// OpenRouter Balance: your OpenRouter credit, in a band above the prompt.
// A management key sees the account: the real balance from /credits, and spend by model from /activity.
// A regular API key sees the balance too, when OpenRouter lets it, and its own spend and limit.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Line } from '../types'
import { bandsFile, parseOrder, stackBands } from './bands'

const EVERY_MS = 5 * 60 * 1000 // the balance is live, but nobody needs it by the second
const TICK_MS = 60 * 1000 // the timer checks every minute; nextTry decides whether to ask
const RETRY_MS = 60 * 1000 // after a failed refresh
const STUCK_MS = 2 * 60 * 1000 // a refresh still running after this is given up on (fetch has no timeout)
const ACTIVITY_MS = 60 * 60 * 1000 // /activity holds completed days only, so once an hour is plenty
const GRACE_S = 15 * 60 // a day first seen this soon after midnight UTC counts as seen from its start
const KEYCHAIN_SERVICE = 'openrouter-key'
const API = 'https://openrouter.ai/api/v1'
const DAY_S = 86_400
const LOW = 2 // dollars: red below this
const MID = 5 // dollars: yellow below this
const BRAND = '#8b9cff' // periwinkle: apart from the green gauge and openai-balance's violet
const GAUGE = 10
const EMPTY: Line = { kind: null, left: null, start: null, today: null, month: null, since: null, top: null, error: null, isLoaded: false, hasData: false }
const SETUP =
  'Needs an OpenRouter key. A **management key** (openrouter.ai → Settings → Management keys) shows the account balance and spend by model; a regular API key shows its own spend and limit. Put it in `/config` → openrouter-balance, or in `OPENROUTER_MANAGEMENT_KEY` or `OPENROUTER_API_KEY`, or on macOS in Keychain: `security add-generic-password -a "$USER" -s openrouter-key -w`.'

// The account's all-time usage when this UTC day was first seen, so today's spend is the difference.
type Mark = { day: number; usage: number; at: number }
type Activity = { date: string; model: string; usage: number; requests: number; prompt_tokens: number; completion_tokens: number }

// Held by the host, so the line survives a hot reload of this file.
const line = atom({ plugin: 'openrouter-balance', key: 'line' } as const, EMPTY)

let timers: Timer[] = [] // restarted on each session.start
let configKey = ''
let key = '' // kept in memory only, never in state, the store or a message
let nextTry = 0
let generation = 0 // a newer refresh wins; an older one that ends later is dropped
let running: { since: number } | null = null
let activityCache: { at: number; items: Promise<Activity[]> } | null = null
let lastKey = '' // the key the cached numbers came from, in memory only

class NoKey extends Error {}
class KeyRejected extends Error {}
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenRouter answered ${status}`)
  }
}

let bandOrder: Promise<string[]> | undefined // read once per session: restart to apply

export const register: Register = (on, options) => {
  configKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
  key = '' // a key changed in /config is read again

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command
      .register({ name: 'openrouter-balance', description: 'OpenRouter credit, spend today and spend by model' })
      .catch(() => {}) // a name Claude Code already has is refused: start anyway
    void refresh($, true).catch(() => {}) // in the background: a slow API never holds up the session
    for (const t of timers) t.cancel()
    timers = [$.clock.every(TICK_MS, () => void refresh($, false).catch(() => {}))]
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void refresh($, false).catch(() => {}) // main-loop turns only, not subagents
    return result
  })

  on('command.run', { command: 'openrouter-balance' }, async $ => {
    try {
      return { text: await detail($) }
    } catch (err) {
      return { text: problem(err) }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const now = { ...EMPTY, ...(await read($, line)) } // a value an older version saved may lack a field
    if (e.props.hasSurvey || !now.isLoaded) return rest

    const { Box, Text } = $.ui.resolve(e)
    const isWide = e.props.bodyColumns >= 60
    const sep = <Text dimColor>{' · '}</Text>
    const head = <Text color={BRAND} bold>{'◆ OpenRouter  '}</Text>
    const today = now.today !== null && (
      <Text>
        <Text bold>{usd(now.today)}</Text>
        <Text dimColor>{now.since !== null ? ` since ${clock(now.since)}` : ' today'}</Text>
      </Text>
    )

    let body
    if (now.error === 'no-key') body = <Text color="red">no key set, see /openrouter-balance</Text>
    else if (now.error === 'rejected') body = <Text color="red">key rejected, see /openrouter-balance</Text>
    else if (!now.hasData) body = <Text dimColor>{"can't reach OpenRouter yet"}</Text>
    else if (now.left === null) {
      // A regular key with no limit: its spend is all there is to show.
      body = (
        <Text>
          {today}
          {now.month !== null && sep}
          {now.month !== null && <Text bold>{usd(now.month)}</Text>}
          {now.month !== null && <Text dimColor>{' this month'}</Text>}
          {isWide && sep}
          {isWide && <Text dimColor>{'a management key shows the balance'}</Text>}
          {now.error === 'offline' && <Text dimColor>{' · offline'}</Text>}
        </Text>
      )
    } else {
      const tone = now.left < LOW ? 'red' : now.left < MID ? 'yellow' : 'green'
      const filled = now.start !== null && now.start > 0 ? Math.max(now.left > 0 ? 1 : 0, Math.min(GAUGE, Math.round((now.left / now.start) * GAUGE))) : 0 // any credit left shows a block
      const of = now.start !== null ? ` of ${usd(now.start)}${now.kind === 'key' ? ' key limit' : ' credit'}` : '' // which one binds: the key's limit or the account's credit
      body = (
        <Text>
          {isWide && <Text color={tone}>{'█'.repeat(filled)}</Text>}
          {isWide && <Text dimColor>{'▁'.repeat(GAUGE - filled)}</Text>}
          <Text color={tone} bold>{`${isWide ? ' ' : ''}${usd(now.left)}`}</Text>
          <Text dimColor>{of}{now.left < LOW ? ' left, top up soon' : ' left'}</Text>
          {today && sep}
          {today}
          {isWide && now.top && <Text dimColor>{', mostly '}</Text>}
          {isWide && now.top && <Text color="cyan">{short(now.top)}</Text>}
          {now.error === 'offline' && <Text dimColor>{' · offline'}</Text>}
        </Text>
      )
    }

    const mine = (
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          {head}
          {body}
        </Text>
      </Box>
    )
    return stackBands(rest, 'openrouter-balance', mine, 'above', await (bandOrder ??= readBandOrder($).catch(() => []))) // above what other mods draw, unless the band order says otherwise
  })
}

// The band order file, as the claude-code-mods checklist saves it; [] on any error.
async function readBandOrder($: EngineInterface): Promise<string[]> {
  const file = bandsFile(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
  return file && (await $.fs.exists(file)) ? parseOrder(await $.fs.read(file)) : []
}

// Forgets the cached band order, for tests.
export function resetBandOrder() {
  bandOrder = undefined
}

// Updates what the band draws. Every 5 minutes, a minute after a failure, or now when forced.
async function refresh($: EngineInterface, isForced: boolean) {
  const now = await $.clock.now()
  if (!isForced && (now < nextTry || (running && now - running.since < STUCK_MS))) return
  const mine = ++generation
  running = { since: now }
  try {
    const next = await snapshot($, now)
    if (mine !== generation) return
    nextTry = now + EVERY_MS
    await update($, line, () => next)
  } catch (err) {
    if (mine !== generation) return
    nextTry = now + RETRY_MS // a fixed key or a network back shows within a minute
    const error: Line['error'] = err instanceof NoKey ? 'no-key' : err instanceof KeyRejected ? 'rejected' : 'offline'
    await update($, line, l => ({ ...EMPTY, ...l, error, isLoaded: true })) // offline keeps the last numbers, marked
  } finally {
    if (mine === generation) running = null
  }
}

async function snapshot($: EngineInterface, now: number): Promise<Line> {
  const info = await keyInfo($)
  const loaded = { ...EMPTY, isLoaded: true, hasData: true }
  const isMgmt = isManagement(info)
  const credits = isMgmt ? await account($) : await account($, true) // a regular key often sees the balance too
  if (!credits) {
    return { ...loaded, kind: 'key', left: num(info.limit_remaining), start: num(info.limit), today: num(info.usage_daily), month: num(info.usage_monthly) }
  }
  const keyLeft = num(info.limit_remaining)
  if (!isMgmt && keyLeft !== null && keyLeft < credits.total_credits - credits.total_usage) {
    return { ...loaded, kind: 'key', left: keyLeft, start: num(info.limit), today: num(info.usage_daily), month: num(info.usage_monthly) } // the key's limit runs out first
  }
  const mark = await dayMark($, Math.floor(now / 1000), credits.total_usage)
  const items = isMgmt ? await activity($, now).catch(() => []) : [] // a hiccup here never hides the balance; a regular key is refused
  return {
    ...loaded,
    kind: 'account',
    left: credits.total_credits - credits.total_usage,
    start: credits.total_credits,
    today: Math.max(0, credits.total_usage - mark.usage),
    since: mark.at - mark.day > GRACE_S ? mark.at : null,
    top: byModel(items)[0]?.model ?? null,
  }
}

// The first all-time usage seen this UTC day. A day first seen late says "since" instead of "today".
async function dayMark($: EngineInterface, nowS: number, usage: number): Promise<Mark> {
  const day = dayStart(nowS)
  const saved = (await $.store.get('mark')) as Mark | undefined
  if (saved && saved.day === day && typeof saved.usage === 'number') return saved
  const mark = { day, usage, at: nowS }
  await $.store.set('mark', mark)
  return mark
}

async function detail($: EngineInterface) {
  const now = await $.clock.now()
  const info = await keyInfo($)
  const lines = ['## OpenRouter balance', '']

  if (!isManagement(info)) {
    const credits = await account($, true)
    if (credits) {
      const mark = await dayMark($, Math.floor(now / 1000), credits.total_usage) // the same "today" the band shows
      lines.push(
        `- **Account balance:** ${usd(credits.total_credits - credits.total_usage)} (${usd(credits.total_credits)} bought, ${usd(credits.total_usage)} used)`,
        `- **Account spend today (UTC):** ${usd(Math.max(0, credits.total_usage - mark.usage))}${mark.at - mark.day > GRACE_S ? ` since ${clock(mark.at)} your time, when this mod first saw the day` : ''}`,
        '',
      )
    }
    lines.push(
      `This key's own spend (a regular API key; a management key shows spend by model):`,
      '',
      `- **Today (UTC):** ${usd(num(info.usage_daily) ?? 0)}`,
      `- **This week:** ${usd(num(info.usage_weekly) ?? 0)}`,
      `- **This month:** ${usd(num(info.usage_monthly) ?? 0)}`,
      `- **All time:** ${usd(num(info.usage) ?? 0)}`,
    )
    if (num(info.limit) !== null) {
      const reset = info.limit_reset ? `, resets ${info.limit_reset}` : ''
      lines.push(`- **Key limit:** ${usd(num(info.limit_remaining) ?? 0)} left of ${usd(info.limit)}${reset}`)
    } else lines.push('- **Key limit:** none')
    const b = info.effective_budget
    if (b && typeof b.limit_usd === 'number' && b.scope !== 'key_limit') lines.push(`- **Budget:** ${usd(b.remaining_usd ?? 0)} left of ${usd(b.limit_usd)}${b.reset_interval ? ` ${b.reset_interval}` : ''}`)
    const free = info.free_model_daily_requests
    if (info.is_free_tier && free) lines.push(`- **Free model requests today:** ${free.remaining} of ${free.limit} left`)
    return lines.join('\n')
  }

  const credits = await account($)
  const mark = await dayMark($, Math.floor(now / 1000), credits.total_usage)
  const items = await activity($, now)
  const yesterday = new Date((dayStart(Math.floor(now / 1000)) - DAY_S) * 1000).toISOString().slice(0, 10)
  const today = Math.max(0, credits.total_usage - mark.usage)
  lines.push(
    `- **Balance:** ${usd(credits.total_credits - credits.total_usage)} (${usd(credits.total_credits)} bought, ${usd(credits.total_usage)} used)`,
    `- **Today (UTC):** ${usd(today)}${mark.at - mark.day > GRACE_S ? ` since ${clock(mark.at)} your time, when this mod first saw the day` : ''}`,
    `- **Yesterday:** ${usd(sum(items.filter(i => i.date === yesterday)))}`,
    `- **Last 30 days:** ${usd(sum(items))}`,
    '',
    '**By model, last 30 days**',
  )
  const models = byModel(items)
  if (models.length === 0) lines.push('- none')
  for (const m of models) lines.push(`- ${m.model}: ${usd4(m.usage)}, ${int(m.requests)} requests, ${int(m.input)} in / ${int(m.output)} out`)
  lines.push('', '_Spend by model counts completed UTC days only, as OpenRouter reports it. Today is the all-time usage now minus where it stood when the day began._')
  return lines.join('\n')
}

// The last 30 days' spend per model, biggest first.
function byModel(items: Activity[]) {
  const map = new Map<string, { model: string; usage: number; requests: number; input: number; output: number }>()
  for (const i of items) {
    const m = map.get(i.model) ?? { model: i.model, usage: 0, requests: 0, input: 0, output: 0 }
    m.usage += Number(i.usage) || 0
    m.requests += Number(i.requests) || 0
    m.input += Number(i.prompt_tokens) || 0
    m.output += Number(i.completion_tokens) || 0
    map.set(i.model, m)
  }
  return [...map.values()].filter(m => m.usage > 0).sort((a, b) => b.usage - a.usage)
}

const sum = (items: Activity[]) => items.reduce((s, i) => s + (Number(i.usage) || 0), 0)

const keyInfo = async ($: EngineInterface) => (await call($, 'key')).data ?? {}
// With isOptional, a refusal or an answer without numbers is null, not an error: the key's own numbers still show.
async function account($: EngineInterface, isOptional?: false): Promise<{ total_credits: number; total_usage: number }>
async function account($: EngineInterface, isOptional: true): Promise<{ total_credits: number; total_usage: number } | null>
async function account($: EngineInterface, isOptional = false) {
  const d = (await call($, 'credits', isOptional))?.data ?? {}
  const total_credits = num(d.total_credits)
  const total_usage = num(d.total_usage)
  if (total_credits === null || total_usage === null) {
    if (isOptional) return null
    throw new Error('OpenRouter sent no credit numbers')
  }
  return { total_credits, total_usage }
}
const isManagement = (info: any) => info.is_management_key === true || info.is_provisioning_key === true

// One lookup shared by concurrent callers, kept an hour. A failed one is tried again next time.
async function activity($: EngineInterface, now: number): Promise<Activity[]> {
  if (!activityCache || now - activityCache.at > ACTIVITY_MS) {
    const entry = {
      at: now,
      items: call($, 'activity').then(
        d => (Array.isArray(d.data) ? d.data : []),
        err => {
          if (activityCache === entry) activityCache = null
          throw err
        },
      ),
    }
    activityCache = entry
  }
  return activityCache.items
}

async function call($: EngineInterface, path: string, isOptional = false) {
  const auth = { authorization: `Bearer ${await apiKey($)}` }
  const res = isOptional ? await $.http.fetch(`${API}/${path}`, { headers: auth }).catch(() => null) : await $.http.fetch(`${API}/${path}`, { headers: auth })
  if (isOptional && (!res || !res.ok)) return null // refused or down: the key's own numbers still show, and the key is not rejected
  if (!res) return null // for the type: only an optional fetch is ever null
  if (res.status === 401 || res.status === 403) {
    key = '' // read it again next time, in case it was replaced
    throw new KeyRejected()
  }
  if (!res.ok) throw new HttpError(res.status)
  try {
    return JSON.parse(res.text)
  } catch (err) {
    if (isOptional) return null
    throw err
  }
}

// From /config first, then OPENROUTER_MANAGEMENT_KEY, OPENROUTER_API_KEY, then the macOS Keychain.
async function apiKey($: EngineInterface) {
  if (key) return key
  const run = async (argv: string[]) => {
    const r = await $.process.run(argv).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout.trim() : ''
  }
  const k =
    configKey ||
    (await run(['printenv', 'OPENROUTER_MANAGEMENT_KEY'])) ||
    (await run(['printenv', 'OPENROUTER_API_KEY'])) ||
    (await run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']))
  if (!k.startsWith('sk-or-')) throw new NoKey()
  if (lastKey && k !== lastKey) {
    activityCache = null // another key may be another account: drop its numbers
    await $.store.set('mark', null).catch(() => {}) // and its start-of-day mark
  }
  lastKey = k
  return (key = k)
}

function problem(err: unknown) {
  if (err instanceof NoKey) return `No OpenRouter key found. ${SETUP}`
  if (err instanceof KeyRejected) return `OpenRouter refused the key (401/403): it may be revoked or disabled. ${SETUP}`
  return `Couldn't reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`
}

// A model id without its provider or variant: "anthropic/claude-sonnet-4.5" → "claude-sonnet-4.5",
// "meta-llama/llama-3.3-70b-instruct:free" → "llama-3.3-70b-instruct".
const short = (model: string) => model.split('/').pop()!.split(':')[0]
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dayStart = (s: number) => s - (s % DAY_S)
const usd = (n: number) => {
  const cents = Math.round(n * 100)
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`
}
const usd4 = (n: number) => `$${n.toFixed(4)}`
const int = (n: number) => Math.round(n).toLocaleString('en-US')
const clock = (s: number) => {
  const d = new Date(s * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` // your local time: the day itself is UTC
}
