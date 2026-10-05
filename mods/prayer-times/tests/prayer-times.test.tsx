import { describe, expect, mock, test } from 'claude-code/testing'

import { adjustFrom, computeTimes, hhmm, status, timesFor, until } from '../hooks/register'
import type { Config, Times } from '../hooks/register'

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
    expect(adjustFrom('Asr+2 isha -5 dhuhr+1')).toEqual({ asr: 2, isha: -5, noon: 1 })
    expect(adjustFrom('nonsense')).toEqual({})
    const moved = timesFor({ ...LONDON, adjust: { asr: 2 } }, new Date(2026, 9, 5, 12))
    expect(Math.round((moved.asr - timesFor(LONDON, new Date(2026, 9, 5, 12)).asr) * 60)).toBe(2)
  })

  // The status tests use this computer's own time zone, so they place `at` by the computed times.
  const day = new Date(2026, 9, 5, 12)
  const t = timesFor(LONDON, day)
  const at = (h: number) => new Date(new Date(2026, 9, 5).getTime() + Math.round(h * 60) * 60_000)
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

  test('draws the line from its settings', { options: { latitude: 51.5074, longitude: -0.1278 } }, async ($, on) => {
    mock.clock(on, { now: Date.now() })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }))
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const band = await $.ui.mount({ plugin: 'prayer-times', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /🕌|⛔/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'band below' })).toBeDefined()
    await band.unmount()
    expect((await $.command.run({ command: 'prayers', args: '' } as any)).text).toMatch(/^Fajr \d\d:\d\d · Sunrise .* Isha \d\d:\d\d \(karachi, hanafi Asr\)$/)
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
