// Every band mod ships the same hooks/bands.ts (the copy of shared/bands.ts) and reads
// the order file with the same readBandOrder in its own register file.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const canonical = readFileSync(join(root, 'shared/bands.ts'), 'utf8')
const copyOf = mod => join(root, 'mods', mod, 'hooks/bands.ts')

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
  const missing = bandMods.filter(mod => !existsSync(copyOf(mod)))
  assert.deepEqual(missing, [], `band mods without hooks/bands.ts (copy shared/bands.ts): ${missing.join(', ')}`)
})

// Claude Code follows $ only within one file, so each mod keeps its own reader: keep them alike.
const reader = mod => /^async function readBandOrder[\s\S]*?^}$/m.exec(readFileSync(join(root, 'mods', mod, 'hooks/register.tsx'), 'utf8'))?.[0]

test('every band mod reads the order file the same way', () => {
  const first = reader(bandMods[0])
  assert.ok(first, `mods/${bandMods[0]}/hooks/register.tsx has no readBandOrder`)
  for (const mod of bandMods) assert.equal(reader(mod), first, `mods/${mod}/hooks/register.tsx: readBandOrder differs from mods/${bandMods[0]}`)
})
