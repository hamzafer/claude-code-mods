import { describe, expect, test } from 'claude-code/testing'

import { bare, cdOf, gitCOf } from '../hooks/register'
import { addedLines, builtin, describe as say, mapStrings, redact } from '../hooks/rules'

// Fake keys, built at run time so no scanner (GitHub push protection included) sees a key in this file.
const GH = 'gh' + 'p_' + 'Zq3vR8tL1mX7wK2pB9nC4yD6hF0jS5aE1uIo'
const AWS = 'AK' + 'IA' + 'QWERTYUIOPASDFGH'.replace(/[01890]/g, 'Z')
const STRIPE = 'sk' + '_live_' + 'h4Tq9ZxLm2Pv7Rk1Wn8Yc3Bd'
const PEM = '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIEowIBAAKCAQEAx9f3k2Lm8Qp\n-----END RSA ' + 'PRIVATE KEY-----'

type Opts = {
  answer?: string
  output?: string // what the Bash tool prints
  isError?: boolean
  diff?: string // what git diff / git log -p prints
  ignored?: boolean // git check-ignore answer
  gitleaks?: { Secret: string; RuleID: string }[] | null // null: not installed
  untracked?: Record<string, string> // untracked files git doesn't ignore, by name
  context?: string[] // what the model reads after the result
  existing?: string // the file's text before a Write
  gitFails?: boolean // git diff / log exit non-zero
  editRecord?: string // an Edit result's originalFile
  folder?: Record<string, string> | null // files in /repo before git init; null: the folder doesn't exist yet
  truncated?: boolean // git's output was cut at 4 MiB
  timedOut?: boolean // git diff failed, but the folder is a repo
}

// Stands for the engine beneath the mod: records what ran, answers the dialog, fakes git and gitleaks.
function engine(on: any, opts: Opts = {}) {
  const ran: any[] = []
  const asked: string[] = []
  const toasts: string[] = []
  const runs: string[][] = []
  const cwds: (string | undefined)[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    asked.push(JSON.stringify(e))
    const q = e.questions[0].question
    return { result: { questions: e.questions, answers: { [q]: opts.answer ?? 'Block it' } }, text: '' }
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'AskUserQuestion') return undefined
    ran.push(e)
    if (e.tool === 'Bash') {
      const stdout = opts.output ?? 'ok'
      if (opts.isError) return { isError: true, result: stdout, text: stdout }
      return { result: { stdout, stderr: '', interrupted: false }, text: stdout }
    }
    if (e.tool === 'Read') {
      const content = opts.output ?? ''
      const text = content.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n')
      return { result: { type: 'text', file: { filePath: e.file_path, content, numLines: 1, startLine: 1, totalLines: 1 } }, text, ...(opts.context ? { context: opts.context } : {}) }
    }
    if (e.tool === 'Edit') return { result: { filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: opts.editRecord ?? '', structuredPatch: [], userModified: false, replaceAll: false }, text: 'The file has been updated.' }
    return { result: {}, text: 'ok' }
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/Users/me' : '/tmp' }))
  on('session.cwd', () => ({ value: '/repo' }))
  const file = (path: string) => (opts.untracked ?? {})[path.replace('/repo/', '')]
  on('fs.stat', (_$: any, e: any) => ({ value: { kind: 'file', size: (file(e.path) ?? '').length, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.read', (_$: any, e: any) => ({ value: file(e.path) ?? (opts.folder ?? {})[e.path.replace('/repo/', '')] ?? opts.existing ?? '' }))
  on('fs.exists', (_$: any, e: any) => ({ value: !(opts.folder === null && e.path === '/repo') }))
  on('fs.list', () => ({ value: Object.entries(opts.folder ?? {}).map(([name, t]) => ({ name, kind: 'file', size: t.length })) }))
  on('process.run', (_$: any, e: any) => {
    const argv = [...e.argv] as string[]
    runs.push(argv)
    cwds.push(e.init?.cwd)
    if (argv[0] === 'gitleaks') {
      if (opts.gitleaks === null || opts.gitleaks === undefined) throw new Error('not installed')
      if (argv[1] === 'version') return { value: { exitCode: 0, stdout: '8.30.1\n', stderr: '' } }
      const text: string = e.init?.stdin ?? ''
      const rows = opts.gitleaks.filter(r => text.includes(r.Secret))
      return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }
    }
    if (argv.includes('ls-files')) return { value: { exitCode: 0, stdout: Object.keys(opts.untracked ?? {}).map(f => `${f}\0`).join(''), stderr: '' } }
    if (argv.includes('rev-parse')) return { value: { exitCode: opts.gitFails && !opts.timedOut ? 128 : 0, stdout: '.git\n', stderr: '' } }
    if (argv.includes('check-ignore')) return { value: { exitCode: opts.ignored ? 0 : 1, stdout: '', stderr: '' } }
    if ((argv.includes('diff') || argv.includes('log')) && opts.gitFails) return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }
    if ((argv.includes('diff') || argv.includes('log')) && opts.truncated) return { value: { exitCode: 0, stdout: opts.diff ?? '', stderr: '', isStdoutTruncated: true } }
    if (argv.includes('diff') || argv.includes('log')) return { value: { exitCode: 0, stdout: opts.diff ?? '', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { ran, asked, toasts, runs, cwds }
}

describe('secret-guard', () => {
  test('built-in rules find common keys and skip placeholders and code', () => {
    const kinds = (t: string) => builtin(t).map(f => f.kind)
    expect(kinds(`token: ${GH}`)).toEqual(['GitHub token'])
    expect(kinds(`aws_access_key_id = ${AWS}`)).toEqual(['AWS access key'])
    expect(kinds(`STRIPE=${STRIPE}`)).toContain('Stripe key')
    expect(kinds(PEM)).toEqual(['private key'])
    expect(kinds('DATABASE_URL=postgres://app:s3cretPw9@db.internal:5432/app')).toEqual(['password in a URL'])
    const value = 'Zk81mQ2p' + 'X9vL4tR7'
    expect(builtin(`export OPENAI_API_KEY=${value}`)[0]?.secret).toBe(value)
    // Not secrets: references, placeholders, numbers, code.
    expect(builtin('GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}')).toEqual([])
    expect(builtin('API_KEY=your-api-key-here')).toEqual([])
    expect(builtin('MAX_TOKENS=100000000')).toEqual([])
    expect(builtin('API_KEY=settings.API_KEY')).toEqual([])
    expect(builtin('SECRET_KEY=os.getenv("SECRET")')).toEqual([])
    expect(builtin('api_key = "not checked: lower-case names are code"')).toEqual([])
    // Dotted values are code only for the env and URL rules: a JWT and a SendGrid key still count.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(kinds(`Authorization: Bearer ${jwt}`)).toEqual(['JWT'])
    const sg = 'SG.' + 'aZ9Bc1De2Fg3Hi4Jk5Lm6N'.slice(0, 22) + '.' + 'Pq8Rs9Tu0Vw1Xy2Za3Bc4De5Fg6Hi7Jk8Lm9No0Pq1Rs2T'.slice(0, 43)
    expect(kinds(sg)).toEqual(['SendGrid key'])
    // A line number or a grep prefix before an env line.
    expect(builtin('    12\tDB_PASSWORD=Hx7pQ2vLk9zz')[0]?.secret).toBe('Hx7pQ2vLk9zz')
    expect(builtin('config/.env:3:API_KEY=Hx7pQ2vLk9zz')[0]?.secret).toBe('Hx7pQ2vLk9zz')
  })

  test('the git matcher stays fast on a long run of options', () => {
    const t = Date.now()
    bare('git' + ' -C -C'.repeat(40) + ' x')
    expect(/commit/.test('git' + ' -C -C'.repeat(40))).toBe(false)
    expect(gitCOf('git' + ' -C -C'.repeat(40) + ' status')).toBe(undefined)
    expect(Date.now() - t).toBeLessThan(200)
  })

  test('helpers', () => {
    const f = builtin(`a ${GH} b ${GH}`)
    expect(redact(`a ${GH} b ${GH}`, f)).toBe('a [hidden by secret-guard: GitHub token] b [hidden by secret-guard: GitHub token]')
    expect(say([{ kind: 'GitHub token', secret: 'x' }])).toBe('a GitHub token')
    expect(say([{ kind: 'AWS access key', secret: 'x' }, { kind: 'AWS access key', secret: 'y' }, { kind: 'JWT', secret: 'z' }])).toBe('2 AWS access keys and a JWT')
    expect(mapStrings({ a: ['x1'], base64: 'x1', n: 3 }, s => s.replace('x', 'y'))).toEqual({ a: ['y1'], base64: 'x1', n: 3 })
    expect(addedLines('+++ b/src/a.ts\n+const k = 1\n-old\n+++ b/b.ts\n+two')).toEqual([
      { file: 'src/a.ts', text: 'const k = 1' },
      { file: 'b.ts', text: 'two' },
    ])
    expect(bare('echo "git push"')).toBe('echo "________"')
    expect(cdOf('cd api && git commit -m x')).toBe('api')
    expect(cdOf('cd api; git commit -m x')).toBe('api')
    expect(gitCOf('git -C ../other commit -m x')).toBe('../other')
    expect(gitCOf('git -c a=b -C "my repo" push', 'push')).toBe('my repo')
    expect(gitCOf('git commit -am "docs: use git -C sub status"')).toBe(undefined)
    expect(gitCOf('git -C sub status && git commit -m x')).toBe(undefined)
    expect(gitCOf('git -C sub status && git -C api commit -m x')).toBe('api')
    expect(gitCOf('git -C "a b"/c commit -m x')).toBe('a b/c')
    expect(gitCOf('git commit -m x')).toBe(undefined)
  })

  test('a secret in Bash output is hidden before Claude reads it, with a toast', async ($, on) => {
    const { toasts } = engine(on, { output: `GITHUB_TOKEN=${GH}\nPATH=/usr/bin` })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'cat .env' } as any)
    expect(r.result.stdout).toBe('GITHUB_TOKEN=[hidden by secret-guard: GitHub token]\nPATH=/usr/bin')
    expect(JSON.stringify(r)).not.toContain(GH)
    expect(toasts[0]).toMatch(/hid a GitHub token from Claude \(Bash output\)/)
  })

  test('a Read of a key file is hidden, though the model text has line numbers', async ($, on) => {
    engine(on, { output: PEM })
    const r: any = await $.tool.call({ tool: 'Read', file_path: '/repo/id_rsa' } as any)
    expect(r.result.file.content).toBe('[hidden by secret-guard: private key]')
  })

  test('a Read of .env hides each value with the built-in rules alone', async ($, on) => {
    engine(on, { output: 'PORT=3000\nDB_PASSWORD=Hx7pQ2vLk9zz\n' })
    const r: any = await $.tool.call({ tool: 'Read', file_path: '/repo/.env' } as any)
    expect(r.result.file.content).toBe('PORT=3000\nDB_PASSWORD=[hidden by secret-guard: secret in an env variable]\n')
  })

  test('a secret in the context the model reads withholds the result, redacted', async ($, on) => {
    engine(on, { output: 'fine', context: [`note: token ${GH}`] })
    const r: any = await $.tool.call({ tool: 'Read', file_path: '/repo/a.txt' } as any)
    expect(r.deny).toMatch(/note: token \[hidden by secret-guard: GitHub token\]/)
    expect(JSON.stringify(r)).not.toContain(GH)
  })

  test('clean output passes through as the same object', async ($, on) => {
    const { toasts } = engine(on, { output: 'all tests pass' })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
    expect(r.result.stdout).toBe('all tests pass')
    expect(r.text).toBe('all tests pass') // core's own record kept
    expect(toasts).toEqual([])
  })

  test('an error that prints a secret is withheld, redacted', async ($, on) => {
    engine(on, { output: `fatal: bad token ${GH}`, isError: true })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(r.deny).toBe('fatal: bad token [hidden by secret-guard: GitHub token]')
  })

  test('gitleaks findings are hidden too, and run from a neutral folder', async ($, on) => {
    const custom = 'q9V2mL7xK4pT8wN3'
    const { runs } = engine(on, { output: `client_secret: ${custom}`, gitleaks: [{ Secret: custom, RuleID: 'generic-api-key' }] })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'cat config.yml' } as any)
    expect(r.result.stdout).toBe('client_secret: [hidden by secret-guard: generic api key]')
    const scan = runs.find(a => a[0] === 'gitleaks' && a[1] === 'stdin')!
    expect(scan).toContain('--ignore-gitleaks-allow')
  })

  test('a Write that adds a key to a tracked file asks, and Block it denies', async ($, on) => {
    const { ran, asked } = engine(on, { answer: 'Block it' })
    const r: any = await $.tool.call({ tool: 'Write', file_path: '/repo/src/config.ts', content: `export const key = '${STRIPE}'` } as any)
    expect(asked[0]).toMatch(/adds what looks like a Stripe key/)
    expect(asked[0]).not.toContain(STRIPE) // the value itself is never shown
    expect(r.deny).toMatch(/^secret-guard: the user blocked writing a Stripe key/)
    expect(ran.filter(e => e.tool === 'Write')).toEqual([])
  })

  test('Allow once lets the write through', async ($, on) => {
    const { ran } = engine(on, { answer: 'Allow once' })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: `k = '${GH}'` } as any)
    expect(ran.filter(e => e.tool === 'Edit').length).toBe(1)
  })

  test('a key written to a git-ignored file goes through without asking', async ($, on) => {
    const { ran, asked, toasts } = engine(on, { ignored: true })
    await $.tool.call({ tool: 'Write', file_path: '/repo/.env', content: `GITHUB_TOKEN=${GH}` } as any)
    expect(asked).toEqual([])
    expect(ran.length).toBe(1)
    expect(toasts[0]).toMatch(/git ignores it/)
  })

  test('an edit that keeps a label already in the file is fine', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/notes.md', old_string: 'see [hidden by secret-guard: JWT]', new_string: 'shows [hidden by secret-guard: JWT]' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/repo/doc.md', content: 'shows [hidden by secret-guard: JWT]' } as any)
    expect(ran.length).toBe(1) // the Edit; the Write brings the label into a file that doesn't have it
  })

  test("writing secret-guard's own label back is refused", async ($, on) => {
    const { ran, asked } = engine(on)
    const r: any = await $.tool.call({ tool: 'Write', file_path: '/repo/.env', content: 'GITHUB_TOKEN=[hidden by secret-guard: GitHub token]\n' } as any)
    expect(r.deny).toMatch(/would replace the real secret/)
    expect(asked).toEqual([])
    expect(ran).toEqual([])
  })

  test('a commit that stages a key asks and names the file, not the key', async ($, on) => {
    const { ran, asked, runs } = engine(on, { answer: 'Block it', diff: `+++ b/src/deploy.sh\n+export AWS_ACCESS_KEY_ID=${AWS}\n` })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git commit -m "deploy"' } as any)
    expect(asked[0]).toMatch(/This commit adds what looks like an AWS access key.* in src\/deploy\.sh/)
    expect(asked[0]).not.toContain(AWS)
    expect(r.deny).toMatch(/blocked this commit/)
    expect(ran).toEqual([])
    expect(runs.find(a => a.includes('diff'))?.at(-1)).toBe('HEAD') // staged or not: checked before the command runs
  })

  test('`git add new.ts && git commit` scans the new file the command is about to stage', async ($, on) => {
    const { ran, asked } = engine(on, { answer: 'Block it', untracked: { 'new.ts': `export const k = '${STRIPE}'\n` } })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git add new.ts && git commit -m "add"' } as any)
    expect(asked[0]).toMatch(/This commit adds what looks like a Stripe key in new\.ts/)
    expect(r.deny).toMatch(/blocked this commit/)
    expect(ran).toEqual([])
  })

  test('a plain commit leaves untracked files out of the scan', async ($, on) => {
    const { asked } = engine(on, { untracked: { 'scratch.ts': `k = '${STRIPE}'` } })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as any)
    expect(asked).toEqual([])
  })

  test('commit -a scans the working tree; push scans every unpushed commit', async ($, on) => {
    const { runs } = engine(on, { diff: '+++ b/a.ts\n+fine\n' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -am "x"' } as any)
    await $.tool.call({ tool: 'Bash', command: 'cd api && git push' } as any)
    expect(runs.find(a => a.includes('diff'))).toContain('HEAD')
    const log = runs.find(a => a.includes('log'))!
    expect(log.slice(-3)).toEqual(['--branches', '--not', '--remotes'])
  })

  test('git -C scans the repo it names', async ($, on) => {
    const { runs, cwds } = engine(on, { diff: '+++ b/a.ts\n+fine\n' })
    await $.tool.call({ tool: 'Bash', command: 'git -C ../other commit -m x' } as any)
    expect(runs.some(a => a.includes('diff'))).toBe(true)
    expect(cwds).toContain('/repo/../other')
  })

  test("a commit git can't read asks instead of going through unchecked", async ($, on) => {
    const { ran, asked } = engine(on, { gitFails: true, answer: 'Block it' })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as any)
    expect(asked[0]).toMatch(/Couldn't read what this commit adds/)
    expect(r.deny).toMatch(/couldn't read what it adds/)
    expect(ran).toEqual([])
  })

  test('an Edit to a file that holds a key says nothing about the parts Claude never reads', async ($, on) => {
    const { toasts } = engine(on, { ignored: true, editRecord: `PORT=1\nGITHUB_TOKEN=${GH}\n` })
    const r: any = await $.tool.call({ tool: 'Edit', file_path: '/repo/.env', old_string: 'PORT=1', new_string: 'PORT=2' } as any)
    expect(toasts).toEqual([])
    expect(r.result.originalFile).toContain(GH) // the on-screen diff keeps the real file
  })

  test('two commits in one command are each checked in their own repo', async ($, on) => {
    const { cwds } = engine(on, { diff: '+++ b/a.ts\n+fine\n' })
    await $.tool.call({ tool: 'Bash', command: 'git -C a commit -m x && git -C b commit -m y' } as any)
    expect(cwds).toContain('/repo/a')
    expect(cwds).toContain('/repo/b')
  })

  test('git init then commit checks the folder files instead of asking blind', async ($, on) => {
    const { asked } = engine(on, { gitFails: true, answer: 'Block it', folder: { 'pay.ts': `k = '${STRIPE}'` } })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git init && git add . && git commit -m init' } as any)
    expect(asked[0]).toMatch(/adds what looks like a Stripe key in pay\.ts/)
    expect(r.deny).toMatch(/blocked this commit/)
  })

  test('git init then commit in a clean folder, or one the command makes, goes through', async ($, on) => {
    const { asked, ran } = engine(on, { gitFails: true, folder: { 'app.ts': 'export {}' } })
    await $.tool.call({ tool: 'Bash', command: 'git init && git add . && git commit -m init' } as any)
    expect(asked).toEqual([])
    expect(ran.length).toBe(1)
  })

  test('git init elsewhere does not skip the check when git timed out in a real repo', async ($, on) => {
    const { asked } = engine(on, { gitFails: true, timedOut: true, folder: { 'a.ts': 'export {}' } })
    await $.tool.call({ tool: 'Bash', command: 'git init tools/x && git commit -am wip' } as any)
    expect(asked[0]).toMatch(/Couldn't read what this commit adds/)
  })

  test('a diff too big to read whole asks instead of passing as clean', async ($, on) => {
    const { asked } = engine(on, { truncated: true, diff: '+++ b/a.ts\n+fine\n', answer: 'Allow once' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m big' } as any)
    expect(asked[0]).toMatch(/too big to check whole/)
  })

  test('a cut diff with a key in its start says both in one ask', async ($, on) => {
    const { asked } = engine(on, { truncated: true, diff: `+++ b/a.ts\n+k = '${STRIPE}'\n`, answer: 'Allow once' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m big' } as any)
    expect(asked.length).toBe(1)
    expect(asked[0]).toMatch(/a Stripe key.*too big to check whole/)
  })

  test('git init with more files than the scan reads asks instead of passing as clean', async ($, on) => {
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`f${i}.ts`, 'export {}']))
    const { asked } = engine(on, { gitFails: true, folder: many, answer: 'Allow once' })
    await $.tool.call({ tool: 'Bash', command: 'git init && git add . && git commit -m init' } as any)
    expect(asked[0]).toMatch(/too big to check whole/)
  })

  test('a clean commit and text that only mentions git go straight through', async ($, on) => {
    const { ran, asked } = engine(on, { diff: '+++ b/a.ts\n+const a = 1\n' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as any)
    await $.tool.call({ tool: 'Bash', command: 'echo "git push"' } as any)
    expect(asked).toEqual([])
    expect(ran.length).toBe(2)
  })

  test('/secret-guard reports the scanner and what it hid', async ($, on) => {
    engine(on, { output: `TOKEN=${GH}`, gitleaks: [] })
    await $.tool.call({ tool: 'Bash', command: 'env' } as any)
    const r: any = await $.command.run({ command: 'secret-guard', args: '' } as any)
    expect(r.text).toMatch(/Scanner: gitleaks \+ built-in rules/)
    expect(r.text).toMatch(/Hidden from Claude this session: \d+ × GitHub token/)
  })
})
