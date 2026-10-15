import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl, findImage, openCommand, openUrl, preview } from '../src/preview.js';

const base = 'https://raw.githubusercontent.com/hamzafer/claude-code-mods/main/images/';

// Fake fetch: answers 200 for listed URLs, 404 otherwise; records calls.
function fakeFetch(found = [], { fail = false } = {}) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, method: opts?.method, signal: !!opts?.signal });
    if (fail) throw new Error('offline');
    return { ok: found.includes(url), status: found.includes(url) ? 200 : 404 };
  };
  return { fetch, calls };
}

// Fake spawn: records the call, returns a child with on/unref.
function fakeSpawn({ throws = false } = {}) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (throws) throw new Error('nope');
    return { on: () => {}, unref: () => { calls.at(-1).unref = true; } };
  };
  return { spawn, calls };
}

test('imageUrl points at the repo images folder', () => {
  assert.equal(imageUrl('heatmap', 'png'), `${base}heatmap.png`);
});

test('findImage tries png first with HEAD and a timeout', async () => {
  const f = fakeFetch([`${base}heatmap.png`, `${base}heatmap.gif`]);
  assert.equal(await findImage('heatmap', { fetch: f.fetch }), `${base}heatmap.png`);
  assert.deepEqual(f.calls, [{ url: `${base}heatmap.png`, method: 'HEAD', signal: true }]);
});

test('findImage falls back to gif', async () => {
  const f = fakeFetch([`${base}reels-demo.gif`]);
  assert.equal(await findImage('reels-demo', { fetch: f.fetch }), `${base}reels-demo.gif`);
  assert.deepEqual(f.calls.map((c) => c.url), [`${base}reels-demo.png`, `${base}reels-demo.gif`]);
});

test('findImage returns null when neither exists or fetch fails', async () => {
  assert.equal(await findImage('loose', { fetch: fakeFetch().fetch }), null);
  assert.equal(await findImage('loose', { fetch: fakeFetch([], { fail: true }).fetch }), null);
});

test('openCommand picks open, xdg-open or start', () => {
  assert.deepEqual(openCommand('u', 'darwin'), ['open', ['u']]);
  assert.deepEqual(openCommand('u', 'linux'), ['xdg-open', ['u']]);
  assert.deepEqual(openCommand('u', 'win32'), ['cmd', ['/c', 'start', '""', 'u']]);
});

test('openUrl spawns detached, ignores output and unrefs', () => {
  const s = fakeSpawn();
  openUrl('u', { spawn: s.spawn, platform: 'linux' });
  assert.equal(s.calls[0].cmd, 'xdg-open');
  assert.equal(s.calls[0].opts.detached, true);
  assert.equal(s.calls[0].opts.stdio, 'ignore');
  assert.equal(s.calls[0].unref, true);
});

test('openUrl swallows spawn errors', () => {
  assert.doesNotThrow(() => openUrl('u', { spawn: fakeSpawn({ throws: true }).spawn, platform: 'linux' }));
});

test('preview opens the found image', async () => {
  const s = fakeSpawn();
  const r = await preview('heatmap', { fetch: fakeFetch([`${base}heatmap.png`]).fetch, spawn: s.spawn, platform: 'darwin' });
  assert.deepEqual(r, { message: 'Opened the screenshot' });
  assert.deepEqual([s.calls[0].cmd, s.calls[0].args], ['open', [`${base}heatmap.png`]]);
});

test('preview says No image yet and opens nothing', async () => {
  const s = fakeSpawn();
  const r = await preview('loose', { fetch: fakeFetch().fetch, spawn: s.spawn, platform: 'darwin' });
  assert.deepEqual(r, { message: 'No image yet' });
  assert.equal(s.calls.length, 0);
});
