// The site under site/ is written by hand: keep it in step with the mods in the marketplace.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(join(root, file), 'utf8')
const BASE = 'https://hamzafer.github.io/claude-code-mods/'

// Our own mods: marketplace entries whose source is a folder in mods/.
const plugins = JSON.parse(read('.claude-plugin/marketplace.json')).plugins
const mods = plugins.filter(p => typeof p.source === 'string' && /^\.\/mods\/[^/]+$/.test(p.source))
const count = mods.length
const pageOf = name => `site/mods/${name}/index.html`

// The JSON-LD block of a page that has `key`: a page may carry more than one.
const ldWith = (html, key) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).find(d => key in d)

// Mod pages that ship without a screenshot or video for now. Add one, then take the mod
// off this list: the test fails while a listed mod has a picture, so the list only shrinks.
const NO_SCREENSHOT_YET = [
  'agent-radar',
  'cache-clock',
  'glance',
  'merge-gate',
  'next-steps',
  'session-saver',
  'snake',
  'switchboard',
  'usage-meter',
]

// Every HTML page of the site, as paths relative to the repo root.
const htmlFiles = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? htmlFiles(`${dir}/${e.name}`) : e.name.endsWith('.html') ? [`${dir}/${e.name}`] : [])
const pages = htmlFiles('site')

const index = read('site/index.html')
const sitemap = read('site/sitemap.xml')

test('the marketplace lists mods from mods/', () => {
  assert.ok(count > 0, 'no marketplace entry has a ./mods/<name> source')
})

test('every folder in mods/ is in the marketplace', () => {
  const dirs = readdirSync(join(root, 'mods'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  const unlisted = dirs.filter(d => !mods.some(m => m.source === `./mods/${d}`))
  assert.deepEqual(unlisted, [], `mods/ has mods missing from .claude-plugin/marketplace.json: ${unlisted.join(', ')}`)
})

test('every folder in site/mods/ is a marketplace mod', () => {
  const dirs = readdirSync(join(root, 'site/mods'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  const stale = dirs.filter(d => !mods.some(m => m.name === d))
  assert.deepEqual(stale, [], `site/mods/ has pages for mods not in .claude-plugin/marketplace.json: ${stale.join(', ')}`)
})

test('NO_SCREENSHOT_YET only names real mods', () => {
  const unknown = NO_SCREENSHOT_YET.filter(n => !mods.some(m => m.name === n))
  assert.deepEqual(unknown, [], `test/site.test.mjs NO_SCREENSHOT_YET names mods that don't exist: ${unknown.join(', ')}`)
})

for (const mod of mods) {
  const { name } = mod
  const page = pageOf(name)
  const url = `${BASE}mods/${name}/`

  test(`${name}: has a site page`, () => {
    assert.ok(existsSync(join(root, page)), `${page} is missing: add a page for ${name}`)
  })

  test(`${name}: site page shows the plugin.json version`, { skip: !existsSync(join(root, page)) }, () => {
    const version = JSON.parse(read(`mods/${name}/.claude-plugin/plugin.json`)).version
    assert.equal(mod.version, version,
      `.claude-plugin/marketplace.json says ${name} is ${mod.version}, mods/${name}/.claude-plugin/plugin.json says ${version}: make them match`)
    const html = read(page)
    const chips = [...html.matchAll(/>Version ([^<\s]+)</g)].map(m => m[1])
    assert.deepEqual(chips, [version], `${page}: the "Version" chip should read "Version ${version}" (found: ${chips.join(', ') || 'none'})`)
    const ld = ldWith(html, 'version')
    assert.ok(ld, `${page} has no JSON-LD <script type="application/ld+json"> with a "version"`)
    assert.equal(ld.version, version, `${page}: the JSON-LD "version" should be "${version}"`)
  })

  test(`${name}: site/index.html links to its page`, () => {
    assert.ok(index.includes(`href="mods/${name}/"`), `site/index.html has no row linking to href="mods/${name}/"`)
    const items = ldWith(index, 'mainEntity')?.mainEntity?.itemListElement ?? []
    assert.ok(items.some(i => i.url === url), `site/index.html JSON-LD itemListElement has no entry with "url": "${url}"`)
  })

  test(`${name}: site/sitemap.xml lists its page`, () => {
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), `site/sitemap.xml is missing <url><loc>${url}</loc></url>`)
  })

  test(`${name}: screenshot status matches NO_SCREENSHOT_YET`, { skip: !existsSync(join(root, page)) }, () => {
    const hasPicture = /<(?:img|video)\b[^>]*\b(?:src|poster)="[^"]*images\//.test(read(page)) // a screenshot, not a logo or icon
    if (NO_SCREENSHOT_YET.includes(name)) {
      assert.ok(!hasPicture, `${page} now has an <img> or <video>: take '${name}' off NO_SCREENSHOT_YET in test/site.test.mjs`)
    } else {
      assert.ok(hasPicture, `${page} has no <img> or <video>: add a screenshot (see images/ and docs/mods.md)`)
    }
  })
}

test('index JSON-LD lists exactly the marketplace mods', () => {
  const items = ldWith(index, 'mainEntity')?.mainEntity?.itemListElement ?? []
  assert.equal(items.length, count, `site/index.html JSON-LD itemListElement has ${items.length} entries, expected ${count}`)
})

// Counts like "All 25 mods" (site/index.html) and "See all 25 mods" (every mod page).
test('mod counts on site pages match the marketplace', () => {
  const wrong = []
  let seen = 0
  for (const page of pages) {
    for (const m of read(page).matchAll(/\b[Aa]ll (\d+) mods\b/g)) {
      seen++
      if (Number(m[1]) !== count) wrong.push(`${page}: "${m[0]}" should be "${count} mods"`)
    }
  }
  assert.ok(seen > 0, 'no "All N mods" count found on any site page; update this test if the wording changed')
  assert.deepEqual(wrong, [], wrong.join('\n'))
})

// src="...", poster="...", and absolute site URLs (og:image, JSON-LD "image") must point at real files.
const MEDIA = /\.(png|jpe?g|gif|webp|svg|avif|mp4|webm)$/i
test('every image and video a site page references exists under site/', () => {
  const missing = []
  for (const page of pages) {
    const html = read(page)
    const refs = [
      ...[...html.matchAll(/\b(?:src|poster)="([^"]+)"/g)].map(m => m[1]),
      ...[...html.matchAll(/https:\/\/hamzafer\.github\.io\/claude-code-mods\/[^"'\s<>)]+/g)].map(m => m[0].split(/[?#]/)[0]).filter(u => MEDIA.test(u)),
    ]
    for (const ref of refs) {
      if (/^(data:|https?:\/\/(?!hamzafer\.github\.io\/claude-code-mods\/))/.test(ref)) continue
      let file
      const path = ref.split(/[?#]/)[0] // a cache-busting ?v=1 still names the same file
      if (path.startsWith(BASE)) file = join('site', path.slice(BASE.length))
      else if (path.startsWith('/claude-code-mods/')) file = join('site', path.slice('/claude-code-mods/'.length))
      else file = normalize(join(dirname(page), path))
      if (!relative('site', file).startsWith('..') && existsSync(join(root, file))) continue
      missing.push(`${page}: "${ref}" -> ${file} does not exist`)
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'))
})
