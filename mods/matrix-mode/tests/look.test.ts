import { expect, test } from 'claude-code/testing'

import { sceneFor } from '../hooks/scene/index.js'

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
    expect(fullSizeMovers(scene, new Set(animated))).toEqual([])
  }
  for (const cls of ['.f0', '.f1', '.f2', '.fa', '.fb']) expect(working).toContain(cls)
  for (const cls of ['.key', '.caret', '.blink']) expect(waiting).toContain(cls)
})

// Every full-size rect (1600 x 1000 or larger) that carries a class, or sits inside an
// element with an animated class. Walks the tags with a stack of each one's classes.
function fullSizeMovers(svg: string, animated: Set<string>): string[] {
  const found: string[] = []
  const open: string[][] = []
  for (const [tag, close, name, attrs, self] of svg.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)) {
    if (close) { open.pop(); continue }
    const classes = (/class="([^"]*)"/.exec(attrs!)?.[1] ?? '').split(' ').filter(Boolean).map(c => `.${c}`)
    const size = (attr: string) => Number(new RegExp(`\\b${attr}="([\\d.]+)"`).exec(attrs!)?.[1] ?? 0)
    if (name === 'rect' && size('width') >= 1600 && size('height') >= 1000) {
      const wrapped = open.some(cls => cls.some(c => animated.has(c)))
      if (classes.length > 0 || wrapped) found.push(tag)
    }
    if (!self) open.push(classes)
  }
  return found
}

test('the same burst draws the same scene, built fresh', () => {
  const five = sceneFor({ mode: 'waiting', burst: 5 })
  const six = sceneFor({ mode: 'waiting', burst: 6 })
  expect(six).not.toBe(five)
  expect(sceneFor({ mode: 'waiting', burst: 5 })).toBe(five)
})

test('no column has two changing glyphs in the same slot', () => {
  for (const scene of [sceneFor({ mode: 'working' }), sceneFor({ mode: 'waiting', burst: 5 })]) {
    const columns = [...scene.matchAll(/<g class="f\d"[^>]*>(.*?)<\/g>/g)]
    expect(columns.length > 40).toBe(true)
    for (const [, body] of columns) {
      const slots = [...body!.matchAll(/<text class="fa" y="(\d+)"/g)].map(m => m[1])
      expect(new Set(slots).size).toBe(slots.length)
    }
  }
})

test('a full-size rect that animates is caught', () => {
  const moving = new Set(['.m'])
  expect(fullSizeMovers('<g class="m"><rect height="1000" x="0" width="1600"/></g>', moving).length).toBe(1)
  expect(fullSizeMovers('<rect fill="red" width="1700" height="1100" class="still"/>', moving).length).toBe(1)
  expect(fullSizeMovers('<g class="m"></g><rect width="1600" height="1000"/>', moving).length).toBe(0)
})
