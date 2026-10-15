import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  marketLocation, loadOptions, optionsLoader, validate, collect, save, createPrompt, rawUrl,
} from '../src/options.js';

const prayer = { name: 'prayer-times', source: './mods/prayer-times' };
const userConfig = {
  latitude: { type: 'number', title: 'Latitude', min: -90, max: 90 },
  method: { type: 'string', title: 'Method', options: ['karachi', 'mwl'], default: 'karachi' },
};
const ok = (stdout) => ({ code: 0, stdout: JSON.stringify(stdout), stderr: '' });

test('marketLocation finds our marketplace clone', async () => {
  const run = async () => ok([{ name: 'other', installLocation: '/x' }, { name: 'claude-code-mods', installLocation: '/clone' }]);
  assert.equal(await marketLocation(run), '/clone');
});

test('marketLocation is null when missing or failing', async () => {
  assert.equal(await marketLocation(async () => ok([])), null);
  assert.equal(await marketLocation(async () => ({ code: 1, stdout: '', stderr: 'x' })), null);
  assert.equal(await marketLocation(async () => { throw new Error('no claude'); }), null);
});

test('loadOptions reads raw GitHub first, so a stale clone does not hide new options', async () => {
  const urls = [];
  let reads = 0;
  const readFile = async () => { reads++; return JSON.stringify({ userConfig: {} }); };
  const fetch = async (u) => { urls.push(u); return { ok: true, json: async () => ({ userConfig }) }; };
  assert.deepEqual(await loadOptions(prayer, { location: '/clone', readFile, fetch }), userConfig);
  assert.deepEqual(urls, [rawUrl('prayer-times')]);
  assert.equal(reads, 0);
  assert.equal(rawUrl('prayer-times'),
    'https://raw.githubusercontent.com/hamzafer/claude-code-mods/main/mods/prayer-times/.claude-plugin/plugin.json');
});

test('loadOptions falls back to the clone when offline', async () => {
  const seen = [];
  const readFile = async (p) => { seen.push(p); return JSON.stringify({ userConfig }); };
  const fetch = async () => { throw new Error('offline'); };
  assert.deepEqual(await loadOptions(prayer, { location: '/clone', readFile, fetch }), userConfig);
  assert.match(seen[0].replaceAll('\\', '/'), /^\/clone\/mods\/prayer-times\/\.claude-plugin\/plugin\.json$/);
});

test('loadOptions gives {} when nothing loads or there are no options', async () => {
  const fetch = async () => ({ ok: false });
  assert.deepEqual(await loadOptions(prayer, { location: null, fetch }), {});
  const readFile = async () => '{"name":"x"}';
  assert.deepEqual(await loadOptions(prayer, { location: '/c', readFile, fetch }), {});
});

test('validate: empty keeps the default (nothing sent)', () => {
  assert.deepEqual(validate({ type: 'string' }, ''), { value: undefined });
  assert.deepEqual(validate({ type: 'number', default: 3 }, '  '), { value: undefined });
});

test('validate: numbers within min and max', () => {
  const o = { type: 'number', min: -90, max: 90 };
  assert.deepEqual(validate(o, '51.5'), { value: '51.5' });
  assert.deepEqual(validate(o, '-90'), { value: '-90' });
  assert.ok(validate(o, 'abc').error);
  assert.match(validate(o, '91').error, /90/);
  assert.match(validate(o, '-91').error, /-90/);
});

test('validate: booleans as y/n', () => {
  const o = { type: 'boolean' };
  for (const y of ['y', 'Y', 'yes', 'true']) assert.deepEqual(validate(o, y), { value: 'true' });
  for (const n of ['n', 'no', 'false']) assert.deepEqual(validate(o, n), { value: 'false' });
  assert.ok(validate(o, 'maybe').error);
});

test('validate: options must be in the list', () => {
  const o = { type: 'string', options: ['karachi', 'mwl'] };
  assert.deepEqual(validate(o, 'mwl'), { value: 'mwl' });
  assert.match(validate(o, 'isna').error, /karachi, mwl/);
});

test('validate: strings pass trimmed', () => {
  assert.deepEqual(validate({ type: 'string' }, ' asr+2 '), { value: 'asr+2' });
});

// Fake prompt: answers in order, records each call.
function fakeAsk(answers) {
  const calls = [];
  const ask = async (q, o) => { calls.push({ q, ...o }); return answers.shift(); };
  return { ask, calls };
}

test('collect asks each option, re-asks bad values, keeps only answers', async () => {
  const { ask, calls } = fakeAsk(['200', '45', '']);
  const out = [];
  const answers = await collect(userConfig, ask, (s) => out.push(s));
  assert.deepEqual(answers, { latitude: '45' });
  assert.equal(calls.length, 3);
  assert.match(out.join('\n'), /90/);
});

test('collect pre-fills the default and drops an unchanged default', async () => {
  const { ask, calls } = fakeAsk(['', 'karachi']);
  const answers = await collect(userConfig, ask, () => {});
  assert.deepEqual(answers, {});
  assert.equal(calls[1].prefill, 'karachi');
});

test('collect masks sensitive options and shows booleans as y/n', async () => {
  const cfg = {
    apiKey: { type: 'string', title: 'API key', sensitive: true },
    toasts: { type: 'boolean', title: 'Toasts', default: true },
  };
  const { ask, calls } = fakeAsk(['sk-1', 'n']);
  assert.deepEqual(await collect(cfg, ask, () => {}), { apiKey: 'sk-1', toasts: 'false' });
  assert.equal(calls[0].sensitive, true);
  assert.equal(calls[1].sensitive, false);
  assert.equal(calls[1].prefill, 'y');
});

test('save sends answered options as JSON on stdin', async () => {
  const calls = [];
  const run = async (args, opts) => { calls.push({ args, opts }); return { code: 0, stdout: '', stderr: '' }; };
  const r = await save(run, 'prayer-times@claude-code-mods', { latitude: '45' });
  assert.equal(r.code, 0);
  assert.deepEqual(calls[0].args, ['plugin', 'configure', 'prayer-times@claude-code-mods', '--values-stdin']);
  assert.deepEqual(JSON.parse(calls[0].opts.input), { latitude: '45' });
});

test('save skips the call when nothing was answered', async () => {
  let called = false;
  const r = await save(async () => { called = true; }, 'x@claude-code-mods', {});
  assert.equal(r, null);
  assert.equal(called, false);
});

test('createPrompt echoes * for sensitive input', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let shown = '';
  output.on('data', (d) => (shown += d));
  const p = createPrompt({ input, output });
  const answer = p.ask('Key: ', { sensitive: true });
  input.write('secret\r');
  assert.equal(await answer, 'secret');
  assert.ok(!shown.includes('secret'));
  assert.match(shown, /Key: /);
  assert.match(shown, /\*{6}/);

  const plain = p.ask('Name: ', { prefill: 'ab' });
  input.write('c\r');
  assert.equal(await plain, 'abc');
  p.close();
});

test('optionsLoader looks up the clone once, on first use', async () => {
  let lists = 0;
  const run = async () => { lists++; return ok([{ name: 'claude-code-mods', installLocation: '/clone' }]); };
  const load = optionsLoader(run, { readFile: async () => JSON.stringify({ userConfig }), fetch: async () => ({ ok: false }) });
  assert.equal(lists, 0);
  await load(prayer);
  await load(prayer);
  assert.equal(lists, 1);
});

test('collect skips non-object entries and strips control characters from text', async () => {
  const cfg = {
    broken: 'nope',
    nothing: null,
    label: { type: 'string', title: 'La\x1b[31mbel', description: 'Wh\x1b]0;x\x07ere', options: ['a\x1bb', 'c'] },
  };
  const { ask, calls } = fakeAsk(['c']);
  const out = [];
  assert.deepEqual(await collect(cfg, ask, (s) => out.push(s)), { label: 'c' });
  assert.equal(calls.length, 1);
  const text = out.join(' ').replace(/\x1b\[2m|\x1b\[22m/g, '');
  assert.doesNotMatch(text, /[\x00-\x1f\x7f-\x9f]/);
  assert.match(text, /La\[31mbel \(ab, c\)/);
});

test('loadOptions gives {} when userConfig is not an object', async () => {
  const fetch = async () => ({ ok: true, json: async () => ({ userConfig: 'x' }) });
  assert.deepEqual(await loadOptions(prayer, { fetch }), {});
});
