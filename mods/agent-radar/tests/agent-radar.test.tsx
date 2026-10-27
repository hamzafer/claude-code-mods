import { describe, expect, mock, test } from 'claude-code/testing'

import { describe as label, elapsed, isShown, modelName, resetBandOrder } from '../hooks/register'
import { agentOf, baseName, outputPathOf, program, shellLabel, tailLines } from '../hooks/watch'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } }
const PANE = { component: 'Pane', requestId: 'agent-radar', props: { title: 'Agent Radar', isFocused: true, bodyColumns: 100, placement: 'dock' } }

const OUT = '/private/tmp/c/p/s/tasks/bqumpaw3k.output'

// Stands for the engine beneath the mod: lsof sees OUT open while `state.open` holds (and not at all
// without `state.lsof`), /proc likewise while `state.proc` holds (no /proc while it is undefined), the
// tails script answers from `state.tails`. A Bash call is a background one.
function engine(on: any, files: Record<string, string> = {}, beneath?: unknown) {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const state = { open: true, lsof: true, text: `Command running in background. Output is being written to: ${OUT}.`, tails: {} as Record<string, string>, proc: undefined as boolean | undefined }
  resetBandOrder()
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: e.path in files }))
  on('fs.read', (_$: any, e: any) => ({ value: files[e.path] ?? '' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { backgroundTaskId: baseName(OUT) }, text: state.text }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => beneath ?? $.ui.resolve(e).Text({ children: 'band below' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Run the sweep', toolUses: [] }, { role: 'assistant', text: 'Sweep is at trial 12 of 40.', toolUses: [] }] }))
  on('process.run', (_$: any, e: any) => {
    const [cmd, flag, script] = e.argv as string[]
    if (cmd?.endsWith('lsof')) {
      if (!state.lsof) throw new Error('lsof: not found')
      const files = (e.argv as string[]).slice(3)
      return { value: { exitCode: state.open ? 0 : 1, stdout: state.open ? files.map(f => `p42\nn${f}\n`).join('') : '', stderr: '' } }
    }
    if (cmd === 'sh' && flag === '-c' && script?.includes('radar:open')) {
      return { value: { exitCode: state.proc === undefined ? 2 : 0, stdout: state.proc ? `n${OUT}\n` : 'n/dev/null\n', stderr: '' } }
    }
    if (cmd === 'sh' && flag === '-c' && script?.includes('radar:tails')) {
      const files = (e.argv as string[]).slice(4)
      return { value: { exitCode: 0, stdout: files.map(f => `\x01${f}\n${state.tails[f] ?? ''}`).join(''), stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { clock, toasts, state }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // a poll runs in the background
// A poll under load can take longer than settle: wait for what it should have done, up to 4 s.
async function eventually(check: () => unknown) {
  for (let i = 0; i < 160 && !(await check()); i++) await new Promise(done => (globalThis as any).setTimeout(done, 25))
}

describe('agent-radar', () => {
  test('helpers', () => {
    expect(elapsed({ startedAt: 0, endedAt: 252_000 })).toBe('4m 12s')
    expect(elapsed({ startedAt: 0, endedAt: 9_000 })).toBe('9s')
    expect(label({ tool: 'mcp__plugin_playwright_playwright__browser_click' })).toBe('browser: click')
    const done = (ago: number) => ({ id: 'x', description: 'd', type: 't', status: 'done' as const, startedAt: 0, endedAt: Date.now() - ago, tools: 0, last: '' })
    expect(isShown(done(5_000))).toBe(true)
    expect([done(600_000)].filter(a => isShown(a))).toEqual([]) // gone after 30 s
  })

  test('a spawned agent shows in the pane, opens to its messages, and toasts when done', async ($, on) => {
    const { toasts } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)

    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: / ● sweep runner$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^ \(Sonnet\)  sub / })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /band below/ })).toBeDefined()
    // the radar sits on top: what other mods draw stays below it
    const root: any = await band.drawn()
    expect(root.props.key).toBe('bands')
    expect(root.children.map((c: any) => c.props?.key)).toEqual(['band:agent-radar', undefined])

    const r = await $.command.run({ command: 'radar', args: '' } as any)
    expect(r.text).toBe('1 running, 0 finished')

    const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /1 running · 0 finished/ })).toBeDefined()
    expect(await ui.find({ key: 'agent-a1' })).toBeDefined()

    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: /Sweep is at trial 12 of 40/ })).toBeDefined()
    await ui.press({ key: 'back' })

    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, agentId: 'a1' } as any)
    expect(toasts[0]).toMatch(/^✓ sweep runner done \(\d+s · 0 tools\)$/)
    expect(await ui.find({ type: 'Text', text: /0 running · 1 finished/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: / ✓ sweep runner/ })).toBeDefined() // still shown for 30 s
    await ui.unmount()
    await band.unmount()
  })

  test('a subagent\'s command line is not drawn; a control character does not reach the band', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep\x1b[2J runner‮' } as any)
    await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer sk-SECRET123" https://x', agentId: 'a1' } as any)
    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: / ● sweep runner$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^ · running curl$/ })).toBeDefined()
    expect(JSON.stringify(await band.drawn())).not.toMatch(/SECRET|\\u001b|‮/)
    await band.unmount()
  })

  test('follows the band order file', async ($, on) => {
    // another band mod drew its column beneath
    const beneath = {
      type: 'Box',
      props: { key: 'bands', flexDirection: 'column' },
      children: [{ type: 'Box', props: { key: 'band:where-am-i' }, children: [{ type: 'Text', children: ['here'] }] }],
    }
    engine(on, { '/home/me/.claude/claude-code-mods/bands.json': '{"order":["where-am-i","agent-radar"]}' }, beneath)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)
    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    const root: any = await band.drawn()
    expect(root.children.map((c: any) => c.props.key)).toEqual(['band:where-am-i', 'band:agent-radar'])
    await band.unmount()
  })

  test('model names', () => {
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelName('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(modelName('us.anthropic.claude-3-5-haiku-20241022-v1:0')).toBe('Haiku 3.5')
    expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
    expect(modelName('haiku')).toBe('Haiku')
    expect(modelName('gpt-5')).toBe('gpt-5')
    expect(modelName('arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe('Sonnet 4') // not the region's 1
    expect(modelName('arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/a1b2c3d4e5f6g7h8i9j0k1l2m3')).toBe('a1b2c3d4e5f6g7h8i9j0k1l…') // cut short
  })

  test('background command helpers', () => {
    expect(agentOf("codex exec -c 'model=\"gpt-5-mini\"' \"fix it\"")).toEqual({ agent: 'codex', model: 'gpt-5-mini' })
    expect(agentOf("timeout 900 codex exec -p 'hello --model nope' --model gpt-5")).toEqual({ agent: 'codex', model: 'gpt-5' })
    expect(agentOf('cd /x && opencode run -m zai/glm hi')).toEqual({ agent: 'opencode', model: 'zai/glm' })
    expect(agentOf('cursor-agent -p hi')?.agent).toBe('cursor-agent')
    expect(agentOf('git commit -m "ask codex exec"')).toBeUndefined()
    expect(agentOf('gh run watch 123')).toBeUndefined()
    expect(shellLabel('codex exec --model gpt-5 "fix it"', 'Ask codex').label).toBe('codex gpt-5')
    expect(shellLabel('gh run watch 123 --exit-status', 'Watch CI')).toEqual({ label: 'Watch CI', detail: 'gh run watch 123 --exit-status' })
    // with no description, the program it runs, never its arguments
    expect(shellLabel('sleep 600 && echo hi && echo a very long command line that goes on', undefined).label).toBe('sleep')
    expect(shellLabel('curl -H "Authorization: Bearer sk-SECRET123" https://x').label).toBe('curl')
    expect(program('cd /work && npm test -- --watch')).toBe('npm test')
    expect(program('gh api -H "Authorization: token ghp_SECRET" /user')).toBe('gh api')
    expect(program('git -c user.token=SECRET push')).toBe('git')
    expect(program('API_KEY=sk-SECRET ./run.sh')).toBe('a shell command')
    expect(program('"$HOME/bin/x" --key SECRET')).toBe('a shell command')
    expect(outputPathOf(`Output is being written to: ${OUT}. You will be notified`)).toBe(OUT)
    expect(outputPathOf('Output is being written to: /tmp/b1.output')).toBe('/tmp/b1.output')
    expect(outputPathOf('nothing here')).toBeUndefined()
    expect(outputPathOf('x', { backgroundOutputPath: '/remote/t.output' })).toBe('/remote/t.output')
    expect(tailLines('a\r\n\x1b[31mb\x1b[0m\n\n c \n', 2)).toEqual(['b', ' c'])
    // what a command prints reaches the terminal: no escape sequence or control character survives
    expect(tailLines('a\x1b]52;c;aGk=\x07b\x1b[>0qc\x9b2Jd\x1bPq#0\x1b\\e\bf')).toEqual(['abcdef'])
    expect(shellLabel('echo \x1b]0;title\x07hi', 'run \x1b[2Jit')).toEqual({ label: 'run it', detail: 'echo hi' })
    // a huge command does not stall the label; the path must be absolute, with no `..`
    expect(Date.now() - (() => { const t = Date.now(); agentOf(`codex exec${' '.repeat(80_000)}`); shellLabel('(a'.repeat(40_000)); return t })()).toBeLessThan(500)
    expect(outputPathOf('Output is being written to: /x/tasks/../../any/tasks/a.output')).toBeUndefined()
    expect(outputPathOf('Output is being written to: -rf.output')).toBeUndefined()
    expect(outputPathOf('Output: /a b/tasks/c.output Output is being written to: /t/tasks/d.output.')).toBe('/t/tasks/d.output')
  })

  test('a background command shows, then finishes after two lsof misses', async ($, on) => {
    const { clock, toasts, state } = engine(on)
    state.tails[OUT] = 'building\nrun 1 of 3\nrun 2 of 3\n'
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: 'gh run watch 123', description: 'Watch CI', run_in_background: true } as any)

    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: / ● Watch CI/ })).toBeDefined()
    await clock.advance(5_000)
    await eventually(() => band.find({ type: 'Text', text: /sh .*· run 2 of 3/ }))
    expect(await band.find({ type: 'Text', text: /sh .*· run 2 of 3/ })).toBeDefined() // kind tag and the last output line
    expect(toasts).toEqual([])

    state.open = false
    await clock.advance(5_000) // one miss: still running
    await settle()
    expect(toasts).toEqual([])
    await clock.advance(5_000) // two in a row: over
    await eventually(() => toasts.length > 0)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toMatch(/^✓ Watch CI done \(\d+s\)$/)
    expect(await band.find({ type: 'Text', text: / ✓ Watch CI/ })).toBeDefined()
    const r = await $.command.run({ command: 'radar', args: '' } as any)
    expect(r.text).toBe('0 running, 1 finished')
    await band.unmount()
  })

  test('a command Claude Code moved to the background (Ctrl+B, a timeout) is a line too', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as any) // no run_in_background; the result carries a task id
    const r = await $.command.run({ command: 'radar', args: '' } as any)
    expect(r.text).toBe('1 running, 0 finished')
  })

  test('a command whose result names no output file is not tracked; without lsof nothing is called done', async ($, on) => {
    const { clock, toasts, state } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    state.text = 'Command running in background.'
    await $.tool.call({ tool: 'Bash', command: 'sleep 600', run_in_background: true } as any)
    expect((await $.command.run({ command: 'radar', args: '' } as any)).text).toBe('0 running, 0 finished')

    state.text = `Output is being written to: ${OUT}.`
    state.lsof = false
    await $.tool.call({ tool: 'Bash', command: 'sleep 600', run_in_background: true } as any)
    for (let i = 0; i < 4; i++) {
      await clock.advance(5_000)
      await settle()
    }
    expect(toasts).toEqual([])
    expect((await $.command.run({ command: 'radar', args: '' } as any)).text).toBe('1 running, 0 finished')
  })

  test('without lsof, /proc says when a command is over', async ($, on) => {
    const { clock, toasts, state } = engine(on)
    state.lsof = false
    state.proc = true
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Nap', run_in_background: true } as any)
    await clock.advance(5_000)
    await settle()
    state.proc = false
    await clock.advance(5_000)
    await settle()
    await clock.advance(5_000)
    await eventually(() => toasts.length > 0)
    expect(toasts[0]).toMatch(/^✓ Nap done/)
  })

  test('an lsof installed mid-session is found on a later look', async ($, on) => {
    const { clock, toasts, state } = engine(on)
    state.lsof = false
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Nap', run_in_background: true } as any)
    await clock.advance(5_000)
    await settle()
    state.lsof = true // installed now: found within a minute, and sees the command open
    for (let i = 0; i < 13; i++) {
      await clock.advance(5_000)
      await settle()
    }
    expect(toasts).toEqual([])
    state.open = false
    for (let i = 0; i < 3 && toasts.length === 0; i++) {
      await clock.advance(5_000)
      await settle()
    }
    await eventually(() => toasts.length > 0)
    expect(toasts[0]).toMatch(/^✓ Nap done/)
  })

  test('a command that runs another agent is labelled with it and its model; the pane shows its output', async ($, on) => {
    const { clock, state } = engine(on)
    state.tails[OUT] = 'thinking\nediting a.ts\n'
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.tool.call({ tool: 'Bash', command: "codex exec -C /x --model gpt-5 'fix it'", run_in_background: true } as any)
    await clock.advance(5_000)
    await settle()
    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: / ● codex gpt-5/ })).toBeDefined()
    await $.command.run({ command: 'radar', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...PANE } as any)
    await ui.press({ key: 'agent-sh:bqumpaw3k.output' })
    await eventually(() => ui.find({ type: 'Text', text: /editing a\.ts/ }))
    expect(await ui.find({ type: 'Text', text: /\$ codex exec -C \/x/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /editing a\.ts/ })).toBeDefined()
    await ui.unmount()
    await band.unmount()
  })
})
