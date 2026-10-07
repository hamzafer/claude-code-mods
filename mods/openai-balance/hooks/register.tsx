// OpenAI Balance: your OpenAI API credit, in a band above the prompt.
// OpenAI has no balance API, so the balance is an estimate: the last balance you set with
// /openai-balance <amount>, minus the real spend the Costs API reports since then.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Line } from '../types'

const EVERY_MS = 10 * 60 * 1000 // spend posts in daily buckets; no need to ask more often
const TICK_MS = 60 * 1000 // the timer checks every minute; nextTry decides whether to ask
const RETRY_MS = 60 * 1000 // after a failed refresh
const STUCK_MS = 2 * 60 * 1000 // a refresh still running after this is given up on (fetch has no timeout)
const KEYCHAIN_SERVICE = 'openai-admin-key'
const API = 'https://api.openai.com/v1/organization'
const DAY_S = 86_400
const LOW = 2 // dollars: red below this
const MID = 5 // dollars: yellow below this
const BRAND = '#c792ea' // soft violet: apart from the green gauge and the other bands
// Usage types to merge. `decisions` 404s while the Decisions API is in beta (Oct 2026); it is asked anyway, so keys
// and times show up by themselves once OpenAI adds it. Until then its spend shows through cost line items.
const USAGE = ['completions', 'decisions', 'embeddings', 'moderations']
const GAUGE = 10
const EMPTY: Line = { left: null, start: null, today: 0, last: null, top: null, error: null, isLoaded: false, hasData: false }
const SETUP =
  'Needs an OpenAI organization **Admin key** (read-only is enough), from platform.openai.com → Settings → Organization → Admin keys. Put it in `/config` → openai-balance, or in `OPENAI_ADMIN_KEY`, or on macOS in Keychain: `security add-generic-password -a "$USER" -s openai-admin-key -w`.'

// The balance you set, and how much of that UTC day's spend it already included.
type Anchor = { balance: number; dayStart: number; spentBefore: number }
type Bucket = { start: number; dollars: number; items: Record<string, number> } // items: dollars per line item

// Held by the host, so the line survives a hot reload of this file.
const line = atom({ plugin: 'openai-balance', key: 'line' } as const, EMPTY)

let timers: Timer[] = [] // restarted on each session.start
let configKey = ''
let key = '' // kept in memory only, never in state, the store or a message
let nextTry = 0
let generation = 0 // a newer refresh wins; an older one that ends later is dropped
let running: { since: number } | null = null

class NoKey extends Error {}
class KeyRejected extends Error {}
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI answered ${status}`)
  }
}

export const register: Register = (on, options) => {
  configKey = typeof options.adminKey === 'string' ? options.adminKey.trim() : ''

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command
      .register({
        name: 'openai-balance',
        description: 'OpenAI API credit, spend and tokens. Add an amount to set the balance after a top-up',
        argumentHint: '[amount]',
      })
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

  on('command.run', { command: 'openai-balance' }, async ($, e) => {
    const arg = e.args.trim().replace(/^\$/, '')
    try {
      if (arg === '') return { text: await detail($) }
      if (!/^\d+(\.\d+)?$/.test(arg) || Number(arg) <= 0) return { text: 'Usage: `/openai-balance` or `/openai-balance 25.00` (the balance from your Billing page)' }
      const anchor = await setBalance($, Number(arg))
      await refresh($, true)
      return { text: `OpenAI balance set to ${usd(anchor.balance)}. From now on the band subtracts spend after this point.` }
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
    const head = <Text color={BRAND} bold>{'◆ OpenAI  '}</Text>

    let body
    if (now.error === 'no-key') body = <Text color="red">no admin key set, see /openai-balance</Text>
    else if (now.error === 'rejected') body = <Text color="red">admin key rejected, see /openai-balance</Text>
    else if (!now.hasData) body = <Text dimColor>{"can't reach OpenAI yet"}</Text>
    else if (now.left === null) {
      body = (
        <Text>
          <Text bold>{usd(now.today)}</Text>
          <Text dimColor>{' today'}</Text>
          {sep}
          <Text dimColor>{'/openai-balance <amount> to show credit'}</Text>
          {now.error === 'offline' && <Text dimColor>{' · offline'}</Text>}
        </Text>
      )
    } else {
      // What today's money mostly went to, when that's not the last call's model: spend the Usage API can't
      // attribute to a call (Decisions) still shows.
      const mostly = now.top && (!now.last || short(now.top) !== short(now.last.model)) ? short(now.top) : null
      const tone = now.left < LOW ? 'red' : now.left < MID ? 'yellow' : 'green'
      const filled = now.start !== null && now.start > 0 ? Math.max(0, Math.min(GAUGE, Math.round((now.left / now.start) * GAUGE))) : 0
      body = (
        <Text>
          {isWide && <Text color={tone}>{'█'.repeat(filled)}</Text>}
          {isWide && <Text dimColor>{'▁'.repeat(GAUGE - filled)}</Text>}
          <Text color={tone} bold>{`${isWide ? ' ' : ''}~${usd(now.left)}`}</Text>
          <Text dimColor>{now.start !== null ? ` of ${usd(now.start)}` : ''}{now.left < LOW ? ' left, top up soon' : ' left'}</Text>
          {sep}
          <Text bold>{usd(now.today)}</Text>
          <Text dimColor>{' today'}</Text>
          {mostly && <Text dimColor>{', mostly '}</Text>}
          {mostly && <Text color="cyan">{mostly}</Text>}
          {now.last && sep}
          {now.last && <Text dimColor>{'last '}</Text>}
          {now.last && <Text color="cyan">{short(now.last.model)}</Text>}
          {now.last && <Text dimColor>{` ${clock(now.last.at)}`}</Text>}
          {now.error === 'offline' && <Text dimColor>{' · offline'}</Text>}
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            {head}
            {body}
          </Text>
        </Box>
        {rest}
      </Box>
    )
  })
}

// Updates what the band draws. Every 10 minutes, a minute after a failure, or now when forced.
async function refresh($: EngineInterface, isForced: boolean) {
  const now = await $.clock.now()
  if (!isForced && (now < nextTry || (running && now - running.since < STUCK_MS))) return
  const mine = ++generation
  running = { since: now }
  try {
    const anchor = await getAnchor($)
    const nowS = Math.floor(now / 1000)
    const buckets = await costs($, Math.min(anchor?.dayStart ?? nowS, dayStart(nowS)))
    const today = spentFrom(buckets, dayStart(nowS))
    const left = anchor ? estimate(anchor, buckets) : null
    const last = await lastCall($, dayStart(nowS)).catch(() => null) // a usage hiccup never hides the balance
    const top = itemsFrom(buckets, dayStart(nowS))[0]?.[0] ?? null
    if (mine !== generation) return
    nextTry = now + EVERY_MS
    await update($, line, () => ({ left, start: anchor?.balance ?? null, today, last, top, error: null, isLoaded: true, hasData: true }))
  } catch (err) {
    if (mine !== generation) return
    nextTry = now + RETRY_MS // a fixed key or a network back shows within a minute
    const error: Line['error'] = err instanceof NoKey ? 'no-key' : err instanceof KeyRejected ? 'rejected' : 'offline'
    await update($, line, l => ({ ...EMPTY, ...l, error, isLoaded: true })) // offline keeps the last numbers, marked
  } finally {
    if (mine === generation) running = null
  }
}

async function detail($: EngineInterface) {
  const now = await $.clock.now()
  const nowS = Math.floor(now / 1000)
  const anchor = await getAnchor($)
  const monthStart = Math.floor(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1) / 1000)
  const thirtyAgo = dayStart(nowS) - 29 * DAY_S
  const buckets = await costs($, Math.min(anchor?.dayStart ?? thirtyAgo, monthStart, thirtyAgo))
  const [models, keys, last] = await Promise.all([tokens($, thirtyAgo, 'model'), tokens($, thirtyAgo, 'api_key_id'), lastCall($, dayStart(nowS)).catch(() => null)])

  const lines = ['## OpenAI balance', '']
  if (anchor) {
    const left = estimate(anchor, buckets)
    lines.push(`- **Estimated left:** ~${usd(left)} (set to ${usd(anchor.balance)} on ${date(anchor.dayStart)}, ${usd(anchor.balance - left)} spent since)`)
  } else {
    lines.push('- **Estimated left:** not set yet. Run `/openai-balance <amount>` with the balance from the Billing page.')
  }
  lines.push(
    `- **Today (UTC):** ${usd(spentFrom(buckets, dayStart(nowS)))}`,
    `- **This month:** ${usd(spentFrom(buckets, monthStart))}`,
    `- **Last 30 days:** ${usd(spentFrom(buckets, thirtyAgo))}`,
    '',
    '**Spend by item, last 30 days**',
  )
  const items = itemsFrom(buckets, thirtyAgo)
  if (items.length === 0) lines.push('- none')
  for (const [k, v] of items) lines.push(`- ${k}: ${usd4(v)}`)
  lines.push('', '**Tokens, last 30 days**')
  if (models.length === 0) lines.push('- none')
  for (const m of models) lines.push(`- ${m.model}: ${num(m.input)} in / ${num(m.output)} out, ${num(m.requests)} requests`)
  lines.push('', '**By key, last 30 days**')
  if (keys.length === 0) lines.push('- none')
  for (const k of keys) lines.push(`- ${k.model}: ${num(k.input + k.output)} tokens, ${num(k.requests)} requests`)
  lines.push('', last ? `**Last call today:** ${last.model} via ${last.key} at ${clock(last.at)}` : '**Last call today:** none')
  lines.push('', '_The balance is an estimate (OpenAI has no balance API). After a top-up, run `/openai-balance <new amount>`. Decisions API calls show as spend only until OpenAI adds them to the Usage API._')
  return lines.join('\n')
}

async function setBalance($: EngineInterface, balance: number): Promise<Anchor> {
  const start = dayStart(Math.floor((await $.clock.now()) / 1000))
  const anchor = { balance, dayStart: start, spentBefore: spentFrom(await costs($, start), start) }
  await $.store.set('anchor', anchor)
  return anchor
}

async function getAnchor($: EngineInterface): Promise<Anchor | undefined> {
  const a = (await $.store.get('anchor')) as Anchor | undefined
  return a && typeof a.balance === 'number' ? a : undefined
}

function estimate(anchor: Anchor, buckets: Bucket[]) {
  return anchor.balance - (spentFrom(buckets, anchor.dayStart) - anchor.spentBefore)
}

// Where the money since `start` went, biggest first.
function itemsFrom(buckets: Bucket[], start: number) {
  const sum: Record<string, number> = {}
  for (const b of buckets) if (b.start >= start) for (const [k, v] of Object.entries(b.items)) sum[k] = (sum[k] ?? 0) + v
  return Object.entries(sum).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
}

function spentFrom(buckets: Bucket[], start: number) {
  return buckets.filter(b => b.start >= start).reduce((sum, b) => sum + b.dollars, 0)
}

// Daily spend in dollars from `start` (unix seconds) until now, all pages.
async function costs($: EngineInterface, start: number): Promise<Bucket[]> {
  const out: Bucket[] = []
  let page = ''
  do {
    const d = await call($, `costs?start_time=${start}&bucket_width=1d&limit=180&group_by=line_item${page && `&page=${encodeURIComponent(page)}`}`)
    for (const b of d.data ?? []) {
      const items: Record<string, number> = {}
      for (const r of b.results ?? []) {
        const name = r.line_item ?? 'other'
        items[name] = (items[name] ?? 0) + Number(r.amount?.value ?? 0)
      }
      out.push({ start: b.start_time, dollars: Object.values(items).reduce((a, v) => a + v, 0), items })
    }
    page = d.has_more && d.next_page ? d.next_page : ''
  } while (page)
  return out
}

async function tokens($: EngineInterface, start: number, by: 'model' | 'api_key_id') {
  const d = await usage($, `start_time=${start}&bucket_width=1d&limit=31&group_by=${by}`)
  const names = by === 'api_key_id' ? await keyNames($) : null
  const byName = new Map<string, { model: string; input: number; output: number; requests: number }>()
  for (const b of d.data ?? []) {
    for (const r of b.results ?? []) {
      const name = names ? keyName(names, r.api_key_id) : (r.model ?? '?')
      const m = byName.get(name) ?? { model: name, input: 0, output: 0, requests: 0 }
      m.input += r.input_tokens ?? 0
      m.output += r.output_tokens ?? 0
      m.requests += r.num_model_requests ?? 0
      byName.set(name, m)
    }
  }
  return [...byName.values()].sort((a, b) => b.input + b.output - (a.input + a.output))
}

// The newest minute today with a request in it: which model, through which key. The hour first, then its minutes,
// so no request needs more than 60 buckets. Model and key come from two groupings, so with two keys busy in the
// same minute the pair is a best guess.
async function lastCall($: EngineInterface, start: number): Promise<Line['last']> {
  const hour = newest(await usage($, `start_time=${start}&bucket_width=1h&limit=24&group_by=model`))
  if (!hour) return null
  const window = `start_time=${hour.at}&end_time=${hour.at + 3600}&bucket_width=1m&limit=60`
  const [byModel, byKey] = await Promise.all((['model', 'api_key_id'] as const).map(by => usage($, `${window}&group_by=${by}`)))
  const m = newest(byModel)
  if (!m) return null
  const k = newest(byKey)
  return { at: m.at, model: m.r.model ?? '?', key: k ? keyName(await keyNames($), k.r.api_key_id) : '?' }
}

// The newest bucket with a request in it, and its busiest row.
function newest(d: { data: any[] }) {
  let best: { at: number; r: any } | null = null
  for (const b of d.data) {
    for (const r of b.results ?? []) {
      const n = r.num_model_requests ?? 0
      if (n > 0 && (!best || b.start_time > best.at || (b.start_time === best.at && n > (best.r.num_model_requests ?? 0)))) best = { at: b.start_time, r }
    }
  }
  return best
}

// The same query over every usage type, buckets merged. Only a type the API doesn't have (404) is skipped.
async function usage($: EngineInterface, query: string) {
  const answers = await Promise.all(
    USAGE.map(type =>
      pages($, `usage/${type}?${query}`).catch(err => {
        if (err instanceof HttpError && err.status === 404) return []
        throw err
      }),
    ),
  )
  return { data: answers.flat() }
}

// Every bucket of a usage query, following next_page.
async function pages($: EngineInterface, path: string) {
  const out: any[] = []
  let page = ''
  do {
    const d = await call($, `${path}${page && `&page=${encodeURIComponent(page)}`}`)
    out.push(...(d.data ?? []))
    page = d.has_more && d.next_page ? d.next_page : ''
  } while (page)
  return out
}

// Key id → the name it was given, across every project. One lookup shared by concurrent callers, kept an hour.
let keyCache: { at: number; names: Promise<Map<string, string>> } | null = null
async function keyNames($: EngineInterface) {
  const now = await $.clock.now()
  if (!keyCache || now - keyCache.at > 60 * 60 * 1000) {
    const entry = { at: now, names: loadKeyNames($).then(r => {
      if (!r.isComplete && keyCache === entry) keyCache = null // a lookup that missed some keys is tried again next time
      return r.names
    }) }
    keyCache = entry
  }
  return keyCache.names
}

// A key without access to the key lists still gets its usage, shown by id (key …abcd).
async function loadKeyNames($: EngineInterface) {
  const names = new Map<string, string>()
  let isComplete = true
  const projects = await list($, 'projects?limit=100').catch(() => ((isComplete = false), []))
  for (const p of projects) {
    const keys = await list($, `projects/${p.id}/api_keys?limit=100`).catch(() => ((isComplete = false), []))
    for (const k of keys) names.set(k.id, k.name || k.redacted_value || k.id)
  }
  return { names, isComplete }
}

// Every item of a paged list endpoint.
async function list($: EngineInterface, path: string) {
  const out: any[] = []
  let after = ''
  do {
    const d = await call($, `${path}${after && `&after=${encodeURIComponent(after)}`}`)
    out.push(...(d.data ?? []))
    after = d.has_more && d.last_id ? d.last_id : ''
  } while (after)
  return out
}

function keyName(map: Map<string, string>, id: string | null | undefined) {
  if (!id) return 'no key'
  return map.get(id) ?? `key …${id.slice(-4)}`
}

async function call($: EngineInterface, path: string) {
  const res = await $.http.fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${await adminKey($)}` } })
  if (res.status === 401 || res.status === 403) {
    key = '' // read it again next time, in case it was replaced
    throw new KeyRejected()
  }
  if (!res.ok) throw new HttpError(res.status)
  return JSON.parse(res.text)
}

// From /config first, then OPENAI_ADMIN_KEY, then the macOS Keychain.
async function adminKey($: EngineInterface) {
  if (key) return key
  const run = async (argv: string[]) => {
    const r = await $.process.run(argv).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout.trim() : ''
  }
  const k = configKey || (await run(['printenv', 'OPENAI_ADMIN_KEY'])) || (await run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']))
  if (!k.startsWith('sk-admin-')) throw new NoKey()
  return (key = k)
}

function problem(err: unknown) {
  if (err instanceof NoKey) return `No OpenAI Admin key found. ${SETUP}`
  if (err instanceof KeyRejected) return `OpenAI refused the Admin key (401/403): it may be revoked, or not an Admin key. ${SETUP}`
  return `Couldn't reach OpenAI: ${err instanceof Error ? err.message : String(err)}`
}

// A model or line item without its snapshot date or billing part: "gpt-5-2025-08-07" → "gpt-5", "x, input" → "x".
const short = (name: string) => name.split(',')[0].trim().replace(/-\d{4}-\d{2}-\d{2}$/, '')
const dayStart = (s: number) => s - (s % DAY_S)
const usd = (n: number) => {
  const cents = Math.round(n * 100)
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`
}
const num = (n: number) => Math.round(n).toLocaleString('en-US')
const clock = (s: number) => {
  const d = new Date(s * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const usd4 = (n: number) => `$${n.toFixed(4)}`
const date = (s: number) => new Date(s * 1000).toISOString().slice(0, 10)
