import { describe, expect, test } from 'claude-code/testing'

import { cdOf, pii, undash } from '../hooks/register'

// Stands for the engine beneath the mod: records what ran, answers the dialog, fakes the repo.
type Opts = {
  answer?: string
  ruffFails?: boolean
  diff?: string
  prettier?: { tracked?: string; realPath?: string }
  files?: Record<string, string> // other repo files, by path
}

function engine(on: any, opts: Opts = {}) {
  const ran: any[] = []
  const asked: string[] = []
  const runs: { argv: string[]; cwd?: string }[] = []
  const toasts: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    asked.push(JSON.stringify(e))
    const question = e.questions[0].question
    return { result: { questions: e.questions, answers: { [question]: opts.answer ?? 'Block it' } }, text: '' }
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') ran.push(e)
    return { result: {}, text: 'ok' }
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/Users/me' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', (_$: any, e: any) => ({ value: (opts.prettier !== undefined && e.path === '/repo/node_modules/.bin/prettier') || e.path in (opts.files ?? {}) }))
  on('fs.read', (_$: any, e: any) => ({ value: opts.files?.[e.path] ?? '' }))
  on('fs.stat', (_$: any, e: any) => {
    const real = e.path === '/repo/node_modules/.bin/prettier' ? (opts.prettier?.realPath ?? '/repo/node_modules/prettier/bin/prettier.cjs') : e.path.replace(/\/[^/]+\/\.\.(?=\/|$)/g, '')
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: real } }
  })
  on('process.run', (_$: any, e: any) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    const [cmd, ...rest] = e.argv as string[]
    const args = cmd === 'git' ? withoutOptions(rest) : rest
    if (cmd === 'git' && args[0] === 'rev-parse') return { value: { exitCode: 0, stdout: '/repo\n', stderr: '' } }
    if (cmd === 'git' && args[0] === 'diff') return { value: { exitCode: 0, stdout: opts.diff ?? 'api/app.py\nREADME.md\n', stderr: '' } }
    if (cmd === 'git' && args[0] === 'ls-files') {
      const t = opts.prettier?.tracked // listed only when a pathspec covers it, as git does
      const listed = t !== undefined && args.slice(args.indexOf('--') + 1).some(p => t === p || t.startsWith(`${p}/`))
      return { value: { exitCode: 0, stdout: listed ? `${t}\n` : '', stderr: '' } }
    }
    if (cmd.endsWith('/prettier')) return { value: { exitCode: 1, stdout: '', stderr: '[warn] web/app.ts\n' } }
    if (cmd === 'ruff') {
      return opts.ruffFails
        ? { value: { exitCode: 1, stdout: 'Would reformat: api/app.py\n1 file would be reformatted', stderr: '' } }
        : { value: { exitCode: 0, stdout: '', stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { ran, asked, runs, toasts }
}

// The git subcommand and its arguments, past any `-c k=v` / `-C dir` global options.
function withoutOptions(args: string[]) {
  let i = 0
  while (args[i] === '-c' || args[i] === '-C') i += 2
  return args.slice(i)
}

describe('rulebook-guard', () => {
  test('helpers', () => {
    expect(undash('fast — and small—really')).toBe('fast, and small, really')
    expect(pii('mail me at a.b@example.com')).toBe('an email address')
    expect(pii('call +47 912 34 567')).toBe('a phone number')
    expect(pii('version 2.1.287 on 2026-10-02')).toBeNull()
    expect(cdOf('cd "my repo" && git push')).toBe('my repo')
    expect(cdOf('git push')).toBeUndefined()
  })

  test('em dashes in a markdown write become commas; code is left alone', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: 'Write', file_path: '/repo/docs/plan.md', content: 'Ship it — today' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/a.ts', content: "const s = '—'" } as any)
    expect(ran[0].content).toBe('Ship it, today')
    expect(ran[1].content).toBe("const s = '—'")
  })

  test('em dashes in a commit message and a Slack post are rewritten', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "Fix login — and tests"' } as any)
    await $.tool.call({ tool: 'mcp__claude_ai_Slack__slack_send_message', channel_id: 'C1', message: 'Done — merged' } as any)
    expect(ran[0].command).toBe('git commit -m "Fix login, and tests"')
    expect(ran[1].message).toBe('Done, merged')
  })

  test('--amend is blocked unless allowed', async ($, on) => {
    const { ran } = engine(on, { answer: 'Block it' })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git commit --amend --no-edit' } as any)
    expect(r.deny).toMatch(/^rulebook-guard: .*new commits, not amend/)
    expect(ran.filter(e => e.tool === 'Bash')).toEqual([])
  })

  test('--amend is caught with git options in between', async ($, on) => {
    const { ran } = engine(on, { answer: 'Block it' })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'cd repo && git -c user.name=demo -C . commit --amend -m "x"' } as any)
    expect(r.deny).toMatch(/new commits, not amend/)
    expect(ran.filter(e => e.tool === 'Bash')).toEqual([])
  })

  test('text that only mentions --amend is not held', async ($, on) => {
    const { ran, asked } = engine(on)
    const script = "python3 - <<'EOF'\nprint('git commit --amend')\nEOF"
    await $.tool.call({ tool: 'Bash', command: script } as any)
    await $.tool.call({ tool: 'Bash', command: 'echo "never run git commit --amend"' } as any)
    expect(asked).toEqual([])
    expect(ran.map(e => e.command)).toEqual([script, 'echo "never run git commit --amend"'])
  })

  test('a push with unformatted Python asks first, and Allow once lets it through', async ($, on) => {
    const { ran, asked } = engine(on, { answer: 'Allow once', ruffFails: true })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(asked[0]).toMatch(/ruff format: api\/app\.py/)
    expect(ran.filter(e => e.tool === 'Bash').map(e => e.command)).toEqual(['git push'])
  })

  test('a formatted push goes straight through', async ($, on) => {
    const { ran, asked } = engine(on, { ruffFails: false })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(asked).toEqual([])
    expect(ran.map(e => e.command)).toEqual(['git push'])
  })

  test('an email going into notes asks first', async ($, on) => {
    const { ran, asked } = engine(on, { answer: 'Block it' })
    const r: any = await $.tool.call({ tool: 'Write', file_path: '/Users/me/notes/setup.md', content: 'login: a.b@example.com' } as any)
    expect(asked[0]).toMatch(/an email address/)
    expect(asked[0]).not.toMatch(/a\.b@example\.com/) // the value itself is never shown
    expect(r.deny).toMatch(/^rulebook-guard: the user blocked writing an email address .*Personal info needs the user's approval first\./)
    expect(ran.filter(e => e.tool === 'Write')).toEqual([])
  })

  test('a prettier the repo tracks in git is never run, and the push says so', async ($, on) => {
    const { ran, asked, runs, toasts } = engine(on, { diff: 'web/app.ts\n', prettier: { tracked: 'node_modules/.bin/prettier' } })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(runs.filter(r => r.argv[0].endsWith('prettier'))).toEqual([])
    expect(toasts.join()).toMatch(/Prettier not checked/)
    expect(asked).toEqual([])
    expect(ran.map(e => e.command)).toEqual(['git push'])
  })

  test('a prettier that resolves outside the repo node_modules is never run', async ($, on) => {
    const { runs, toasts } = engine(on, { diff: 'web/app.ts\n', prettier: { realPath: '/tmp/evil/prettier' } })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(runs.filter(r => r.argv[0].endsWith('prettier'))).toEqual([])
    expect(toasts.join()).toMatch(/Prettier not checked/)
  })

  test('a file the repo tracks deeper in node_modules also stops prettier', async ($, on) => {
    const { runs, toasts } = engine(on, { diff: 'web/app.ts\n', prettier: { tracked: 'node_modules/prettier/index.cjs' } })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(runs.filter(r => r.argv[0].endsWith('prettier'))).toEqual([])
    expect(toasts.join()).toMatch(/ships its own/)
  })

  // Configs Prettier would run as code; the second sits next to the file, not at the root.
  const codeConfigs: Record<string, string> = {
    '/repo/prettier.config.js': 'module.exports = {}',
    '/repo/web/.prettierrc.cjs': 'module.exports = {}',
    '/repo/.prettierrc': '{ "plugins": ["./plug.cjs"] }',
    '/repo/package.json': '{ "prettier": "./shared-config.js" }',
  }
  for (const [path, text] of Object.entries(codeConfigs)) {
    test(`${path.slice(6)} stops prettier, since it would run repo code`, async ($, on) => {
      const { runs, toasts } = engine(on, { diff: 'web/app.ts\n', prettier: {}, files: { [path]: text } })
      await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
      expect(runs.filter(r => r.argv[0].endsWith('prettier'))).toEqual([])
      expect(toasts.join()).toMatch(/would run this repo's own code/)
    })
  }

  test('a plain data config still lets prettier check the push', async ($, on) => {
    const { runs } = engine(on, { answer: 'Block it', diff: 'web/app.ts\n', prettier: {}, files: { '/repo/.prettierrc.json': '{ "semi": false }', '/repo/package.json': '{ "name": "x" }' } })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(runs.filter(r => r.argv[0].endsWith('prettier')).length).toBe(1)
  })

  test('an npm-installed prettier still checks the push', async ($, on) => {
    const { asked, runs } = engine(on, { answer: 'Block it', diff: 'web/app.ts\n', prettier: {} })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    expect(runs.filter(r => r.argv[0].endsWith('prettier')).length).toBe(1)
    expect(asked[0]).toMatch(/prettier: web\/app\.ts/)
    expect(r.deny).toMatch(/not formatted/)
  })

  test('a cd outside the session folder is ignored; one inside is followed', async ($, on) => {
    const { runs } = engine(on)
    await $.tool.call({ tool: 'Bash', command: 'cd /tmp/evil && git push' } as any)
    await $.tool.call({ tool: 'Bash', command: 'cd ../other && git push' } as any)
    await $.tool.call({ tool: 'Bash', command: 'cd api && git push' } as any)
    const tops = runs.filter(r => r.argv.includes('rev-parse')).map(r => r.cwd)
    expect(tops).toEqual(['/repo', '/repo', '/repo/api'])
  })

  test('every git call turns the repo fsmonitor hook off', async ($, on) => {
    const { runs } = engine(on, { diff: 'web/app.ts\n', prettier: {} })
    await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
    const git = runs.filter(r => r.argv[0] === 'git')
    expect(git.map(r => withoutOptions(r.argv.slice(1))[0])).toEqual(['rev-parse', 'diff', 'ls-files'])
    for (const r of git) expect(r.argv.slice(1, 3)).toEqual(['-c', 'core.fsmonitor=false'])
  })
})
