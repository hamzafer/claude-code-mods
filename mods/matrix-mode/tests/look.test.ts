import { expect, test } from 'claude-code/testing'

test('session start sets the dark look with the scene', async ($, on) => {
  let sent: any
  on('theme.set', ($, e) => { sent = e; return { value: { isDrawn: true } as any } })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(sent.backdrop.scene).toBe('matrix-mode')
  expect(sent.overrideColorScheme).toBe('dark')
})

const BACKDROP = {
  plugin: 'matrix-mode', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
  viewport: { columns: 100, rows: 30 },
  props: { scene: 'matrix-mode', plugin: 'matrix-mode', glass: false },
} as any

// Only the needs-you scene has the prompt line.
const PROMPT = 'class="spot"'

test('the backdrop draws the rain on desktop, under the size limit', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const svg = (await ui.find({ type: 'Svg' })) as any
  expect(svg).toBeDefined()
  expect(svg.props.source).toContain('class="f2"')
  expect(svg.props.source.length < 131072).toBe(true)
})

test('the prompt shows when a turn ends and goes when the next starts', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  // A fresh session starts working: no prompt before the first turn
  expect(await svg()).not.toContain(PROMPT)

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  expect(await svg()).not.toContain(PROMPT)

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const waiting = await svg()
  expect(waiting).toContain(PROMPT)
  expect(waiting.length < 131072).toBe(true)

  await $.turn.start({ turnId: 't2', prompt: 'next' } as any)
  expect(await svg()).not.toContain(PROMPT)
})

test('a question mid-turn shows the prompt until answered', async ($, on) => {
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
  expect(during).toContain(PROMPT)
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).not.toContain(PROMPT)
})

test('each wait holds new columns; waiting on keeps the same scene', async ($, on) => {
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

test('each scene has one reduced-motion rule naming every animated class, and nothing full-size moves', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const working = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const waiting = await svg()
  for (const scene of [working, waiting]) {
    expect(scene.split('prefers-reduced-motion').length).toBe(2)
    const at = scene.indexOf('@media (prefers-reduced-motion')
    const rule = scene.slice(at, scene.indexOf('</style>', at))
    // Every class the stylesheet animates
    const animated = [...scene.matchAll(/\.([\w-]+)\{[^}]*animation:/g)].map(m => `.${m[1]}`)
    expect(animated.length > 0).toBe(true)
    for (const cls of animated) expect(rule).toContain(cls)
    // Desktop stops the whole scene for good once a full-size layer animates
    expect(scene).not.toMatch(/<rect width="1600" height="1000"[^>]*class=/)
  }
  for (const cls of ['.f0', '.f1', '.f2', '.fa', '.fb']) expect(working).toContain(cls)
  for (const cls of ['.key', '.caret', '.blink']) expect(waiting).toContain(cls)
})
