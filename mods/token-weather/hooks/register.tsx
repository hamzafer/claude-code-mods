// Token Weather: a live forecast of the context window, above the prompt,
// and how long the prompt cache stays warm after the last request.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TokenWeatherReading } from '../types'

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
// before that it moves in 15 s steps, so the band is not redrawn every second.
const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const
const FAST_BELOW_MS = 2 * 60_000
const SLOW_STEP_MS = 15_000
const WARN_BELOW_MS = 60_000

// Held by the host, so the history survives a hot reload of this file.
const readings = atom({ plugin: 'token-weather', key: 'readings' } as const, [] as TokenWeatherReading[])
const lastRequestAt = atom({ plugin: 'token-weather', key: 'lastRequestAt' } as const, null as number | null)

export const register: Register = (on, options) => {
  const ttlMs = options.cacheTtl === '1h' ? TTL_MS['1h'] : TTL_MS['5m']
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await takeReading($)
    const since = await read($, lastRequestAt) // kept across a hot reload: pick the countdown up again
    if (since !== null) restart($, since, await $.clock.now(), ttlMs)
    return result
  })

  // One model request of a turn. The cache's clock restarts when each one on the
  // main thread finishes, tool-loop requests inside a turn included.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result.stopReason !== null) {
      const now = await $.clock.now()
      await update($, lastRequestAt, () => now)
      restart($, now, now, ttlMs)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await takeReading($) // main-loop turns only, not subagents
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
    const cache = since === null ? null : cachePart(since + ttlMs - (await $.clock.now()))
    const lineWidth =
      2 + // paddingX
      `${f.icon} ${f.word} ${now.percent}% of context ${short(now.tokens)} / ${short(now.window)}`.length +
      (isWide ? `  last turns ${sparkline(history)}${history.length > 1 ? trend(history) : ''}`.length : 0)
    const showCache = cache !== null && lineWidth + cache.text.length <= e.props.bodyColumns

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          <Text color={f.color} bold>{`${f.icon} ${f.word}`}</Text>
          <Text>{` ${now.percent}% of context`}</Text>
          <Text dimColor>{` ${short(now.tokens)} / ${short(now.window)}`}</Text>
          {isWide && <Text dimColor>{'  last turns '}</Text>}
          {isWide && <Text color={f.color}>{sparkline(history)}</Text>}
          {isWide && history.length > 1 && <Text dimColor>{trend(history)}</Text>}
          {showCache && <Text color={cache.color} dimColor={cache.isCold}>{cache.text}</Text>}
        </Box>
        {rest}
      </Box>
    )
  })
}

// The countdown's redraw timer, one at a time; a reload of this file starts it over.
let tick: Timer | undefined
let armedFor: number | null = null

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
  const step = isFast ? 1000 : SLOW_STEP_MS
  const wait = Math.min(left % step || step, isFast ? step : left - FAST_BELOW_MS)
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
  return { text: `  ❄ cache ${clock}`, color: leftMs < WARN_BELOW_MS ? 'yellow' : undefined, isCold: false }
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
