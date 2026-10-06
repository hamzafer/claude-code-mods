import { describe, expect, test } from 'claude-code/testing'

import { baseline, move, totals, trim } from '../hooks/register'
import { byRules, costOf, jevRequest, parseJev, tierOf } from '../hooks/route'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } }
const PANE = { component: 'Pane', requestId: 'switchboard', props: { title: 'Switchboard', isFocused: true, bodyColumns: 100, placement: 'dock' } }
const USAGE = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SPAWN = { tool_use_id: 't1', prompt: 'Find where the auth middleware is defined and list the files that import it.', description: 'find auth middleware', subagentType: 'general-purpose', model: 'opus', parentModel: 'claude-opus-5-5', background: false, fork: false }

function jevAnswer(choice: string, confidence: number) {
  return JSON.stringify({ model: 'jev-1.13.0', answers: { tier: { type: 'choice', choice, probabilities: { haiku: 0.82, sonnet: 0.15, opus: 0.03 }, confidence } }, usage: { input_tokens: 700, output_tokens: 20 } })
}

// Stands for the engine beneath the mod; records what each spawn ran on and what Jev was sent.
function engine(on: any, jev: { status: number; text: string } | null, env: Record<string, string> = {}) {
  const spawned: (string | undefined)[] = []
  const sent: any[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('clock.sleep', () => new Promise(() => {})) // Jev's timeout never fires here: the fetch answers first
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }))
  on('http.fetch', (_$: any, e: any) => {
    sent.push({ url: e.url, headers: e.init?.headers, body: JSON.parse(e.init?.body ?? '{}') })
    return jev ? { value: { status: jev.status, ok: jev.status < 300, headers: {}, text: jev.text } } : { value: { status: 500, ok: false, headers: {}, text: '' } }
  })
  on('agent.spawn', (_$: any, e: any) => (spawned.push(e.model), { model: e.model ?? e.parentModel, agentId: 'a1' }))
  on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'claude-haiku-4-5' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  return { spawned, sent }
}

describe('switchboard', () => {
  test('rules, Jev parsing and prices', () => {
    expect(byRules({ subagentType: 'Explore', description: 'x' }).tier).toBe('haiku')
    expect(byRules({ subagentType: 'Plan', description: 'x' }).tier).toBe('opus')
    expect(byRules({ subagentType: 'general-purpose', description: 'find the config loader' }).tier).toBe('haiku')
    expect(byRules({ subagentType: 'general-purpose', description: 'security review of login' }).tier).toBe('opus')
    expect(byRules({ subagentType: 'general-purpose', description: 'add a logout button' }).tier).toBe('sonnet')
    expect(byRules({ subagentType: 'general-purpose', description: 'add the export endpoint' }).tier).toBe('sonnet') // the prompt's words don't count

    expect(baseline({ model: 'haiku', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })).toBe('haiku')
    expect(baseline({ model: 'inherit', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })).toBe('claude-opus-5-5')
    expect(baseline({ parentModel: 'claude-opus-5-5', subagentType: 'general-purpose' })).toBe('claude-opus-5-5')
    expect(baseline({ parentModel: 'claude-opus-5-5', subagentType: 'Explore' })).toBeUndefined() // its own definition decides

    expect(jevRequest(SPAWN).questions.tier.type).toBe('choice')
    expect(jevRequest({ ...SPAWN, prompt: 'x'.repeat(20_000) }).state.task.length).toBe(6_000)
    expect(parseJev(jevAnswer('haiku', 0.8))?.tier).toBe('haiku')
    expect(parseJev(jevAnswer('gpt', 0.8))).toBeNull()
    expect(parseJev('not json')).toBeNull()

    expect(tierOf('claude-sonnet-5-5')).toBe('sonnet')
    expect(tierOf(undefined)).toBeUndefined()
    expect(costOf('claude-haiku-4-5', USAGE)?.toFixed(4)).toBe('0.0200') // 10k × $1 + 2k × $5 per million
    expect(costOf('claude-opus-5-5', USAGE)?.toFixed(4)).toBe('0.0800')
    expect(costOf('mystery-model', USAGE)).toBeUndefined()

    const r = { id: 'x', description: 'd', type: 't', asked: 'claude-opus-5-5', picked: 'haiku' as const, by: 'rules' as const, reason: '', applied: true, status: 'done' as const, startedAt: 0, costUsd: 0.02, askedUsd: 0.08 }
    expect(move(r, 'auto')).toBe('opus → haiku')
    expect(move({ ...r, applied: false }, 'suggest')).toBe('opus · try haiku')
    expect(move({ ...r, applied: false, picked: 'opus' }, 'auto')).toBe('opus (kept)')
    expect(totals([r])).toEqual({ count: 1, switched: 1, cost: 0.02, asked: 0.08, jev: 0 })
    expect(move({ ...r, asked: undefined, applied: false }, 'auto')).toBe('own model · try haiku')
    const many = Array.from({ length: 60 }, (_, i) => ({ ...r, id: `r${i}`, status: i === 55 ? ('running' as const) : ('done' as const) }))
    expect(trim(many).map(x => x.id)).toEqual([...many.slice(0, 50).map(x => x.id), 'r55'])
  })

  test('with a Jev key, the spawn runs on Jev\'s pick and the cost is counted once per turn', { options: { jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned, sent } = engine(on, { status: 200, text: jevAnswer('haiku', 0.8) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn(SPAWN as any)
    expect(spawned).toEqual(['haiku'])
    expect(sent[0].url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(sent[0].headers.Authorization).toBe('Bearer k-test')
    expect(sent[0].body.state.description).toBe('find auth middleware')

    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /opus → haiku/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /jev 80%/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /band below/ })).toBeDefined()

    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, agentId: 'a1' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'more', durationMs: 1, agentId: 'a1' } as any) // a second turn after a message
    const r = await $.command.run({ command: 'route', args: '' } as any)
    expect(r.text).toBe('1 routed, 1 switched · $0.04 spent, $0.16 at the asked models')

    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /1 routed · 1 switched · mode: auto/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ran on claude-haiku-4-5/ })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
    await ui.unmount()
    await band.unmount()
  })

  test('with no key, rules decide and nothing is sent', async ($, on) => {
    const { spawned, sent } = engine(on, null)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ ...SPAWN, model: undefined } as any) // general-purpose inherits opus; 'find' is a lookup
    expect(sent).toEqual([])
    expect(spawned).toEqual(['haiku'])
  })

  test('Jev failing falls back to the rules', { options: { jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned } = engine(on, { status: 529, text: '' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ ...SPAWN, description: 'security review of login', prompt: 'review it' } as any)
    expect(spawned).toEqual(['opus'])
    const r = await $.command.run({ command: 'route', args: '' } as any)
    expect(r.text).toMatch(/^1 routed, 0 switched/)
  })

  test('suggest mode and forks leave the model alone', { options: { jevApiKey: 'k-test', mode: 'suggest' } }, async ($, on) => {
    const { spawned } = engine(on, { status: 200, text: jevAnswer('haiku', 0.9) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn(SPAWN as any)
    await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', fork: true, model: undefined } as any)
    expect(spawned).toEqual(['opus', undefined])
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /opus · try haiku/ })).toBeDefined()
    await band.unmount()
  })

  test('teammates and agents with their own model are not switched', { options: { jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned, sent } = engine(on, { status: 200, text: jevAnswer('haiku', 0.9) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ ...SPAWN, isTeammate: true, name: 'scout' } as any)
    expect(sent).toEqual([]) // a teammate's task is not sent anywhere
    await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', subagentType: 'Explore', model: undefined } as any)
    expect(spawned).toEqual(['opus', undefined])
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /own model · try haiku/ })).toBeDefined()
    await band.unmount()
  })

  test('with only a gateway key, Jev is asked through Vercel AI Gateway with zero retention', async ($, on) => {
    const answer = JSON.stringify({ model: 'typesafe-ai/jev', answers: { tier: { type: 'choice', choice: 'haiku', probabilities: { haiku: 0.9, sonnet: 0.1, opus: 0 } } }, usage: { inputTokens: 700, outputTokens: 20 }, providerMetadata: { gateway: { cost: '0.0000294' } } })
    const { spawned, sent } = engine(on, { status: 200, text: answer }, { AI_GATEWAY_API_KEY: 'gw-test' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn(SPAWN as any)
    expect(sent[0].url).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    expect(sent[0].headers.Authorization).toBe('Bearer gw-test')
    expect(sent[0].body.model).toBe('typesafe-ai/jev')
    expect(sent[0].body.providerOptions.gateway.zeroDataRetention).toBe(true)
    expect(spawned).toEqual(['haiku'])
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /jev 90%/ })).toBeDefined() // the pick's probability stands in for confidence
    await band.unmount()
  })

  test('a Jev pick under 50% is shown but not applied', { options: { jevApiKey: 'k-test' } }, async ($, on) => {
    const { spawned } = engine(on, { status: 200, text: jevAnswer('haiku', 0.3) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn(SPAWN as any)
    expect(spawned).toEqual(['opus'])
  })
})
