// Checks community.json against each repo's own marketplace on GitHub: the marketplace name
// matches and it has a plugin by the entry's name. Needs the network, so it is not a *.test.mjs.
// Run by .github/workflows/repo-guard.yml; locally: node test/community-remote.mjs
import { readFileSync } from 'node:fs'

const { mods } = JSON.parse(readFileSync(new URL('../community.json', import.meta.url), 'utf8'))

// HEAD is the repo's default branch.
const markets = new Map()
async function marketOf(repo) {
  if (!markets.has(repo)) {
    markets.set(repo, (async () => {
      const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(`${repo}: .claude-plugin/marketplace.json returned ${r.status}`)
      return r.json()
    })())
  }
  return markets.get(repo)
}

const problems = []
const expect = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) problems.push(what)
}

for (const m of mods) {
  let market
  try {
    market = await marketOf(m.repo)
  } catch (e) {
    expect(false, `${m.name}: ${e.message}`)
    continue
  }
  expect(market?.name === m.marketplace, `${m.name}: ${m.repo} is the ${m.marketplace} marketplace (it says ${market?.name})`)
  const plugins = Array.isArray(market?.plugins) ? market.plugins : []
  expect(plugins.some(p => p?.name === m.name), `${m.name}: ${m.repo} has a ${m.name} plugin`)
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s): update community.json or the README row.`)
  process.exit(1)
}
