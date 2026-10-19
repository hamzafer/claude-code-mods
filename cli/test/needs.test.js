import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onPath, missing, warning } from '../src/needs.js';

// Fake fs access: only these full paths exist.
const fakeAccess = (files) => (p) => { if (!files.includes(p)) throw new Error('ENOENT'); };

test('onPath finds a command in any PATH entry', () => {
  const access = fakeAccess(['/b/gh']);
  assert.equal(onPath('gh', { path: '/a:/b', platform: 'linux', access }), true);
  assert.equal(onPath('codex', { path: '/a:/b', platform: 'linux', access }), false);
});

test('onPath skips empty entries and an empty PATH', () => {
  const access = fakeAccess(['/gh']);
  assert.equal(onPath('gh', { path: '', platform: 'linux', access }), false);
  assert.equal(onPath('gh', { path: undefined, platform: 'linux', access }), false);
});

test('onPath honors PATHEXT on Windows', () => {
  const access = fakeAccess(['C:\\bin\\gh.EXE']);
  const o = { path: 'C:\\tools;C:\\bin', pathext: '.COM;.EXE', platform: 'win32', access };
  assert.equal(onPath('gh', o), true);
  assert.equal(onPath('node', o), false);
});

test('missing checks gh, codex, node and unpause on PATH', () => {
  const which = (c) => c === 'node' || c === 'gh';
  assert.deepEqual(missing(['gh', 'codex', 'node', 'unpause'], { which, platform: 'darwin' }), ['codex', 'unpause']);
});

test('missing checks macOS against the platform', () => {
  const which = () => true;
  assert.deepEqual(missing(['macOS'], { which, platform: 'darwin' }), []);
  assert.deepEqual(missing(['macOS'], { which, platform: 'linux' }), ['macOS']);
});

test('other needs are display-only, never missing', () => {
  const which = () => false;
  assert.deepEqual(missing(['Chrome', 'Spotify', 'OpenAI Admin key'], { which, platform: 'linux' }), []);
  assert.deepEqual(missing(undefined, { which, platform: 'linux' }), []);
});

test('warning names the missing tools and the mod', () => {
  assert.equal(warning('merge-gate', ['gh']), "gh not found: merge-gate won't work until you install it");
  assert.equal(warning('merge-gate', ['gh', 'codex']), "gh, codex not found: merge-gate won't work until you install them");
  assert.equal(warning('now-playing', ['macOS']), "now-playing needs macOS: it won't work on this system");
  assert.equal(warning('x', ['macOS', 'gh']), "x needs macOS: it won't work on this system. gh not found");
  assert.equal(warning('x', []), null);
});
