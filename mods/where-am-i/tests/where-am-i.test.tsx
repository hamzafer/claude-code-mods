import { describe, expect, test } from 'claude-code/testing'

import { describe as label, parseRecap, resetBandOrder } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }

const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))

// Stands for the engine beneath the mod.
// `reply` is Haiku's text, or a handler that answers `model.complete` itself.
function engine(on: any, reply: string | ((...args: any[]) => unknown), beneath?: unknown) {
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('prompt.submit', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'sweep runner', type: 'general-purpose', status: 'running' }] }))
  on('model.complete', typeof reply === 'function' ? reply : () => ({ value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the mods', toolUses: [] }] }))
  on('ui.render', ($: any, e: any) => {
    if (beneath) return beneath
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

  test('sending a message clears waiting on you at once', async ($, on) => {
    engine(on, '{"goal":"Ship 3 mods","now":"asked to test","waiting":"you to test it","next":""}')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'please test it', durationMs: 1 } as any)
    await wait()

    await $.prompt.submit({ text: 'tested, it works' } as any)
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^Ship 3 mods$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting on you/ })).toBeUndefined()
    await ui.unmount()
  })

  // Haiku holds its recap until `answer` is called.
  function slowHaiku(on: any) {
    const held = { answer: (_text: string) => {} }
    engine(on, () => new Promise(done => (held.answer = text => done({ value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1 } } }))))
    return held
  }
  const OLD = '{"goal":"Ship 3 mods","now":"old turn","waiting":"you to test it","next":""}'

  test('a summary that lands after the next turn starts is dropped', async ($, on) => {
    const haiku = slowHaiku(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'ship all 3' } as any)
    await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()

    // Haiku is still writing the recap when the next turn starts.
    await $.prompt.submit({ text: 'now the next one' } as any)
    await $.turn.start({ turnId: 't2' } as any)
    haiku.answer(OLD)
    await wait()
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /old turn|waiting on you/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a slash command while Haiku writes keeps its summary', async ($, on) => {
    const haiku = slowHaiku(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'ship all 3' } as any)
    await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()

    await $.prompt.submit({ text: '/where' } as any) // starts no turn of Claude's
    haiku.answer(OLD)
    await wait()
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /waiting on you: you to test it/ })).toBeDefined()
    await ui.unmount()
  })

  test('a slash command that starts no turn leaves now as it was', async ($, on) => {
    engine(on, '{"goal":"Ship 3 mods","now":"built Where Am I","waiting":"","next":""}')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()
    await $.prompt.submit({ text: '/where' } as any)
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^built Where Am I$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /reading your message/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a turn Claude Code starts itself keeps the person\'s message as the prompt', async ($, on) => {
    const asked: string[] = []
    engine(on, (_$: any, e: any) => (asked.push(e.prompt), { value: { isAnswered: true, text: '{"goal":"g","now":"n","waiting":"","next":""}', usage: { input_tokens: 1, output_tokens: 1 } } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'ship all 3' } as any)
    await $.turn.start({ turnId: 't1', text: 'ship all 3' } as any)
    await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'started an agent', durationMs: 1 } as any)
    await $.turn.start({ turnId: 't2', text: '<task-notification>agent done</task-notification>' } as any) // a background agent finished
    await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'the agent is done', durationMs: 1 } as any)
    await wait()
    expect(asked[1]).toContain("The person's latest message: ship all 3")
    expect(asked[1]).not.toContain('task-notification')
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

  // Stands for glance: a mod that calls an MCP tool in the background, as `$.mcp.call` does.
  const glance = {
    name: 'glance',
    register(on: any) {
      on('command.run', { command: 'peek' }, async ($: any) => {
        await $.tool.call({ tool: 'mcp__claude_ai_Slack__slack_search_public_and_private', query: 'x' })
        return { text: 'peeked' }
      })
    },
  }

  test('a call another mod makes does not change now; one Claude makes does', { plugins: [glance] }, async ($, on) => {
    engine(on, '{"goal":"Ship 3 mods","now":"built Where Am I","waiting":"","next":"Rulebook Guard"}')
    on('command.run', () => ({ text: '' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()

    // Idle: glance checks Slack in the background.
    await $.command.run({ command: 'peek', args: '' } as any)
    const idle = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await idle.find({ type: 'Text', text: /^built Where Am I$/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /slack/ })).toBeUndefined()
    await idle.unmount()

    // Claude's own call shows as now.
    await $.prompt.submit({ text: 'ship all 3' } as any)
    await $.tool.call({ tool: 'Read', file_path: '/work/a/b.ts' } as any)
    const busy = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await busy.find({ type: 'Text', text: /^reading a\/b.ts$/ })).toBeDefined()
    await busy.unmount()
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
    // a Bash call with no description names its program, never its arguments
    expect(label({ tool: 'Bash', command: 'curl -H "Authorization: Bearer sk-SECRET123" https://x' })).toBe('running curl')
    expect(label({ tool: 'Bash', command: 'cd /work && git push origin main' })).toBe('running git push')
    expect(label({ tool: 'Bash', command: 'TOKEN=sk-SECRET123 ./deploy.sh' })).toBe('running a shell command')
    expect(label({ tool: 'Read', file_path: '/a/b\x1b[2J/c.ts' })).toBe('reading b/c.ts')
  })

  test('a command line never reaches the band or Haiku', async ($, on) => {
    const prompts: string[] = []
    engine(on, (_$: any, e: any) => (prompts.push(e.prompt), { value: { isAnswered: true, text: '{"goal":"Ship it","now":"","waiting":"","next":""}', usage: { input_tokens: 1, output_tokens: 1 } } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any) // a recap, so the band draws
    await wait()
    await $.prompt.submit({ text: 'fetch it' } as any)
    await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer sk-SECRET123" https://x' } as any)
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^running curl$/ })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).not.toMatch(/SECRET/)
    await ui.unmount()
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()
    expect(prompts.length).toBe(2)
    expect(prompts[1]).toMatch(/Tools used this turn: running curl\n/)
    expect(prompts[1]).not.toMatch(/SECRET/)
  })

  test('a control character in the recap does not reach the band', async ($, on) => {
    engine(on, '{"goal":"Ship \\u001b[2Jit\\u202e","now":"built\\u0007 it","waiting":"","next":""}')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'ship it' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^Ship it$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^built it$/ })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).not.toMatch(/\\u001b|\\u0007|‮/)
    await ui.unmount()
  })

  test('reads the JSON and drops em dashes', () => {
    expect(parseRecap('{"goal":"A — B","now":"","waiting":"","next":""}')?.goal).toBe('A, B')
    expect(parseRecap('no json here')).toBeNull()
    const long = parseRecap('{"goal":"g","now":"Part A of Merge Gate passed. Codex rules block without the luna model and codex exec too.","waiting":"","next":""}')
    expect(long?.now).toBe('Part A of Merge Gate passed')
  })

  test('keys its band and follows the band order file', async ($, on) => {
    // another band mod drew its column beneath
    const beneath = {
      type: 'Box',
      props: { key: 'bands', flexDirection: 'column' },
      children: [{ type: 'Box', props: { key: 'band:context-bar' }, children: [{ type: 'Text', children: ['here'] }] }],
    }
    resetBandOrder()
    const files: Record<string, string> = { '/home/me/.claude/claude-code-mods/bands.json': '{"order":["context-bar","where-am-i"]}' }
    on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
    on('fs.exists', (_$: any, e: any) => ({ value: e.path in files }))
    on('fs.read', (_$: any, e: any) => ({ value: files[e.path] ?? '' }))
    engine(on, '{"goal":"Ship 3 mods","now":"built it","waiting":"","next":""}', beneath)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'ship all 3' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await wait()
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...BAND } as any)
    const root: any = await ui.drawn()
    expect(root.props.key).toBe('bands')
    // with no order it would sit above context-bar; the order file puts it last
    expect(root.children.map((c: any) => c.props.key)).toEqual(['band:context-bar', 'band:where-am-i'])
    expect(await ui.find({ type: 'Text', text: /^Ship 3 mods$/ })).toBeDefined()
    await ui.unmount()
    resetBandOrder()
  })
})
