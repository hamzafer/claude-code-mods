import { expect, test } from 'claude-code/testing'

import { reactor } from '../hooks/scene/reactor.js'
import { sparks } from '../hooks/scene/sparks.js'

const BACKDROP = {
  plugin: 'stark-lab', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
  viewport: { columns: 100, rows: 30 },
  props: { scene: 'stark-lab', plugin: 'stark-lab', glass: false },
} as any

// The needs-you scene is the only one with the lock-on round the reactor.
const NEEDS_YOU = 'class="target"'

// Mounts the backdrop with turns that start and end on cue, and reads the scene it draws.
async function mountScene($: any, on: any) {
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  return {
    svg: async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string,
    start: (turnId: string) => $.turn.start({ turnId, prompt: 'hi' } as any),
    end: (turnId: string) => $.turn.complete({ turnId, answer: 'ok', durationMs: 5, isAborted: false, usage: null } as any),
  }
}

// The working scene, then the needs-you scene after one turn.
async function bothScenes($: any, on: any): Promise<[string, string]> {
  const scene = await mountScene($, on)
  const working = await scene.svg()
  await scene.start('t1')
  await scene.end('t1')
  return [working, await scene.svg()]
}

// Top-level CSS blocks as [prelude, body], matching braces so nested blocks stay whole.
function blocks(css: string): [string, string][] {
  const out: [string, string][] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let j = open + 1
    for (; depth > 0 && j < css.length; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0
    out.push([css.slice(i, open).trim(), css.slice(open + 1, j - 1)])
    i = j
  }
  return out
}

const classesIn = (selector: string) => [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1]!)
const styleOf = (svg: string) => svg.slice(svg.indexOf('<style>') + 7, svg.indexOf('</style>'))
const REDUCED = '@media (prefers-reduced-motion'

// Every class a rule animates, outside the reduced-motion block, looking inside other @media.
function animatedClasses(css: string): Set<string> {
  const found = new Set<string>()
  for (const [prelude, body] of blocks(css)) {
    if (prelude.startsWith('@keyframes') || prelude.startsWith(REDUCED)) continue
    if (prelude.startsWith('@')) animatedClasses(body).forEach(c => found.add(c))
    else if (/animation(-name)?\s*:/.test(body)) classesIn(prelude).forEach(c => found.add(c))
  }
  return found
}

// The classes the reduced-motion block's own rules name.
function stilledClasses(svg: string): Set<string> {
  const media = blocks(styleOf(svg)).filter(([prelude]) => prelude.startsWith(REDUCED))
  expect(media.length).toBe(1)
  return new Set(blocks(media[0]![1]).flatMap(([prelude]) => classesIn(prelude)))
}

type Tag = { name: string; classes: string[]; attrs: string; ancestors: string[] }

// Every element's tag, its classes and all its ancestors' classes.
function tags(svg: string): Tag[] {
  const body = svg.replace(/<style>[\s\S]*?<\/style>/, '')
  const out: Tag[] = []
  const stack: string[][] = []
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attrs, selfClosing] = m
    if (closing) { stack.pop(); continue }
    const classes = /class="([^"]+)"/.exec(attrs!)?.[1]!.split(/\s+/) ?? []
    out.push({ name: name!, classes, attrs: attrs!, ancestors: stack.flat() })
    if (!selfClosing) stack.push(classes)
  }
  return out
}

function fullSize(attrs: string): boolean {
  const size = (key: string) => /^(\d+(\.\d+)?)(%?)$/.exec(new RegExp(`\\b${key}="([^"]+)"`).exec(attrs)?.[1] ?? '')
  const [w, h] = [size('width'), size('height')]
  if (w?.[3] === '%' || h?.[3] === '%') return true
  return w !== null && h !== null && Number(w[1]) >= 1600 && Number(h[1]) >= 1000
}

test('session start sets the dark look with the scene', async ($, on) => {
  let sent: any
  on('theme.set', ($, e) => { sent = e; return { value: { isDrawn: true } as any } })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(sent.backdrop.scene).toBe('stark-lab')
  expect(sent.overrideColorScheme).toBe('dark')
})

test('the backdrop draws the lab svg on desktop', async ($, on) => {
  const source = await (await mountScene($, on)).svg()
  expect(source.length < 131072).toBe(true)
  expect(source).toContain('preserveAspectRatio="xMidYMid slice"')
  expect(source).not.toContain('<script')
})

test('the needs-you scene appears when a turn ends and goes when the next starts', async ($, on) => {
  const scene = await mountScene($, on)
  // A fresh session starts working
  expect(await scene.svg()).not.toContain(NEEDS_YOU)
  await scene.start('t1')
  expect(await scene.svg()).not.toContain(NEEDS_YOU)
  await scene.end('t1')
  const waiting = await scene.svg()
  expect(waiting).toContain(NEEDS_YOU)
  expect(waiting).toContain('class="spark ')
  expect(waiting.length < 131072).toBe(true)
  await scene.start('t2')
  expect(await scene.svg()).not.toContain(NEEDS_YOU)
})

test('a question mid-turn shows the needs-you scene until answered', async ($, on) => {
  let during = ''
  let read: () => Promise<string> = async () => ''
  on('tool.call', async () => {
    during = await read()
    return { result: { answers: {} } }
  })
  const scene = await mountScene($, on)
  read = scene.svg
  await scene.start('t1')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  expect(during).toContain(NEEDS_YOU)
  expect(await scene.svg()).not.toContain(NEEDS_YOU)
})

test('each time it calls, the sparks are new; calling again while waiting keeps them', async ($, on) => {
  const scene = await mountScene($, on)
  await scene.start('t1')
  await scene.end('t1')
  const first = await scene.svg()
  await scene.end('t1b') // still waiting: same burst
  expect(await scene.svg()).toBe(first)
  await scene.start('t2')
  await scene.end('t2')
  expect(await scene.svg()).not.toBe(first)
})

test('the same seed draws the same lock and sparks; a new seed, new ones', () => {
  expect(sparks(42, 1).svg).toBe(sparks(42, 1).svg)
  expect(sparks(42, 1).css).toBe(sparks(42, 1).css)
  expect(reactor(42).css).toBe(reactor(42).css)
  expect(sparks(43, 1).css).not.toBe(sparks(42, 1).css)
  expect(reactor(43).css).not.toBe(reactor(42).css)
})

test('no full-size element is animated or sits inside an animated one, which freezes Desktop', async ($, on) => {
  for (const scene of await bothScenes($, on)) {
    const animated = animatedClasses(styleOf(scene))
    const full = tags(scene).filter(t => fullSize(t.attrs))
    // The room itself is full-size, so the check always has something to look at
    expect(full.length > 0).toBe(true)
    for (const t of full) {
      expect(t.classes).toEqual([])
      expect(t.ancestors.filter(c => animated.has(c))).toEqual([])
    }
    expect(scene).not.toContain('cubic-bezier')
  }
})

test('each scene has one reduced-motion rule, stilling every animated class', async ($, on) => {
  for (const scene of await bothScenes($, on)) {
    const stilled = stilledClasses(scene)
    const elements = tags(scene)
    const animated = animatedClasses(styleOf(scene))
    expect(animated.size > 0).toBe(true)
    for (const cls of animated) {
      // Stilled by name, or every element carrying it also carries a stilled class
      const covered = stilled.has(cls) || elements.filter(t => t.classes.includes(cls)).every(t => t.classes.some(c => stilled.has(c)))
      expect([cls, covered]).toEqual([cls, true])
    }
  }
})

test('the stylesheet stays inside what the desktop app animates', async ($, on) => {
  // Outside @keyframes, no rule may declare a transform: placing is done with attributes.
  const staticTransforms = (css: string): string[] =>
    blocks(css).flatMap(([prelude, body]) =>
      prelude.startsWith('@keyframes') ? [] : prelude.startsWith('@') ? staticTransforms(body) : /(^|[;\s])transform\s*:/.test(body) ? [prelude] : [])
  for (const scene of await bothScenes($, on)) {
    const css = styleOf(scene)
    expect(css.match(/@media/g)?.length).toBe(1)
    for (const banned of ['forwards', 'backwards', 'cubic-bezier', 'vector-effect', 'clip-path', 'animation-fill-mode', 'animation-name', 'animation-iteration-count', 'animation-timing-function']) {
      expect([banned, css.includes(banned)]).toEqual([banned, false])
    }
    expect(/\breverse\b/.test(css)).toBe(false)
    expect(scene).not.toContain('clipPath')
    for (const m of css.matchAll(/steps\(/g)) expect(css.slice(m.index, m.index! + 8)).toBe('steps(1)')
    expect(staticTransforms(css)).toEqual([])
  }
})
