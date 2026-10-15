import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner } from '../src/claude.js';

// Points the runner at node instead of claude, so no real claude runs.
const run = makeRunner(process.execPath);

test('returns code, stdout and stderr', async () => {
  const r = await run(['-e', 'console.log("hi"); console.error("oops"); process.exit(3)']);
  assert.deepEqual(r, { code: 3, stdout: 'hi\n', stderr: 'oops\n' });
});

test('passes input on stdin', async () => {
  const r = await run(['-e', 'process.stdin.pipe(process.stdout)'], { input: '{"a":"1"}' });
  assert.equal(r.stdout, '{"a":"1"}');
});

test('a missing binary rejects with ENOENT', async () => {
  await assert.rejects(makeRunner('no-such-claude-binary')(['--version']), { code: 'ENOENT' });
});
