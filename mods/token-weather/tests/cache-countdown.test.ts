import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'token-weather',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
}

// Stands for the engine: a context reading, one model request per step, and its own band.
async function start($: Engine, on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: 20_000, window: 200_000, percent: 10 } },
  }) as any)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' }) as any
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  return clock
}

// One model request, read to its end as the engine would.
async function request($: Engine, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // drain
  }
  await stream.result
}

describe('token-weather cache countdown', () => {
  test('is hidden before the first request', async ($, on) => {
    await start($, on)
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    await ui.unmount()
  })

  test('starts after a request, counts down, turns yellow, then cold', async ($, on) => {
    const clock = await start($, on)
    await request($, 0)
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()

    await clock.advance(48_000)
    const later = await ui.find({ type: 'Text', text: /❄ cache 4:1\d/ })
    expect(later).toBeDefined()
    expect(later?.props.color).toBeUndefined()

    await clock.advance(4 * 60_000 - 48_000 + 1_000) // 59 s left
    const warn = await ui.find({ type: 'Text', text: '  ❄ cache 0:59' })
    expect(warn).toBeDefined()
    expect(warn?.props.color).toBe('yellow')

    await clock.advance(59_000)
    const cold = await ui.find({ type: 'Text', text: '  ❄ cache cold' })
    expect(cold).toBeDefined()
    expect(cold?.props.color).toBe('red')
    expect(cold?.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test('ticks every second only under two minutes', async ($, on) => {
    const clock = await start($, on)
    await request($, 0)
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    await clock.advance(5_000)
    // Far from expiry the text moves in 15 s steps, not every second.
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()
    await clock.advance(10_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 4:45' })).toBeDefined()

    await clock.advance(3 * 60_000 - 15_000 + 1_000) // 1:59 left
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 1:59' })).toBeDefined()
    await clock.advance(1_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 1:58' })).toBeDefined()
    await ui.unmount()
  })

  test('resets on every main-thread request, not on a subagent request', async ($, on) => {
    const clock = await start($, on)
    await request($, 0)
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    await clock.advance(4 * 60_000) // 1:00 left
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 1:00' })).toBeDefined()

    await request($, 1, 'agent-1') // a subagent's request does not touch the main cache
    await clock.advance(1_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 0:59' })).toBeDefined()

    await request($, 1) // a tool-loop request in the same turn
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()
    await clock.advance(15_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 4:45' })).toBeDefined()
    await ui.unmount()
  })

  test('respects cacheTtl 1h', { options: { cacheTtl: '1h' } }, async ($, on) => {
    const clock = await start($, on)
    await request($, 0)
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await clock.advance(10 * 60_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 50:00' })).toBeDefined()
    await clock.advance(40 * 60_000)
    expect(await ui.find({ type: 'Text', text: /cold/ })).toBeUndefined()
    await clock.advance(10 * 60_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache cold' })).toBeDefined()
    await ui.unmount()
  })

  test('drops the cache part first on a narrow line', async ($, on) => {
    await start($, on)
    await request($, 0)
    // 60 columns: room for the forecast and its sparkline, not for the cache part too.
    const narrow = { ...BAND, props: { ...BAND.props, bodyColumns: 60 } }
    const ui = await $.ui.mount({ surface: 'terminal', ...narrow } as any)
    expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /last turns/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    await ui.unmount()

    const desk = await $.ui.mount({ surface: 'desktop', ...BAND } as any)
    expect(await desk.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()
    await desk.unmount()
  })
})
