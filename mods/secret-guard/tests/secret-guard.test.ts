import { describe, expect, test } from 'claude-code/testing'

import { bare, cdOf } from '../hooks/register'
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
}

// Stands for the engine beneath the mod: records what ran, answers the dialog, fakes git and gitleaks.
function engine(on: any, opts: Opts = {}) {
  const ran: any[] = []
  const asked: string[] = []
  const toasts: string[] = []
  const runs: string[][] = []
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
      return { result: { type: 'text', file: { filePath: e.file_path, content, numLines: 1, startLine: 1, totalLines: 1 } }, text: content }
    }
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
  on('fs.read', (_$: any, e: any) => ({ value: file(e.path) ?? '' }))
  on('process.run', (_$: any, e: any) => {
    const argv = [...e.argv] as string[]
    runs.push(argv)
    if (argv[0] === 'gitleaks') {
      if (opts.gitleaks === null || opts.gitleaks === undefined) throw new Error('not installed')
      if (argv[1] === 'version') return { value: { exitCode: 0, stdout: '8.30.1\n', stderr: '' } }
      const text: string = e.init?.stdin ?? ''
      const rows = opts.gitleaks.filter(r => text.includes(r.Secret))
      return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }
    }
    if (argv.includes('ls-files')) return { value: { exitCode: 0, stdout: Object.keys(opts.untracked ?? {}).map(f => `${f}\0`).join(''), stderr: '' } }
    if (argv.includes('check-ignore')) return { value: { exitCode: opts.ignored ? 0 : 1, stdout: '', stderr: '' } }
    if (argv.includes('diff') || argv.includes('log')) return { value: { exitCode: 0, stdout: opts.diff ?? '', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { ran, asked, toasts, runs }
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
    expect(bare('echo "git push"')).toBe('echo ""')
    expect(cdOf('cd api && git commit -m x')).toBe('api')
  })

  test('a secret in Bash output is hidden before Claude reads it, with a toast', async ($, on) => {
    const { toasts } = engine(on, { output: `GITHUB_TOKEN=${GH}\nPATH=/usr/bin` })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'cat .env' } as any)
    expect(r.result.stdout).toBe('GITHUB_TOKEN=[hidden by secret-guard: GitHub token]\nPATH=/usr/bin')
    expect(JSON.stringify(r)).not.toContain(GH)
    expect(toasts[0]).toMatch(/hid a GitHub token from Claude \(Bash output\)/)
  })

  test('a Read of a key file is hidden; a clean read is untouched', async ($, on) => {
    engine(on, { output: PEM })
    const r: any = await $.tool.call({ tool: 'Read', file_path: '/repo/id_rsa' } as any)
    expect(r.result.file.content).toBe('[hidden by secret-guard: private key]')
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
    expect(log.slice(-3)).toEqual(['HEAD', '--not', '--remotes'])
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
