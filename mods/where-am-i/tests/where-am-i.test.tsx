import { describe, expect, test } from 'claude-code/testing'

import { describe as label, parseRecap } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }

const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))

// Stands for the engine beneath the mod.
function engine(on: any, reply: string) {
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('prompt.submit', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'sweep runner', type: 'general-purpose', status: 'running' }] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the mods', toolUses: [] }] }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'band below' }) // stands for Token Weather and the engine's own band
  })
}

describe('where-am-i', () => {
  test('draws the recap above what was already there', async ($, on) => {
    engine(on, '```json\n{"goal":"Ship 3 mods","now":"built Where Am I","waiting":"you to test it","next":"Rulebook Guard"}\n```')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'ship all 3' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/work/a/b.ts', content: 'x' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^Ship 3 mods$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^built Where Am I$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting on you: you to test it/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await ui.unmount()
  })

  test('leaves out next while the next-steps mod shows it', async ($, on) => {
    engine(on, '{"goal":"Ship 3 mods","now":"built Where Am I","waiting":"","next":"Rulebook Guard"}')
    let nextStepsOn = false // stands for the value next-steps sets when it starts
    on('state.get', { plugin: 'next-steps', key: 'active' }, () => ({ value: { value: nextStepsOn || undefined, version: nextStepsOn ? 1 : 0 } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()

    const shown = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await shown.find({ type: 'Text', text: /^Rulebook Guard$/ })).toBeDefined()
    await shown.unmount()

    nextStepsOn = true
    const hidden = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await hidden.find({ type: 'Text', text: /^Ship 3 mods$/ })).toBeDefined()
    expect(await hidden.find({ type: 'Text', text: /next:/ })).toBeUndefined()
    expect(await hidden.find({ type: 'Text', text: /^Rulebook Guard$/ })).toBeUndefined()
    await hidden.unmount()
  })

  test('/recap answers with a summary', async ($, on) => {
    engine(on, '- Goal: ship 3 mods')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.command.run({ command: 'where', args: '' } as any)
    expect(r.text).toBe('- Goal: ship 3 mods')
  })

  test('labels tool calls in plain words', () => {
    expect(label({ tool: 'Bash', description: 'Run tests' })).toBe('running Run tests')
    expect(label({ tool: 'Edit', file_path: '/a/b/c.ts' })).toBe('editing b/c.ts')
    expect(label({ tool: 'mcp__claude_ai_Slack__slack_send_message' })).toBe('using claude_ai_Slack slack_send_message')
  })

  test('reads the JSON and drops em dashes', () => {
    expect(parseRecap('{"goal":"A — B","now":"","waiting":"","next":""}')?.goal).toBe('A, B')
    expect(parseRecap('no json here')).toBeNull()
    const long = parseRecap('{"goal":"g","now":"Part A of Merge Gate passed. Codex rules block without the luna model and codex exec too.","waiting":"","next":""}')
    expect(long?.now).toBe('Part A of Merge Gate passed')
  })
})
