import { test } from 'node:test';
import assert from 'node:assert/strict';
test('rule test: fails on purpose so this PR can never merge', () => assert.fail('throwaway'));
