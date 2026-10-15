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

test('enable and disable keep the scope the mod is installed in', () => {
  const s = readState(list, { scope: 'project', cwd: '/work/a' });
  assert.deepEqual(planActions({ state: s, picked: ['agent-radar'], scope: 'project' }), [
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
