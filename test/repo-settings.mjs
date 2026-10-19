// Checks the repo's live settings through the GitHub API, read-only: main's rules and the
// npm environment. Exits 1 on drift. Run by .github/workflows/repo-guard.yml; locally:
//   node test/repo-settings.mjs   (GITHUB_TOKEN optional; GITHUB_REPOSITORY defaults to this repo)
// It can't see the ruleset's bypass list (that needs an admin token): keep it empty by hand.
const repo = process.env.GITHUB_REPOSITORY || 'hamzafer/claude-code-mods'
const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }

async function get(path) {
  const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers })
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`)
  return r.json()
}

const problems = []
const expect = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) problems.push(what)
}

const rules = await get('rules/branches/main')
const rule = type => rules.find(r => r.type === type)
expect(!!rule('deletion'), 'main cannot be deleted')
expect(!!rule('non_fast_forward'), 'main cannot be force-pushed')
const pr = rule('pull_request')?.parameters
expect(!!pr, 'main changes only through a pull request')
expect(JSON.stringify(pr?.allowed_merge_methods) === '["squash"]', 'pull requests merge by squash only')
const checks = (rule('required_status_checks')?.parameters.required_status_checks ?? []).map(c => c.context)
for (const name of ['mods', 'cli']) expect(checks.includes(name), `the ${name} check must pass before a merge`)

const env = await get('environments/npm')
expect(env.can_admins_bypass === false, 'admins cannot bypass the npm environment')
expect(env.deployment_branch_policy?.custom_branch_policies === true, 'the npm environment has a branch allowlist')
const allowed = (await get('environments/npm/deployment-branch-policies')).branch_policies.map(p => `${p.type}:${p.name}`)
expect(JSON.stringify(allowed) === '["branch:main"]', `only main may deploy to npm (found ${allowed.join(', ') || 'none'})`)

if (problems.length) {
  console.error(`\n${problems.length} repo setting(s) drifted. Fix them in Settings > Rules or Settings > Environments.`)
  process.exit(1)
}
console.log('\nRepo settings OK.')
