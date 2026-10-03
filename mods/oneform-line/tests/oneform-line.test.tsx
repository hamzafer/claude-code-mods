import { describe, expect, test } from 'claude-code/testing'

const OPTIONS = { options: { url: 'https://oneform.test/', key: 'k-123' } }
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } }

const TODAY = {
  logical_date: '2026-10-01', // a Thursday
  sleep_hours: 7.1667,
  energy: 4,
  soreness: 2,
  stress: null,
  meals: [{ description: 'Skyr and oats', protein_estimate: 62, calories_estimate: 760 }],
  totals: { calories_estimate: 760, protein_estimate: 62 },
  targets: { calories_kcal: 2000, protein_g: 140, sleep_hours: 8 },
  remaining: { calories: 1240, protein: 78 },
  activities: [{ name: 'Morning Run', strava_sport_type: 'Run', moving_time_s: 1920 }],
  workout: null,
}
const PLAN = {
  plan_items: [
    { logical_date: '2026-10-01', type: 'run', status: 'planned', notes: null, satisfied_by: 'outcome' },
    { logical_date: '2026-10-02', type: 'strength', status: 'planned', notes: 'upper', satisfied_by: null },
    { logical_date: '2026-10-04', type: 'long_run', status: 'planned', notes: null, satisfied_by: null },
  ],
}

// Stands for the engine and OneForm beneath the mod.
function engine(on: any, answer: { status: number; today?: object; plan?: object; body?: string }) {
  const calls: { url: string; auth: string; body: string }[] = []
  let now = 1_000_000
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('clock.now', () => ({ value: now }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' })
  })
  on('http.fetch', (_$: any, e: any) => {
    calls.push({ url: e.url, auth: e.init?.headers?.authorization, body: e.init?.body })
    if (answer.status !== 200) return { value: { status: answer.status, ok: false, headers: {}, text: answer.body ?? '{}' } }
    const text = JSON.stringify(e.url.endsWith('/get_today') ? (answer.today ?? TODAY) : (answer.plan ?? PLAN))
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  return { calls, tick: (ms: number) => (now += ms) }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the refresh runs in the background
const start = async ($: any) => {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle()
}
const turn = async ($: any) => {
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
  await settle()
}
const UNAUTHORIZED = JSON.stringify({ error: 'unauthorized' })
const mount = ($: any, surface: 'terminal' | 'desktop', bodyColumns = 140) =>
  $.ui.mount({ plugin: 'oneform-line', surface, ...BAND, props: { ...BAND.props, bodyColumns } })

describe('oneform-line', () => {
  test('draws the day above the prompt', OPTIONS, async ($, on) => {
    const h = engine(on, { status: 200 })
    await start($)
    expect(h.calls.map(c => c.url)).toEqual(['https://oneform.test/api/tools/get_today', 'https://oneform.test/api/tools/get_plan'])
    expect(h.calls[0].auth).toBe('Bearer k-123')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /🌙 7h10\/8h/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /78g protein left/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /1,240 kcal left/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /🏃 Run 32m/ })).toBeDefined()
      // Today's run is done by outcome, so the next one is tomorrow's strength.
      expect(await ui.find({ type: 'Text', text: /📅 Strength tomorrow/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined() // stacked, not replaced
      await ui.unmount()
    }
  })

  test('a narrow terminal keeps sleep, protein and the next session', OPTIONS, async ($, on) => {
    engine(on, { status: 200 })
    await start($)
    const ui = await mount($, 'terminal', 50)
    expect(await ui.find({ type: 'Text', text: /78g protein left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /kcal/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /🏃/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /📅 Strength tomorrow/ })).toBeDefined()
    await ui.unmount()
  })

  test('says what is not logged, and when targets are passed', OPTIONS, async ($, on) => {
    const over = { ...TODAY, sleep_hours: null, activities: [], remaining: { calories: -180, protein: -12 } }
    engine(on, { status: 200, today: over })
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /🌙 sleep not logged/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+12g over/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /180 kcal over/ })).toBeDefined()
    await ui.unmount()
  })

  test('an empty day still draws the line', OPTIONS, async ($, on) => {
    const empty = { ...TODAY, sleep_hours: null, meals: [], activities: [], remaining: { calories: 2000, protein: 140 } }
    engine(on, { status: 200, today: empty, plan: { plan_items: [] } })
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /🌙 sleep not logged/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /140g protein left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2,000 kcal left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /📅 nothing planned/ })).toBeDefined()
    await ui.unmount()
  })

  test('refreshes at most every 10 minutes', OPTIONS, async ($, on) => {
    const h = engine(on, { status: 200 })
    await start($)
    await turn($)
    expect(h.calls.length).toBe(2)
    h.tick(10 * 60 * 1000)
    await turn($)
    expect(h.calls.length).toBe(4)
  })

  test('/oneform refreshes now and prints the whole day', OPTIONS, async ($, on) => {
    const h = engine(on, { status: 200 })
    await start($)
    const r: any = await $.command.run({ command: 'oneform', args: '' } as any)
    expect(h.calls.length).toBe(4)
    expect(r.text).toMatch(/Skyr and oats: 62g protein, 760 kcal/)
    expect(r.text).toMatch(/✅ today: Run/)
    expect(r.text).toMatch(/⬜ tomorrow: Strength, upper/)
    expect(r.text).toMatch(/⬜ Sun: Long run/)
  })

  test('a rejected key says so', OPTIONS, async ($, on) => {
    engine(on, { status: 401, body: UNAUTHORIZED })
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /key rejected/ })).toBeDefined()
    await ui.unmount()
  })

  test('without settings it stays hidden and /oneform explains', async ($, on) => {
    const h = engine(on, { status: 200 })
    await start($)
    expect(h.calls).toEqual([])
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /💪/ })).toBeUndefined()
    await ui.unmount()
    const r: any = await $.command.run({ command: 'oneform', args: '' } as any)
    expect(r.text).toMatch(/not set up yet/)
  })

  test('a 401 that is not OneForm\'s own is not called a bad key', OPTIONS, async ($, on) => {
    engine(on, { status: 401, body: '<html>Log in to Vercel</html>' })
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /key rejected/ })).toBeUndefined()
    await ui.unmount()
  })

  test('after a failure it tries again in a minute, not ten', OPTIONS, async ($, on) => {
    const h = engine(on, { status: 503 })
    await start($)
    expect(h.calls.length).toBe(2)
    h.tick(30 * 1000)
    await turn($)
    expect(h.calls.length).toBe(2)
    h.tick(30 * 1000)
    await turn($)
    expect(h.calls.length).toBe(4)
  })

  test('exactly on the protein target is a tick, not an overage', OPTIONS, async ($, on) => {
    engine(on, { status: 200, today: { ...TODAY, remaining: { calories: 300, protein: 0 } } })
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /🍗 protein ✓/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /over/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a travel day is not the next session', OPTIONS, async ($, on) => {
    const travel = { logical_date: '2026-10-02', type: 'travel', status: 'planned', notes: null, satisfied_by: null }
    engine(on, { status: 200, plan: { plan_items: [travel, ...PLAN.plan_items.slice(2)] } })
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /📅 Long run Sun/ })).toBeDefined()
    await ui.unmount()
  })

  test('refuses a plain http url, so the key never goes out in the clear', { options: { url: 'http://oneform.test', key: 'k' } }, async ($, on) => {
    const h = engine(on, { status: 200 })
    await start($)
    expect(h.calls).toEqual([])
    const r: any = await $.command.run({ command: 'oneform', args: '' } as any)
    expect(r.text).toMatch(/https:\/\//)
  })
})
