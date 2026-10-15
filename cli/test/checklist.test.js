import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { initialState, reduce, render, keyOf, tagWords, runChecklist } from '../src/checklist.js';

const mod = (name, category, extra = {}) => ({ name, description: `${name} does things`, category, tags: [], needs: [], ...extra });
const catalog = [
  mod('heatmap', 'For fun'),
  mod('context-bar', 'See what\'s happening', { tags: ['band', 'command'], description: 'Your context window as one stacked bar' }),
  mod('loose', 'Other'),
  mod('where-am-i', 'See what\'s happening'),
];
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const view = (state, size = {}) => plain(render(state, { columns: 80, rows: 40, color: false, ...size }));
const press = (state, ...keys) => keys.reduce(reduce, state);
const current = (s) => s.rows[s.cursor].mod.name;

test('rows follow README group order, Other last', () => {
  const s = initialState(catalog, []);
  assert.deepEqual(s.rows.map((r) => r.type === 'header' ? `# ${r.category}` : r.mod.name), [
    '# See what\'s happening', 'context-bar', 'where-am-i', '# For fun', 'heatmap', '# Other', 'loose',
  ]);
});

test('cursor starts on the first mod, not a header', () => {
  assert.equal(current(initialState(catalog, [])), 'context-bar');
});

test('down and j skip headers; up and k go back', () => {
  let s = initialState(catalog, []);
  s = press(s, 'down');
  assert.equal(current(s), 'where-am-i');
  s = press(s, 'j');
  assert.equal(current(s), 'heatmap');
  s = press(s, 'k', 'up');
  assert.equal(current(s), 'context-bar');
});

test('cursor stops at both ends', () => {
  let s = initialState(catalog, []);
  assert.equal(current(press(s, 'up')), 'context-bar');
  assert.equal(current(press(s, 'down', 'down', 'down', 'down', 'down')), 'loose');
});

test('ticked set starts from the given names, unknown names dropped', () => {
  assert.deepEqual(initialState(catalog, ['heatmap', 'gone']).ticked, ['heatmap']);
});

test('space ticks and unticks the current mod', () => {
  let s = press(initialState(catalog, []), 'space');
  assert.deepEqual(s.ticked, ['context-bar']);
  s = press(s, 'space');
  assert.deepEqual(s.ticked, []);
});

test('reduce does not mutate the old state', () => {
  const s = initialState(catalog, []);
  press(s, 'space', 'down');
  assert.deepEqual(s.ticked, []);
  assert.equal(current(s), 'context-bar');
});

test('enter applies with ticked names in catalog order', () => {
  const s = press(initialState(catalog, ['loose']), 'space', 'return');
  assert.equal(s.done, 'apply');
  assert.deepEqual(s.ticked, ['context-bar', 'loose']);
});

test('q, escape and ctrl-c quit', () => {
  for (const k of ['q', 'escape', 'ctrl-c']) assert.equal(reduce(initialState(catalog, []), k).done, 'quit');
});

test('unknown keys change nothing', () => {
  const s = initialState(catalog, []);
  assert.equal(reduce(s, 'x'), s);
});

test('p asks for a preview effect for the current mod', () => {
  const s = press(initialState(catalog, []), 'down', 'p');
  assert.deepEqual(s.effect, { type: 'preview', name: 'where-am-i' });
});

test('ticking leaves a tick effect, the next key clears it', () => {
  let s = press(initialState(catalog, []), 'space');
  assert.deepEqual(s.effect, { type: 'tick', name: 'context-bar', ticked: true });
  s = press(s, 'down');
  assert.equal(s.effect, null);
});

test('moving clears the message', () => {
  let s = { ...initialState(catalog, []), message: 'hello' };
  assert.equal(press(s, 'space').message, 'hello');
  assert.equal(press(s, 'down').message, null);
});

test('keyOf maps readline keypresses', () => {
  assert.equal(keyOf(undefined, { name: 'c', ctrl: true }), 'ctrl-c');
  assert.equal(keyOf(undefined, { name: 'down' }), 'down');
  assert.equal(keyOf('j', { name: 'j' }), 'j');
  assert.equal(keyOf('\r', { name: 'return' }), 'return');
  assert.equal(keyOf('\n', { name: 'enter' }), 'return');
  assert.equal(keyOf(' ', { name: 'space' }), 'space');
});

test('tagWords puts tags in words', () => {
  assert.equal(tagWords(['band', 'pane']), 'a line above the prompt, a pane');
  assert.equal(tagWords(['mystery']), 'mystery');
});

test('header shows scope and picked count', () => {
  const out = view(initialState(catalog, ['heatmap', 'loose']));
  assert.match(out.split('\n')[0], /claude-code-mods · everywhere \(user scope\) · 2 picked/);
  assert.match(view(initialState(catalog, [], { scope: 'project' })).split('\n')[0], /this project \(project scope\) · 0 picked/);
});

test('rows show tick marks and the cursor', () => {
  const out = view(press(initialState(catalog, ['heatmap']), 'down'));
  assert.match(out, /^  ◯ context-bar /m);
  assert.match(out, /^▸ ◯ where-am-i /m);
  assert.match(out, /^  ◉ heatmap /m);
  assert.match(out, /^  For fun$/m);
});

test('detail box shows tags in words and the full description', () => {
  const long = 'word '.repeat(40).trim();
  const s = initialState([mod('a', 'For fun', { tags: ['band', 'command'], description: long })], []);
  const out = view(s, { columns: 50 });
  assert.match(out, /── a ─+/);
  assert.match(out, /Adds: a line above the prompt, a command/);
  const words = out.split('── a')[1].match(/word/g).length;
  assert.equal(words, 40);
  for (const line of out.split('\n')) assert.ok(line.length <= 50, `too wide: ${line}`);
});

test('detail box skips Adds when there are no tags, shows message and keys', () => {
  const out = view({ ...initialState(catalog, []), cursor: 2, message: 'Something to say' });
  assert.doesNotMatch(out.split('── where-am-i')[1], /Adds:/);
  assert.match(out, /Something to say/);
  assert.match(out, /↑↓ move · space pick · p preview · enter apply · q quit/);
});

test('lines are cut to the terminal width', () => {
  const out = view(initialState(catalog, []), { columns: 20 });
  for (const line of out.split('\n')) assert.ok(line.length <= 20, `too wide: ${line}`);
});

test('the list scrolls to keep the cursor visible', () => {
  const many = Array.from({ length: 30 }, (_, i) => mod(`m${i}`, 'For fun'));
  let s = initialState(many, []);
  const size = { rows: 15 };
  assert.match(view(s, size), /m0 /);
  for (let i = 0; i < 25; i++) s = reduce(s, 'down');
  const out = view(s, size);
  assert.match(out, /^▸ ◯ m25 /m);
  assert.doesNotMatch(out, /m0 /);
  assert.ok(out.split('\n').length <= 15);
});

test('color uses inverse for the cursor; NO_COLOR-style off has no escapes', () => {
  const s = initialState(catalog, []);
  assert.match(render(s, { columns: 80, rows: 40, color: true }), /\x1b\[7m/);
  assert.doesNotMatch(render(s, { columns: 80, rows: 40, color: false }), /\x1b\[/);
});

const gate = mod('merge-gate', 'Guard your repo', { description: 'Holds gh pr merge until CI and Codex', needs: ['gh', 'codex'] });

test('needs show after the description in the row', () => {
  const out = view(initialState([gate], []));
  assert.match(out, /^▸ ◯ merge-gate {2}Holds gh pr merge until CI and Codex {2}needs gh, codex$/m);
});

test('a narrow row cuts the description first and keeps the needs', () => {
  const out = view(initialState([gate], []), { columns: 45 });
  const row = out.split('\n').find((l) => l.startsWith('▸'));
  assert.ok(row.length <= 45, `too wide: ${row}`);
  assert.match(row, /^▸ ◯ merge-gate {2}Holds gh pr…  needs gh, codex$/);
});

test('a very narrow row is cut whole', () => {
  const out = view(initialState([gate], []), { columns: 20 });
  for (const line of out.split('\n')) assert.ok(line.length <= 20, `too wide: ${line}`);
});

test('needs are dimmed in the row, inside the cursor highlight', () => {
  const out = render(initialState([gate, mod('b', 'Guard your repo', { needs: ['node'] })], []), { columns: 80, rows: 40, color: true });
  assert.match(out, /\x1b\[7m▸ ◯ merge-gate {2}Holds gh pr merge until CI and Codex\x1b\[2m {2}needs gh, codex\x1b\[0m/);
  assert.match(out, / ◯ b {11}b does things\x1b\[2m {2}needs node\x1b\[0m/);
});

test('detail box shows needs; mods without needs show none', () => {
  assert.match(view(initialState([gate], [])), /^ {2}Needs: gh, codex$/m);
  assert.doesNotMatch(view(initialState(catalog, [])), /needs|Needs/);
});

// The loop, driven through fake streams.
function fakeTty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.raw = [];
  input.setRawMode = (on) => input.raw.push(on);
  const output = new PassThrough();
  output.columns = 80;
  output.rows = 30;
  let written = '';
  output.on('data', (d) => (written += d));
  return { input, output, written: () => written };
}

test('runChecklist returns the ticked names on enter and restores the terminal', async () => {
  const t = fakeTty();
  const done = runChecklist({ mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 0 });
  t.input.write(' ');
  t.input.write('\x1b[B');
  t.input.write(' ');
  t.input.write('\r');
  assert.deepEqual(await done, ['context-bar', 'where-am-i']);
  assert.deepEqual(t.input.raw, [true, false]);
  assert.match(t.written(), /\x1b\[\?1049h/);
  assert.match(t.written(), /\x1b\[\?1049l/);
  assert.match(t.written(), /\x1b\[\?25h$/);
});

test('runChecklist returns null on ctrl-c', async () => {
  const t = fakeTty();
  const done = runChecklist({ mods: catalog, ticked: ['heatmap'], input: t.input, output: t.output, color: false, settleMs: 0 });
  t.input.write('\x03');
  assert.equal(await done, null);
  assert.deepEqual(t.input.raw, [true, false]);
});

test('runChecklist hands effects to onEffect and shows its message', async () => {
  const t = fakeTty();
  const seen = [];
  const done = runChecklist({
    mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 0,
    onEffect: async (effect) => { seen.push(effect); return { message: `look at ${effect.name}` }; },
  });
  t.input.write('p');
  await new Promise((r) => setTimeout(r, 10));
  t.input.write('q');
  assert.equal(await done, null);
  assert.deepEqual(seen, [{ type: 'preview', name: 'context-bar' }]);
  assert.match(t.written(), /look at context-bar/);
});

test('runChecklist restores the terminal when onEffect throws', async () => {
  const t = fakeTty();
  const done = runChecklist({
    mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 0,
    onEffect: async () => { throw new Error('nope'); },
  });
  t.input.write('p');
  await assert.rejects(done, /nope/);
  assert.deepEqual(t.input.raw, [true, false]);
});

test('render survives odd mod fields and strips control characters', () => {
  const odd = { name: 'odd', category: 'For fun', description: 'a\x1b[2Jb', tags: 'band', needs: [3, 'g\x07h'] };
  const out = render(initialState([odd], []), { columns: 80, rows: 30, color: false });
  assert.doesNotMatch(out, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  assert.match(out, /a\[2Jb/);
  assert.match(out, /needs gh/);
});

test('q quits while a preview is still loading', async () => {
  const t = fakeTty();
  const done = runChecklist({
    mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 0,
    onEffect: () => new Promise(() => {}),
  });
  t.input.write('p');
  t.input.write('q');
  assert.equal(await done, null);
  assert.deepEqual(t.input.raw, [true, false]);
});

test('a slow effect message shows when it lands', async () => {
  const t = fakeTty();
  let land;
  const done = runChecklist({
    mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 0,
    onEffect: () => new Promise((r) => { land = r; }),
  });
  t.input.write('p');
  await new Promise((r) => setTimeout(r, 10));
  land({ message: 'landed late' });
  await new Promise((r) => setTimeout(r, 10));
  assert.match(t.written(), /landed late/);
  t.input.write('q');
  assert.equal(await done, null);
});

// A stand-in for process: signals and exit, without ending the test run.
function fakeProc() {
  const proc = new EventEmitter();
  proc.exits = [];
  proc.exit = (code) => proc.exits.push(code);
  return proc;
}

test('a failing first draw still restores the terminal', async () => {
  const t = fakeTty();
  let writes = 0;
  const write = t.output.write.bind(t.output);
  t.output.write = (s) => { if (++writes === 2) throw new Error('draw broke'); return write(s); };
  await assert.rejects(
    runChecklist({ mods: catalog, input: t.input, output: t.output, color: false, settleMs: 0, proc: fakeProc() }),
    /draw broke/,
  );
  assert.deepEqual(t.input.raw, [true, false]);
});

test('SIGTERM and SIGHUP restore the terminal, then exit', async () => {
  for (const [sig, code] of [['SIGTERM', 143], ['SIGHUP', 129]]) {
    const t = fakeTty();
    const proc = fakeProc();
    runChecklist({ mods: catalog, input: t.input, output: t.output, color: false, settleMs: 0, proc });
    proc.emit(sig);
    assert.deepEqual(t.input.raw, [true, false]);
    assert.match(t.written(), /\x1b\[\?1049l\x1b\[\?25h$/);
    assert.deepEqual(proc.exits, [code]);
  }
});

test('exit restores the terminal, and listeners go away when done', async () => {
  const t = fakeTty();
  const proc = fakeProc();
  runChecklist({ mods: catalog, input: t.input, output: t.output, color: false, settleMs: 0, proc });
  proc.emit('exit');
  assert.deepEqual(t.input.raw, [true, false]);

  const u = fakeTty();
  const p2 = fakeProc();
  const done = runChecklist({ mods: catalog, input: u.input, output: u.output, color: false, settleMs: 0, proc: p2 });
  assert.ok(p2.listenerCount('SIGTERM') > 0);
  u.input.write('q');
  await done;
  for (const e of ['exit', 'SIGTERM', 'SIGHUP']) assert.equal(p2.listenerCount(e), 0);
});

test('a late message is dropped once the cursor has moved on', async () => {
  const t = fakeTty();
  let land;
  const done = runChecklist({
    mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 0,
    onEffect: () => new Promise((r) => { land = r; }), proc: fakeProc(),
  });
  t.input.write('p');
  t.input.write('j');
  await new Promise((r) => setTimeout(r, 10));
  land({ message: 'for the old row' });
  await new Promise((r) => setTimeout(r, 10));
  assert.doesNotMatch(t.written(), /for the old row/);
  t.input.write('q');
  await done;
});

test('runChecklist ignores keys typed before the list was drawn, like the Enter from npx\'s prompt', async () => {
  const t = fakeTty();
  const done = runChecklist({ mods: catalog, ticked: [], input: t.input, output: t.output, color: false, settleMs: 50 });
  t.input.write('\r');
  await new Promise((r) => setTimeout(r, 80));
  t.input.write(' ');
  t.input.write('\r');
  assert.deepEqual(await done, ['context-bar']);
});
