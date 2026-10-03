// Token Weather: a live forecast of the context window, above the prompt,
// and how long the prompt cache stays warm after the last request.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheTtl, TokenWeatherReading } from '../types'

const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: 'red' },
] as const

// The cache countdown ticks every second only in its last two minutes;
// before that it moves in 15 s steps (30 s with over ten minutes left),
// so the band is not redrawn every second.
const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const
const FAST_BELOW_MS = 2 * 60_000
const SLOW_STEP_MS = 15_000
const SLOWER_ABOVE_MS = 10 * 60_000
const SLOWER_STEP_MS = 30_000
const WARN_BELOW_MS = 60_000
// How much of the transcript's end to read for the last response's usage.
const TAIL_BYTES = 1024 * 1024

// Held by the host, so the history survives a hot reload of this file.
const readings = atom({ plugin: 'token-weather', key: 'readings' } as const, [] as TokenWeatherReading[])
const lastRequestAt = atom({ plugin: 'token-weather', key: 'lastRequestAt' } as const, null as number | null)
// The cache lifetime Claude's responses last showed; null until one wrote to the cache.
const detectedTtl = atom({ plugin: 'token-weather', key: 'detectedTtl' } as const, null as CacheTtl | null)

export const register: Register = (on, options) => {
  // `5m` or `1h` set by hand wins; `auto` (the default) goes by what was detected.
  const override: CacheTtl | null = options.cacheTtl === '5m' || options.cacheTtl === '1h' ? options.cacheTtl : null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await takeReading($)
    if ((await read($, detectedTtl)) === null) {
      const known = await $.store.get('detectedTtl').catch(() => undefined) // the last session's, until this one's first response says
      if (known === '5m' || known === '1h') await update($, detectedTtl, () => known)
    }
    const since = await read($, lastRequestAt) // kept across a hot reload: pick the countdown up again
    if (since !== null) restart($, since, await $.clock.now(), await ttlMsFor($, override))
    return result
  })


  // A /clear or a resume leaves the old conversation, and its cache, behind.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      stop()
      await update($, lastRequestAt, () => null)
    }
    return next(e)
  })

  // One model request of a turn. The cache's clock restarts when each one on the
  // main thread finishes, tool-loop requests inside a turn included.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result.stopReason !== null) {
      const now = await $.clock.now()
      await update($, lastRequestAt, () => now)
      restart($, now, now, await ttlMsFor($, override))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await takeReading($) // main-loop turns only, not subagents
      if (override === null) {
        // The last response's usage in the transcript says which lifetime it wrote to the cache with.
        const found = ttlFromTranscript(await readTail($))
        if (found !== null) await detect($, found)
      }
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const history = await read($, readings)
    const now = history.at(-1)
    if (e.props.hasSurvey || !now) {
      return rest
    }

    const { Box, Text } = $.ui.resolve(e)
    const f = FORECAST.find(b => now.percent < b.upTo) ?? FORECAST[4]
    const isWide = e.props.bodyColumns >= 60

    // The cache part goes first when the line runs out of room.
    const since = await read($, lastRequestAt)
    const ttlMs = await ttlMsFor($, override)
    let cache: ReturnType<typeof cachePart> | null = null
    if (since !== null) {
      const clockNow = await $.clock.now()
      if (armedFor !== since) restart($, since, clockNow, ttlMs) // its timer was lost (a reload): pick it up
      cache = cachePart(since + ttlMs - clockNow)
    }
    const lineWidth =
      2 + // paddingX
      `${f.icon} ${f.word} ${now.percent}% of context ${short(now.tokens)} / ${short(now.window)}`.length +
      (isWide ? `  last turns ${sparkline(history)}${history.length > 1 ? trend(history) : ''}`.length : 0)
    const showCache = isWide && cache !== null && lineWidth + cache.text.length <= e.props.bodyColumns

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          <Text color={f.color} bold>{`${f.icon} ${f.word}`}</Text>
          <Text>{` ${now.percent}% of context`}</Text>
          <Text dimColor>{` ${short(now.tokens)} / ${short(now.window)}`}</Text>
          {isWide && <Text dimColor>{'  last turns '}</Text>}
          {isWide && <Text color={f.color}>{sparkline(history)}</Text>}
          {isWide && history.length > 1 && <Text dimColor>{trend(history)}</Text>}
          {showCache && cache && <Text color={cache.color} dimColor={cache.isCold}>{cache.text}</Text>}
        </Box>
        {rest}
      </Box>
    )
  })
}

async function ttlMsFor($: EngineInterface, override: CacheTtl | null) {
  return TTL_MS[override ?? (await read($, detectedTtl)) ?? '5m']
}

// Keeps a newly detected lifetime, here and for the next session, and moves the countdown
// onto it. Only called with no override set.
async function detect($: EngineInterface, ttl: CacheTtl) {
  if ((await read($, detectedTtl)) === ttl) return
  await update($, detectedTtl, () => ttl)
  await $.store.set('detectedTtl', ttl).catch(() => {}) // remembered for the next session when the store allows
  const now = await $.clock.now()
  const since = await read($, lastRequestAt) // read last, so a request that just finished is the one re-armed
  if (since !== null) restart($, since, now, TTL_MS[ttl])
}

// The end of this session's transcript, where the last response is: whole if small,
// else its last bytes. '' when it cannot be found or read.
async function readTail($: EngineInterface) {
  try {
    const path = await transcriptPath($)
    if (path === null) return ''
    const { size } = await $.fs.stat(path)
    if (size <= TAIL_BYTES) return await $.fs.read(path)
    const { exitCode, stdout } = await $.process.run(['tail', '-c', String(TAIL_BYTES), path])
    return exitCode === 0 ? stdout : ''
  } catch {
    return '' // unreadable: keep the last detected value
  }
}

// <config dir>/projects/<project root, each other character a dash>/<session id>.jsonl
// A very long project path, or a root moved during the session, gives a path that does
// not exist: then nothing is detected and the last value stays.
async function transcriptPath($: EngineInterface) {
  const home = await $.env.get('HOME')
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  if (!configDir) return null
  const project = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')
  return `${configDir}/projects/${project}/${await $.session.id()}.jsonl`
}

// The lifetime the latest main-thread response wrote to the cache with; null when it
// wrote nothing (a pure cache hit) or no response was found.
function ttlFromTranscript(text: string): CacheTtl | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: any
    try {
      entry = JSON.parse(lines[i] ?? '')
    } catch {
      continue // blank, or cut by the tail
    }
    if (entry?.type !== 'assistant' || entry.isSidechain || !entry.message?.usage) continue
    const written = entry.message.usage.cache_creation
    if (Number(written?.ephemeral_1h_input_tokens) > 0) return '1h'
    if (Number(written?.ephemeral_5m_input_tokens) > 0) return '5m'
    return null
  }
  return null
}

// The countdown's redraw timer, one at a time; a reload of this file starts it over.
let tick: Timer | undefined
let armedFor: number | null = null

function stop() {
  tick?.cancel()
  tick = undefined
  armedFor = null
}

function restart($: EngineInterface, since: number, now: number, ttlMs: number) {
  armedFor = since
  arm($, since, now, ttlMs)
}

// Redraws the band when the countdown's text next changes, until it reads cold.
function arm($: EngineInterface, since: number, now: number, ttlMs: number) {
  if (armedFor !== since) return // a newer request took over
  tick?.cancel()
  const left = since + ttlMs - now
  if (left <= 0) return
  const isFast = left <= FAST_BELOW_MS
  const step = isFast ? 1000 : left > SLOWER_ABOVE_MS ? SLOWER_STEP_MS : SLOW_STEP_MS
  const wait = Math.min(left % step || step, isFast ? step : left - (left > SLOWER_ABOVE_MS ? SLOWER_ABOVE_MS : FAST_BELOW_MS))
  tick = $.clock.after(wait, () => {
    $.ui.invalidate('ui.render')
    $.clock.now().then(t => arm($, since, t, ttlMs)).catch(() => {})
  })
}

async function takeReading($: EngineInterface) {
  const { context } = await $.session.usage()
  if (!context?.window) return
  const tokens = context.tokens ?? 0
  const percent = context.percent ?? Math.round((tokens / context.window) * 100)
  await update($, readings, history => [...history, { tokens, window: context.window, percent }].slice(-HISTORY))
}

// What the cache part says with `leftMs` until the cache expires.
function cachePart(leftMs: number) {
  if (leftMs <= 0) {
    return { text: '  ❄ cache cold', color: 'red', isCold: true }
  }
  const seconds = Math.ceil(leftMs / 1000)
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return { text: `  ❄ cache ${clock}`, color: seconds * 1000 < WARN_BELOW_MS ? 'yellow' : undefined, isCold: false }
}

function sparkline(history: TokenWeatherReading[]) {
  const top = Math.max(...history.map(r => r.tokens), 1)
  return history.map(r => BARS[Math.floor((r.tokens / top) * (BARS.length - 1))]).join('')
}

function trend(history: TokenWeatherReading[]) {
  const delta = (history.at(-1)?.tokens ?? 0) - (history.at(-2)?.tokens ?? 0)
  if (delta === 0) return ' steady'
  return delta > 0 ? ` ▲ +${short(delta)} last turn` : ` ▼ ${short(-delta)} last turn`
}

function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
