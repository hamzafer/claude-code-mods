import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readState, planActions, toShell } from '../src/plan.js';

const list = [
  { id: 'context-bar@claude-code-mods', scope: 'user', enabled: true },
  { id: 'heatmap@claude-code-mods', scope: 'user', enabled: false },
  { id: 'where-am-i@claude-code-mods', scope: 'project', enabled: true, projectPath: '/work/a' },
  { id: 'bands@claude-code-mods', scope: 'project', enabled: true, projectPath: '/work/b' },
  { id: 'agent-radar@claude-code-mods', scope: 'local', enabled: false, projectPath: '/work/a' },
  { id: 'superpowers@other-market', scope: 'user', enabled: true },
];

test('readState keeps only this marketplace in user scope', () => {
  assert.deepEqual(readState(list, { scope: 'user' }), {
    'context-bar': { enabled: true, scope: 'user' },
    heatmap: { enabled: false, scope: 'user' },
  });
});

test('readState in project scope keeps project and local entries for this folder', () => {
  assert.deepEqual(readState(list, { scope: 'project', cwd: '/work/a' }), {
    'where-am-i': { enabled: true, scope: 'project' },
    'agent-radar': { enabled: false, scope: 'local' },
  });
});

const state = readState(list, { scope: 'user' });

test('installs, enables and disables to match the picks', () => {
  const actions = planActions({ state, picked: ['heatmap', 'bands'], scope: 'user' });
  assert.deepEqual(actions, [
    { verb: 'refresh' },
    { verb: 'install', name: 'bands', scope: 'user' },
    { verb: 'enable', name: 'heatmap', scope: 'user' },
    { verb: 'disable', name: 'context-bar', scope: 'user' },
  ]);
});

test('never uninstalls a disabled mod that is not picked', () => {
  assert.deepEqual(planActions({ state, picked: ['context-bar'], scope: 'user' }), []);
});

test('adds the marketplace first when it is missing and something turns on', () => {
  const actions = planActions({ state, picked: ['context-bar', 'bands'], scope: 'user', hasMarketplace: false });
  assert.deepEqual(actions[0], { verb: 'marketplace' });
  assert.equal(actions.length, 2);
});

test('no marketplace add when only disabling', () => {
  assert.deepEqual(planActions({ state, picked: [], scope: 'user', hasMarketplace: false }), [
    { verb: 'disable', name: 'context-bar', scope: 'user' },
  ]);
});

test('refreshes the marketplace first when something turns on, so installs are current', () => {
  const actions = planActions({ state, picked: ['context-bar', 'bands'], scope: 'user', hasMarketplace: true });
  assert.deepEqual(actions[0], { verb: 'refresh' });
  assert.equal(toShell(actions[0]), 'claude plugin marketplace update claude-code-mods');
});

test('no refresh when only disabling', () => {
  assert.deepEqual(planActions({ state, picked: [], scope: 'user', hasMarketplace: true }), [
    { verb: 'disable', name: 'context-bar', scope: 'user' },
  ]);
});

test('enable and disable keep the scope the mod is installed in', () => {
  const s = readState(list, { scope: 'project', cwd: '/work/a' });
  assert.deepEqual(planActions({ state: s, picked: ['agent-radar'], scope: 'project' }), [
    { verb: 'refresh' },
    { verb: 'enable', name: 'agent-radar', scope: 'local' },
    { verb: 'disable', name: 'where-am-i', scope: 'project' },
  ]);
});

test('toShell prints one claude line per action', () => {
  assert.equal(toShell({ verb: 'marketplace' }), 'claude plugin marketplace add hamzafer/claude-code-mods');
  assert.equal(
    toShell({ verb: 'install', name: 'where-am-i', scope: 'user' }),
    'claude plugin install where-am-i@claude-code-mods --scope user',
  );
  assert.equal(
    toShell({ verb: 'disable', name: 'heatmap', scope: 'project' }),
    'claude plugin disable heatmap@claude-code-mods --scope project',
  );
});

test('never disables an installed mod that is not in the current catalog', () => {
  const s = { 'context-bar': { enabled: true, scope: 'user' }, retired: { enabled: true, scope: 'user' } };
  assert.deepEqual(planActions({ state: s, picked: [], scope: 'user', catalog: ['context-bar', 'heatmap'] }), [
    { verb: 'disable', name: 'context-bar', scope: 'user' },
  ]);
});

test('readState matches this folder through symlinks and trailing slashes', async () => {
  const { mkdtempSync, mkdirSync, symlinkSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mods-')));
  const real = join(root, 'real');
  mkdirSync(real);
  symlinkSync(real, join(root, 'link'));
  const entry = (projectPath) => [{ id: 'bands@claude-code-mods', scope: 'project', enabled: true, projectPath }];
  assert.ok(readState(entry(real), { scope: 'project', cwd: join(root, 'link') }).bands);
  assert.ok(readState(entry(`${real}/`), { scope: 'project', cwd: real }).bands);
  // Root-exact: a parent folder is not this folder.
  assert.deepEqual(readState(entry(root), { scope: 'project', cwd: real }), {});
});
