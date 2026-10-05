import { describe, expect, mock, test } from 'claude-code/testing'

import { adjustFrom, atHours, computeTimes, deadlineDue, hhmm, status, timesFor, until } from '../hooks/register'
import type { Config, Times } from '../hooks/register'

const MINUTE = 60_000
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }
const LONDON: Config = { latitude: 51.5074, longitude: -0.1278, method: 'karachi', asr: 'hanafi', highLatitude: 'angle' }

// Hours after midnight as HH:MM, rounded to the minute as prayer tables print them.
const clock = (h: number) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
// Each time within a minute of the reference (rounding differs by a minute at most).
function near(t: Times, ref: Partial<Record<keyof Times, string>>, slack = 1.5) {
  for (const [k, v] of Object.entries(ref)) {
    const [hh, mm] = v!.split(':').map(Number)
    let diff = Math.abs(t[k as keyof Times] * 60 - (hh! * 60 + mm!))
    diff = Math.min(diff, 1440 - diff) // Isha past midnight
    expect({ [k]: clock(t[k as keyof Times]), off: diff <= (k === 'asr' ? Math.max(slack, 3) : slack) }).toEqual({ [k]: clock(t[k as keyof Times]), off: true })
  }
}

describe('prayer-times', () => {
  // Reference times from the Aladhan API for public cities (not anyone's own location). Aladhan's Asr runs
  // 1.5 to 2.5 minutes later than the textbook shadow formula used here, so Asr is held to 3 minutes; the
  // `adjust` setting is how someone matches their own mosque's timetable exactly.
  test('matches published times: London, Karachi convention, Hanafi Asr', () => {
    near(computeTimes(LONDON, 2026, 10, 5, 1), { fajr: '05:16', sunrise: '07:08', noon: '12:49', asr: '16:37', sunset: '18:29', isha: '20:21' })
  })

  test('matches published times: London, Muslim World League', () => {
    near(computeTimes({ ...LONDON, method: 'mwl' }, 2026, 10, 5, 1), { fajr: '05:16', isha: '20:14' })
  })

  test('matches published times: Makkah, Umm al-Qura, standard Asr', () => {
    const makkah: Config = { latitude: 21.4225, longitude: 39.8262, method: 'makkah', asr: 'standard', highLatitude: 'angle' }
    near(computeTimes(makkah, 2026, 10, 5, 3), { fajr: '04:57', sunrise: '06:13', noon: '12:09', asr: '15:33', sunset: '18:05', isha: '19:35' })
  })

  test('far north in summer: Fajr and Isha from a share of the night', () => {
    const helsinki: Config = { latitude: 60.17, longitude: 24.94, method: 'mwl', asr: 'hanafi', highLatitude: 'angle' }
    const t = computeTimes(helsinki, 2026, 6, 21, 3)
    near(t, { fajr: '02:23', sunrise: '03:54', noon: '13:22', asr: '19:24', sunset: '22:50' })
    // The sun never reaches 17° below: Isha is sunset plus 17/60 of the night (Aladhan prints 18/60 here).
    expect(Math.abs(t.isha - (t.sunset + (17 / 60) * (24 - (t.sunset - t.sunrise))))).toBeLessThan(1e-9)
    near(computeTimes({ ...helsinki, highLatitude: 'seventh' }, 2026, 6, 21, 3), { fajr: '03:11', isha: '23:33' })
  })

  test('helpers', () => {
    const at = new Date(2026, 9, 5, 12, 0)
    expect(until(new Date(2026, 9, 5, 12, 42), at)).toBe('42m')
    expect(until(new Date(2026, 9, 5, 13, 5), at)).toBe('1h 05m')
    expect(until(new Date(2026, 9, 5, 12, 0, 30), at)).toBe('1m') // rounds up: never "0m" before it ends
    expect(hhmm(new Date(2026, 9, 5, 7, 5))).toBe('07:05')
    expect(adjustFrom('Asr+2 isha -5 dhuhr+1 fajr 1.5')).toEqual({ asr: 2, isha: -5, dhuhr: 1, fajr: 1.5 })
    expect(adjustFrom('nonsense')).toEqual({})
    const moved = timesFor({ ...LONDON, adjust: { asr: 2 } }, new Date(2026, 9, 5, 12))
    expect(Math.round((moved.asr - timesFor(LONDON, new Date(2026, 9, 5, 12)).asr) * 60)).toBe(2)
  })

  // The status tests use this computer's own time zone, so they place `at` by the computed times.
  const day = new Date(2026, 9, 5, 12)
  const t = timesFor(LONDON, day)
  const at = (h: number) => atHours(day, h)
  const text = (s: ReturnType<typeof status>) => s.parts.map(p => p.text).join(' · ')

  test('in a prayer: its name, the time left, then the next prayer', () => {
    const s = status(LONDON, at(t.asr + 0.5))
    expect(s.current?.name).toBe('Asr')
    expect(text(s)).toMatch(/^🕌 Asr · \d+h \d+m left · next Maghrib \d\d:\d\d$/)
    expect(s.parts[1]!.color).toBe('green')
    const late = status(LONDON, at(t.isha - 10 / 60)) // Maghrib, 10 minutes left
    expect(late.current?.name).toBe('Maghrib')
    expect(late.parts[1]!.color).toBe('yellow')
  })

  test('the time left: green, yellow under 20 minutes, red under 5', () => {
    expect(status(LONDON, at(t.asr - 30 / 60)).parts[1]).toMatchObject({ color: 'green' })
    expect(status(LONDON, at(t.asr - 19 / 60)).parts[1]).toMatchObject({ color: 'yellow', bold: true })
    expect(status(LONDON, at(t.asr - 5 / 60)).parts[1]).toMatchObject({ color: 'yellow' })
    expect(status(LONDON, at(t.asr - 4 / 60)).parts[1]).toMatchObject({ text: '4m left', color: 'red', bold: true })
  })

  test('the deadline warning: at N minutes left, once per prayer, off at 0', () => {
    const due = (h: number, n = 15, warned = '') => deadlineDue(status(LONDON, at(h)), at(h), n, warned)
    expect(due(t.asr - 16 / 60)).toBeNull() // more than 15 minutes left
    const w = due(t.asr - 15 / 60)!
    expect(w.text).toBe(`⏳ Dhuhr ends in 15 min (${hhmm(at(t.asr))})`)
    expect(due(t.asr - 10 / 60, 15, w.key)).toBeNull() // already warned for this Dhuhr
    expect(due(t.asr - 3 / 60)?.text).toMatch(/^⏳ Dhuhr ends in 3 min/) // a session started late still hears it once
    expect(due(t.asr - 10 / 60, 0)).toBeNull()
    expect(due(t.asr - 10 / 60, 30)?.text).toMatch(/^⏳ Dhuhr ends in 10 min/)
    // Without makruh minutes, Asr warns before sunset; its key differs from Dhuhr's.
    const asr = due(t.sunset - 10 / 60, 15, w.key)!
    expect(asr.text).toBe(`⏳ Asr ends in 10 min (${hhmm(at(t.sunset))})`)
    expect(asr.key).not.toBe(w.key)
    expect(due(t.sunset - 10 / 60, 15, asr.key)).toBeNull()
    // With makruh minutes, Asr warns before they begin, not when the line already says not to pray.
    const early = (h: number) => deadlineDue(status(LONDON, at(h)), at(h), 15, '', 15)
    expect(early(t.sunset - 31 / 60)).toBeNull()
    expect(early(t.sunset - 30 / 60)?.text).toBe(`⏳ Asr: makruh in 15 min (${hhmm(at(t.sunset - 15 / 60))}), sunset ${hhmm(at(t.sunset))}`)
    // Between prayers there is nothing to warn about.
    expect(due(t.sunrise + 1)).toBeNull()
  })

  test('zawal: no prayer, a countdown, then Dhuhr', () => {
    const s = status(LONDON, at(t.noon - 2 / 60))
    expect(s.blocked?.name).toBe('!zawal')
    expect(text(s)).toMatch(/^⛔ Zawal · no prayer for \d+m · next Dhuhr \d\d:\d\d$/)
  })

  test('between sunrise and Dhuhr: Dhuhr is next, and when zawal starts', () => {
    const s = status(LONDON, at(t.sunrise + 1))
    expect(s.current).toBeUndefined()
    expect(text(s)).toMatch(/^🕌 Dhuhr in \d+h \d+m · zawal \d\d:\d\d$/)
  })

  test('the last minutes before sunset are makruh, and Asr still shows its time left', () => {
    const s = status(LONDON, at(t.sunset - 5 / 60))
    expect(s.current?.name).toBe('Asr')
    expect(text(s)).toMatch(/^⛔ Sunset near · Asr 5m left, makruh now · next Maghrib/)
  })

  test('after midnight, Isha runs until Fajr', () => {
    const s = status(LONDON, new Date(2026, 9, 6, 0, 30))
    expect(s.current?.name).toBe('Isha')
    expect(s.next.name).toBe('Fajr')
  })

  test('adjusting Dhuhr moves its start, not zawal', () => {
    const plain = timesFor(LONDON, day)
    const moved = timesFor({ ...LONDON, adjust: { dhuhr: 5 } }, day)
    expect(moved.noon).toBe(plain.noon)
    expect(Math.round((moved.dhuhr - plain.dhuhr) * 60)).toBe(5)
    const s = status({ ...LONDON, adjust: { dhuhr: 5 } }, atHours(day, plain.noon + 3 / 60)) // zawal over, Dhuhr not yet
    expect(s.current).toBeUndefined()
    expect(s.next.name).toBe('Dhuhr')
  })

  test('polar day: no sunrise or sunset, so it estimates from latitude 65° and says so', () => {
    const north: Config = { ...LONDON, latitude: 69.6, longitude: 18.9 }
    const t = computeTimes(north, 2026, 6, 21, 2)
    expect(t.estimated).toBe(true)
    for (const k of ['fajr', 'sunrise', 'noon', 'dhuhr', 'asr', 'sunset', 'isha'] as const) expect(Number.isFinite(t[k])).toBe(true)
    const s = status(north, new Date(2026, 5, 21, 12))
    expect(s.parts.map(p => p.text).join(' · ')).toMatch(/estimated/)
    expect(s.parts.map(p => p.text).join(' · ')).not.toMatch(/NaN|Invalid/)
  })

  test('every day of the year shows the wall-clock times of that day\'s own offset', () => {
    // On a daylight-saving day the times still match that day's clock (checked on any machine time zone).
    for (let d = new Date(2026, 0, 1, 12); d.getFullYear() === 2026; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)) {
      const zone = -d.getTimezoneOffset() / 60
      const local = computeTimes(LONDON, d.getFullYear(), d.getMonth() + 1, d.getDate(), zone)
      expect(hhmm(atHours(d, timesFor(LONDON, d).dhuhr))).toBe(clock(local.dhuhr))
    }
  })

  test('draws the line from its settings', { options: { latitude: 51.5074, longitude: -0.1278 } }, async ($, on) => {
    mock.clock(on, { now: Date.now() })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }))
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'prayer-times', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /🕌|⛔/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^(🕌|⛔)$/ })).toBeDefined() // the icon is its own plain Text
    expect(await band.find({ type: 'Text', text: 'band below' })).toBeDefined()
    await band.unmount()
    expect((await $.command.run({ command: 'prayers', args: '' } as any)).text).toMatch(/^Fajr \d\d:\d\d · Sunrise .* Isha \d\d:\d\d \(karachi, hanafi Asr\)$/)
  })

  test('one toast in the last 15 minutes of Dhuhr', { options: { latitude: 51.5074, longitude: -0.1278, warnMinutes: 15 } }, async ($, on) => {
    const clock = mock.clock(on, { now: at(t.asr - 20 / 60).getTime() })
    const toasts: string[] = []
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }))
    on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.advance(4 * MINUTE) // 16 minutes left: not yet
    expect(toasts.filter(x => x.startsWith('⏳'))).toEqual([])
    await clock.advance(12 * MINUTE) // through the last 15 minutes
    expect(toasts.filter(x => / ends in /.test(x))).toEqual([expect.stringMatching(/^⏳ Dhuhr ends in 1[45] min \(\d\d:\d\d\)$/)])
  })

  test('without a location it asks for one and computes nothing', async ($, on) => {
    mock.clock(on, { now: Date.now() })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }))
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'prayer-times', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /set your latitude and longitude in \/config/ })).toBeDefined()
    await band.unmount()
  })
})
