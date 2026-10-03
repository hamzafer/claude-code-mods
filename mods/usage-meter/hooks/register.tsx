// Usage Meter: the plan's rate-limit windows and the session's cost, above the prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { UsageMeterSnapshot, UsageMeterWindow } from '../types'

const CELLS = 5
const BLOCKS = '▁▂▃▄▅▆▇█'
const TICK_MS = 60_000
const WARN_AT = 90
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const ORDER = ['five_hour', 'seven_day', 'spend_limit']

// Held by the host, so they survive a hot reload of this file.
const snapshot = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, null as UsageMeterSnapshot | null)
const tick = atom({ plugin: 'usage-meter', key: 'tick' } as const, 0)
const warned = atom({ plugin: 'usage-meter', key: 'warned' } as const, {} as Record<string, number>)

type Segment = { text: string; color?: string; dim?: boolean }
type Part = { kind: 'window' | 'cost'; isPrimary: boolean; segments: Segment[] }

export const register: Register = on => {
  let timer: Timer | undefined // one countdown timer, even if session.start fires again

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Moves the reset countdown on while a window has a reset time.
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      void (async () => {
        const snap = await read($, snapshot)
        if (snap?.rateLimits.some(w => w.resetsAt)) await update($, tick, n => n + 1)
      })().catch(() => {})
    })
    const usage = await $.session.usage().catch(() => null)
    if (usage) await take($, usage.rateLimits, usage.cost?.usd).catch(() => {})
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await take($, e.rateLimits, e.cost?.usd).catch(() => {})
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    await read($, tick) // redraws on each tick of the countdown
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !snap) return rest

    const parts = fit(build(snap, await $.clock.now()), e.props.bodyColumns - 2)
    if (parts.length === 0) return rest

    const { Box, Text } = $.ui.resolve(e)
    const segments: Segment[] = [{ text: '⏱ ', dim: true }]
    parts.forEach((p, i) => {
      if (i > 0) segments.push({ text: ' · ', dim: true })
      segments.push(...p.segments)
    })

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          {segments.map((s, i) => (
            <Text key={String(i)} color={s.color} dimColor={s.dim} wrap="truncate">
              {s.text}
            </Text>
          ))}
        </Box>
        {rest}
      </Box>
    )
  })
}

async function take($: EngineInterface, rateLimits: readonly UsageMeterWindow[], costUsd: number | undefined) {
  const windows = rateLimits
    .filter(w => Number.isFinite(w.percentUsed))
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
  await update($, snapshot, () => ({ rateLimits: windows, costUsd }))
  await warn($, windows)
}

// One toast per window per reset period, once it passes WARN_AT.
async function warn($: EngineInterface, windows: UsageMeterWindow[]) {
  const done = await read($, warned)
  const now = await $.clock.now()
  const fresh: Record<string, number> = {}
  const rearm: string[] = []
  for (const w of windows) {
    const resetMs = resetTime(w)
    if (w.percentUsed < WARN_AT) {
      // With no reset time, dropping back under the line is the only sign of a new period.
      if (resetMs === 0 && done[w.kind] !== undefined) rearm.push(w.kind)
      continue
    }
    const last = done[w.kind]
    // A reset time that moved on by more than half an hour is a new period.
    if (last !== undefined && resetMs <= last + 30 * 60_000) continue
    fresh[w.kind] = resetMs
    const when = resetMs > 0 ? `, resets in ${countdown(resetMs - now)}` : ''
    const what = w.kind === 'spend_limit' ? 'Spend limit' : `${label(w.kind)} usage limit`
    $.ui.toast(`${what} at ${Math.round(w.percentUsed)}%${when}`)
  }
  if (Object.keys(fresh).length > 0 || rearm.length > 0) {
    await update($, warned, old => {
      const next = { ...old, ...fresh }
      for (const kind of rearm) delete next[kind]
      return next
    })
  }
}

export function build(snap: UsageMeterSnapshot, now: number): Part[] {
  const windows = snap.rateLimits
    .filter(w => !isStale(w, now)) // a window past its reset waits for a fresh reading
    .sort((a, b) => rank(a.kind) - rank(b.kind))
  const parts: Part[] = windows.map((w, i) => {
    const color = colorFor(w.percentUsed)
    const segments: Segment[] = [
      { text: `${label(w.kind)} `, dim: true },
      { text: bar(w.percentUsed), color },
      { text: ` ${Math.round(w.percentUsed)}%`, color },
    ]
    const resetMs = resetTime(w)
    // The first window always says when it resets; the others only once they run high.
    if (resetMs > 0 && (i === 0 || w.percentUsed >= 75)) {
      segments.push({ text: ` · resets ${countdown(resetMs - now)}`, dim: true })
    }
    return { kind: 'window', isPrimary: i === 0, segments }
  })
  if (snap.costUsd !== undefined && snap.costUsd > 0) {
    parts.push({ kind: 'cost', isPrimary: false, segments: [{ text: `$${snap.costUsd.toFixed(2)} session`, dim: true }] })
  }
  return parts
}

// Drops the secondary windows first, then the cost, until the line fits.
export function fit(parts: Part[], columns: number): Part[] {
  let kept = [...parts]
  const tooWide = () => width(kept) > columns
  while (tooWide()) {
    const i = findLastIndex(kept, p => p.kind === 'window' && !p.isPrimary)
    if (i < 0) break
    kept.splice(i, 1)
  }
  if (tooWide() && kept.some(p => p.isPrimary)) kept = kept.filter(p => p.kind !== 'cost')
  return kept
}

function width(parts: Part[]) {
  const text = parts.map(p => p.segments.map(s => s.text).join('')).join(' · ')
  return 3 + [...text].length // the clock and its space: the glyph can draw two cells wide
}

function findLastIndex<T>(list: T[], test: (item: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i] as T)) return i
  return -1
}

export function bar(percent: number) {
  const filled = (Math.min(Math.max(percent, 0), 100) / 100) * CELLS
  let out = ''
  for (let i = 0; i < CELLS; i++) {
    const cell = Math.min(Math.max(filled - i, 0), 1)
    out += BLOCKS[Math.round(cell * (BLOCKS.length - 1))]
  }
  return out
}

export function colorFor(percent: number) {
  if (percent >= 90) return 'red'
  if (percent >= 75) return 'yellow'
  return 'green'
}

export function countdown(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

function resetTime(w: UsageMeterWindow) {
  const ms = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  return Number.isFinite(ms) ? ms : 0
}

function isStale(w: UsageMeterWindow, now: number) {
  const resetMs = resetTime(w)
  return resetMs > 0 && resetMs <= now
}

function label(kind: string) {
  return LABELS[kind] ?? kind.replace(/_/g, ' ')
}

function rank(kind: string) {
  const i = ORDER.indexOf(kind)
  return i < 0 ? ORDER.length : i
}
