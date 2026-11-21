import { describe, expect, mock, test } from 'claude-code/testing'

import type { Engine } from 'claude-code/testing'

import { resetBandOrder } from '../hooks/register'

// One model request, read to its end as the engine would.
async function request($: Engine, turnId: string, agentId?: string) {
  const stream = $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
  for await (const _ of stream) {
    // drain
  }
  await stream.result
}

describe('token-weather', () => {
  test('the band follows the context window', async ($, on) => {
    // Hooks registered here sit beneath the mod and stand for the engine.
    let tokens = 36_100
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200_000, percent: Math.round(tokens / 2_000) } },
    }) as any)
    on('turn.complete', () => ({ text: '' }) as any)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'engine band' }) as any // stands for the engine's own band
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)

    const BAND = {
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    }

    const ui = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()

    tokens = 134_400
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(await ui.find({ type: 'Text', text: /Showers/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /67% of context/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▲ \+98\.3k last turn/ })).toBeDefined()
    await ui.unmount()

    // The same readings draw on the desktop surface too.
    const desk = await $.ui.mount({ plugin: 'token-weather', surface: 'desktop', ...BAND } as any)
    expect(await desk.find({ type: 'Text', text: /Showers/ })).toBeDefined()
    expect(await desk.find({ type: 'Text', text: /engine band/ })).toBeDefined() // stacked, not replaced
    await desk.unmount()
  })

  test('measures against a smaller compaction window', async ($, on) => {
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('session.usage', (_$, e: any) => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        // autoCompactWindow 400k on a 1M model: the engine's own percent is against 1M
        context: { tokens: 164_000, window: 1_000_000, percent: 16, ...(e.breakdown ? { breakdown: { rawMaxTokens: 400_000 } } : {}) },
      },
    }) as any)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({
      plugin: 'token-weather',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any)
    expect(await ui.find({ type: 'Text', text: /Cloudy/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /41% of context/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /164k \/ 400k/ })).toBeDefined()
    await ui.unmount()
  })

  test('the band follows the window within a long turn', async ($, on) => {
    let tokens = 36_100
    mock.clock(on, { now: 1_000_000 })
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200_000, percent: Math.round(tokens / 2_000) } },
    }) as any)
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null } as any
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({
      plugin: 'token-weather',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 },
    } as any)
    expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()

    // A tool step of the main thread, before the turn ends.
    tokens = 170_000
    await request($, 't1')
    expect(await ui.find({ type: 'Text', text: /Storm/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /85% of context/ })).toBeDefined()

    // A subagent's step is not the main window.
    tokens = 190_000
    await request($, 't2', 'a')
    expect(await ui.find({ type: 'Text', text: /85% of context/ })).toBeDefined()
    await ui.unmount()
  })

  test('yields the band to a survey', async ($, on) => {
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens: 10_000, window: 200_000, percent: 5 } },
    }) as any)
    on('ui.render', ($, e) => {
      // Stands for the engine's own band.
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'engine band' }) as any
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({
      plugin: 'token-weather',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any)
    expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('keys its band and follows the band order file', async ($, on) => {
    // another band mod drew its column beneath
    const beneath = {
      type: 'Box',
      props: { key: 'bands', flexDirection: 'column' },
      children: [{ type: 'Box', props: { key: 'band:where-am-i' }, children: [{ type: 'Text', children: ['here'] }] }],
    }
    resetBandOrder()
    const files: Record<string, string> = { '/home/me/.claude/claude-code-mods/bands.json': '{"order":["where-am-i","token-weather"]}' }
    on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
    on('fs.exists', (_$: any, e: any) => ({ value: e.path in files }))
    on('fs.read', (_$: any, e: any) => ({ value: files[e.path] ?? '' }))
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens: 10_000, window: 200_000, percent: 5 } },
    }) as any)
    on('ui.render', () => beneath as any)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({
      plugin: 'token-weather',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any)
    const root: any = await ui.drawn()
    expect(root.props.key).toBe('bands')
    // with no order it would sit above where-am-i; the order file puts it last
    expect(root.children.map((c: any) => c.props.key)).toEqual(['band:where-am-i', 'band:token-weather'])
    expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()
    await ui.unmount()
    resetBandOrder()
  })
})
