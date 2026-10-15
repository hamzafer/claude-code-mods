import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main, profileLabel, bandsPath, parseBandOrder } from '../src/cli.js';

const catalog = [
  { name: 'context-bar', description: 'A bar', category: 'See what\'s happening', tags: [], needs: [] },
  { name: 'heatmap', description: 'A grid', category: 'For fun', tags: [], needs: [] },
  { name: 'where-am-i', description: 'Where', category: 'See what\'s happening', tags: [], needs: [] },
];

// Fake claude: answers list calls from fixtures, records everything else.
function fakeClaude({ plugins = [], markets = [{ name: 'claude-code-mods' }], fail = [] } = {}) {
  const calls = [];
  const run = async (args, opts) => {
    const line = args.join(' ');
    calls.push(line);
    if (line === 'plugin list --json') return { code: 0, stdout: JSON.stringify(plugins), stderr: '' };
    if (line === 'plugin marketplace list --json') return { code: 0, stdout: JSON.stringify(markets), stderr: '' };
    if (fail.some((f) => line.includes(f))) return { code: 1, stdout: '', stderr: 'boom\nmore' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

async function go(argv, claude = fakeClaude(), extra = {}) {
  const out = [], err = [];
  const code = await main(argv, {
    run: claude.run,
    loadCatalog: async () => catalog,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    cwd: '/work/a',
    loadOptions: async () => ({}),
    isTTY: false,
    ...extra,
  });
  return { code, out: out.join('\n'), err: err.join('\n'), calls: claude.calls };
}

const installed = [
  { id: 'context-bar@claude-code-mods', scope: 'user', enabled: true },
  { id: 'heatmap@claude-code-mods', scope: 'user', enabled: false },
];

test('parseArgs reads every flag', () => {
  assert.deepEqual(parseArgs(['--pick', 'a,b', '--dry-run', '--project']), {
    pick: ['a', 'b'], dryRun: true, project: true, help: false,
  });
  assert.deepEqual(parseArgs(['--pick=a, b']).pick, ['a', 'b']);
  assert.equal(parseArgs([]).pick, null);
  assert.equal(parseArgs(['--help']).help, true);
});

test('--pick "" means none', () => {
  assert.deepEqual(parseArgs(['--pick', '']).pick, []);
});

test('parseArgs rejects unknown flags and a bare --pick', () => {
  assert.throws(() => parseArgs(['--nope']), /--nope/);
  assert.throws(() => parseArgs(['--pick']), /--pick/);
});

test('--help prints usage and exits 0', async () => {
  const r = await go(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage: claude-code-mods/);
  assert.deepEqual(r.calls, []);
});

test('an unknown flag prints usage and exits 1', async () => {
  const r = await go(['--yes']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Unknown flag: --yes/);
  assert.match(r.err, /Usage: claude-code-mods/);
});

test('unknown names in --pick exit 1 and are named', async () => {
  const r = await go(['--pick', 'context-bar,nope,zilch']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Unknown mod: nope, zilch/);
  assert.deepEqual(r.calls, []);
});

test('a missing claude command exits 1', async () => {
  const run = async () => { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); };
  const r = await go(['--pick', 'heatmap'], { run, calls: [] });
  assert.equal(r.code, 1);
  assert.match(r.err, /Install Claude Code first/);
});

test('a failing plugin list exits 1', async () => {
  const run = async () => ({ code: 1, stdout: '', stderr: 'bad' });
  const r = await go(['--pick', 'heatmap'], { run, calls: [] });
  assert.equal(r.code, 1);
  assert.match(r.err, /bad/);
});

test('--dry-run prints one shell line per command and runs none', async () => {
  const claude = fakeClaude({ plugins: installed, markets: [] });
  const r = await go(['--pick', 'heatmap,where-am-i', '--dry-run'], claude);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.split('\n'), [
    'claude plugin marketplace add hamzafer/claude-code-mods',
    'claude plugin install where-am-i@claude-code-mods --scope user',
    'claude plugin enable heatmap@claude-code-mods --scope user',
    'claude plugin disable context-bar@claude-code-mods --scope user',
  ]);
  assert.deepEqual(r.calls, ['plugin list --json', 'plugin marketplace list --json']);
});

test('nothing differs: "Nothing to change." and exit 0', async () => {
  const r = await go(['--pick', 'context-bar'], fakeClaude({ plugins: installed }));
  assert.equal(r.code, 0);
  assert.equal(r.out, 'Nothing to change.');
  assert.deepEqual(r.calls, ['plugin list --json']);
});

test('applies in order and ends with the restart hint', async () => {
  const r = await go(['--pick', 'heatmap,where-am-i'], fakeClaude({ plugins: installed }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, [
    'plugin list --json',
    'plugin marketplace list --json',
    'plugin marketplace update claude-code-mods',
    'plugin install where-am-i@claude-code-mods --scope user',
    'plugin enable heatmap@claude-code-mods --scope user',
    'plugin disable context-bar@claude-code-mods --scope user',
  ]);
  assert.deepEqual(r.out.split('\n'), [
    '✓ updated the claude-code-mods marketplace',
    '✓ installed where-am-i',
    '✓ enabled heatmap',
    '✓ disabled context-bar',
    '',
    'Restart Claude Code to load your mods.',
  ]);
});

test('a failed command is reported, the rest still run, exit 1', async () => {
  const claude = fakeClaude({ plugins: installed, markets: [], fail: ['marketplace add', 'install'] });
  const r = await go(['--pick', 'heatmap,where-am-i'], claude);
  assert.equal(r.code, 1);
  assert.equal(r.calls.length, 6);
  assert.match(r.out, /✗ add the claude-code-mods marketplace \(boom\)/);
  assert.match(r.out, /✗ install where-am-i \(boom\)/);
  assert.match(r.out, /✓ enabled heatmap/);
  assert.match(r.out, /✓ disabled context-bar/);
});

test('--project works in project scope for this folder', async () => {
  const plugins = [
    ...installed,
    { id: 'heatmap@claude-code-mods', scope: 'project', enabled: true, projectPath: '/work/a' },
    { id: 'where-am-i@claude-code-mods', scope: 'project', enabled: true, projectPath: '/work/b' },
  ];
  const r = await go(['--project', '--pick', 'where-am-i', '--dry-run'], fakeClaude({ plugins }));
  assert.deepEqual(r.out.split('\n'), [
    'claude plugin marketplace update claude-code-mods',
    'claude plugin install where-am-i@claude-code-mods --scope project',
    'claude plugin disable heatmap@claude-code-mods --scope project',
  ]);
});

test('no --pick: prints the grouped list and exits 1', async () => {
  const r = await go([]);
  assert.equal(r.code, 1);
  assert.match(r.out, /See what's happening\n {2}context-bar +A bar\n {2}where-am-i +Where\n\nFor fun\n {2}heatmap/);
  assert.match(r.err, /Run in a terminal, or pass --pick/);
});

test('no --pick in a terminal: the checklist opens pre-ticked and its picks apply', async () => {
  const seen = [];
  const checklist = async (o) => { seen.push(o); return ['context-bar', 'where-am-i']; };
  const r = await go(['--dry-run'], fakeClaude({ plugins: installed }), { isTTY: true, checklist });
  assert.equal(r.code, 0);
  assert.deepEqual(seen[0].ticked, ['context-bar']);
  assert.equal(seen[0].scope, 'user');
  assert.equal(seen[0].mods, catalog);
  assert.match(r.out, /claude plugin install where-am-i@claude-code-mods --scope user/);
  assert.equal(r.calls.filter((c) => c === 'plugin list --json').length, 1);
});

test('quitting the checklist changes nothing and exits 0', async () => {
  const r = await go([], fakeClaude({ plugins: installed }), { isTTY: true, checklist: async () => null });
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, ['plugin list --json']);
});

// Effects: the checklist hands ticks and previews back to cli.js.
async function effects(list, extra = {}) {
  const mods = [...catalog, { name: 'merge-gate', description: 'Gate', category: 'Guard your repo', tags: [], needs: ['gh', 'codex', 'Chrome'] }];
  const results = [];
  const checklist = async ({ onEffect }) => {
    for (const e of list) results.push(await onEffect(e, {}));
    return null;
  };
  await go([], fakeClaude(), { isTTY: true, checklist, loadCatalog: async () => mods, ...extra });
  return results;
}

test('ticking a mod with a missing tool warns, without blocking', async () => {
  const [r] = await effects([{ type: 'tick', name: 'merge-gate', ticked: true }], { checkNeeds: (needs) => needs.filter((n) => n === 'gh') });
  assert.deepEqual(r, { message: "gh not found: merge-gate won't work until you install it" });
});

test('no warning when tools are there, or on untick', async () => {
  const all = (needs) => needs.filter((n) => n === 'gh');
  assert.deepEqual(await effects([{ type: 'tick', name: 'merge-gate', ticked: true }], { checkNeeds: () => [] }), [null]);
  assert.deepEqual(await effects([{ type: 'tick', name: 'merge-gate', ticked: false }], { checkNeeds: all }), [null]);
});

test('p hands the mod name to the preview and shows its message', async () => {
  const seen = [];
  const showPreview = async (name) => { seen.push(name); return { message: 'No image yet' }; };
  const [r] = await effects([{ type: 'preview', name: 'heatmap' }], { showPreview });
  assert.deepEqual(seen, ['heatmap']);
  assert.deepEqual(r, { message: 'No image yet' });
});

// Options: where-am-i has two, heatmap none.
const whereOpts = {
  label: { type: 'string', title: 'Label' },
  secret: { type: 'string', title: 'Key', sensitive: true },
};
const loadOptions = async (mod) => (mod.name === 'where-am-i' ? whereOpts : {});
function fakePrompt(answers) {
  const asked = [];
  let closed = false;
  const makePrompt = () => ({
    ask: async (q, o) => { asked.push(o); return answers.shift(); },
    close: () => { closed = true; },
  });
  return { makePrompt, asked, closed: () => closed };
}

test('--dry-run lists the options it would ask for new mods', async () => {
  const r = await go(['--pick', 'heatmap,where-am-i', '--dry-run'], fakeClaude({ plugins: installed }), { loadOptions });
  assert.equal(r.code, 0);
  assert.equal(r.out.split('\n').at(-1), 'would ask where-am-i: label, secret');
});

test('a new mod with options is asked and saved in a terminal', async () => {
  const claude = fakeClaude({ plugins: installed });
  const p = fakePrompt(['home', '']);
  const r = await go(['--pick', 'heatmap,where-am-i'], claude, { loadOptions, isTTY: true, makePrompt: p.makePrompt });
  assert.equal(r.code, 0);
  assert.equal(p.asked.length, 2);
  assert.equal(p.asked[1].sensitive, true);
  assert.ok(p.closed());
  assert.ok(r.calls.includes('plugin configure where-am-i@claude-code-mods --values-stdin'));
  assert.match(r.out, /✓ configured where-am-i/);
  assert.match(r.out, /Restart Claude Code to load your mods\.$/);
});

test('options are not asked outside a terminal or for mods already installed', async () => {
  const p = fakePrompt([]);
  let r = await go(['--pick', 'where-am-i'], fakeClaude({ plugins: installed }), { loadOptions, isTTY: false, makePrompt: p.makePrompt });
  assert.equal(r.code, 0);
  assert.equal(p.asked.length, 0);
  const plugins = [{ id: 'where-am-i@claude-code-mods', scope: 'user', enabled: false }];
  r = await go(['--pick', 'where-am-i'], fakeClaude({ plugins }), { loadOptions, isTTY: true, makePrompt: p.makePrompt });
  assert.equal(p.asked.length, 0);
  assert.ok(!r.calls.some((c) => c.includes('configure')));
});

test('a failed install is not asked; a failed configure is reported', async () => {
  let p = fakePrompt([]);
  let r = await go(['--pick', 'where-am-i'], fakeClaude({ plugins: installed, fail: ['install'] }), { loadOptions, isTTY: true, makePrompt: p.makePrompt });
  assert.equal(p.asked.length, 0);
  p = fakePrompt(['home', 'k']);
  r = await go(['--pick', 'where-am-i'], fakeClaude({ plugins: installed, fail: ['configure'] }), { loadOptions, isTTY: true, makePrompt: p.makePrompt });
  assert.equal(r.code, 1);
  assert.match(r.out, /✗ configure where-am-i \(boom\)/);
});

test('an enabled mod missing from the catalog is never disabled', async () => {
  const plugins = [...installed, { id: 'retired@claude-code-mods', scope: 'user', enabled: true }];
  const r = await go(['--pick', 'context-bar', '--dry-run'], fakeClaude({ plugins }));
  assert.equal(r.out, 'Nothing to change.');
});

test('claude error lines are shown without control characters', async () => {
  const claude = fakeClaude({ plugins: installed });
  const run = async (args) => {
    if (args[1] === 'install') return { code: 1, stdout: '', stderr: '\x1b[31mbad\x1b]0;t\x07 thing\nmore' };
    return claude.run(args);
  };
  const r = await go(['--pick', 'context-bar,where-am-i'], { run, calls: [] });
  assert.match(r.out, /✗ install where-am-i \(\[31mbad\]0;t thing\)/);
});

test('ctrl-c while asking options skips configuring, keeps the restart hint, exits 130', async () => {
  let closed = false;
  const makePrompt = () => ({
    ask: async () => { throw Object.assign(new Error('Stopped'), { code: 'ABORT' }); },
    close: () => { closed = true; },
  });
  const claude = fakeClaude({ plugins: installed });
  const r = await go(['--pick', 'heatmap,where-am-i'], claude, { loadOptions, isTTY: true, makePrompt });
  assert.equal(r.code, 130);
  assert.ok(closed);
  assert.ok(!r.calls.some((c) => c.includes('configure')));
  assert.match(r.out, /Skipped configuring/);
  assert.match(r.out, /Restart Claude Code to load your mods\.$/);
});

test('outside a terminal, new mods with options get a configure hint', async () => {
  const r = await go(['--pick', 'heatmap,where-am-i,context-bar'], fakeClaude({ plugins: [] }), { loadOptions, isTTY: false });
  assert.equal(r.code, 0);
  assert.match(r.out, /^where-am-i has options: run claude plugin configure where-am-i@claude-code-mods$/m);
  assert.doesNotMatch(r.out, /heatmap has options/);
});

test('an empty mod list exits 1 before the checklist opens', async () => {
  let opened = false;
  const r = await go([], fakeClaude(), { isTTY: true, loadCatalog: async () => [], checklist: async () => { opened = true; return null; } });
  assert.equal(r.code, 1);
  assert.equal(opened, false);
  assert.match(r.err, /mod list is empty/);
});

test('profileLabel names the profile claude will use', () => {
  assert.equal(profileLabel({}, '/home/u'), '~/.claude');
  assert.equal(profileLabel({ CLAUDE_CONFIG_DIR: '/home/u/.claude-work' }, '/home/u'), '~/.claude-work');
  assert.equal(profileLabel({ CLAUDE_CONFIG_DIR: '/opt/claude' }, '/home/u'), '/opt/claude');
  assert.equal(profileLabel({ CLAUDE_CONFIG_DIR: '/home/u/.claude-work/' }, '/home/u'), '~/.claude-work');
});

// Band order: read the file in, save it from the order screen's effect.
test('bandsPath sits in the profile folder, trailing slashes dropped', () => {
  assert.equal(bandsPath({}, '/home/u'), '/home/u/.claude/claude-code-mods/bands.json');
  assert.equal(bandsPath({ CLAUDE_CONFIG_DIR: '/home/u/.claude-work//' }, '/home/u'), '/home/u/.claude-work/claude-code-mods/bands.json');
});

test('parseBandOrder reads names, anything odd means no order', () => {
  assert.deepEqual(parseBandOrder('{"order":["a","b"]}'), ['a', 'b']);
  for (const bad of [null, '', 'nope', '{}', '{"order":"a"}', '{"order":["a",3]}', '[]', 'null']) {
    assert.deepEqual(parseBandOrder(bad), [], String(bad));
  }
});

async function ordering(list, extra = {}) {
  const writes = [];
  const reads = [];
  const results = [];
  let seen;
  const checklist = async (o) => {
    seen = o;
    for (const e of list) results.push(await o.onEffect(e, {}));
    return null;
  };
  const r = await go(extra.argv || [], fakeClaude(), {
    isTTY: true, checklist,
    env: { CLAUDE_CONFIG_DIR: '/p/.claude-work/' }, home: '/p',
    readText: async (path) => { reads.push(path); if (extra.file === undefined) throw Object.assign(new Error('no'), { code: 'ENOENT' }); return extra.file; },
    writeText: async (path, text) => { if (extra.failWrite) throw new Error('disk full'); writes.push([path, text]); },
    ...extra.main,
  });
  return { ...r, writes, reads, results, seen };
}

const PATH = '/p/.claude-work/claude-code-mods/bands.json';

test('the order file is read from the profile and handed to the checklist', async () => {
  const r = await ordering([], { file: '{"order":["context-bar","where-am-i"]}' });
  assert.deepEqual(r.reads, [PATH]);
  assert.deepEqual(r.seen.bandOrder, ['context-bar', 'where-am-i']);
  assert.equal(r.seen.profile, '~/.claude-work');
});

test('a missing order file means no order', async () => {
  assert.deepEqual((await ordering([])).seen.bandOrder, []);
});

test('saving writes bands.json and says to restart', async () => {
  const r = await ordering([{ type: 'order', order: ['where-am-i', 'context-bar'] }]);
  assert.deepEqual(r.writes, [[PATH, '{\n  "order": [\n    "where-am-i",\n    "context-bar"\n  ]\n}\n']]);
  assert.deepEqual(r.results, [{ message: 'Saved. Restart Claude Code to apply.' }]);
});

test('a failed save shows why, without leaving the checklist', async () => {
  const r = await ordering([{ type: 'order', order: ['a'] }], { failWrite: true });
  assert.deepEqual(r.results, [{ message: 'Could not save the band order: disk full' }]);
});

test('--dry-run writes nothing, shows the path and JSON, and prints them after', async () => {
  const r = await ordering([{ type: 'order', order: ['where-am-i'] }], { argv: ['--dry-run'] });
  assert.deepEqual(r.writes, []);
  assert.equal(r.code, 0);
  assert.match(r.results[0].message, /Dry run: would write \/p\/\.claude-work\/claude-code-mods\/bands\.json/);
  assert.match(r.results[0].message, /"where-am-i"/);
  assert.equal(r.out, `would write ${PATH}\n{\n  "order": [\n    "where-am-i"\n  ]\n}`);
});
