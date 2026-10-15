import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, normalize, groupByCategory, LIVE_URL } from '../src/catalog.js';

const market = {
  name: 'claude-code-mods',
  plugins: [
    { name: 'heatmap', description: 'A grid', source: './mods/heatmap', category: 'For fun', tags: ['pane'] },
    { name: 'context-bar', description: 'A bar', source: './mods/context-bar', category: 'See what\'s happening' },
    { name: 'mystery', description: 'No group', source: './mods/mystery' },
    { name: 'merge-gate', description: 'Holds merges', source: './mods/merge-gate', category: 'My setup (fork and adapt)', needs: ['gh'] },
  ],
};

const okFetch = (body) => async () => ({ ok: true, json: async () => body });
const noFiles = async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };

test('loads the live list first', async () => {
  let asked;
  const mods = await loadCatalog({
    fetch: async (url, opts) => { asked = { url, opts }; return { ok: true, json: async () => market }; },
    readFile: noFiles,
  });
  assert.equal(asked.url, LIVE_URL);
  assert.ok(asked.opts.signal, 'fetch gets a timeout signal');
  assert.equal(mods.length, 4);
});

test('falls back to the bundled copy, then the repo copy', async () => {
  const read = [];
  const mods = await loadCatalog({
    fetch: async () => { throw new Error('offline'); },
    readFile: async (p) => {
      read.push(p);
      if (read.length === 1) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      return JSON.stringify(market);
    },
    fallbacks: ['/bundled.json', '/repo.json'],
  });
  assert.deepEqual(read, ['/bundled.json', '/repo.json']);
  assert.equal(mods.length, 4);
});

test('a non-ok response counts as a failed fetch', async () => {
  const mods = await loadCatalog({
    fetch: async () => ({ ok: false, status: 404 }),
    readFile: async () => JSON.stringify(market),
    fallbacks: ['/bundled.json'],
  });
  assert.equal(mods.length, 4);
});

test('throws when every source fails', async () => {
  await assert.rejects(
    loadCatalog({ fetch: async () => { throw new Error('offline'); }, readFile: noFiles, fallbacks: ['/x'] }),
    /mod list/,
  );
});

test('normalize fills missing fields', () => {
  const [, , mystery] = normalize(market);
  assert.deepEqual(mystery, {
    name: 'mystery', description: 'No group', source: './mods/mystery',
    category: 'Other', tags: [], needs: [],
  });
});

test('groups follow the README order with Other last', () => {
  const groups = groupByCategory(normalize(market));
  assert.deepEqual(groups.map((g) => g.category), [
    'See what\'s happening', 'My setup (fork and adapt)', 'For fun', 'Other',
  ]);
  assert.deepEqual(groups[0].mods.map((m) => m.name), ['context-bar']);
});

test('works with no fallbacks when the live list loads', async () => {
  assert.equal((await loadCatalog({ fetch: okFetch(market), readFile: noFiles })).length, 4);
});
