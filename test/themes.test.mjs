// Every theme mod ships the same hooks and state machine (copies of shared/theme/) and
// keeps only its look and its scene for itself.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(join(root, file), 'utf8')

// Where each shared file sits inside a theme mod.
const COPIES = {
  'register.tsx': 'hooks/register.tsx',
  'state.ts': 'hooks/state.ts',
  'random.ts': 'hooks/scene/random.ts',
  'make-colors.js': 'hooks/make-colors.js',
  'make-colors.d.ts': 'hooks/make-colors.d.ts',
  'state.test.ts': 'tests/state.test.ts',
}

const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'))
const themes = marketplace.plugins.filter(p => (p.tags ?? []).includes('theme')).map(p => p.name)

test('there is at least one theme mod', () => {
  assert.ok(themes.length > 0, "no mod in the marketplace is tagged 'theme'")
})

test('every theme mod has an exact copy of each shared file', () => {
  for (const mod of themes) {
    for (const [shared, copy] of Object.entries(COPIES)) {
      const path = `mods/${mod}/${copy}`
      assert.ok(existsSync(join(root, path)), `${path} is missing: copy shared/theme/${shared}`)
      // Claude Code reads an atom's plugin as a literal, so the hooks name the mod in that one place.
      const expected = read(`shared/theme/${shared}`).replace("plugin: '<theme>'", `plugin: '${mod}'`)
      assert.ok(read(path) === expected, `${path} differs from shared/theme/${shared}: copy it over again`)
    }
  }
})

// The shared hooks keep the signal under the mod's own name, which is also its scene name.
test("every theme mod's scene name is its plugin name", () => {
  for (const mod of themes) {
    const { name } = JSON.parse(read(`mods/${mod}/.claude-plugin/plugin.json`))
    assert.match(read(`mods/${mod}/hooks/look.ts`), new RegExp(`^export const SCENE_NAME = '${name}'$`, 'm'), `mods/${mod}/hooks/look.ts: SCENE_NAME must be '${name}'`)
  }
})

// The state machine is shared, so the value it moves through is the same in every theme.
const signalType = mod => /^export type Signal =\n(?:  .*\n)+/m.exec(read(`mods/${mod}/types/index.d.ts`))?.[0].replace(/^\s*\/\/.*\n/gm, '')

test('every theme mod declares the same Signal, under its own name', () => {
  const first = signalType(themes[0])
  assert.ok(first, `mods/${themes[0]}/types/index.d.ts has no Signal type`)
  for (const mod of themes) {
    assert.equal(signalType(mod), first, `mods/${mod}/types/index.d.ts: Signal differs from mods/${themes[0]}`)
    assert.match(read(`mods/${mod}/types/index.d.ts`), new RegExp(`'${mod}': \\{\\n\\s+signal: Signal\\n`), `mods/${mod}/types/index.d.ts must declare '${mod}': { signal: Signal }`)
  }
})
