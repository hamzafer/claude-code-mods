import { expect, mock, test } from 'claude-code/testing'

test('session start sets the dark look with the scene', async ($, on) => {
  let sent: any
  on('theme.set', ($, e) => { sent = e; return { value: { isDrawn: true } as any } })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(sent.backdrop.scene).toBe('gotham-night')
  expect(sent.overrideColorScheme).toBe('dark')
})

test('the backdrop draws the skyline svg on desktop', async ($, on) => {
  const ui = await $.ui.mount({
    plugin: 'gotham-night', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
    viewport: { columns: 100, rows: 30 },
    props: { scene: 'gotham-night', plugin: 'gotham-night', glass: false },
  } as any)
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const len = (svg as any).props.source.length
  expect(len < 131072).toBe(true)
})

const BACKDROP = {
  plugin: 'gotham-night', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
  viewport: { columns: 100, rows: 30 },
  props: { scene: 'gotham-night', plugin: 'gotham-night', glass: false },
} as any

test('the signal shows while waiting and hides while Claude works', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  // A fresh session starts sweeping: no signal before the first turn
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).not.toContain('class="signal"')

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).not.toContain('class="signal"')

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).toContain('class="signal"')
})

test('a question mid-turn lights the signal until answered', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  let during = ''
  let ui: any
  on('tool.call', async () => {
    during = (await ui.find({ type: 'Svg' })).props.source
    return { result: { answers: {} } }
  })
  ui = await $.ui.mount(BACKDROP)
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  expect(during).toContain('class="signal"')
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).not.toContain('class="signal"')
})

// The ask under test is the one with tool_use_id 'u1'. Every other check allows, so the
// tool call that follows really runs: its handler marks `ran`.
const askOnlyU1 = ($: unknown, e: { tool_use_id?: string }) => ({ decision: e.tool_use_id === 'u1' ? 'ask' : 'allow' }) as any

test('an ask left unanswered lights the signal, and the tool finishing clears it', async ($, on) => {
  const clock = mock.clock(on)
  let ran = false
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.check', askOnlyU1)
  on('tool.call', () => { ran = true; return { result: 'ok' } })
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.tool.check({ tool: 'Bash', input: { command: 'touch x' }, tool_use_id: 'u1', approver: 'person' } as any)
  expect(await svg()).not.toContain('class="signal"')
  await clock.advance(1600)
  expect(await svg()).toContain('class="signal"')
  await $.tool.call({ tool: 'Bash', command: 'touch x' } as any)
  expect(ran).toBe(true)
  expect(await svg()).not.toContain('class="signal"')
})

test('an ask settled quickly (Auto mode) never lights the signal', async ($, on) => {
  const clock = mock.clock(on)
  let ran = false
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.check', askOnlyU1)
  on('tool.call', () => { ran = true; return { result: 'ok' } })
  const ui = await $.ui.mount(BACKDROP)
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.tool.check({ tool: 'Bash', input: { command: 'touch x' }, tool_use_id: 'u1', approver: 'person' } as any)
  await clock.advance(500)
  await $.tool.call({ tool: 'Bash', command: 'touch x' } as any)
  expect(ran).toBe(true)
  await clock.advance(2000)
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).not.toContain('class="signal"')
})

test("a subagent's turns never light or clear the signal", async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const done = (id: string, agentId?: string) =>
    $.turn.complete({ turnId: id, agentId, answer: 'ok', durationMs: 5, isAborted: false, usage: null } as any)
  await $.turn.start({ turnId: 'main', prompt: 'hi' } as any)
  // A subagent finishing mid-turn: Claude is still working
  await $.turn.start({ turnId: 'sub', agentId: 'a1', prompt: 'task' } as any)
  await done('sub', 'a1')
  expect(await svg()).not.toContain('class="signal"')
  // The main turn ends: lit. A background agent starting after that doesn't clear it
  await done('main')
  const lit = await svg()
  expect(lit).toContain('class="signal"')
  await $.turn.start({ turnId: 'bg', agentId: 'a2', prompt: 'later' } as any)
  expect(await svg()).toBe(lit)
})

test('each time the signal lights, the bat burst is new; lighting it again keeps it', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const done = (id: string) => $.turn.complete({ turnId: id, answer: 'ok', durationMs: 5, isAborted: false, usage: null } as any)
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await done('t1')
  const first = await svg()
  await done('t1b') // still waiting: same burst
  expect(await svg()).toBe(first)
  await $.turn.start({ turnId: 't2', prompt: 'again' } as any)
  await done('t2')
  expect(await svg()).not.toBe(first)
})

test('a lit scene opens with the strike and the blackout; a sweeping one has neither', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string

  const sweeping = await svg()
  expect(sweeping).not.toContain('class="hit"')
  expect(sweeping).not.toContain('class="grid"')
  // The storm and the train belong to the city, lit or not
  expect(sweeping).toContain('class="strike sa"')
  expect(sweeping).toContain('class="train"')

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const lit = await svg()
  expect(lit).toContain('class="hit"')
  // Desktop stops the whole scene for good once lightning flashes all of it
  for (const scene of [sweeping, lit]) expect(scene).not.toContain('<rect width="1600" height="1000" fill="#dfe8ff"')
  expect(lit).toContain('class="grid"')
  expect(lit.length < 131072).toBe(true)
})

test('each scene has one reduced-motion rule, naming every part', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const sweeping = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  for (const scene of [sweeping, await svg()]) {
    expect(scene.split('@media').length).toBe(2)
    const rule = scene.slice(scene.indexOf('@media'))
    for (const cls of ['.beam', '.rain2', '.strike', '.hit', '.train', '.airship', '.grid']) expect(rule).toContain(cls)
  }
})
