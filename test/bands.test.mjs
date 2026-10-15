// Every band mod ships the same hooks/bands.ts: the copy of shared/bands.ts.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const canonical = readFileSync(join(root, 'shared/bands.ts'), 'utf8')
const copyOf = mod => join(root, 'mods', mod, 'hooks/bands.ts')

// Band mods that have not adopted the helper yet: they may go without a copy.
// To make the check strict, empty this list (once every band mod has a copy):
// then any band-tagged mod without hooks/bands.ts fails.
const PENDING = [
  'agent-radar',
  'blast-radius',
  'browser-lanes',
  'glance',
  'merge-gate',
  'mission-control',
  'next-steps',
  'now-playing',
  'openai-balance',
  'openrouter-balance',
  'prayer-times',
  'review-watch',
  'session-saver',
  'switchboard',
  'token-weather',
  'usage-meter',
  'where-am-i',
]

const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
const bandMods = marketplace.plugins.filter(p => (p.tags ?? []).includes('band')).map(p => p.name)

test('every copy of the helper matches shared/bands.ts', () => {
  const mods = readdirSync(join(root, 'mods')).filter(mod => existsSync(copyOf(mod)))
  assert.ok(mods.length > 0, 'no mod has hooks/bands.ts')
  for (const mod of mods) {
    assert.ok(readFileSync(copyOf(mod), 'utf8') === canonical, `mods/${mod}/hooks/bands.ts differs from shared/bands.ts: copy it over again`)
  }
})

test('every band mod has a copy of the helper', () => {
  const missing = bandMods.filter(mod => !PENDING.includes(mod) && !existsSync(copyOf(mod)))
  assert.deepEqual(missing, [], `band mods without hooks/bands.ts (copy shared/bands.ts): ${missing.join(', ')}`)
})
