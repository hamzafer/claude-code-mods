import { expect, test } from 'claude-code/testing'

const BACKDROP = {
  plugin: 'interstellar', component: 'Backdrop', requestId: 'bg', surface: 'desktop',
  viewport: { columns: 100, rows: 30 },
  props: { scene: 'interstellar', plugin: 'interstellar', glass: false },
} as any

// The needs-you scene is the one where the ship holds station and hails you.
const HAIL = 'class="hail"'

test('session start sets the dark look with the scene', async ($, on) => {
  let sent: any
  on('theme.set', ($, e) => { sent = e; return { value: { isDrawn: true } as any } })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(sent.backdrop.scene).toBe('interstellar')
  expect(sent.overrideColorScheme).toBe('dark')
})

test('the backdrop draws the black hole svg on desktop, under the size limit', async ($, on) => {
  const ui = await $.ui.mount(BACKDROP)
  const svg = (await ui.find({ type: 'Svg' })) as any
  expect(svg).toBeDefined()
  expect(svg.props.source).toContain('preserveAspectRatio="xMidYMid slice"')
  expect(svg.props.source.length < 131072).toBe(true)
})

test('the ship hails you when the turn ends and resumes its voyage when the next starts', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  // A fresh session starts working: the ship is on its way, not hailing
  expect(await svg()).not.toContain(HAIL)
  expect(await svg()).toContain('class="voyage"')

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  expect(await svg()).not.toContain(HAIL)

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const hailing = await svg()
  expect(hailing).toContain(HAIL)
  expect(hailing).not.toContain('class="voyage"')
  expect(hailing).toContain('class="meteor')
  expect(hailing.length < 131072).toBe(true)

  await $.turn.start({ turnId: 't2', prompt: 'again' } as any)
  expect(await svg()).not.toContain(HAIL)
})

test('each time the ship hails, the shooting stars are new; hailing again keeps them', async ($, on) => {
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

test('no scene fades anything that covers the whole of it', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const working = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  // Desktop stops the whole scene for good once a full-size layer's opacity animates.
  // The full-size layers are the background rect, which never animates, and the two
  // star layers that drift: they may move, never fade.
  for (const scene of [working, await svg()]) {
    for (const rect of scene.match(/<rect width="1600" height="1000"[^>]*>/g) ?? []) expect(rect).not.toContain('class=')
    for (const layer of ['driftA', 'driftB']) {
      expect(scene).toContain(`<g class="${layer}">`)
      const name = new RegExp(`\\.${layer}\\{animation:([\\w-]+)`).exec(scene)?.[1]
      expect(name).toBeDefined()
      const at = scene.indexOf(`@keyframes ${name}{`)
      expect(at > -1).toBe(true)
      expect(scene.slice(at, scene.indexOf('}}', at))).not.toContain('opacity')
    }
    expect(scene).not.toContain('<script')
  }
})

test('each scene has one reduced-motion rule, naming every part', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const working = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const hailing = await svg()
  const parts: [string, string[]][] = [
    [working, ['.driftA', '.driftB', '.tw', '.swirl', '.knot', '.spin', '.voyage']],
    [hailing, ['.driftA', '.driftB', '.tw', '.swirl', '.knot', '.flare', '.spin', '.ping', '.beacon', '.meteor']],
  ]
  for (const [scene, classes] of parts) {
    expect(scene.split('@media (prefers-reduced-motion').length).toBe(2)
    const at = scene.indexOf('@media (prefers-reduced-motion')
    const rule = scene.slice(at, scene.indexOf('</style>', at))
    for (const cls of classes) expect(rule.slice(0, rule.indexOf('{ animation: none; }'))).toContain(cls)
  }
})

test('with reduced motion the sky stills but stays whole: only the shooting stars go', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const still = (scene: string) => scene.slice(scene.indexOf('@media (prefers-reduced-motion'), scene.indexOf('</style>'))
  const working = still(await svg())
  // The ship rests on its arc and the knots on the disc, all in view
  expect(working).toContain('.voyage{opacity:1}')
  expect(working).toContain('.kn0{opacity:.75}')
  expect(working).not.toContain('display:none')
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  const hailing = still(await svg())
  // One faint ring stays round the hailing ship; the shooting stars are hidden
  expect(hailing).toContain('.ping.p1{opacity:.35}')
  expect(hailing).toContain('.meteor{display:none}')
})

test('the stylesheet stays inside what the desktop app animates', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props.source as string
  const working = await svg()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, usage: null } as any)
  // Everything in the stylesheet outside @keyframes blocks, found by brace matching.
  const outsideKeyframes = (css: string) => {
    let out = ''
    for (let i = 0; i < css.length; ) {
      if (css.startsWith('@keyframes', i)) {
        let depth = 0
        do { depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0; i++ } while (depth > 0 || css[i - 1] !== '}')
      } else out += css[i++]
    }
    return out
  }
  for (const scene of [working, await svg()]) {
    const css = scene.slice(scene.indexOf('<style>'), scene.indexOf('</style>'))
    expect(css.split('@media').length).toBe(2)
    for (const word of ['forwards', 'backwards', 'cubic-bezier', 'vector-effect', 'clip-path', 'clipPath', 'gradientTransform']) {
      expect(scene).not.toContain(word)
    }
    for (const call of css.match(/steps\([^)]*\)/g) ?? []) expect(call).toBe('steps(1)')
    expect(outsideKeyframes(css)).not.toContain('transform:')
  }
})
