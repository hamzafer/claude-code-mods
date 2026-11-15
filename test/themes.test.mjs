// Every theme mod ships the same hooks and state machine (copies of shared/theme/) and
// keeps only its look and its scene for itself.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

// A mod that sets a look is a theme, tagged or not: an untagged one would skip every check below.
test("every mod with a look is tagged 'theme'", () => {
  const withLook = readdirSync(join(root, 'mods')).filter(mod => existsSync(join(root, 'mods', mod, 'hooks/look.ts')))
  assert.deepEqual(withLook.filter(mod => !themes.includes(mod)), [], "mods with hooks/look.ts that the marketplace doesn't tag 'theme'")
})

test('every theme mod has an exact copy of each shared file', () => {
  for (const mod of themes) {
    for (const [shared, copy] of Object.entries(COPIES)) {
      const path = `mods/${mod}/${copy}`
      assert.ok(existsSync(join(root, path)), `${path} is missing: copy shared/theme/${shared}`)
      // Claude Code reads an atom's plugin as a literal, so the hooks name the mod in that one place.
      const canonical = read(`shared/theme/${shared}`)
      const expected = shared === 'register.tsx' ? canonical.replace("plugin: '<theme>'", `plugin: '${mod}'`) : canonical
      assert.ok(read(path) === expected, `${path} differs from shared/theme/${shared}: copy it over again`)
    }
  }
})

// The shared hooks keep the signal under the mod's name and answer for the scene of that
// name, so the folder, the marketplace entry, plugin.json and the scene all share one name.
const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test("every theme mod's folder, plugin name and scene name are the same", () => {
  for (const mod of themes) {
    const { name } = JSON.parse(read(`mods/${mod}/.claude-plugin/plugin.json`))
    assert.equal(name, mod, `mods/${mod}/.claude-plugin/plugin.json: name must be '${mod}', the folder and marketplace name`)
    assert.match(read(`mods/${mod}/hooks/look.ts`), new RegExp(`^export const SCENE_NAME = '${literal(mod)}'$`, 'm'), `mods/${mod}/hooks/look.ts: SCENE_NAME must be '${mod}'`)
  }
})

// The state machine is shared, so the value it moves through is the same in every theme.
// It can't live in shared/theme/: Claude Code wants each mod's types/index.d.ts to stand
// alone, with no import. So each mod declares Signal there, one member per line, and
// this compares the declarations with their comments taken out.
const signalType = mod => /^export type Signal =\n(?:  .*\n)+/m.exec(read(`mods/${mod}/types/index.d.ts`))?.[0].replace(/^\s*\/\/.*\n/gm, '')

test('every theme mod declares the same Signal, under its own name', () => {
  const first = signalType(themes[0])
  assert.ok(first, `mods/${themes[0]}/types/index.d.ts has no Signal type`)
  for (const mod of themes) {
    assert.equal(signalType(mod), first, `mods/${mod}/types/index.d.ts: Signal differs from mods/${themes[0]}`)
    assert.match(read(`mods/${mod}/types/index.d.ts`), new RegExp(`'${literal(mod)}': \\{\\n\\s+signal: Signal\\n`), `mods/${mod}/types/index.d.ts must declare '${mod}': { signal: Signal }`)
  }
})
