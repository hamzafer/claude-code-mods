import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin.js', import.meta.url));

// Only paths that exit before any claude call or fetch.
test('bin prints usage on --help', () => {
  assert.match(execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }), /Usage: claude-code-mods/);
});

test('bin exits 1 on an unknown flag', () => {
  const r = spawnSync(process.execPath, [bin, '--nope'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown flag: --nope/);
});
