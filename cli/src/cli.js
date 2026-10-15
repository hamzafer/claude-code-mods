// Parse flags, wire the rest, exit codes.
import { loadCatalog as defaultLoadCatalog, groupByCategory, clean, tidy } from './catalog.js';
import { run as defaultRun } from './claude.js';
import { readState, planActions, toArgs, toShell, MARKET } from './plan.js';
import { runChecklist } from './checklist.js';
import { optionsLoader, collect, save, createPrompt } from './options.js';
import { missing, warning } from './needs.js';
import { preview } from './preview.js';

export const USAGE = `Usage: claude-code-mods [--pick a,b] [--project] [--dry-run]

  --pick a,b   Turn on exactly these mods (--pick "" turns all off)
  --project    Install and toggle for this project only
  --dry-run    Print the claude commands instead of running them
  --help       Show this help`;

export function parseArgs(argv) {
  const opts = { pick: null, dryRun: false, project: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--project') opts.project = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--pick' || a.startsWith('--pick=')) {
      const value = a === '--pick' ? argv[++i] : a.slice('--pick='.length);
      if (value === undefined) throw new Error('--pick needs a list of mods');
      opts.pick = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else throw new Error(`Unknown flag: ${a}`);
  }
  return opts;
}

const DONE = { install: 'installed', enable: 'enabled', disable: 'disabled' };
const label = (a) => a.verb === 'marketplace' ? `add the ${MARKET} marketplace`
  : a.verb === 'refresh' ? `update the ${MARKET} marketplace` : `${a.verb} ${a.name}`;
const doneLabel = (a) => a.verb === 'marketplace' ? `added the ${MARKET} marketplace`
  : a.verb === 'refresh' ? `updated the ${MARKET} marketplace` : `${DONE[a.verb]} ${a.name}`;
const firstLine = (s) => clean(String(s).trim().split('\n')[0]).trim();

async function listJson(run, args) {
  const r = await run(args);
  if (r.code !== 0) throw new Error(`claude ${args.join(' ')} failed: ${firstLine(r.stderr || r.stdout)}`);
  return JSON.parse(r.stdout);
}

function printList(mods, out) {
  mods = mods.map(tidy);
  const width = Math.max(...mods.map((m) => m.name.length));
  const blocks = groupByCategory(mods).map((g) =>
    [g.category, ...g.mods.map((m) => `  ${m.name.padEnd(width)}  ${m.description}`)].join('\n'));
  out(blocks.join('\n\n'));
}

export async function main(argv, {
  run = defaultRun,
  loadCatalog = defaultLoadCatalog,
  out = console.log,
  err = console.error,
  cwd = process.cwd(),
  loadOptions = optionsLoader(run),
  makePrompt = createPrompt,
  isTTY = !!(process.stdin.isTTY && process.stdout.isTTY),
  checklist = runChecklist,
  checkNeeds = missing,
  showPreview = preview,
} = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err(`${e.message}\n\n${USAGE}`);
    return 1;
  }
  if (opts.help) {
    out(USAGE);
    return 0;
  }

  try {
    const mods = await loadCatalog();
    if (!mods.length) {
      err('The mod list is empty. Try again later, or update claude-code-mods.');
      return 1;
    }
    const scope = opts.project ? 'project' : 'user';
    let state;
    if (opts.pick === null) {
      if (!isTTY) {
        printList(mods, out);
        err('\nRun in a terminal, or pass --pick');
        return 1;
      }
      state = readState(await listJson(run, ['plugin', 'list', '--json']), { scope, cwd });
      const ticked = Object.keys(state).filter((n) => state[n].enabled);
      // Ticks warn about missing tools; p opens the screenshot.
      const onEffect = async (e) => {
        if (e.type === 'preview') return showPreview(e.name);
        if (e.type !== 'tick' || !e.ticked) return null;
        const msg = warning(e.name, checkNeeds(mods.find((m) => m.name === e.name)?.needs || []));
        return msg ? { message: msg } : null;
      };
      opts.pick = await checklist({ mods, ticked, scope, onEffect });
      if (!opts.pick) return 0;
    }
    const names = new Set(mods.map((m) => m.name));
    const byName = (n) => mods.find((m) => m.name === n);
    const unknown = opts.pick.filter((n) => !names.has(n));
    if (unknown.length) {
      err(`Unknown mod: ${unknown.join(', ')}`);
      return 1;
    }

    state ??= readState(await listJson(run, ['plugin', 'list', '--json']), { scope, cwd });
    const catalog = [...names];
    let actions = planActions({ state, picked: opts.pick, scope, catalog });
    if (actions.some((a) => a.verb === 'install' || a.verb === 'enable')) {
      const markets = await listJson(run, ['plugin', 'marketplace', 'list', '--json']);
      actions = planActions({ state, picked: opts.pick, scope, catalog, hasMarketplace: markets.some((m) => m.name === MARKET) });
    }

    if (!actions.length) {
      out('Nothing to change.');
      return 0;
    }
    if (opts.dryRun) {
      for (const a of actions) out(toShell(a));
      for (const a of actions.filter((a) => a.verb === 'install')) {
        const keys = Object.keys(await loadOptions(byName(a.name)));
        if (keys.length) out(`would ask ${a.name}: ${keys.join(', ')}`);
      }
      return 0;
    }

    let failed = 0;
    const report = (r, ok, bad) => {
      if (r.code === 0) return out(`✓ ${ok}`);
      failed++;
      out(`✗ ${bad} (${firstLine(r.stderr || r.stdout || `exit ${r.code}`)})`);
    };
    const installed = [];
    for (const a of actions) {
      const r = await run(toArgs(a));
      report(r, doneLabel(a), label(a));
      if (r.code === 0 && a.verb === 'install') installed.push(a.name);
    }
    // Options for newly installed mods, in a terminal only; elsewhere, say how.
    let stopped = false;
    for (const name of installed) {
      const userConfig = await loadOptions(byName(name));
      if (!Object.keys(userConfig).length) continue;
      if (!isTTY) {
        out(`${name} has options: run claude plugin configure ${name}@${MARKET}`);
        continue;
      }
      out(`\nOptions for ${name} (Enter keeps the default)`);
      const prompt = makePrompt();
      let answers;
      try {
        answers = await collect(userConfig, prompt.ask, out);
      } catch (e) {
        if (e.code !== 'ABORT') throw e;
        // Ctrl-C or Ctrl-D: the mods are in, only their options wait.
        out(`\nSkipped configuring. Later: claude plugin configure <mod>@${MARKET}`);
        stopped = true;
        break;
      } finally { prompt.close(); }
      const r = await save(run, `${name}@${MARKET}`, answers);
      if (r) report(r, `configured ${name}`, `configure ${name}`);
    }
    out('\nRestart Claude Code to load your mods.');
    return stopped ? 130 : failed ? 1 : 0;
  } catch (e) {
    err(e.code === 'ENOENT' ? 'Install Claude Code first: the claude command was not found.' : e.message);
    return 1;
  }
}
