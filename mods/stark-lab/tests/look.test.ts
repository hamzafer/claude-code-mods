import { expect, test } from 'claude-code/testing'

import { sparks } from '../hooks/scene/sparks.js'
import { reactor } from '../hooks/scene/reactor.js'

const BACKDROP = {
  plugin: 'stark-lab', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
  viewport: { columns: 100, rows: 30 },
  props: { scene: 'stark-lab', plugin: 'stark-lab', glass: false },
} as any

// The needs-you scene is the only one with the lock-on round the reactor.
const NEEDS_YOU = 'class="target"'

test('session start sets the dark look with the scene', async ($, on) => {
  let sent: any
  on('theme.set', ($, e) => { sent = e; return { value: { isDrawn: true } as any } })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(sent.backdrop.scene).toBe('stark-lab')
  expect(sent.overrideColorScheme).toBe('dark')
})

test('the backdrop draws the lab svg on desktop', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const source = (svg as any).props.source as string
  expect(source.length < 131072).toBe(true)
  expect(source).toContain('preserveAspectRatio="xMidYMid slice"')
  expect(source).not.toContain('<script')
})

test('the needs-you scene appears when a turn ends and goes when the next starts', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  // A fresh session starts working
  expect(await svg()).not.toContain(NEEDS_YOU)

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  expect(await svg()).not.toContain(NEEDS_YOU)

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const waiting = await svg()
  expect(waiting).toContain(NEEDS_YOU)
  expect(waiting).toContain('class="spark ')
  expect(waiting.length < 131072).toBe(true)

  await $.turn.start({ turnId: 't2', prompt: 'again' } as any)
  expect(await svg()).not.toContain(NEEDS_YOU)
})

test('a question mid-turn shows the needs-you scene until answered', async ($, on) => {
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
  expect(during).toContain(NEEDS_YOU)
  expect(((await ui.find({ type: 'Svg' })) as any).props.source).not.toContain(NEEDS_YOU)
})

test('each time it calls, the sparks are new; calling again while waiting keeps them', async ($, on) => {
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

test('the same seed draws the same lock and sparks', () => {
  expect(sparks(42, 1).svg).toBe(sparks(42, 1).svg)
  expect(sparks(42, 1).css).toBe(sparks(42, 1).css)
  expect(reactor(42).css).toBe(reactor(42).css)
  expect(sparks(43, 1).css).not.toBe(sparks(42, 1).css)
})

test('no scene animates a full-size veil, which freezes Desktop', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const working = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  for (const scene of [working, await svg()]) {
    // The only full-size rect is the room itself, and it carries no class
    expect(scene.split('width="1600" height="1000"').length).toBe(2)
    expect(scene).toContain('<rect width="1600" height="1000" fill="url(#room)"/>')
    expect(scene).not.toContain('cubic-bezier')
  }
})

test('each scene has one reduced-motion rule, naming every animated part', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const working = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const waiting = await svg()
  const named = (scene: string) => {
    expect(scene.split('prefers-reduced-motion').length).toBe(2)
    return scene.slice(scene.indexOf('prefers-reduced-motion'))
  }
  const still = named(working)
  for (const cls of ['.ra', '.rb', '.rc', '.rd', '.core', '.scan', '.arm', '.wave', '.needle', '.bar', '.mote']) expect(still).toContain(cls)
  const lit = named(waiting)
  for (const cls of ['.ra', '.rd', '.cool', '.hot', '.throb', '.bracket', '.brackets', '.ping', '.spark', '.mote']) expect(lit).toContain(cls)
})
