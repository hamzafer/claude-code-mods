import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCatalog, normalize, groupByCategory, LIVE_URL,
  loadCommunity, normalizeCommunity, loadAll, COMMUNITY, COMMUNITY_URL, COMMUNITY_FALLBACKS,
} from '../src/catalog.js';
import { readFile } from 'node:fs/promises';

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

test('normalize strips control characters and coerces odd types', () => {
  const [m] = normalize({ plugins: [{
    name: 'ok-mod', description: 'bad \x1b[31mred\x1b[0m\x9b text', category: 7,
    tags: ['band', 3, null, 'x\x07'], needs: 'gh',
  }] });
  assert.equal(m.description, 'bad [31mred[0m text');
  assert.equal(m.category, '7');
  assert.deepEqual(m.tags, ['band', 'x']);
  assert.deepEqual(m.needs, []);
  const [d] = normalize({ plugins: [{ name: 'd', description: { a: 1 } }] });
  assert.equal(typeof d.description, 'string');
});

test('normalize drops plugins with unsafe names', () => {
  const names = normalize({ plugins: [
    { name: 'good.mod_1-x' }, { name: 'Bad' }, { name: 'a&calc' }, { name: '../x' },
    { name: '-flag' }, { name: 5 }, null, { name: 'a b' },
  ] }).map((m) => m.name);
  assert.deepEqual(names, ['good.mod_1-x']);
});

test('normalize survives a plugins field that is not an array', () => {
  assert.deepEqual(normalize({ plugins: 'nope' }), []);
  assert.deepEqual(normalize(null), []);
});

// Community mods: other people's, each in its own marketplace.
const community = {
  mods: [
    {
      name: 'image-view', marketplace: 'claude-image-view', repo: 'jarrodwatts/claude-image-view',
      author: 'jarrodwatts', url: 'https://github.com/jarrodwatts/claude-image-view',
      description: 'Thumbnails', tags: ['band'],
    },
    {
      name: 'cache-meter', marketplace: 'T-AI-Labs', repo: 'T-AI-Labs/claude-code-mods',
      author: 'T-AI-Labs', url: 'https://github.com/T-AI-Labs/claude-code-mods#cache-meter',
      description: 'Cache share',
    },
  ],
};

test('normalizeCommunity keeps who made it and where, in the Community group', () => {
  const [m, c] = normalizeCommunity(community);
  assert.deepEqual(m, {
    name: 'image-view', description: 'Thumbnails', source: undefined, category: COMMUNITY,
    tags: ['band'], needs: [],
    marketplace: 'claude-image-view', repo: 'jarrodwatts/claude-image-view',
    author: 'jarrodwatts', url: 'https://github.com/jarrodwatts/claude-image-view',
  });
  assert.equal(c.marketplace, 'T-AI-Labs');
  assert.deepEqual(c.tags, []);
});

test('normalizeCommunity drops entries with unsafe or missing fields', () => {
  const good = community.mods[0];
  const names = normalizeCommunity({ mods: [
    good,
    { ...good, name: 'a&b' },
    { ...good, name: 'no-market', marketplace: '-x' },
    { ...good, name: 'no-repo', repo: 'a b/c' },
    { ...good, name: 'bad-author', author: 'x;rm' },
    { ...good, name: 'bad-url', url: 'http://evil.example/x' },
    { ...good, name: 'no-url', url: undefined },
    null,
  ] }).map((m) => m.name);
  assert.deepEqual(names, ['image-view']);
  assert.deepEqual(normalizeCommunity({ mods: 'nope' }), []);
  assert.deepEqual(normalizeCommunity(null), []);
});

test('loadCommunity loads the live list first, then the fallbacks, else none', async () => {
  let asked;
  const mods = await loadCommunity({
    fetch: async (url) => { asked = url; return { ok: true, json: async () => community }; },
    readFile: noFiles,
  });
  assert.equal(asked, COMMUNITY_URL);
  assert.equal(mods.length, 2);
  const read = [];
  const offline = await loadCommunity({
    fetch: async () => { throw new Error('offline'); },
    readFile: async (p) => { read.push(p); return JSON.stringify(community); },
    fallbacks: ['/bundled.json'],
  });
  assert.deepEqual(read, ['/bundled.json']);
  assert.equal(offline.length, 2);
  assert.deepEqual(await loadCommunity({ fetch: async () => { throw new Error('offline'); }, readFile: noFiles, fallbacks: ['/x'] }), []);
});

test('loadAll puts community mods after ours and drops names that clash', async () => {
  const clash = { mods: [...community.mods, { ...community.mods[0], name: 'heatmap' }] };
  const mods = await loadAll({
    loadCatalog: async () => normalize(market),
    loadCommunity: async () => normalizeCommunity(clash),
  });
  assert.deepEqual(mods.map((m) => m.name), ['heatmap', 'context-bar', 'mystery', 'merge-gate', 'image-view', 'cache-meter']);
  assert.equal(mods[0].category, 'For fun');
});

test('loadAll still loads ours when the community list fails', async () => {
  const mods = await loadAll({
    loadCatalog: async () => normalize(market),
    loadCommunity: async () => { throw new Error('boom'); },
  });
  assert.equal(mods.length, 4);
});

test('the Community group comes last, after Other', () => {
  const groups = groupByCategory([...normalizeCommunity(community), ...normalize(market)]);
  assert.deepEqual(groups.map((g) => g.category).slice(-2), ['Other', COMMUNITY]);
  assert.equal(COMMUNITY, 'Community (not maintained here)');
});

test('the repo copy of community.json loads in full', async () => {
  const repoCopy = COMMUNITY_FALLBACKS.at(-1);
  const raw = JSON.parse(await readFile(repoCopy, 'utf8'));
  const mods = normalizeCommunity(raw);
  assert.equal(mods.length, raw.mods.length);
  assert.ok(mods.some((m) => m.name === 'image-view' && m.marketplace === 'claude-image-view'));
});
