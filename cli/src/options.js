// A mod's userConfig: read it, ask for it, check it, save it.
import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import readline from 'node:readline';
import { MARKET, MARKET_REPO } from './plan.js';
import { clean, cleanList } from './catalog.js';

export const rawUrl = (name) =>
  `https://raw.githubusercontent.com/${MARKET_REPO}/main/mods/${name}/.claude-plugin/plugin.json`;

// Where claude cloned our marketplace, or null.
export async function marketLocation(run) {
  try {
    const r = await run(['plugin', 'marketplace', 'list', '--json']);
    if (r.code !== 0) return null;
    return JSON.parse(r.stdout).find((m) => m.name === MARKET)?.installLocation || null;
  } catch {
    return null;
  }
}

const asConfig = (c) => (c && typeof c === 'object' && !Array.isArray(c) ? c : {});

// Raw GitHub first (the clone may be stale), then the clone when offline. {} when neither loads.
export async function loadOptions(mod, {
  location,
  readFile = fsReadFile,
  fetch = globalThis.fetch,
  timeoutMs = 3000,
} = {}) {
  try {
    const res = await fetch(rawUrl(mod.name), { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return asConfig((await res.json())?.userConfig);
  } catch {}
  if (location) {
    try {
      const file = join(location, mod.source || `./mods/${mod.name}`, '.claude-plugin', 'plugin.json');
      return asConfig(JSON.parse(await readFile(file, 'utf8'))?.userConfig);
    } catch {}
  }
  return {};
}

// loadOptions with the clone looked up once, when first needed.
export function optionsLoader(run, deps = {}) {
  let location;
  return async (mod) => loadOptions(mod, { ...deps, location: await (location ??= marketLocation(run)) });
}

// raw -> { value } (undefined means keep the default) or { error }.
export function validate(option, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: undefined };
  if (option.type === 'number') {
    const n = Number(s);
    if (!Number.isFinite(n)) return { error: 'Enter a number.' };
    if (option.min !== undefined && n < option.min) return { error: `At least ${option.min}.` };
    if (option.max !== undefined && n > option.max) return { error: `At most ${option.max}.` };
    return { value: s };
  }
  if (option.type === 'boolean') {
    if (/^(y|yes|true)$/i.test(s)) return { value: 'true' };
    if (/^(n|no|false)$/i.test(s)) return { value: 'false' };
    return { error: 'Enter y or n.' };
  }
  if (Array.isArray(option.options) && option.options.length && !option.options.includes(s)) {
    return { error: `One of: ${cleanList(option.options).join(', ')}.` };
  }
  return { value: s };
}

const shown = (option, v) => option.type === 'boolean' ? (v ? 'y' : 'n') : String(v);

// Asks each option until valid. Returns only the answers that differ from the default.
export async function collect(userConfig, ask, out = console.log) {
  const answers = {};
  for (const [key, option] of Object.entries(userConfig)) {
    if (!option || typeof option !== 'object') continue;
    const choices = cleanList(option.options);
    const hint = option.type === 'boolean' ? ' (y/n)' : choices.length ? ` (${choices.join(', ')})` : '';
    out(`${clean(option.title) || clean(key)}${hint}`);
    const about = clean(option.description);
    if (about) out(`\x1b[2m${about}\x1b[22m`);
    const prefill = option.default !== undefined && option.default !== '' && !option.sensitive
      ? shown(option, option.default) : undefined;
    for (;;) {
      const r = validate(option, await ask('> ', { sensitive: !!option.sensitive, prefill }));
      if (r.error) { out(r.error); continue; }
      const same = r.value !== undefined && prefill !== undefined && validate(option, prefill).value === r.value;
      if (r.value !== undefined && !same) answers[key] = r.value;
      break;
    }
  }
  return answers;
}

// Null when there is nothing to send.
export async function save(run, id, answers) {
  if (!Object.keys(answers).length) return null;
  return run(['plugin', 'configure', id, '--values-stdin'], { input: JSON.stringify(answers) });
}

// Printable characters become `*`; escape sequences (cursor moves, backspace redraws) pass through.
export const maskText = (s) =>
  s.replace(/(\x1b\[[0-9;?]*[ -\/]*[@-~])|[^\x00-\x1f\x7f-\x9f]/g, (m, esc) => esc || '*');

// Line input. Sensitive answers echo `*`; prefill puts the default on the line.
// Ctrl-C or Ctrl-D rejects the pending question with code ABORT.
export function createPrompt({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output, terminal: true });
  const write = rl._writeToOutput.bind(rl);
  let mask = false, pending = null, closed = false;
  rl._writeToOutput = (s) => write(mask ? maskText(s) : s);
  rl.on('SIGINT', () => rl.close());
  rl.on('close', () => {
    closed = true;
    pending?.(Object.assign(new Error('Stopped'), { code: 'ABORT' }));
  });
  return {
    ask(question, { sensitive = false, prefill } = {}) {
      output.write(question);
      return new Promise((resolve, reject) => {
        if (closed) return reject(Object.assign(new Error('Stopped'), { code: 'ABORT' }));
        mask = sensitive;
        pending = reject;
        rl.question('', (a) => { mask = false; pending = null; resolve(a); });
        if (prefill) rl.write(prefill);
      });
    },
    close: () => rl.close(),
  };
}
