import { expect, mock, test } from 'claude-code/testing'

import { embers } from '../hooks/scene/embers.js'

const BACKDROP = {
  plugin: 'akatsuki-night', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
  viewport: { columns: 100, rows: 30 },
  props: { scene: 'akatsuki-night', plugin: 'akatsuki-night', glass: false },
} as any

const done = ($: any, id: string, agentId?: string) =>
  $.turn.complete({ turnId: id, agentId, answer: 'ok', durationMs: 5, isAborted: false, usage: null } as any)

test('session start sets the dark look with the scene', async ($, on) => {
  let sent: any
  on('theme.set', ($, e) => { sent = e; return { value: { isDrawn: true } as any } })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(sent.backdrop.scene).toBe('akatsuki-night')
  expect(sent.overrideColorScheme).toBe('dark')
})

test('the backdrop draws the moon scene on desktop, under the size limit', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const source = (svg as any).props.source as string
  expect(source.length < 131072).toBe(true)
  expect(source).toContain('preserveAspectRatio="xMidYMid slice"')
  expect(source).not.toContain('<script')
  // The moon, its face and the eye turning in it
  expect(source).toContain('class="moon"')
  expect(source).toContain('fill="url(#moonface)"')
  expect(source).toContain('class="think"')
})

// A doubled minus ("--18px") makes the browser drop the whole declaration.
const doubledMinus = (css: string) => css.includes('(--') || /--\d/.test(css)

test('no scene writes a number with a doubled minus', async ($, on) => {
  for (let seed = 1; seed <= 60; seed++) expect(doubledMinus(embers(seed).css)).toBe(false)
  const ui = await $.ui.mount(BACKDROP)
  expect(doubledMinus(((await ui.find({ type: 'Svg' })) as any).props.source)).toBe(false)
})

// The body of `@keyframes name`, braces and all.
function keyframesOf(scene: string, name: string): string {
  const from = scene.indexOf(`@keyframes ${name}{`)
  let depth = 0
  for (let n = scene.indexOf('{', from); n < scene.length; n++) {
    if (scene[n] === '{') depth++
    if (scene[n] === '}' && --depth === 0) return scene.slice(from, n + 1)
  }
  return ''
}

test('the scene is the same while working, after a turn ends, and during a question', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  let during = ''
  let ui: any
  on('tool.call', async () => {
    during = (await ui.find({ type: 'Svg' })).props.source
    return { result: { answers: {} } }
  })
  ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const fresh = await svg()
  expect(fresh).toContain('class="think"')

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  expect(await svg()).toBe(fresh)

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  expect(during).toBe(fresh)

  await done($, 't1')
  expect(await svg()).toBe(fresh)
})

test('the scene fits the limit, and fades no full-size layer', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const scene = ((await ui.find({ type: 'Svg' })) as any).props.source as string
  expect(scene.length < 131072).toBe(true)
  // Desktop stops the whole scene for good once a full-size layer's opacity animates
  for (const [rect] of scene.matchAll(/<rect\b[^>]*>/g)) {
    const size = (key: string) => Number(new RegExp(`\\b${key}="([\\d.]+)"`).exec(rect)?.[1] ?? 0)
    if (size('width') >= 1600 && size('height') >= 1000) expect(rect).not.toContain('class=')
  }
  expect(/<g class="[^"]*"><rect width="1600"/.test(scene)).toBe(false)
  // The cloud layers span the whole width: they may only move, never fade
  for (const layer of ['cfar', 'cmid', 'cnear']) {
    const name = new RegExp(`\\.${layer}\\{animation:([\\w-]+) `).exec(scene)?.[1]
    expect(name).toBeDefined()
    const frames = keyframesOf(scene, name!)
    expect(frames).toContain('transform')
    expect(frames).not.toContain('opacity')
  }
})

test('the scene has one reduced-motion rule, naming every animated class', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const scene = ((await ui.find({ type: 'Svg' })) as any).props.source as string
  expect(scene.split('prefers-reduced-motion').length).toBe(2)
  const at = scene.indexOf('@media (prefers-reduced-motion')
  const rule = scene.slice(at, scene.indexOf('</style>'))
  const styles = scene.slice(0, at)
  // Every class given an animation must be stopped there.
  const animated = [...styles.matchAll(/\.([\w-]+)\{[^{}]*animation:/g)].map(m => m[1]!)
  expect(animated.length >= 8).toBe(true)
  for (const cls of animated) {
    expect(rule.includes(`.${cls},`) || rule.includes(`.${cls} `)).toBe(true)
  }
  expect(rule).toContain('.cnear')
})

// `css` with every `@keyframes` block cut out, braces matched.
function outsideKeyframes(css: string): string {
  let out = ''
  for (let n = 0; n < css.length; ) {
    if (!css.startsWith('@keyframes', n)) { out += css[n++]; continue }
    let depth = 0
    for (n = css.indexOf('{', n); n < css.length; n++) {
      if (css[n] === '{') depth++
      if (css[n] === '}' && --depth === 0) { n++; break }
    }
  }
  return out
}

test('the stylesheet stays inside what the desktop app animates', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const scene = ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const css = /<style>([\s\S]*?)<\/style>/.exec(scene)![1]!
  expect(css.split('@media').length).toBe(2)
  for (const word of ['forwards', 'backwards', 'cubic-bezier']) expect(css).not.toContain(word)
  for (const [call] of css.matchAll(/steps\([^)]*\)/g)) expect(call).toBe('steps(1)')
  expect(outsideKeyframes(css)).not.toMatch(/(^|[;{\s])transform\s*:/)
})
