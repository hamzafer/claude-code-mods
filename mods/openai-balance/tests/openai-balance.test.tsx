import { describe, expect, test } from 'claude-code/testing'

const NOW = Date.UTC(2026, 9, 7, 12, 30) // 2026-10-07 12:30 UTC
const TODAY = NOW / 1000 - ((NOW / 1000) % 86_400)
const KEY = 'sk-admin-test'
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } }

const bucket = (start: number, dollars: number) => ({ start_time: start, results: [{ line_item: 'gpt-5, input', amount: { value: dollars, currency: 'usd' } }] })
const ok = (body: object) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
const fail = (status: number) => ({ value: { status, ok: false, headers: {}, text: '{}' } })

// Stands for the engine, the key's sources and OpenAI beneath the mod.
function engine(on: any, opts: { todaySpend: () => number; keyFrom?: 'env' | 'keychain' | 'none'; status?: () => number }) {
  const urls: string[] = []
  const auths: string[] = []
  const from = opts.keyFrom ?? 'keychain'
  let now = NOW
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  const store = new Map<string, unknown>()
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'engine band' }))
  on('process.run', (_$: any, e: any) => {
    const hit = (e.argv[0] === 'printenv' && from === 'env') || (e.argv[0] === 'security' && from === 'keychain')
    return { value: { exitCode: hit ? 0 : 1, stdout: hit ? `${KEY}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_$: any, e: any) => {
    urls.push(e.url)
    auths.push(e.init?.headers?.authorization)
    const status = opts.status?.() ?? 200
    if (status !== 200) return fail(status)
    if (e.url.includes('/usage/decisions')) return fail(404) // no Decisions usage path yet
    if (/usage\/(embeddings|moderations)/.test(e.url)) return ok({ data: [] })
    if (e.url.includes('/api_keys')) return ok({ data: [{ id: 'key_abc123', name: 'ci-bot' }], has_more: false })
    if (e.url.includes('/projects')) return ok({ data: [{ id: 'proj_1' }], has_more: false })
    if (e.url.includes('group_by=api_key_id')) {
      return ok({ data: [{ start_time: TODAY + 3600, results: [{ api_key_id: 'key_abc123', input_tokens: 7687, output_tokens: 4530, num_model_requests: 5 }] }] })
    }
    if (e.url.includes('/costs')) {
      const start = Number(/start_time=(\d+)/.exec(e.url)![1])
      return ok({ data: [bucket(TODAY - 86_400, 0.05), bucket(TODAY, opts.todaySpend())].filter(b => b.start_time >= start), has_more: false })
    }
    return ok({ data: [{ start_time: TODAY + 3600, results: [{ model: 'gpt-5', input_tokens: 7687, output_tokens: 4530, num_model_requests: 5 }] }] })
  })
  return { urls, auths, tick: (ms: number) => (now += ms) }
}

// Every Text the band draws, joined, on each surface; they must agree.
async function band($: any) {
  const out: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'openai-balance', surface, ...BAND })
    const t = await ui.find({ type: 'Text', text: /OpenAI/ })
    out.push(t ? String(t.text) : '')
    await ui.unmount()
  }
  expect(out[0]).toBe(out[1])
  return out[0]
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
const run = ($: any, args: string) => $.command.run({ command: 'openai-balance', args } as any)

describe('openai-balance', () => {
  test('asks for a balance until one is set, then subtracts only new spend', async ($, on) => {
    let spend = 0.04
    const h = engine(on, { todaySpend: () => spend })
    await start($)
    expect(await band($)).toMatch(/\$0\.04 today.*to show credit/)
    expect(h.auths[0]).toBe(`Bearer ${KEY}`)

    const set = await run($, '13.82')
    expect(set.text).toMatch(/set to \$13\.82/)
    expect(await band($)).toMatch(/█{10} ~\$13\.82 of \$13\.82 left · \$0\.04 today · gpt-5 via ci-bot \d\d:\d\d/) // today's $0.04 was already in the balance

    spend = 0.54
    const out = await run($, '')
    expect(out.text).toMatch(/Estimated left:\*\* ~\$13\.32/)
    expect(out.text).toMatch(/Last 30 days:\*\* \$0\.59/)
    expect(out.text).toMatch(/gpt-5: 7,687 in \/ 4,530 out, 5 requests/)
    expect(out.text).toMatch(/ci-bot: 12,217 tokens, 5 requests/)
    expect(out.text).not.toContain(KEY)
  })

  test('turns red and says so when the balance is low', async ($, on) => {
    let spend = 0
    engine(on, { todaySpend: () => spend })
    await start($)
    await run($, '$2.50')
    spend = 1
    await run($, '1.40')
    expect(await band($)).toMatch(/~\$1\.40 of \$1\.40 left, top up soon/)
  })

  test('refuses an amount that is not a plain positive number', async ($, on) => {
    engine(on, { todaySpend: () => 0 })
    await start($)
    for (const bad of ['0', '1e3', '0x10', '-5', 'ten']) expect((await run($, bad)).text).toMatch(/^Usage:/)
  })

  test('reads the key from OPENAI_ADMIN_KEY when Keychain has none', async ($, on) => {
    const h = engine(on, { todaySpend: () => 0, keyFrom: 'env' })
    await start($)
    expect(h.auths[0]).toBe(`Bearer ${KEY}`)
  })

  test('says when there is no key, and sends nothing', async ($, on) => {
    const h = engine(on, { todaySpend: () => 0, keyFrom: 'none' })
    await start($)
    expect(await band($)).toMatch(/no admin key set/)
    expect(h.urls).toEqual([])
    expect((await run($, '')).text).toMatch(/No OpenAI Admin key found/)
  })

  test('a refused key (401 or 403) is named, not hidden', async ($, on) => {
    engine(on, { todaySpend: () => 0, status: () => 403 })
    await start($)
    expect(await band($)).toMatch(/admin key rejected/)
    expect((await run($, '')).text).toMatch(/refused the Admin key/)
  })

  test('a first refresh that fails says so instead of showing $0.00', async ($, on) => {
    engine(on, { todaySpend: () => 0, status: () => 500 })
    await start($)
    expect(await band($)).toMatch(/can't reach OpenAI yet/)
  })

  test('an outage keeps the last numbers, marked offline', async ($, on) => {
    let status = 200
    const h = engine(on, { todaySpend: () => 0.04, status: () => status })
    await start($)
    await run($, '13.82')
    status = 500
    h.tick(11 * 60 * 1000) // past the 10-minute refresh
    await turn($)
    expect(await band($)).toMatch(/~\$13\.82 of \$13\.82 left.*offline/)
    status = 200
    h.tick(61 * 1000) // a failure retries after a minute, not ten
    await turn($)
    expect(await band($)).not.toMatch(/offline/)
  })
})
