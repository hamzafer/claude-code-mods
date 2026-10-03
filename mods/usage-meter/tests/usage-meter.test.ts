import { describe, expect, mock, test } from 'claude-code/testing'

import { bar, colorFor, countdown } from '../hooks/register'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// Stands for the engine beneath the mod.
function engine(on: any, first: { rateLimits: Limit[]; cost?: { usd: number } }) {
  const toasts: string[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, ...first } }))
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'engine band' }))
  return { toasts, clock }
}

const band = (bodyColumns = 120) => ({
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
})

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const measure = ($: any, rateLimits: Limit[], usd?: number) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits, cost: usd === undefined ? undefined : { usd }, changed: ['rateLimits'] })

// Every Text in the band, in order, joined into the line as drawn.
async function line(ui: any) {
  const texts: any[] = (await ui.findAll({ type: 'Text' })) ?? []
  return texts.map(t => t.text).filter(t => t !== 'engine band').join('')
}

describe('usage-meter', () => {
  test('helpers: bars, colors and countdowns', () => {
    expect(bar(0)).toBe('▁▁▁▁▁')
    expect(bar(100)).toBe('█████')
    expect(bar(50)).toBe('██▅▁▁')
    expect(colorFor(74.9)).toBe('green')
    expect(colorFor(75)).toBe('yellow')
    expect(colorFor(89.9)).toBe('yellow')
    expect(colorFor(90)).toBe('red')
    expect(countdown(2 * HOUR + 10 * MIN)).toBe('2h10')
    expect(countdown(45 * MIN)).toBe('45m')
    expect(countdown(3 * 24 * HOUR + 4 * HOUR)).toBe('3d4h')
    expect(countdown(-5)).toBe('now')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws bars, percents, the countdown and the cost (${surface})`, async ($, on) => {
      engine(on, {
        rateLimits: [
          { kind: 'seven_day', percentUsed: 18, resetsAt: at(80 * HOUR) },
          { kind: 'five_hour', percentUsed: 42, resetsAt: at(2 * HOUR + 10 * MIN) },
        ],
        cost: { usd: 4.321 },
      })
      await start($)
      const ui = await $.ui.mount({ plugin: 'usage-meter', surface, ...band() } as any)
      const text = await line(ui)
      expect(text).toContain('5h ██▂▁▁ 42% · resets 2h10')
      expect(text).toContain('7d ▇▁▁▁▁ 18%')
      expect(text.indexOf('5h')).toBeLessThan(text.indexOf('7d'))
      expect(text).toContain('$4.32 session')
      expect(text).not.toContain('resets 3d') // the 7d reset shows only once it runs high
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined() // stacked, not replaced
      expect((await ui.find({ type: 'Text', text: /^ 42%$/ }))?.props?.color).toBe('green')
      await ui.unmount()
    })
  }

  test('colors follow the thresholds and the countdown ticks', async ($, on) => {
    const { clock } = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 75, resetsAt: at(46 * MIN) }] })
    await start($)
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band() } as any)
    expect((await ui.find({ type: 'Text', text: /^ 75%$/ }))?.props?.color).toBe('yellow')
    expect(await line(ui)).toContain('resets 46m')

    await clock.advance(MIN)
    expect(await line(ui)).toContain('resets 45m')

    await measure($, [{ kind: 'five_hour', percentUsed: 89.9, resetsAt: at(46 * MIN) }])
    expect((await ui.find({ type: 'Text', text: /^ 90%$/ }))?.props?.color).toBe('yellow') // 89.9 rounds, still yellow
    await measure($, [{ kind: 'five_hour', percentUsed: 90, resetsAt: at(46 * MIN) }])
    expect((await ui.find({ type: 'Text', text: /^ 90%$/ }))?.props?.color).toBe('red')
    await ui.unmount()
  })

  test('one toast per window per reset period past 90%', async ($, on) => {
    const { toasts } = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: at(HOUR) }] })
    await start($)
    expect(toasts).toHaveLength(0)

    await measure($, [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(HOUR) }])
    expect(toasts).toEqual(['5h usage limit at 91%, resets in 1h00'])
    await measure($, [{ kind: 'five_hour', percentUsed: 95, resetsAt: at(HOUR) }])
    await measure($, [{ kind: 'five_hour', percentUsed: 97, resetsAt: at(HOUR + 2 * MIN) }]) // same period, a little jitter
    expect(toasts).toHaveLength(1)

    await measure($, [{ kind: 'five_hour', percentUsed: 92, resetsAt: at(6 * HOUR) }]) // the next period
    await measure($, [{ kind: 'seven_day', percentUsed: 90, resetsAt: at(50 * HOUR) }])
    expect(toasts).toHaveLength(3)
    expect(toasts[2]).toBe('7d usage limit at 90%, resets in 2d2h')
  })

  test('a window with no reset time warns again only after it drops under 90%', async ($, on) => {
    const { toasts } = engine(on, { rateLimits: [] })
    await start($)
    await measure($, [{ kind: 'spend_limit', percentUsed: 120 }])
    await measure($, [{ kind: 'spend_limit', percentUsed: 125 }])
    expect(toasts).toEqual(['Spend limit at 120%'])
    await measure($, [{ kind: 'spend_limit', percentUsed: 10 }])
    await measure($, [{ kind: 'spend_limit', percentUsed: 95 }])
    expect(toasts).toEqual(['Spend limit at 120%', 'Spend limit at 95%'])
  })

  test('a window past its reset time hides until a fresh reading; spend over 100% stays red', async ($, on) => {
    const { clock } = engine(on, {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 96, resetsAt: at(10 * MIN) },
        { kind: 'spend_limit', percentUsed: 120 },
      ],
      cost: { usd: 2 },
    })
    await start($)
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band() } as any)
    expect(await line(ui)).toContain('5h ████▇ 96% · resets 10m')
    expect(await line(ui)).toContain('spend █████ 120%')
    expect((await ui.find({ type: 'Text', text: /^ 120%$/ }))?.props?.color).toBe('red')

    await clock.advance(11 * MIN)
    expect(await line(ui)).toBe('⏱ spend █████ 120% · $2.00 session')
    await ui.unmount()
  })

  test('yields the band to a survey', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 42 }], cost: { usd: 1 } })
    await start($)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any)
    expect(await line(ui)).toBe('')
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('no subscription: only the cost', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 1.5 } })
    await start($)
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band() } as any)
    const text = await line(ui)
    expect(text).toBe('⏱ $1.50 session')
    await ui.unmount()
  })

  test('nothing to show: the line hides', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 0 } })
    await start($)
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band() } as any)
    expect(await line(ui)).toBe('')
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('narrow terminals drop the 7d part first, then the cost', async ($, on) => {
    engine(on, {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: at(2 * HOUR + 10 * MIN) },
        { kind: 'seven_day', percentUsed: 18, resetsAt: at(80 * HOUR) },
      ],
      cost: { usd: 4.32 },
    })
    await start($)
    // The whole line is 60 cells, padding aside: "⏱ 5h ██▂▁▁ 42% · resets 2h10 · 7d ▇▁▁▁▁ 18% · $4.32 session".
    const wide = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band(64) } as any)
    expect(await line(wide)).toContain('7d')
    await wide.unmount()

    const mid = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band(50) } as any)
    const midText = await line(mid)
    expect(midText).not.toContain('7d')
    expect(midText).toContain('$4.32 session')
    await mid.unmount()

    const thin = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...band(34) } as any)
    const thinText = await line(thin)
    expect(thinText).toContain('5h ██▂▁▁ 42%')
    expect(thinText).not.toContain('$4.32')
    await thin.unmount()
  })
})
