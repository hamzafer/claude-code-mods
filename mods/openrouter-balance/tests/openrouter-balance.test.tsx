import { describe, expect, test } from 'claude-code/testing'

const NOW = Date.UTC(2026, 9, 7, 0, 5) // 2026-10-07 00:05 UTC, just after the day began
const KEY = 'sk-or-v1-test'
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } }

const ok = (body: object) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
const fail = (status: number) => ({ value: { status, ok: false, headers: {}, text: '{}' } })
const regular = { label: 'sk-or-v1-abc...123', is_management_key: false, limit: null, limit_remaining: null, usage: 41.2, usage_daily: 0.42, usage_weekly: 3.1, usage_monthly: 12.3 }
const management = { label: 'sk-or-v1-mgm...999', is_management_key: true, usage: 0, usage_daily: 0 }
const activity = [
  { date: '2026-10-06', model: 'anthropic/claude-sonnet-4.5', usage: 1.2, requests: 30, prompt_tokens: 90_000, completion_tokens: 12_000 },
  { date: '2026-10-05', model: 'google/gemini-2.5-flash', usage: 0.4, requests: 120, prompt_tokens: 300_000, completion_tokens: 40_000 },
  { date: '2026-10-06', model: 'anthropic/claude-sonnet-4.5', usage: 0.3, requests: 5, prompt_tokens: 10_000, completion_tokens: 2_000 },
]

// Stands for the engine, the key's sources and OpenRouter beneath the mod.
function engine(on: any, opts: { info?: object; credits?: () => { total_credits: number; total_usage: number }; keyFrom?: 'env' | 'keychain' | 'none'; status?: () => number }) {
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
    const hit = (e.argv[0] === 'printenv' && e.argv[1] === 'OPENROUTER_API_KEY' && from === 'env') || (e.argv[0] === 'security' && from === 'keychain')
    return { value: { exitCode: hit ? 0 : 1, stdout: hit ? `${KEY}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_$: any, e: any) => {
    urls.push(e.url)
    auths.push(e.init?.headers?.authorization)
    const status = opts.status?.() ?? 200
    if (status !== 200) return fail(status)
    if (e.url.endsWith('/key')) return ok({ data: opts.info ?? regular })
    if (e.url.endsWith('/credits')) return ok({ data: opts.credits?.() ?? { total_credits: 100, total_usage: 25 } })
    if (e.url.endsWith('/activity')) return ok({ data: activity })
    return fail(404)
  })
  return { urls, auths, tick: (ms: number) => (now += ms) }
}

// Every Text the band draws, joined, on each surface; they must agree.
async function band($: any) {
  const out: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'openrouter-balance', surface, ...BAND })
    const t = await ui.find({ type: 'Text', text: /OpenRouter/ })
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
const run = ($: any) => $.command.run({ command: 'openrouter-balance', args: '' } as any)

describe('openrouter-balance', () => {
  test('a management key shows the account balance, today and where the money mostly went', async ($, on) => {
    let usage = 25
    const h = engine(on, { info: management, credits: () => ({ total_credits: 100, total_usage: usage }) })
    await start($)
    expect(h.auths[0]).toBe(`Bearer ${KEY}`)
    expect(await band($)).toMatch(/█{8}▁{2} \$75\.00 of \$100\.00 left · \$0\.00 today, mostly claude-sonnet-4\.5/)

    usage = 25.6
    h.tick(6 * 60 * 1000) // past the 5-minute refresh
    await turn($)
    expect(await band($)).toMatch(/\$74\.40 of \$100\.00 left · \$0\.60 today/)

    const out = await run($)
    expect(out.text).toMatch(/Balance:\*\* \$74\.40 \(\$100\.00 bought, \$25\.60 used\)/)
    expect(out.text).toMatch(/Yesterday:\*\* \$1\.50/)
    expect(out.text).toMatch(/Last 30 days:\*\* \$1\.90/)
    expect(out.text).toMatch(/anthropic\/claude-sonnet-4\.5: \$1\.5000, 35 requests, 100,000 in \/ 14,000 out/)
    expect(out.text).not.toContain(KEY)
  })

  test('a day first seen late says "since" instead of "today"', async ($, on) => {
    const h = engine(on, { info: management })
    h.tick(9 * 60 * 60 * 1000) // 09:05 UTC
    await start($)
    expect(await band($)).toMatch(/\$0\.00 since \d\d:\d\d/)
  })

  test('a regular key without a limit shows its own spend and never asks for the balance', async ($, on) => {
    const h = engine(on, { keyFrom: 'env' })
    await start($)
    expect(await band($)).toMatch(/\$0\.42 today · \$12\.30 this month · a management key shows the balance/)
    expect(h.urls.some(u => u.endsWith('/credits'))).toBe(false)
    const out = await run($)
    expect(out.text).toMatch(/This week:\*\* \$3\.10/)
    expect(out.text).toMatch(/Key limit:\*\* none/)
  })

  test('a regular key with a limit shows what the limit leaves, red when low', async ($, on) => {
    engine(on, { info: { ...regular, limit: 10, limit_remaining: 1.5, limit_reset: 'monthly' } })
    await start($)
    expect(await band($)).toMatch(/\$1\.50 of \$10\.00 key limit left, top up soon · \$0\.42 today/)
  })

  test('says when there is no key, and sends nothing', async ($, on) => {
    const h = engine(on, { keyFrom: 'none' })
    await start($)
    expect(await band($)).toMatch(/no key set/)
    expect(h.urls).toEqual([])
    expect((await run($)).text).toMatch(/No OpenRouter key found/)
  })

  test('a refused key (401 or 403) is named, not hidden', async ($, on) => {
    engine(on, { status: () => 401 })
    await start($)
    expect(await band($)).toMatch(/key rejected/)
    expect((await run($)).text).toMatch(/refused the key/)
  })

  test('a first refresh that fails says so instead of showing $0.00', async ($, on) => {
    engine(on, { status: () => 500 })
    await start($)
    expect(await band($)).toMatch(/can't reach OpenRouter yet/)
  })

  test('an outage keeps the last numbers, marked offline', async ($, on) => {
    let status = 200
    const h = engine(on, { info: management, status: () => status })
    await start($)
    status = 500
    h.tick(6 * 60 * 1000)
    await turn($)
    expect(await band($)).toMatch(/\$75\.00 of \$100\.00 left.*offline/)
    status = 200
    h.tick(61 * 1000) // a failure retries after a minute, not five
    await turn($)
    expect(await band($)).not.toMatch(/offline/)
  })
})
