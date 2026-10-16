// community.json lists other people's mods for the CLI checklist; the README table lists the same.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(join(root, file), 'utf8')
const { mods } = JSON.parse(read('community.json'))
const ours = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.map(p => p.name)

const TAGS = ['band', 'pane', 'statusline', 'guard', 'toast', 'command']
// The same checks the CLI makes before a value reaches a claude command.
const NAME = /^[a-z0-9][a-z0-9._-]*$/
const MARKET = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const USER = /^[A-Za-z0-9][A-Za-z0-9-]*$/
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/

test('community.json has a list of mods', () => {
  assert.ok(Array.isArray(mods) && mods.length > 0)
})

for (const m of mods) {
  test(`${m.name}: entry is well-formed`, () => {
    assert.match(m.name, NAME)
    assert.match(m.marketplace, MARKET)
    assert.match(m.repo, REPO)
    assert.match(m.author, USER)
    assert.equal(m.repo.split('/')[0], m.author, 'repo owner is the author')
    assert.ok(m.url.startsWith(`https://github.com/${m.repo}`), `url should point at ${m.repo}: ${m.url}`)
    assert.ok(typeof m.description === 'string' && m.description.trim() !== '', 'empty description')
    assert.doesNotMatch(m.description, /`|\*\*|\]\(/, 'description is plain text, no markdown')
    assert.ok(Array.isArray(m.tags), 'tags must be an array')
    for (const t of m.tags) assert.ok(TAGS.includes(t), `unknown tag: ${t}`)
  })
}

test('names are unique across community.json and the marketplace', () => {
  const all = [...ours, ...mods.map(m => m.name)]
  const dupes = all.filter((n, i) => all.indexOf(n) !== i)
  assert.deepEqual(dupes, [])
})

// The section runs to the next heading, or to the end of the file.
const readme = read('README.md')
const section = /^## .*Community mods$([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/m.exec(readme)?.[1] ?? ''
const rows = [...section.matchAll(/^\|[^|\n]*\| \*\*\[([^\]]+)\]\(.*$/gm)].map(r => ({ name: r[1], line: r[0] }))

test('README Community mods table and community.json list the same mods', () => {
  assert.ok(section, 'README has no Community mods section')
  assert.deepEqual(rows.map(r => r.name).sort(), mods.map(m => m.name).sort())
})

for (const m of mods) {
  test(`${m.name}: README row installs from the same marketplace`, () => {
    const row = rows.find(r => r.name === m.name)?.line ?? ''
    assert.ok(row.includes(`marketplace add ${m.repo}`), `row should say marketplace add ${m.repo}`)
    assert.ok(row.includes(`install ${m.name}@${m.marketplace}`), `row should say install ${m.name}@${m.marketplace}`)
  })
}
