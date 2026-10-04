import { describe, expect, mock, test } from 'claude-code/testing'

import { elapsed, findingsOf, findingsText, isCodexReview, isReviewAgent, isShown, keyOf, labelOf, modelOf, outputOf } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } }
const CMD = `codex review -c 'model="gpt-5.6-luna"' --base origin/main --title "Fix the toast" > /work/out.txt 2>&1`
const OUTPUT = 'thinking\nreading hooks/register.tsx\nFull review comments:\n\n- [P2] Sync the version — a.json:3\n  details\n- [P1] Clear the status — b.tsx:20\n'

// Stands for the engine beneath the mod: `ps` lists a codex process while `alive` holds.
function engine(on: any) {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const state = { alive: true }
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: 'Command running in background with ID: b1. Output is being written to: /tmp/b1.output' }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('process.run', (_$: any, e: any) => {
    const [cmd] = e.argv
    if (cmd === 'ps') return { value: { exitCode: 0, stdout: state.alive ? `zsh\ncodex review -c model="gpt-5.6-luna" --base origin/main --title Fix the toast\n` : 'zsh\n', stderr: '' } }
    if (cmd === 'tail') return { value: { exitCode: 0, stdout: OUTPUT, stderr: '' } }
    return { value: { exitCode: 0, stdout: 'model = "gpt-6-astra"\n', stderr: '' } }
  })
  return { clock, toasts, state }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // a poll runs in the background

describe('review-watch', () => {
  test('helpers', () => {
    expect(isCodexReview(CMD)).toBe(true)
    expect(isCodexReview(`cd /x && timeout 900 codex review --commit abc`)).toBe(true)
    expect(isCodexReview(`codex -c 'model="x"' review`)).toBe(true)
    expect(isCodexReview('codex exec "do it"')).toBe(false)
    expect(isCodexReview('git log --grep review')).toBe(false)
    expect(isCodexReview('git commit -m "docs: codex review notes"')).toBe(false)
    expect(isCodexReview('codex exec review the PR')).toBe(false)
    expect(isCodexReview(`codex -c a=1 -c b=2 -c c=3 -c d=4 --profile x review --base main`)).toBe(true)
    expect(isReviewAgent('Review PR 28')).toBe(true)
    expect(isReviewAgent('Code reviewer pass')).toBe(true)
    expect(isReviewAgent('Preview the page')).toBe(false)
    expect(modelOf('git commit -m "x" && codex review --base main')).toBeUndefined()
    expect(modelOf(`codex review --title "x -m foo" --base main`)).toBeUndefined()
    expect(modelOf(CMD)).toBe('gpt-5.6-luna')
    expect(modelOf('codex review --model o4 --base main')).toBe('o4')
    expect(modelOf('codex review --base main')).toBeUndefined()
    expect(labelOf(CMD)).toBe('Fix the toast')
    expect(labelOf('codex review --commit abcdef123456')).toBe('commit abcdef1')
    expect(labelOf('codex review --base main')).toBe('changes vs main')
    expect(labelOf('codex review')).toBe('uncommitted changes')
    expect(outputOf(CMD, '/work')).toBe('/work/out.txt')
    expect(outputOf('codex review > out.txt', '/work')).toBe('/work/out.txt')
    expect(outputOf('codex review 2>&1', '/work')).toBeUndefined()
    expect(outputOf('codex review --base main > ~/r.txt', '/work', '/home/me')).toBe('/home/me/r.txt')
    expect(outputOf('cd /repo && codex review > r.txt', '/work')).toBe('/repo/r.txt')
    expect(outputOf('codex review --title "a > b" > r.txt', '/work')).toBe('/work/r.txt')
    expect(outputOf('codex review > $OUT', '/work')).toBeUndefined()
    // Two untitled reviews find different processes.
    expect(keyOf('timeout 900 codex review --base main > a.txt 2>&1')).toBe('codex review --base main')
    expect(keyOf(`cd /x && codex review -c 'model="o4"' --commit abc`)).toBe('codex review -c model=o4 --commit abc')
    expect(keyOf(CMD)).toBe('codex review -c model=gpt-5.6-luna --base origin/main --title Fix the toast')
    expect(findingsOf(OUTPUT)).toEqual(['P2', 'P1'])
    expect(findingsOf('looked around\nNo issues found.\n')).toEqual([])
    expect(findingsOf('')).toBeUndefined() // unreadable or empty output is not "no findings"
    expect(findingsOf('error: usage limit reached')).toBeUndefined()
    expect(findingsText(['P2', 'P1'])).toBe('2 findings (P2, P1)')
    expect(findingsText([])).toBe('no findings')
    expect(elapsed({ startedAt: 0, endedAt: 242_000 })).toBe('4m 02s')
    expect(isShown({ status: 'done', endedAt: Date.now() - 600_000 })).toBe(false)
  })

  test('a background codex review shows live, then toasts its findings when its process ends', async ($, on) => {
    const { clock, toasts, state } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: CMD, run_in_background: true } as any)

    await clock.advance(3_000)
    await settle()
    const band = await $.ui.mount({ plugin: 'review-watch', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /codex/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /gpt-5\.6-luna · Fix the toast/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /└ - \[P1\] Clear the status/ })).toBeDefined()
    expect(toasts).toEqual([])

    state.alive = false
    await clock.advance(3_000)
    await settle()
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toMatch(/^✓ codex review \(gpt-5\.6-luna\) done · .* · 2 findings \(P2, P1\)$/)
    await band.unmount()
  })

  test('a codex review without a model on its command line uses the Codex config', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: 'codex review --base main' } as any) // foreground: over when the call returns
    const band = await $.ui.mount({ plugin: 'review-watch', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /gpt-6-astra · changes vs main/ })).toBeDefined()
    await band.unmount()
  })

  test('tracks a review subagent and ignores other subagents', async ($, on) => {
    const { toasts } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'look', description: 'Explore the repo', subagentType: 'Explore' } as any)
    await $.agent.spawn({ prompt: 'review', description: 'Review PR 28', subagentType: 'general-purpose', model: 'sonnet' } as any)
    const band = await $.ui.mount({ plugin: 'review-watch', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /sonnet · Review PR 28/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Explore the repo/ })).toBeUndefined()

    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, agentId: 'a1' } as any)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toMatch(/^✓ Review PR 28 \(sonnet\) done · \d+s$/)
    await band.unmount()
  })

  test('a review that ends twice (the call returns and a poll sees it gone) toasts once', async ($, on) => {
    const { clock, toasts, state } = engine(on)
    state.alive = false
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await Promise.all([$.tool.call({ tool: 'Bash', command: CMD } as any), clock.advance(3_000)])
    await clock.advance(3_000)
    await settle()
    expect(toasts.length).toBe(1)
  })

  test('other commands pass straight through', async ($, on) => {
    const { toasts } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
    const band = await $.ui.mount({ plugin: 'review-watch', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /codex/ })).toBeUndefined()
    expect(toasts).toEqual([])
    await band.unmount()
  })
})
