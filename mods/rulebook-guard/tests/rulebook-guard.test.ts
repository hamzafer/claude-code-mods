import { describe, expect, test } from 'claude-code/testing'

import { cdOf, pii, undash } from '../hooks/register'

// Stands for the engine beneath the mod: records what ran, answers the dialog, fakes the repo.
function engine(on: any, opts: { answer?: string; ruffFails?: boolean } = {}) {
  const ran: any[] = []
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    asked.push(JSON.stringify(e))
    const question = e.questions[0].question
    return { result: { questions: e.questions, answers: { [question]: opts.answer ?? 'Block it' } }, text: '' }
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') ran.push(e)
    return { result: {}, text: 'ok' }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', (_$: any, e: any) => {
    const [cmd, ...args] = e.argv as string[]
    if (cmd === 'git' && args[0] === 'rev-parse') return { value: { exitCode: 0, stdout: '/repo\n', stderr: '' } }
    if (cmd === 'git' && args[0] === 'diff') return { value: { exitCode: 0, stdout: 'api/app.py\nREADME.md\n', stderr: '' } }
    if (cmd === 'ruff') {
      return opts.ruffFails
        ? { value: { exitCode: 1, stdout: 'Would reformat: api/app.py\n1 file would be reformatted', stderr: '' } }
        : { value: { exitCode: 0, stdout: '', stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { ran, asked }
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
})
