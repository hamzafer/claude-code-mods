// The checklist: pure state, keys -> new state, state -> string. A thin raw-mode loop drives it.
import { emitKeypressEvents } from 'node:readline';
import { groupByCategory, tidy, clean } from './catalog.js';

const TAGS = {
  band: 'a line above the prompt',
  pane: 'a pane',
  statusline: 'a status line',
  guard: 'a guard on tool calls',
  toast: 'a toast',
  command: 'a command',
};
const SCOPES = { user: 'everywhere (user scope)', project: 'this project (project scope)' };
export const HINTS = ['↑↓ move', 'space pick', 'p preview', 'o order', 'enter apply', 'q quit'];
export const ORDER_HINTS = ['↑↓ move', '⇧↑ ⇧↓ or K J reorder', 'enter save', 'esc back'];

export const tagWords = (tags) => tags.map((t) => TAGS[t] || t).join(', ');

export function initialState(catalog, ticked, { scope = 'user', profile, bandOrder = [] } = {}) {
  const rows = [];
  for (const g of groupByCategory(catalog.map(tidy))) {
    rows.push({ type: 'header', category: g.category });
    for (const mod of g.mods) rows.push({ type: 'mod', mod });
  }
  const names = new Set(ticked);
  return {
    rows,
    scope,
    profile,
    cursor: rows.findIndex((r) => r.type === 'mod'),
    ticked: rows.filter((r) => r.type === 'mod' && names.has(r.mod.name)).map((r) => r.mod.name),
    message: null, // shown in the detail box, cleared on move
    effect: null, // for the loop to act on: { type: 'preview' | 'tick', name } or { type: 'order', order }
    done: null, // 'apply' | 'quit'
    screen: 'list', // 'list' | 'order'
    bandOrder, // the order file's names, top to bottom
    order: null, // on the order screen: { names, cursor }
  };
}

// The ticked bands as the mods stack them: bands not in the file on top, then file order.
function bandsInOrder(state) {
  const bands = state.rows
    .filter((r) => r.type === 'mod' && r.mod.tags.includes('band') && state.ticked.includes(r.mod.name))
    .map((r) => r.mod.name);
  const listed = state.bandOrder.filter((n) => bands.includes(n));
  return [...bands.filter((n) => !listed.includes(n)), ...listed];
}

function reduceOrder(state, key) {
  const { names, cursor } = state.order;
  const to = (c) => ({ ...state, order: { names, cursor: c } });
  const swap = (step) => {
    const j = cursor + step;
    if (j < 0 || j >= names.length) return state;
    const next = [...names];
    [next[cursor], next[j]] = [next[j], next[cursor]];
    return { ...state, order: { names: next, cursor: j } };
  };
  switch (key) {
    case 'up': case 'k': return cursor > 0 ? to(cursor - 1) : state;
    case 'down': case 'j': return cursor < names.length - 1 ? to(cursor + 1) : state;
    case 'shift-up': case 'K': return swap(-1);
    case 'shift-down': case 'J': return swap(1);
    case 'return': {
      // Names in the old file that are not ticked now keep their place after.
      const order = [...names, ...state.bandOrder.filter((n) => !names.includes(n))];
      return { ...state, screen: 'list', order: null, bandOrder: order, effect: { type: 'order', order } };
    }
    case 'q': case 'escape': return { ...state, screen: 'list', order: null };
    case 'ctrl-c': return { ...state, done: 'quit' };
    default: return state;
  }
}

function move(state, step) {
  for (let i = state.cursor + step; i >= 0 && i < state.rows.length; i += step) {
    if (state.rows[i].type === 'mod') return { ...state, cursor: i, message: null };
  }
  return state;
}

export function reduce(state, key) {
  const s = state.effect ? { ...state, effect: null } : state;
  if (s.screen === 'order') return reduceOrder(s, key);
  const name = s.rows[s.cursor]?.mod.name;
  switch (key) {
    case 'up': case 'k': return move(s, -1);
    case 'down': case 'j': return move(s, 1);
    case 'space': {
      const on = !s.ticked.includes(name);
      const set = new Set(on ? [...s.ticked, name] : s.ticked.filter((n) => n !== name));
      const ticked = s.rows.filter((r) => r.type === 'mod' && set.has(r.mod.name)).map((r) => r.mod.name);
      return { ...s, ticked, effect: { type: 'tick', name, ticked: on } };
    }
    case 'p': return { ...s, effect: { type: 'preview', name } };
    case 'o': {
      const names = bandsInOrder(s);
      if (!names.length) return { ...s, message: 'Tick a band mod first.' };
      return { ...s, screen: 'order', order: { names, cursor: 0 } };
    }
    case 'return': return { ...s, done: 'apply' };
    case 'q': case 'escape': case 'ctrl-c': return { ...s, done: 'quit' };
    default: return state;
  }
}

// readline keypress -> the key names reduce() knows.
export function keyOf(str, key = {}) {
  if (key.ctrl && key.name === 'c') return 'ctrl-c';
  if (key.name === 'enter') return 'return';
  if (key.shift && (key.name === 'up' || key.name === 'down')) return `shift-${key.name}`;
  if (key.shift && (key.name === 'j' || key.name === 'k')) return key.name.toUpperCase();
  return key.name || str;
}

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const cut = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);

function renderOrder(state, { columns, rows, bold, dim, inverse }) {
  const fit = (s) => cut(s, columns);
  const { names, cursor } = state.order;
  const head = [bold(fit(['  Band order', state.profile].filter(Boolean).join(' · '))), dim(fit('  top'))];
  const foot = [dim(fit('  ── your prompt ──')), dim(fit(`  ${ORDER_HINTS.join(' · ')}`))];
  const height = Math.max(3, rows - head.length - foot.length);
  let top = 0;
  if (names.length > height && cursor >= height - 1) top = Math.min(cursor - height + 2, names.length - height);
  const list = names.slice(top, top + height).map((n, i) => {
    const here = top + i === cursor;
    const line = fit(`  ${here ? '▸' : ' '} ${clean(n)}`);
    return here ? inverse(line) : line;
  });
  return [...head, ...list, ...foot].join('\n');
}

export function render(state, { columns = 80, rows = 24, color = !process.env.NO_COLOR } = {}) {
  const st = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const [bold, dim, inverse] = [st(1), st(2), st(7)];
  if (state.screen === 'order') return renderOrder(state, { columns, rows, bold, dim, inverse });
  const fit = (s) => cut(s, columns);
  const current = state.rows[state.cursor].mod;
  const width = Math.max(...state.rows.filter((r) => r.type === 'mod').map((r) => r.mod.name.length));

  const where = [state.profile, SCOPES[state.scope] || state.scope].filter(Boolean).join(' · ');
  const head = [bold(fit(`  claude-code-mods · ${where} · ${state.ticked.length} picked`)), ''];

  const inner = Math.max(10, columns - 4);
  const rule = `  ── ${current.name} `;
  const detail = [
    '',
    dim(fit(rule + '─'.repeat(Math.max(0, columns - rule.length - 2)))),
    ...(current.tags.length ? wrap(`Adds: ${tagWords(current.tags)}`, inner).map((l) => `  ${l}`) : []),
    ...wrap(current.description, inner).map((l) => `  ${l}`),
    ...(current.needs?.length ? wrap(`Needs: ${current.needs.join(', ')}`, inner).map((l) => dim(`  ${l}`)) : []),
    ...(state.message ? wrap(clean(state.message), inner).map((l) => bold(`  ${l}`)) : []),
    dim(fit(`  ${HINTS.join(' · ')}`)),
  ];

  // Keep the cursor in view, with one row of context below when scrolling.
  const height = Math.max(3, rows - head.length - detail.length);
  const all = state.rows;
  let top = 0;
  if (all.length > height && state.cursor >= height - 1) top = Math.min(state.cursor - height + 2, all.length - height);
  const list = all.slice(top, top + height).map((r, i) => {
    if (r.type === 'header') return bold(fit(`  ${r.category}`));
    const on = state.ticked.includes(r.mod.name);
    const here = top + i === state.cursor;
    const start = `${here ? '▸' : ' '} ${on ? '◉' : '◯'} ${r.mod.name.padEnd(width)}  `;
    const needs = r.mod.needs?.length ? `  needs ${r.mod.needs.join(', ')}` : '';
    const room = columns - start.length - needs.length;
    // Too narrow to keep the needs readable: cut the whole row instead.
    if (!needs || room < 8) {
      const line = fit(start + r.mod.description);
      return here ? inverse(line) : line;
    }
    const main = start + cut(r.mod.description, room);
    if (!color) return main + needs;
    return `${here ? '\x1b[7m' : ''}${main}\x1b[2m${needs}\x1b[0m`;
  });

  return [...head, ...list, ...detail].join('\n');
}

// Runs until apply (resolves the ticked names) or quit (resolves null).
// onEffect(effect, state) may return a patch, e.g. { message }, to show when it lands.
// The terminal is restored on every way out: keys, errors, exit and SIGTERM/SIGHUP.
export function runChecklist({
  mods, ticked = [], scope = 'user',
  input = process.stdin, output = process.stdout,
  color = !process.env.NO_COLOR,
  onEffect = async () => null,
  proc = process,
  settleMs = 250,
  profile,
  bandOrder = [],
}) {
  let state = initialState(mods, ticked, { scope, profile, bandOrder });
  const draw = () => {
    const frame = render(state, { columns: output.columns || 80, rows: output.rows || 24, color });
    output.write('\x1b[H\x1b[2J' + frame.split('\n').join('\r\n'));
  };

  return new Promise((resolve, reject) => {
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      input.off('keypress', onKey);
      output.off('resize', draw);
      for (const [sig, fn] of Object.entries(onSignal)) proc.off(sig, fn);
      proc.off('exit', restore);
      try { if (input.isTTY) input.setRawMode(false); } catch {}
      input.pause();
      try { output.write('\x1b[?1049l\x1b[?25h'); } catch {}
    };
    const finish = (fn) => { restore(); fn(); };
    const fail = (e) => {
      state = { ...state, done: 'quit' };
      finish(() => reject(e));
    };
    // 128 + signal number, as shells report it.
    const onSignal = {
      SIGTERM: () => { restore(); proc.exit(143); },
      SIGHUP: () => { restore(); proc.exit(129); },
    };
    const onKey = (str, key) => {
      if (state.done) return;
      // An Enter typed before the list showed (npx's "Ok to proceed?") would apply at once; drop it.
      if (key?.name === 'return' && Date.now() < readyAt) return;
      try {
        state = reduce(state, keyOf(str, key));
        if (state.done) return finish(() => resolve(state.done === 'apply' ? state.ticked : null));
        // Effects run on the side, so keys (and quitting) never wait on them.
        if (state.effect) {
          const at = state.cursor;
          Promise.resolve(onEffect(state.effect, state)).then((patch) => {
            if (!patch || state.done || state.cursor !== at) return;
            state = { ...state, ...patch };
            draw();
          }).catch((e) => { if (!state.done) fail(e); });
        }
        draw();
      } catch (e) {
        fail(e);
      }
    };

    const readyAt = Date.now() + settleMs;
    try {
      proc.once('exit', restore);
      for (const [sig, fn] of Object.entries(onSignal)) proc.once(sig, fn);
      emitKeypressEvents(input);
      if (input.isTTY) input.setRawMode(true);
      input.on('keypress', onKey);
      output.on('resize', draw);
      input.resume();
      output.write('\x1b[?1049h\x1b[?25l');
      draw();
    } catch (e) {
      fail(e);
    }
  });
}
