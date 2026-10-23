// Parse flags, wire the rest, exit codes.
import { homedir } from 'node:os';
import { sep, join, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadAll as defaultLoadCatalog, groupByCategory, clean, tidy } from './catalog.js';
import { run as defaultRun } from './claude.js';
import { readState, planActions, toArgs, toShell, MARKET } from './plan.js';
import { runChecklist } from './checklist.js';
import { optionsLoader, collect, save, createPrompt } from './options.js';
import { missing, warning } from './needs.js';
import { preview } from './preview.js';

export const USAGE = `Usage: claude-code-mods [--pick a,b] [--project] [--dry-run] [--yes-community]

  --pick a,b       Turn on exactly these mods (--pick "" turns all off)
  --project        Install and toggle for this project only
  --dry-run        Print the claude commands instead of running them
  --yes-community  Install picked community mods without asking (needed outside a terminal)
  --help           Show this help`;

export function parseArgs(argv) {
  const opts = { pick: null, dryRun: false, project: false, help: false, yesCommunity: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--project') opts.project = true;
    else if (a === '--yes-community') opts.yesCommunity = true;
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
const label = (a) => a.verb === 'marketplace' ? `add the ${a.market || MARKET} marketplace`
  : a.verb === 'refresh' ? `update the ${a.market || MARKET} marketplace` : `${a.verb} ${a.name}`;
const doneLabel = (a) => a.verb === 'marketplace' ? `added the ${a.market || MARKET} marketplace`
  : a.verb === 'refresh' ? `updated the ${a.market || MARKET} marketplace` : `${DONE[a.verb]} ${a.name}`;
// Shown when a community mod is ticked: it is someone else's code.
export const communityNote = (m) => `Community mod by @${m.author}, not maintained here. Read its code first: ${m.url}`;
// Asked once before any new community mod installs. Default is no.
export const communityWarning = (list) => [
  `${list.length === 1 ? 'This community mod is' : 'These community mods are'} third-party code, not reviewed or maintained here:`,
  ...list.map((m) => `  ${m.name} by @${m.author} (${m.repo})`),
  "Each installs from its author's own marketplace at the latest version, which can change at any time.",
].join('\n');
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

// CLAUDE_CONFIG_DIR without trailing slashes, or null.
const configEnv = (env) => (env.CLAUDE_CONFIG_DIR || '').replace(/(.)\/+$/, '$1') || null;

// The profile claude uses here: CLAUDE_CONFIG_DIR, or ~/.claude.
export function profileLabel(env = process.env, home = homedir()) {
  const dir = configEnv(env);
  if (!dir) return '~/.claude';
  return dir === home || dir.startsWith(home + sep) ? '~' + dir.slice(home.length) : dir;
}

// The band order file the band mods read, in that same profile.
export function bandsPath(env = process.env, home = homedir()) {
  return join(configEnv(env) || join(home, '.claude'), 'claude-code-mods', 'bands.json');
}

// The file's names, top to bottom, each once; a missing or odd file means no order, as in the mods.
export function parseBandOrder(text) {
  try {
    const { order } = JSON.parse(text);
    return Array.isArray(order) && order.every((n) => typeof n === 'string') ? [...new Set(order)] : [];
  } catch {
    return [];
  }
}

const bandsJson = (order) => JSON.stringify({ order }, null, 2) + '\n';
const readText = (path) => readFile(path, 'utf8');
async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
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
  env = process.env,
  home = homedir(),
  readText: read = readText,
  writeText: write = writeText,
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
    const community = mods.filter((m) => m.marketplace);
    let state;
    if (opts.pick === null) {
      if (!isTTY) {
        printList(mods, out);
        err('\nRun in a terminal, or pass --pick');
        return 1;
      }
      state = readState(await listJson(run, ['plugin', 'list', '--json']), { scope, cwd, community });
      const ticked = Object.keys(state).filter((n) => state[n].enabled);
      const bandsFile = bandsPath(env, home);
      const bandOrder = parseBandOrder(await read(bandsFile).catch(() => null));
      let savedOrder = bandOrder; // what is on disk, put back if a save fails
      let dryBands = null;
      // Ticks warn about missing tools; p opens the screenshot; the order screen saves bands.json.
      const onEffect = async (e) => {
        if (e.type === 'preview') {
          const mod = mods.find((m) => m.name === e.name);
          return mod?.marketplace ? { message: `No screenshot here, see ${mod.url}` } : showPreview(e.name);
        }
        if (e.type === 'order') {
          const text = bandsJson(e.order);
          if (opts.dryRun) {
            dryBands = `would write ${bandsFile}\n${text.trimEnd()}`;
            return { message: `Dry run: would write ${bandsFile}: ${JSON.stringify({ order: e.order })}` };
          }
          try {
            await write(bandsFile, text);
            savedOrder = e.order;
            return { message: 'Saved. Restart Claude Code to apply.' };
          } catch (failure) {
            return { message: `Could not save the band order: ${failure.message}`, bandOrder: savedOrder };
          }
        }
        if (e.type !== 'tick' || !e.ticked) return null;
        const mod = mods.find((m) => m.name === e.name);
        if (mod?.marketplace) return { message: communityNote(mod) };
        const msg = warning(e.name, checkNeeds(mod?.needs || []));
        return msg ? { message: msg } : null;
      };
      opts.pick = await checklist({ mods, ticked, scope, onEffect, profile: profileLabel(env, home), bandOrder });
      if (dryBands) out(dryBands);
      if (!opts.pick) return 0;
    }
    const names = new Set(mods.map((m) => m.name));
    const byName = (n) => mods.find((m) => m.name === n);
    const unknown = opts.pick.filter((n) => !names.has(n));
    if (unknown.length) {
      err(`Unknown mod: ${unknown.join(', ')}`);
      return 1;
    }

    state ??= readState(await listJson(run, ['plugin', 'list', '--json']), { scope, cwd, community });
    const catalog = [...names];
    let actions = planActions({ state, picked: opts.pick, scope, catalog, community });
    let markets;
    if (actions.some((a) => a.verb === 'install' || a.verb === 'enable')) {
      markets = (await listJson(run, ['plugin', 'marketplace', 'list', '--json'])).map((m) => m.name);
      actions = planActions({ state, picked: opts.pick, scope, catalog, community, markets });
    }
    // Options come from our repo's plugin.json, so only our own mods are asked.
    const ours = (name) => !byName(name)?.marketplace;

    // New community mods need a yes first: --yes-community, or an answer in a terminal.
    // Already installed ones only get enabled or disabled, so they are not asked.
    const fresh = actions.filter((a) => a.verb === 'install' && !ours(a.name)).map((a) => byName(a.name));
    let confirmed = false;
    let dropped = false; // mods asked for by name that were left out: the run did not do it all
    if (fresh.length && !opts.yesCommunity) {
      const list = fresh.map((m) => m.name).join(', ');
      const question = `Install ${fresh.length === 1 ? 'it' : 'them'}? (y/N) `;
      if (!isTTY) {
        err(`Skipped community mods: ${list}. They are third-party code; pass --yes-community to install them.`);
        dropped = true;
      } else if (opts.dryRun) {
        out(`${communityWarning(fresh)}\nwould ask: ${question.trim()}`);
        confirmed = true;
      } else {
        out(communityWarning(fresh));
        const prompt = makePrompt();
        let answer = '';
        try {
          answer = await prompt.ask(question);
        } catch (e) {
          if (e.code !== 'ABORT') throw e;
          // Ctrl-C or Ctrl-D: stop here, as the checklist does. Nothing has changed yet.
          out('\nStopped, nothing changed.');
          return 130;
        } finally { prompt.close(); }
        confirmed = /^(y|yes)$/i.test(String(answer).trim());
        if (!confirmed) out(`Skipped community mods: ${list}.`);
      }
      if (!confirmed) {
        const skip = new Set(fresh.map((m) => m.name));
        opts.pick = opts.pick.filter((n) => !skip.has(n));
        actions = planActions({ state, picked: opts.pick, scope, catalog, community, markets });
      }
    }

    if (!actions.length) {
      out('Nothing to change.');
      return dropped ? 1 : 0;
    }
    // Someone else's code is about to turn on: say so first (unless just asked).
    for (const a of actions.filter((a) => (a.verb === 'install' || a.verb === 'enable') && !ours(a.name))) {
      if (!(confirmed && a.verb === 'install')) out(communityNote(byName(a.name)));
    }
    if (opts.dryRun) {
      for (const a of actions) out(toShell(a));
      for (const a of actions.filter((a) => a.verb === 'install' && ours(a.name))) {
        const keys = Object.keys(await loadOptions(byName(a.name)));
        if (keys.length) out(`would ask ${a.name}: ${keys.join(', ')}`);
      }
      return dropped ? 1 : 0;
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
      if (r.code === 0 && a.verb === 'install' && ours(a.name)) installed.push(a.name);
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
    return stopped ? 130 : failed || dropped ? 1 : 0;
  } catch (e) {
    err(e.code === 'ENOENT' ? 'Install Claude Code first: the claude command was not found.' : e.message);
    return 1;
  }
}
