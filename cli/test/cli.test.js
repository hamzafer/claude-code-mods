import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main } from '../src/cli.js';

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
    'plugin install where-am-i@claude-code-mods --scope user',
    'plugin enable heatmap@claude-code-mods --scope user',
    'plugin disable context-bar@claude-code-mods --scope user',
  ]);
  assert.deepEqual(r.out.split('\n'), [
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
