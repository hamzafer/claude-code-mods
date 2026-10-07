import { describe, expect, test } from 'claude-code/testing'

import { baseline, move, totals, trim } from '../hooks/register'
import { LADDERS, costOf, parsePick, pickRequest, tierOf } from '../hooks/route'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } }
const PANE = { component: 'Pane', requestId: 'switchboard', props: { title: 'Switchboard', isFocused: true, bodyColumns: 100, placement: 'dock' } }
const USAGE = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
// No model named: a general-purpose agent inherits the parent's Opus.
const SPAWN = { tool_use_id: 't1', prompt: 'Find where the auth middleware is defined. Token: sk-live-secret', description: 'find auth middleware', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', background: false, fork: false }
const ASK = { ladder: 'haiku-sonnet-opus', style: 'saver' } as const

// The shape the live API returned on 2026-10-07.
function openaiAnswer(choice: string, confidence: number) {
  return JSON.stringify({ answers: [{ type: 'choice', name: 'tier', choice, probabilities: [{ value: 'sonnet', probability: 0.01 }, { value: 'opus', probability: 0.01 }, { value: 'haiku', probability: 0.98 }], confidence }], usage: { input_tokens: 270, output_tokens: 0, total_tokens: 270 } })
}

function jevAnswer(choice: string, confidence: number) {
  return JSON.stringify({ model: 'jev-1.13.0', answers: { tier: { type: 'choice', choice, probabilities: { haiku: 0.82, sonnet: 0.15, opus: 0.03 }, confidence } }, usage: { input_tokens: 700, output_tokens: 20 } })
}

// Stands for the engine beneath the mod; records what each spawn ran on and what the picker was sent.
function engine(on: any, answer: { status: number; text: string } | null, env: Record<string, string> = {}) {
  const spawned: (string | undefined)[] = []
  const sent: any[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('clock.sleep', () => new Promise(() => {})) // the timeout never fires here: the fetch answers first
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }))
  on('http.fetch', (_$: any, e: any) => {
    sent.push({ url: e.url, headers: e.init?.headers, body: JSON.parse(e.init?.body ?? '{}') })
    return answer ? { value: { status: answer.status, ok: answer.status < 300, headers: {}, text: answer.text } } : { value: { status: 500, ok: false, headers: {}, text: '' } }
  })
  on('agent.spawn', (_$: any, e: any) => (spawned.push(e.model), { model: e.model ?? e.parentModel, agentId: 'a1' }))
  on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'claude-haiku-4-5' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  return { spawned, sent }
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as any

describe('switchboard', () => {
  test('requests, answers, prices and labels', () => {
    expect(baseline({ model: 'haiku', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })).toBe('haiku')
    expect(baseline({ model: 'inherit', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })).toBe('claude-opus-5-5')
    expect(baseline({ parentModel: 'claude-opus-5-5', subagentType: 'general-purpose' })).toBe('claude-opus-5-5')
    expect(baseline({ parentModel: 'claude-opus-5-5', subagentType: 'Explore' })).toBeUndefined() // its own definition decides

    // Only the type and the label go out, never the task text.
    const oaBody = pickRequest(SPAWN, 'openai', ASK) as any
    expect(JSON.parse(oaBody.input)).toEqual({ agent_type: 'general-purpose', description: 'find auth middleware' })
    expect(JSON.stringify(pickRequest(SPAWN, 'typesafe', ASK))).not.toContain('sk-live-secret')
    expect(oaBody.questions[0].choices.map((c: any) => c.value)).toEqual(['haiku', 'sonnet', 'opus'])
    const fable = pickRequest(SPAWN, 'openai', { ladder: 'sonnet-opus-fable', style: 'quality' }) as any
    expect(fable.questions[0].choices.map((c: any) => c.value)).toEqual(['sonnet', 'opus', 'fable'])
    expect(fable.questions[0].instructions).toMatch(/Which model would this developer pick/)
    expect(Object.keys((pickRequest(SPAWN, 'typesafe', { ladder: 'sonnet-opus-fable', style: 'saver' }) as any).questions.tier.criteria)).toEqual(['sonnet', 'opus', 'fable'])

    const three = LADDERS['haiku-sonnet-opus']
    expect(parsePick(jevAnswer('haiku', 0.8), 'typesafe', three)?.tier).toBe('haiku')
    expect(parsePick(jevAnswer('haiku', 0.8), 'typesafe', LADDERS['sonnet-opus-fable'])).toBeNull() // off the ladder
    expect(parsePick('not json', 'typesafe', three)).toBeNull()
    const oa = parsePick(openaiAnswer('haiku', 0.97), 'openai', three)
    expect({ ...oa, costUsd: oa?.costUsd.toFixed(7) }).toEqual({ tier: 'haiku', confidence: 0.97, probabilities: { sonnet: 0.01, opus: 0.01, haiku: 0.98 }, costUsd: '0.0000270' }) // 270 tokens at $0.10 per million
    expect(parsePick(jevAnswer('haiku', 0.8), 'openai', three)).toBeNull() // each picker reads only its own shape

    expect(tierOf('claude-sonnet-5-5')).toBe('sonnet')
    expect(tierOf('claude-fable-5-1')).toBe('fable')
    expect(tierOf(undefined)).toBeUndefined()
    expect(costOf('claude-haiku-4-5', USAGE)?.toFixed(4)).toBe('0.0200') // 10k × $1 + 2k × $5 per million
    expect(costOf('claude-opus-5-5', USAGE)?.toFixed(4)).toBe('0.0800')
    expect(costOf('mystery-model', USAGE)).toBeUndefined()

    const r = { id: 'x', description: 'd', type: 't', asked: 'claude-opus-5-5', picked: 'haiku' as const, by: 'openai' as const, reason: '', applied: true, status: 'done' as const, startedAt: 0, costUsd: 0.02, askedUsd: 0.08 }
    expect(move(r, 'auto')).toBe('opus → haiku')
    expect(move({ ...r, applied: false }, 'suggest')).toBe('opus · try haiku')
    expect(move({ ...r, applied: false, picked: 'opus' }, 'auto')).toBe('opus (kept)')
    expect(move({ ...r, applied: false, picked: undefined, by: 'none' }, 'auto')).toBe('opus') // nothing picked
    expect(move({ ...r, asked: undefined, applied: false }, 'auto')).toBe('own model · try haiku')
    expect(totals([r])).toEqual({ count: 1, switched: 1, cost: 0.02, asked: 0.08, picker: 0 })
    const many = Array.from({ length: 60 }, (_, i) => ({ ...r, id: `r${i}`, status: i === 55 ? ('running' as const) : ('done' as const) }))
    expect(trim(many).map(x => x.id)).toEqual([...many.slice(0, 50).map(x => x.id), 'r55'])
  })

  test('picker openai switches an unnamed spawn and counts its cost once per turn', { options: { picker: 'openai' } }, async ($, on) => {
    const { spawned, sent } = engine(on, { status: 200, text: openaiAnswer('haiku', 0.97) }, { OPENAI_API_KEY: 'oa-test' })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(sent[0].url).toBe('https://api.openai.com/v1/decisions')
    expect(sent[0].headers.Authorization).toBe('Bearer oa-test')
    expect(sent[0].body.model).toBe('gpt-6-luna')
    expect(spawned).toEqual(['haiku'])

    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /opus → haiku/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /openai 97%/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /band below/ })).toBeDefined()

    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, agentId: 'a1' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'more', durationMs: 1, agentId: 'a1' } as any) // a second turn after a message
    const r = await $.command.run({ command: 'route', args: '' } as any)
    expect(r.text).toBe('1 subagents, 1 switched · $0.04 spent, $0.16 at the asked models')

    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /1 subagents · 1 switched · mode: auto · picker: openai/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ran on claude-haiku-4-5/ })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
    await ui.unmount()
    await band.unmount()
  })

  test('a named model is kept and nothing is sent', { options: { picker: 'openai' } }, async ($, on) => {
    const { spawned, sent } = engine(on, { status: 200, text: openaiAnswer('haiku', 0.97) }, { OPENAI_API_KEY: 'oa-test' })
    await $.session.start(START)
    await $.agent.spawn({ ...SPAWN, model: 'sonnet' } as any)
    expect(sent).toEqual([])
    expect(spawned).toEqual(['sonnet'])
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /named by the caller, kept/ })).toBeDefined()
    await band.unmount()
  })

  test('with keep-named off, a named model is routed too', { options: { picker: 'openai', respectNamed: false } }, async ($, on) => {
    const { spawned } = engine(on, { status: 200, text: openaiAnswer('haiku', 0.97) }, { OPENAI_API_KEY: 'oa-test' })
    await $.session.start(START)
    await $.agent.spawn({ ...SPAWN, model: 'sonnet' } as any)
    expect(spawned).toEqual(['haiku'])
  })

  test('picker off sends nothing and changes nothing', async ($, on) => {
    const { spawned, sent } = engine(on, { status: 200, text: openaiAnswer('haiku', 0.97) }, { OPENAI_API_KEY: 'oa', TYPESAFE_API_KEY: 'ts', AI_GATEWAY_API_KEY: 'gw' })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(sent).toEqual([]) // a key alone never turns a picker on
    expect(spawned).toEqual([undefined])
  })

  test('a picker that fails leaves the model alone and says why', { options: { picker: 'jev', jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned } = engine(on, { status: 529, text: '' })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(spawned).toEqual([undefined])
    const r = await $.command.run({ command: 'route', args: '' } as any)
    expect(r.text).toMatch(/^1 subagents, 0 switched/)
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /Jev did not answer/ })).toBeDefined()
    await ui.unmount()
  })

  test('the sonnet-opus-fable ladder never offers haiku', { options: { picker: 'openai', models: 'sonnet-opus-fable', style: 'quality' } }, async ($, on) => {
    const answer = JSON.stringify({ answers: [{ type: 'choice', name: 'tier', choice: 'sonnet', probabilities: [{ value: 'sonnet', probability: 0.9 }, { value: 'opus', probability: 0.1 }, { value: 'fable', probability: 0 }], confidence: 0.9 }], usage: { input_tokens: 300 } })
    const { spawned, sent } = engine(on, { status: 200, text: answer }, { OPENAI_API_KEY: 'oa-test' })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(sent[0].body.questions[0].choices.map((c: any) => c.value)).toEqual(['sonnet', 'opus', 'fable'])
    expect(sent[0].body.questions[0].instructions).toMatch(/this developer/)
    expect(spawned).toEqual(['sonnet'])
  })

  test('suggest mode and forks leave the model alone', { options: { picker: 'jev', jevApiKey: 'k-test', mode: 'suggest' } }, async ($, on) => {
    const { spawned } = engine(on, { status: 200, text: jevAnswer('haiku', 0.9) })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', fork: true } as any)
    expect(spawned).toEqual([undefined, undefined])
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /opus · try haiku/ })).toBeDefined()
    await band.unmount()
  })

  test('teammates and agents with their own model are not switched', { options: { picker: 'jev', jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned, sent } = engine(on, { status: 200, text: jevAnswer('haiku', 0.9) })
    await $.session.start(START)
    await $.agent.spawn({ ...SPAWN, isTeammate: true, name: 'scout' } as any)
    expect(sent).toEqual([]) // a teammate's label is not sent anywhere
    await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', subagentType: 'Explore' } as any)
    expect(spawned).toEqual([undefined, undefined])
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /own model · try haiku/ })).toBeDefined()
    await band.unmount()
  })

  test('with only a gateway key, Jev is asked through Vercel AI Gateway, from TypeSafe only', { options: { picker: 'jev' } }, async ($, on) => {
    const answer = JSON.stringify({ model: 'typesafe-ai/jev', answers: { tier: { type: 'choice', choice: 'haiku', probabilities: { haiku: 0.9, sonnet: 0.1, opus: 0 } } }, usage: { inputTokens: 700, outputTokens: 20 }, providerMetadata: { gateway: { cost: '0.0000294' } } })
    const { spawned, sent } = engine(on, { status: 200, text: answer }, { AI_GATEWAY_API_KEY: 'gw-test' })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(sent[0].url).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    expect(sent[0].headers.Authorization).toBe('Bearer gw-test')
    expect(sent[0].body.model).toBe('typesafe-ai/jev')
    expect(sent[0].body.providerOptions.gateway).toEqual({ only: ['typesafe-ai'] }) // zero retention is opt-in: the gateway refuses it below Pro
    expect(spawned).toEqual(['haiku'])
  })

  test('gateway zero retention is sent only when turned on, and a /config key wins', { options: { picker: 'jev', gatewayApiKey: 'gw-set', gatewayZeroRetention: true } }, async ($, on) => {
    const { sent } = engine(on, { status: 200, text: jevAnswer('haiku', 0.8) }, { TYPESAFE_API_KEY: 'ts-env' })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(sent[0].headers.Authorization).toBe('Bearer gw-set')
    expect(sent[0].body.providerOptions.gateway).toEqual({ only: ['typesafe-ai'], zeroDataRetention: true })
  })

  test('a picker with no key says so', { options: { picker: 'openai' } }, async ($, on) => {
    const { sent } = engine(on, null)
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(sent).toEqual([])
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /picker: openai \(no key, nothing changes\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /no OpenAI key/ })).toBeDefined()
    await ui.unmount()
  })

  test('a pick under 50% is shown but not applied', { options: { picker: 'jev', jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned } = engine(on, { status: 200, text: jevAnswer('haiku', 0.3) })
    await $.session.start(START)
    await $.agent.spawn(SPAWN as any)
    expect(spawned).toEqual([undefined])
  })
})
