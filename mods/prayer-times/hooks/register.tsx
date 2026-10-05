// Prayer Times: which prayer is it, and how long is left?
//   One line above the prompt: the current prayer and the time left to pray it, then the
//   next one; zawal and the makruh minutes after sunrise and before sunset in red. The times
//   are computed on this computer from the latitude and longitude in /config (the sun's
//   position, as prayer apps do it), so the location is never sent anywhere.
//   /prayers lists today's times. A toast says when a prayer begins, and again when its time
//   is nearly over.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const MIN = 60_000
const SOON_MIN = 20 // the time left turns yellow under this many minutes
const LAST_MIN = 5 // and red under this many

// The sun's angle below the horizon for Fajr and Isha; Makkah's Isha is a fixed 90 minutes after Maghrib.
const METHODS = {
  karachi: { fajr: 18, isha: 18 },
  mwl: { fajr: 18, isha: 17 },
  isna: { fajr: 15, isha: 15 },
  egypt: { fajr: 19.5, isha: 17.5 },
  makkah: { fajr: 18.5, isha: 90 / 60, ishaIsMinutes: true },
} as const

export type Config = {
  latitude: number
  longitude: number
  method: keyof typeof METHODS
  asr: 'hanafi' | 'standard'
  highLatitude: 'angle' | 'seventh' | 'middle'
  adjust?: Partial<Record<Adjustable, number>> // minutes, to match a mosque's timetable
}

type Adjustable = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'sunset' | 'isha'

// A day's times in hours after midnight UTC of that date (some may fall before 0 or past 24).
export type Times = { fajr: number; sunrise: number; noon: number; dhuhr: number; asr: number; sunset: number; isha: number; estimated?: boolean }

// Held by the host, so the line keeps ticking across a hot reload.
const now = atom({ plugin: 'prayer-times', key: 'now' } as const, 0)

export const register: Register = (on, options) => {
  const cfg = configFrom(options)
  const makruh = num(options.makruhMinutes, 15)
  const zawal = num(options.zawalMinutes, 5)
  const toasts = options.toasts !== false
  const warnMinutes = Math.min(120, num(options.warnMinutes, 15))
  let toasted = ''
  let warned = ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'prayers', description: "Today's prayer times" }).catch(() => {})
    const first = await $.clock.now()
    await update($, now, () => first)
    // The line moves each minute; a toast marks the start of each prayer, and another its last minutes.
    $.clock.every(30_000, () => {
      void (async () => {
        const t = await $.clock.now()
        await update($, now, () => t)
        if (!cfg || !toasts) return
        const s = status(cfg, new Date(t), makruh, zawal)
        const key = `${s.current?.name}@${s.current?.start.toDateString()}`
        if (s.current && t - s.current.start.getTime() < 60_000 && key !== toasted) {
          toasted = key
          $.ui.toast(`🕌 ${s.current.name} has begun · until ${hhmm(s.current.end)}`)
        }
        const due = deadlineDue(s, new Date(t), warnMinutes, warned)
        if (due) {
          warned = due.key
          $.ui.toast(due.text)
        }
      })().catch(() => {})
    })
    return r
  })

  on('command.run', { command: 'prayers' }, async () => {
    if (!cfg) return { text: 'Set your latitude and longitude in /config (prayer-times). They stay on this computer.' }
    const d = new Date()
    const t = timesFor(cfg, d)
    const at = (h: number) => hhmm(atHours(d, h))
    return {
      text:
        `Fajr ${at(t.fajr)} · Sunrise ${at(t.sunrise)} · Zawal ${at(t.noon - zawal / 60)} · Dhuhr ${at(t.dhuhr)} · ` +
        `Asr ${at(t.asr)} · Maghrib ${at(t.sunset)} · Isha ${at(t.isha)} (${cfg.method}, ${cfg.asr} Asr` +
        `${t.estimated ? ', no sunrise or sunset today: estimated from latitude 65°' : ''})`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    if (e.props.hasSurvey) return rest
    const t = (await read($, now)) || Date.now() // subscribes the line to the clock
    const { Box, Text } = $.ui.resolve(e)
    if (!cfg) {
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">{'🕌 prayer-times: set your latitude and longitude in /config. They stay on this computer'}</Text>
          {rest}
        </Box>
      )
    }
    const s = status(cfg, new Date(t), makruh, zawal)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {s.parts.map((p, i) => (
            <Text color={p.color} bold={p.bold} dimColor={p.dim}>{(i > 0 ? ' · ' : '') + p.text}</Text>
          ))}
        </Text>
        {rest}
      </Box>
    )
  })
}

const DHUHR_AFTER = 2 / 60 // Dhuhr starts this long after the sun's highest point

type Part = { text: string; color?: string; bold?: boolean; dim?: boolean }
type Window = { name: string; start: Date; end: Date }

// What the line says at `at`: the prayer whose time it is and what is left, or the forbidden window, then the next prayer.
export function status(cfg: Config, at: Date, makruh = 15, zawal = 5) {
  // Times are UTC hours of each local date, so far from UTC (e.g. UTC+13) a day's prayers can sit two dates back.
  const windows = [-2, -1, 0, 1].flatMap(offset => dayWindows(cfg, addDays(at, offset), makruh, zawal))
  const inside = (w: Window) => w.start <= at && at < w.end
  const prayers = windows.filter(w => !w.name.startsWith('!'))
  const current = prayers.find(inside)
  const blocked = windows.find(w => w.name.startsWith('!') && inside(w))
  const next = prayers.find(w => w.start > at)!
  const parts: Part[] = []

  if (blocked) {
    const label = blocked.name === '!zawal' ? 'Zawal' : blocked.name === '!sunrise' ? 'Sunrise' : 'Sunset near'
    parts.push({ text: `⛔ ${label}`, color: 'red', bold: true })
    if (blocked.name === '!sunset' && current) parts.push({ text: `${current.name} ${until(current.end, at)} left, makruh now`, color: 'red' })
    else parts.push({ text: `no prayer for ${until(blocked.end, at)}`, color: 'red' })
  } else if (current) {
    const left = (current.end.getTime() - at.getTime()) / MIN
    parts.push({ text: `🕌 ${current.name}`, bold: true })
    parts.push({ text: `${until(current.end, at)} left`, color: left < LAST_MIN ? 'red' : left < SOON_MIN ? 'yellow' : 'green', bold: left < SOON_MIN })
  } else {
    parts.push({ text: `🕌 ${next.name} in ${until(next.start, at)}`, bold: true })
  }
  if (current || blocked) parts.push({ text: `next ${next.name} ${hhmm(next.start)}`, dim: true })
  // Before Dhuhr, say when zawal comes.
  const z = windows.find(w => w.name === '!zawal' && w.start > at)
  if (z && next.name === 'Dhuhr' && !blocked) parts.push({ text: `zawal ${hhmm(z.start)}`, dim: true })
  if (timesFor(cfg, at).estimated) parts.push({ text: 'estimated (no sunrise or sunset today)', dim: true })
  return { parts, current, next, blocked }
}

// The warning that the current prayer's time is nearly over, once per window (`warned` is the last key warned).
// It also comes when the session starts inside the last minutes, but not for a window no longer than the warning,
// whose start toast already says when it ends. Asr warns too: its time runs to sunset, through the makruh minutes.
export function deadlineDue(s: Pick<ReturnType<typeof status>, 'current'>, at: Date, warnMinutes: number, warned: string) {
  const w = s.current
  if (!w || !(warnMinutes > 0)) return null
  const key = `${w.name}@${w.start.getTime()}`
  const left = (w.end.getTime() - at.getTime()) / MIN
  const length = (w.end.getTime() - w.start.getTime()) / MIN
  if (key === warned || left <= 0 || left > warnMinutes || length <= warnMinutes) return null
  return { key, text: `⏳ ${w.name} ends in ${Math.ceil(left)} min (${hhmm(w.end)})` }
}

// One day's windows: each prayer from its start to its end (Hanafi), and the times not to pray, marked with `!`.
function dayWindows(cfg: Config, day: Date, makruh: number, zawal: number): Window[] {
  const t = timesFor(cfg, day)
  const tomorrow = timesFor(cfg, addDays(day, 1))
  const at = (h: number) => atHours(day, h)
  return [
    { name: 'Fajr', start: at(t.fajr), end: at(t.sunrise) },
    { name: '!sunrise', start: at(t.sunrise), end: at(t.sunrise + makruh / 60) },
    { name: '!zawal', start: at(t.noon - zawal / 60), end: at(t.noon + DHUHR_AFTER) },
    { name: 'Dhuhr', start: at(t.dhuhr), end: at(t.asr) },
    { name: 'Asr', start: at(t.asr), end: at(t.sunset) },
    { name: '!sunset', start: at(t.sunset - makruh / 60), end: at(t.sunset) },
    { name: 'Maghrib', start: at(t.sunset), end: at(t.isha) },
    { name: 'Isha', start: at(t.isha), end: at(24 + tomorrow.fajr) },
  ]
}

// The day's times at the computer's own time zone for that date.
// The times for the computer's local date, as UTC hours, so a daylight-saving change that day can't shift them.
export function timesFor(cfg: Config, day: Date): Times {
  const t = computeTimes(cfg, day.getFullYear(), day.getMonth() + 1, day.getDate(), 0)
  for (const [k, m] of Object.entries(cfg.adjust ?? {})) t[k as Adjustable] += m / 60
  return t
}

// `asr+2 isha-5` as minutes per time. Dhuhr moves Dhuhr's start only (zawal stays on the sun's highest point); Maghrib moves sunset.
export function adjustFrom(text: string): Config['adjust'] {
  const names: Record<string, Adjustable> = { fajr: 'fajr', sunrise: 'sunrise', dhuhr: 'dhuhr', asr: 'asr', maghrib: 'sunset', isha: 'isha' }
  const out: Partial<Record<Adjustable, number>> = {}
  for (const m of text.toLowerCase().matchAll(/(fajr|sunrise|dhuhr|asr|maghrib|isha)\s*([+-]?)\s*(\d+(?:\.\d+)?)/g)) out[names[m[1]!]!] = (m[2] === '-' ? -1 : 1) * Number(m[3])
  return out
}

// The sun's position for the day, then the times it reaches each prayer's angle (the PrayTimes method).
export function computeTimes(cfg: Config, year: number, month: number, day: number, zone: number): Times {
  const t = solve(cfg, year, month, day, zone)
  if (Number.isFinite(t.sunrise) && Number.isFinite(t.sunset)) return t
  // Polar day or night: no sunrise or sunset at all. Use the nearest latitude that has them (65°), as many scholars advise.
  return { ...solve({ ...cfg, latitude: Math.sign(cfg.latitude) * 65 }, year, month, day, zone), estimated: true }
}

function solve(cfg: Config, year: number, month: number, day: number, zone: number): Times {
  const { latitude: lat, longitude: lng } = cfg
  const m = METHODS[cfg.method]
  const jdate = julian(year, month, day) - lng / (15 * 24)
  const sun = (t: number) => sunPosition(jdate + t)
  const midDay = (t: number) => fix(12 - sun(t).equation, 24)
  const angleTime = (angle: number, t: number, before: boolean) => {
    const decl = sun(t).declination
    const noon = midDay(t)
    const cos = (-sin(angle) - sin(decl) * sin(lat)) / (cos_(decl) * cos_(lat))
    const span = acos(cos) / 15 // NaN when the sun never reaches the angle
    return noon + (before ? -span : span)
  }
  const asrTime = (factor: number, t: number) => {
    const decl = sun(t).declination
    return angleTime(-acot(factor + tan(Math.abs(lat - decl))), t, false)
  }
  const factor = cfg.asr === 'hanafi' ? 2 : 1

  // Two passes: the first from rough guesses, the second from the first's answers.
  let h = { fajr: 5, sunrise: 6, noon: 12, asr: 13, sunset: 18, isha: 18 }
  for (let pass = 0; pass < 2; pass++) {
    const d = (x: number) => x / 24
    h = {
      fajr: angleTime(m.fajr, d(h.fajr), true),
      sunrise: angleTime(0.833, d(h.sunrise), true),
      noon: midDay(d(h.noon)),
      asr: asrTime(factor, d(h.asr)),
      sunset: angleTime(0.833, d(h.sunset), false),
      isha: 'ishaIsMinutes' in m ? NaN : angleTime(m.isha, d(h.isha), false),
    }
  }
  const shift = zone - lng / 15
  const out: Times = { fajr: h.fajr + shift, sunrise: h.sunrise + shift, noon: h.noon + shift, dhuhr: h.noon + shift + DHUHR_AFTER, asr: h.asr + shift, sunset: h.sunset + shift, isha: h.isha + shift }
  if ('ishaIsMinutes' in m) out.isha = out.sunset + m.isha

  // Far from the equator the sun may never get low enough: Fajr and Isha take a share of the night instead.
  const night = 24 - (out.sunset - out.sunrise)
  const share = (angle: number) => (cfg.highLatitude === 'seventh' ? 1 / 7 : cfg.highLatitude === 'middle' ? 1 / 2 : angle / 60)
  const fajrMax = share(m.fajr) * night
  if (!Number.isFinite(out.fajr) || out.sunrise - out.fajr > fajrMax) out.fajr = out.sunrise - fajrMax
  if (!('ishaIsMinutes' in m)) {
    const ishaMax = share(m.isha) * night
    if (!Number.isFinite(out.isha) || out.isha - out.sunset > ishaMax) out.isha = out.sunset + ishaMax
  }
  return out
}

function sunPosition(jd: number) {
  const D = jd - 2451545
  const g = fix(357.529 + 0.98560028 * D, 360)
  const q = fix(280.459 + 0.98564736 * D, 360)
  const L = fix(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360)
  const e = 23.439 - 0.00000036 * D
  const ra = atan2(cos_(e) * sin(L), cos_(L)) / 15
  return { declination: asin(sin(e) * sin(L)), equation: q / 15 - fix(ra, 24) }
}

function julian(year: number, month: number, day: number) {
  if (month <= 2) {
    year -= 1
    month += 12
  }
  const a = Math.floor(year / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const sin = (d: number) => Math.sin(rad(d))
const cos_ = (d: number) => Math.cos(rad(d))
const tan = (d: number) => Math.tan(rad(d))
const asin = (x: number) => deg(Math.asin(x))
const acos = (x: number) => deg(Math.acos(x))
const atan2 = (y: number, x: number) => deg(Math.atan2(y, x))
const acot = (x: number) => deg(Math.atan(1 / x))
const fix = (a: number, b: number) => {
  const r = a - b * Math.floor(a / b)
  return r < 0 ? r + b : r
}

function configFrom(options: Record<string, unknown>): Config | null {
  const latitude = Number(options.latitude)
  const longitude = Number(options.longitude)
  const isSet = (v: unknown) => v !== undefined && v !== null && v !== ''
  if (!isSet(options.latitude) || !isSet(options.longitude) || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null
  const method = String(options.method ?? 'karachi') as Config['method']
  return {
    latitude,
    longitude,
    method: method in METHODS ? method : 'karachi',
    asr: options.asr === 'standard' ? 'standard' : 'hanafi',
    highLatitude: options.highLatitude === 'seventh' || options.highLatitude === 'middle' ? options.highLatitude : 'angle',
    adjust: adjustFrom(String(options.adjust ?? '')),
  }
}

function num(value: unknown, fallback: number) {
  const n = Number(value)
  return value === undefined || value === null || value === '' || !Number.isFinite(n) ? fallback : Math.max(0, n)
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12)
}

// The instant `hours` after midnight UTC of the day's local date.
export function atHours(day: Date, hours: number) {
  return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) + Math.round(hours * 60) * MIN)
}

export function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Time left until `end`, rounded up to the minute: `42m`, `1h 05m`.
export function until(end: Date, at: Date) {
  const m = Math.max(0, Math.ceil((end.getTime() - at.getTime()) / MIN))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
