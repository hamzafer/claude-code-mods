// Keeps the README short, and checks its links: details belong in docs/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const MAX_LINES = 110
const read = path => readFileSync(path, 'utf8')
const readme = read('README.md')
const mods = read('docs/mods.md')
const names = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.map(p => p.name)

// GitHub's heading ids: lowercase, punctuation and emoji gone, the emoji variation selector kept.
const slug = heading => heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '').replaceAll(' ', '-')
const anchors = text => new Set([
  ...[...text.matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1].trim())),
  ...[...text.matchAll(/<a id="([^"]+)"/g)].map(m => m[1]),
])

test(`README stays under ${MAX_LINES} lines`, () => {
  assert.ok(readme.split('\n').length <= MAX_LINES, 'move the detail to docs/')
})

for (const name of names) {
  test(`${name}: in the README and the docs/mods.md table`, () => {
    assert.match(readme, new RegExp(`\\[\\*\\*${name}\\*\\*\\]`))
    assert.match(mods, new RegExp(`^\\| .* \\| \\*\\*${name}\\*\\* \\|`, 'm'))
  })
}

for (const file of ['README.md', 'docs/install.md', 'docs/community.md']) {
  test(`${file}: local links and anchors resolve`, () => {
    const text = read(file)
    const targets = [...text.matchAll(/\]\(([^)\s]+)\)|(?:href|src)="([^"]+)"/g)].map(m => m[1] ?? m[2])
    for (const target of targets.filter(t => !/^https?:/.test(t))) {
      const [path, hash] = target.split('#')
      const resolved = path ? normalize(join(dirname(file), path)) : file
      assert.ok(existsSync(resolved), `${target} is missing`)
      if (hash) assert.ok(anchors(read(resolved)).has(decodeURIComponent(hash)), `${target} has no such heading`)
    }
  })
}
