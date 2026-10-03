import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'token-weather',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
}

// One transcript line of a main-thread response that wrote `m5` and `h1` tokens to the cache.
function response(m5: number, h1: number) {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      role: 'assistant',
      usage: {
        input_tokens: 5,
        output_tokens: 20,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: m5 + h1,
        cache_creation: { ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1 },
      },
    },
  })
}

// Stands for the engine: a transcript on disk, one model request per step, a store.
async function start(
  $: Engine,
  on: On,
  store: Record<string, unknown> | null = {}, // null: the test answers the store itself
  padding = '',
  env: Record<string, string> = { HOME: '/home/me' },
  file = '/home/me/.claude/projects/-work-my-app/abc.jsonl',
) {
  let transcript = padding
  const clock = mock.clock(on, { now: 1_000_000 })
  if (store) mock.store(on, store)
  on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: 20_000, window: 200_000, percent: 10 } },
  }) as any)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('fs.stat', (_$, e) => {
    if (e.path !== file) return { deny: 'no such file' } as any
    return { value: { kind: 'file', size: transcript.length, mtimeMs: 0, isLink: false } } as any
  })
  on('fs.read', () => ({ value: transcript.length > 1024 * 1024 ? '' : transcript }) as any) // past 1 MiB the mod tails it instead
  on('turn.complete', () => ({ text: '' }) as any)
  mock.env(on, env)
  on('session.root', () => ({ value: '/work/my app' }) as any)
  on('session.id', () => ({ value: 'abc' }) as any)
  on('process.run', (_$, e) => {
    const bytes = Number(e.argv[2])
    return { value: { exitCode: 0, stdout: transcript.slice(-bytes), stderr: '' } } as any
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' }) as any
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)

  // A finished turn: its response lands in the transcript, then the turn completes.
  async function turn(...lines: string[]) {
    transcript += lines.map(l => l + '\n').join('')
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
    for await (const _ of stream) {
      // drain
    }
    await stream.result
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
  }
  return { clock, turn }
}

describe('token-weather cache lifetime detection', () => {
  test('falls back to 5m before anything is detected', async ($, on) => {
    const { turn } = await start($, on)
    await turn('{"type":"user"}')
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()
    await ui.unmount()
  })

  test('picks 1h from a response that wrote 1h cache tokens', async ($, on) => {
    const { turn } = await start($, on)
    await turn(response(0, 1355))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('picks 5m from a response that wrote only 5m tokens', async ($, on) => {
    const { turn } = await start($, on)
    await turn(response(0, 900))
    await turn(response(400, 0))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()
    await ui.unmount()
  })

  test('keeps the last value on a pure cache hit, and ignores subagent lines', async ($, on) => {
    const { turn } = await start($, on)
    await turn(response(0, 1355))
    const sidechain = JSON.stringify({ ...JSON.parse(response(300, 0)), isSidechain: true })
    await turn(response(0, 0), sidechain)
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('a new session starts from the last detected value', async ($, on) => {
    const { turn } = await start($, on, { detectedTtl: '1h' })
    await turn('{"type":"user"}')
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('detection moves a running countdown onto the new lifetime', async ($, on) => {
    const { clock, turn } = await start($, on)
    await turn('{"type":"user"}')
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    await clock.advance(4 * 60_000)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 1:00' })).toBeDefined()
    await turn(response(0, 500))
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('reads only the end of a large transcript', async ($, on) => {
    const { turn } = await start($, on, {}, 'x'.repeat(1200 * 1024) + '\n')
    await turn(response(0, 1355))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('remembers a detection for the next session', async ($, on) => {
    const saved: Record<string, unknown> = {}
    on('store.get', () => ({ value: undefined }) as any)
    on('store.set', (_$, e) => {
      saved[e.key] = e.value
      return { value: undefined } as any
    })
    const { turn } = await start($, on, null)
    await turn(response(0, 1355))
    expect(saved.detectedTtl).toBe('1h')
  })

  test('finds the transcript under CLAUDE_CONFIG_DIR', async ($, on) => {
    const { turn } = await start($, on, {}, '', { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/cfg' }, '/cfg/projects/-work-my-app/abc.jsonl')
    await turn(response(0, 1355))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('keeps the last value when the transcript cannot be found', async ($, on) => {
    const { turn } = await start($, on, { detectedTtl: '1h' }, '', { HOME: '/home/me' }, '/somewhere/else.jsonl')
    await turn(response(400, 0))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })

  test('an explicit 5m setting overrides detection', { options: { cacheTtl: '5m' } }, async ($, on) => {
    const { turn } = await start($, on)
    await turn(response(0, 1355))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 5:00' })).toBeDefined()
    await ui.unmount()
  })

  test('an explicit 1h setting overrides detection', { options: { cacheTtl: '1h' } }, async ($, on) => {
    const { turn } = await start($, on)
    await turn(response(400, 0))
    const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: '  ❄ cache 60:00' })).toBeDefined()
    await ui.unmount()
  })
})
