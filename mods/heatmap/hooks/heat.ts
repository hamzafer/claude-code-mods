// The heatmap's pure parts: active minutes, the ledger, and what the pane shows.
// No `$` here, so every rule is tested without an engine.

/** One ledger row: a project's activity on one local day. */
export type Row = {
  d: string // the local day, YYYY-MM-DD
  p: string // the project's folder under projects/ (its root, each other character a dash)
  n: string // the project's display name, the last part of its root
  min: number // active minutes
  s: number // sessions active that day
  h: number[] // active minutes per local hour, 24 of them
}

/** One session log: its project and the times of its messages, in ms. */
export type SessionLog = { p: string; n: string; times: number[] }

/** Minutes UTC is ahead of local time at an instant, as Date#getTimezoneOffset says it. */
export type Offset = (ms: number) => number

export const GAP_MS = 5 * 60_000 // a pause longer than this adds nothing
export const MAX_WEEKS = 52
export const LABEL_COLUMNS = 4 // "Mon " before each grid row
export const MILESTONES = [7, 30, 100]

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const localOffset: Offset = ms => new Date(ms).getTimezoneOffset()

/** The local day of an instant, YYYY-MM-DD. */
export function dayOf(ms: number, offset: Offset): string {
  return new Date(ms - offset(ms) * 60_000).toISOString().slice(0, 10)
}

/** Adds whole days to a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Monday is 0, Sunday 6. */
export function weekday(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
}

type DayTotals = { ms: number; hours: number[] }

/**
 * One session's activity per local day: the time between messages, where a pause
 * over GAP_MS adds nothing, split at local midnight and at each local hour.
 * A day with a message and no counted time is still there, with 0 ms.
 */
export function sessionDays(times: readonly number[], offset: Offset): Map<string, DayTotals> {
  const sorted = [...times].sort((a, b) => a - b)
  const days = new Map<string, DayTotals>()
  const at = (day: string) => {
    let t = days.get(day)
    if (!t) days.set(day, (t = { ms: 0, hours: new Array<number>(24).fill(0) }))
    return t
  }
  for (const ms of sorted) at(dayOf(ms, offset))
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!
    const b = sorted[i]!
    if (b - a > GAP_MS) continue
    let cur = a
    while (cur < b) {
      const local = cur - offset(cur) * 60_000
      const end = Math.min(b, cur + (Math.floor(local / HOUR_MS) + 1) * HOUR_MS - local) // the next local hour
      const t = at(new Date(local).toISOString().slice(0, 10))
      t.ms += end - cur
      t.hours[new Date(local).getUTCHours()]! += end - cur
      cur = end
    }
  }
  return days
}

/** Ledger rows from session logs: one per day per project, from `fromDay` on. */
export function aggregate(logs: readonly SessionLog[], offset: Offset, fromDay = ''): Row[] {
  const acc = new Map<string, { p: string; n: string; d: string; ms: number; s: number; hours: number[] }>()
  for (const log of logs) {
    for (const [d, t] of sessionDays(log.times, offset)) {
      if (d < fromDay) continue
      const key = `${d}\u0000${log.p}`
      let r = acc.get(key)
      if (!r) acc.set(key, (r = { p: log.p, n: log.n, d, ms: 0, s: 0, hours: new Array<number>(24).fill(0) }))
      r.ms += t.ms
      r.s += 1
      t.hours.forEach((ms, h) => (r!.hours[h]! += ms))
    }
  }
  return sortRows(
    [...acc.values()].map(r => ({ d: r.d, p: r.p, n: r.n, min: Math.round(r.ms / 60_000), s: r.s, h: r.hours.map(ms => Math.round(ms / 60_000)) })),
  )
}

/** The ledger with every day from `fromDay` on replaced by `fresh`; older days are never rewritten. */
export function mergeLedger(old: readonly Row[], fresh: readonly Row[], fromDay: string): Row[] {
  return sortRows([...old.filter(r => r.d < fromDay), ...fresh.filter(r => r.d >= fromDay)])
}

/** Reads the ledger file; a malformed line is skipped. */
export function parseLedger(text: string): Row[] {
  const rows: Row[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as Partial<Row>
      if (typeof r.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.d) || typeof r.p !== 'string') continue
      if (typeof r.min !== 'number' || typeof r.s !== 'number') continue
      const h = Array.isArray(r.h) && r.h.length === 24 && r.h.every(x => typeof x === 'number') ? r.h : new Array<number>(24).fill(0)
      rows.push({ d: r.d, p: r.p, n: typeof r.n === 'string' && r.n ? r.n : r.p, min: r.min, s: r.s, h })
    } catch {
      // a broken line costs that line only
    }
  }
  return rows
}

export function formatLedger(rows: readonly Row[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
}

function sortRows(rows: Row[]): Row[] {
  return rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
}

/** How many weeks fit a pane this wide: two columns a week after the labels, up to MAX_WEEKS. */
export function weeksFor(columns: number): number {
  return Math.max(1, Math.min(MAX_WEEKS, Math.floor((columns - LABEL_COLUMNS) / 2)))
}

/** 0 for no activity, then 1 to 4 for under 15 minutes, under an hour, under 3 hours, 3 hours and more. */
export function level(min: number, s: number): number {
  if (s <= 0 && min <= 0) return 0
  return min < 15 ? 1 : min < 60 ? 2 : min < 180 ? 3 : 4
}

export type Day = { d: string; min: number; s: number; top: string | null }

export type View = {
  start: string // the Monday the grid starts on
  weeks: number
  today: string
  days: Day[] // from start to today, one per day
  streak: { current: number; best: number }
  totalMin: number
  sessions: number
  peakDay: number | null // Monday is 0
  peakHour: number | null
  top: { name: string; min: number; share: number }[] // all projects only
}

/**
 * What the pane shows for one scope: `project` set keeps that project's rows alone.
 * Streaks count over every day in the ledger; the rest over the weeks shown.
 */
export function buildView(rows: readonly Row[], opts: { today: string; weeks: number; project?: string }): View {
  const scoped = opts.project === undefined ? rows : rows.filter(r => r.p === opts.project)
  const start = addDays(opts.today, -weekday(opts.today) - (opts.weeks - 1) * 7)

  const byDay = new Map<string, { min: number; s: number; projects: Map<string, number> }>()
  for (const r of scoped) {
    let t = byDay.get(r.d)
    if (!t) byDay.set(r.d, (t = { min: 0, s: 0, projects: new Map() }))
    t.min += r.min
    t.s += r.s
    t.projects.set(r.n, (t.projects.get(r.n) ?? 0) + r.min)
  }

  const days: Day[] = []
  const weekdayMin = new Array<number>(7).fill(0)
  const hourMin = new Array<number>(24).fill(0)
  const projectMin = new Map<string, number>()
  let totalMin = 0
  let sessions = 0
  for (let d = start; d <= opts.today; d = addDays(d, 1)) {
    const t = byDay.get(d)
    days.push({ d, min: t?.min ?? 0, s: t?.s ?? 0, top: t ? topOf(t.projects) : null })
    if (!t) continue
    totalMin += t.min
    sessions += t.s
    weekdayMin[weekday(d)]! += t.min
  }
  for (const r of scoped) {
    if (r.d < start || r.d > opts.today) continue
    r.h.forEach((m, h) => (hourMin[h]! += m))
    projectMin.set(r.n, (projectMin.get(r.n) ?? 0) + r.min)
  }

  const top =
    opts.project === undefined && totalMin > 0
      ? [...projectMin.entries()]
          .filter(([, min]) => min > 0)
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .slice(0, 3)
          .map(([name, min]) => ({ name, min, share: min / totalMin }))
      : []

  return {
    start,
    weeks: opts.weeks,
    today: opts.today,
    days,
    streak: streaks(new Set([...byDay.entries()].filter(([, t]) => t.s > 0 || t.min > 0).map(([d]) => d)), opts.today),
    totalMin,
    sessions,
    peakDay: argmax(weekdayMin),
    peakHour: argmax(hourMin),
    top,
  }
}

/**
 * The current streak runs back from today, or from yesterday while today has no
 * activity yet; the best is the longest run of active days anywhere.
 */
export function streaks(active: ReadonlySet<string>, today: string): { current: number; best: number } {
  let current = 0
  for (let d = active.has(today) ? today : addDays(today, -1); active.has(d); d = addDays(d, -1)) current++
  let best = 0
  for (const d of active) {
    if (active.has(addDays(d, -1))) continue // not the start of a run
    let n = 0
    for (let x = d; active.has(x); x = addDays(x, 1)) n++
    best = Math.max(best, n)
  }
  return { current, best: Math.max(best, current) }
}

function topOf(projects: Map<string, number>): string | null {
  let best: string | null = null
  let most = -1
  for (const [name, min] of projects) {
    if (min > most || (min === most && best !== null && name < best)) {
      best = name
      most = min
    }
  }
  return best
}

function argmax(xs: readonly number[]): number | null {
  let at: number | null = null
  xs.forEach((x, i) => {
    if (x > 0 && (at === null || x > xs[at]!)) at = i
  })
  return at
}

/** The month names over the grid: each sits over the first week holding the 1st of its month, when there is room. */
export function monthLabels(start: string, weeks: number): string {
  let out = ''
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, w * 7)
    const hasFirst = w === 0 ? false : Array.from({ length: 7 }, (_, i) => addDays(monday, i)).some(d => d.endsWith('-01'))
    if (!hasFirst || out.length > w * 2) continue
    const sunday = addDays(monday, 6)
    const name = MONTHS[Number(sunday.slice(5, 7)) - 1]!
    out = out.padEnd(w * 2) + name
  }
  return out.slice(0, weeks * 2)
}

/** 3h 12m, 47m, 0m. */
export function duration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Tue 14 Oct, from fixed names so every machine says the same. */
export function dayLabel(day: string): string {
  return `${WEEKDAYS[weekday(day)]} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`
}

export function weekdayName(i: number): string {
  return WEEKDAYS[i]!
}

/** 22:00 */
export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

/** 1,204 */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The last part of a project's root, or its folder name when there is no root. */
export function projectName(cwd: string | null, folder: string): string {
  const parts = (cwd ?? '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? folder
}

/** Message times from `grep -o '"timestamp":"…"'` output. */
export function parseTimes(grepOutput: string): number[] {
  const out: number[] = []
  for (const m of grepOutput.matchAll(/"timestamp": *"([^"]+)"/g)) {
    const ms = Date.parse(m[1]!)
    if (Number.isFinite(ms)) out.push(ms)
  }
  return out
}
