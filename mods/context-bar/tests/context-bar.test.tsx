import { describe, expect, test } from 'claude-code/testing'

import { cells, legend, share, toReading, tokens } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 84 } }

// /context's breakdown as the engine hands it over, for a 1M window.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_400, color: 'promptBorder', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 12_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP tools', tokens: 2_600, color: 'cyan_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'MCP tools (deferred)', tokens: 40_000, color: 'inactive', kind: 'deferred', isDeferred: true },
    { name: 'Skills', tokens: 0, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Messages', tokens: 186_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'Autocompact buffer', tokens: 50_000, color: 'inactive', kind: 'buffer', isDeferred: false },
    { name: 'Free space', tokens: 746_000, color: 'promptBorder', kind: 'free', isDeferred: false },
  ],
  totalTokens: 204_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 20,
  autoCompactThreshold: 950_000,
  isAutoCompactEnabled: true,
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  model: 'opus',
  apiUsage: null,
  autocompactSource: 'model-default',
}

// Stands for the engine beneath the mod.
function engine(on: any, store: Record<string, unknown> = {}) {
  const asked: unknown[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('session.usage', (_$: any, e: any) => {
    asked.push(e)
    return { value: { startedAt: 0, context: { tokens: 204_000, window: 1_000_000, percent: 20, breakdown: BREAKDOWN }, rateLimits: {}, cost: { usd: 0 } } }
  })
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  return { asked, store }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the first refresh runs in the background

describe('context-bar', () => {
  test('helpers', () => {
    expect(tokens(3_400)).toBe('3.4k')
    expect(tokens(186_000)).toBe('186k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(950)).toBe('950')
    expect(share(3_400, 1_000_000)).toBe('0.3%')
    expect(share(186_000, 1_000_000)).toBe('19%')
    expect(share(494, 1_000_000)).toBe('<0.1%')

    const r = toReading(BREAKDOWN)
    // Deferred and empty rows are left out; used first, then free, then the buffer.
    expect(r.slices.map(s => s.name)).toEqual(['system prompt', 'system tools', 'mcp tools', 'messages', 'free space', 'autocompact buffer'])
    expect(r.compactsAt).toBe(950_000)
    // Every used row has its own color, and none matches free space or the buffer.
    const colors = r.slices.filter(s => s.kind === 'used').map(s => s.color)
    expect(new Set(colors).size).toBe(colors.length)
    expect(cells(r, 80).find(c => c.kind === 'buffer')?.text).toMatch(/^░+$/)
    expect(cells(r, 80).find(c => c.kind === 'free')?.text).toMatch(/^─+$/)

    for (const width of [20, 47, 80, 200]) {
      const bar = cells(r, width)
      expect(bar.reduce((n, c) => n + c.text.length, 0)).toBe(width) // always exactly the width
      expect(bar.filter(c => c.kind === 'used').every(c => c.text.length >= 1)).toBe(true) // a small used slice still shows
    }
    for (const line of legend(r, 40)) {
      const size = line.reduce((n, s, i) => n + (i ? 3 : 0) + 2 + s.name.length + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0), 0)
      expect(size <= 40 || line.length === 1).toBe(true)
    }
    expect(toReading({ ...BREAKDOWN, isAutoCompactEnabled: false }).compactsAt).toBeUndefined()
  })

  test('draws the bar and legend above the prompt from a summary breakdown', async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect(asked).toEqual([{ breakdown: 'summary' }]) // estimated locally, never the token-count API

    const band = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /204k of 1M · compacts at 950k/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: / 20% / })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^messages $/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^186k$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /mcp tools \(deferred\)/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'band below' })).toBeDefined() // the band beneath stays
    await band.unmount()
  })

  test('refreshes after a main turn, not after a subagent turn', async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, agentId: 'a1' } as any)
    expect(asked.length).toBe(1)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(asked.length).toBe(2)
  })

  test('refreshes after a compaction', async ($, on) => {
    const { asked } = engine(on)
    on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
    await settle()
    expect(asked.length).toBe(2)
  })

  test('/context-bar hides and shows it, and remembers the choice', async ($, on) => {
    const { store } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toMatch(/hidden/)
    expect(store.isHidden).toBe(true)
    let band = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /of 1M/ })).toBeUndefined()
    await band.unmount()

    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toBe('Context bar on')
    expect(store.isHidden).toBe(false)
    band = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /of 1M/ })).toBeDefined()
    await band.unmount()
  })

  test('a session that hid it starts hidden', async ($, on) => {
    engine(on, { isHidden: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /of 1M/ })).toBeUndefined()
    await band.unmount()
  })
})
