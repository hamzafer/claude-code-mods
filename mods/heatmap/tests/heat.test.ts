import { describe, expect, test } from 'claude-code/testing'

import {
  aggregate,
  buildView,
  dayLabel,
  duration,
  formatLedger,
  level,
  mergeLedger,
  monthLabels,
  parseLedger,
  parseTimes,
  projectName,
  rampFor,
  sessionDays,
  streaks,
  weeksFor,
} from '../hooks/heat'
import type { Row } from '../hooks/heat'

const UTC = () => 0
const t = (iso: string) => Date.parse(iso)
const min = (n: number) => n * 60_000
const zeros = () => new Array<number>(24).fill(0)
const row = (d: string, p: string, m: number, s = 1): Row => ({ d, p, n: p, min: m, s, h: zeros() })

describe('active minutes', () => {
  test('counts the time between messages, but not a pause over 5 minutes', () => {
    const start = t('2026-10-14T10:00:00Z')
    const times = [start, start + min(4), start + min(8), start + min(30), start + min(31)]
    const days = sessionDays(times, UTC)
    expect(Math.round(days.get('2026-10-14')!.ms / 60_000)).toBe(9) // 4 + 4 + (22 skipped) + 1
  })

  test('splits a counted gap at midnight', () => {
    const times = [t('2026-10-14T23:58:00Z'), t('2026-10-15T00:02:00Z')]
    const days = sessionDays(times, UTC)
    expect(days.get('2026-10-14')!.ms).toBe(min(2))
    expect(days.get('2026-10-15')!.ms).toBe(min(2))
  })

  test('uses local midnight, not UTC', () => {
    const cest = () => -120 // UTC is 2 hours behind local
    const times = [t('2026-10-14T21:58:00Z'), t('2026-10-14T22:02:00Z')] // 23:58 to 00:02 local
    const days = sessionDays(times, cest)
    expect(days.get('2026-10-14')!.ms).toBe(min(2))
    expect(days.get('2026-10-15')!.ms).toBe(min(2))
    expect(days.get('2026-10-15')!.hours[0]).toBe(min(2))
  })

  test('a lone message still marks the day', () => {
    const days = sessionDays([t('2026-10-14T10:00:00Z')], UTC)
    expect(days.get('2026-10-14')!.ms).toBe(0)
  })

  test('aggregates sessions per day per project', () => {
    const a = { p: 'proj-a', n: 'a', times: [t('2026-10-14T10:00:00Z'), t('2026-10-14T10:03:00Z')] }
    const b = { p: 'proj-a', n: 'a', times: [t('2026-10-14T12:00:00Z'), t('2026-10-14T12:02:00Z')] }
    const c = { p: 'proj-b', n: 'b', times: [t('2026-10-13T09:00:00Z'), t('2026-10-13T09:01:00Z')] }
    const rows = aggregate([a, b, c], UTC)
    expect(rows.map(r => [r.d, r.p, r.min, r.s])).toEqual([
      ['2026-10-13', 'proj-b', 1, 1],
      ['2026-10-14', 'proj-a', 5, 2],
    ])
    expect(rows[1]!.h[10]).toBe(3)
    expect(rows[1]!.h[12]).toBe(2)
    expect(aggregate([a, b, c], UTC, '2026-10-14').map(r => r.d)).toEqual(['2026-10-14'])
  })

  test('a resumed session copying earlier messages counts them once', () => {
    const early = [t('2026-10-14T10:00:00Z'), t('2026-10-14T10:04:00Z')]
    const original = { p: 'a', n: 'a', times: early }
    const resumed = { p: 'a', n: 'a', times: [...early, t('2026-10-15T09:00:00Z'), t('2026-10-15T09:02:00Z')] }
    const copy = { p: 'a', n: 'a', times: [...early] } // a resume that added nothing, listed first
    const rows = aggregate([copy, resumed, original], UTC)
    expect(rows.map(r => [r.d, r.min, r.s])).toEqual([
      ['2026-10-14', 4, 1],
      ['2026-10-15', 2, 1],
    ])
  })

  test('reads message times from grep output', () => {
    const out = '"timestamp":"2026-10-14T10:00:00.000Z"\n"timestamp":"not a date"\n"timestamp":"2026-10-14T10:01:00Z"\n'
    expect(parseTimes(out)).toEqual([t('2026-10-14T10:00:00Z'), t('2026-10-14T10:01:00Z')])
    expect(parseTimes('"timestamp": "2026-10-14T10:00:00Z"')).toEqual([t('2026-10-14T10:00:00Z')]) // spaced JSON too
  })
})

describe('ledger', () => {
  test('never rewrites days before the refresh window', () => {
    const old = [row('2026-09-01', 'a', 50), row('2026-10-14', 'a', 10)]
    const fresh = [row('2026-10-14', 'a', 40), row('2026-10-15', 'a', 5)]
    expect(mergeLedger(old, fresh, '2026-10-14').map(r => [r.d, r.min])).toEqual([
      ['2026-09-01', 50],
      ['2026-10-14', 40],
      ['2026-10-15', 5],
    ])
  })

  test('keeps an old row its logs no longer cover', () => {
    const old = [row('2026-09-01', 'a', 50), row('2026-09-01', 'b', 20)]
    const fresh = [row('2026-09-01', 'a', 55)]
    expect(mergeLedger(old, fresh, '2026-09-01').map(r => [r.p, r.min])).toEqual([
      ['a', 55],
      ['b', 20],
    ])
  })

  test('round-trips and skips malformed lines', () => {
    const rows = [row('2026-10-14', 'a', 10)]
    const text = formatLedger(rows) + 'not json\n{"d":"bad"}\n{"d":"2026-10-15","p":"b","min":3,"s":1}\n'
    const parsed = parseLedger(text)
    expect(parsed.length).toBe(2)
    expect(parsed[0]).toEqual(rows[0])
    expect(parsed[1]!.n).toBe('b') // a missing name falls back to the folder
    expect(parsed[1]!.h.length).toBe(24)
  })
})

describe('streaks', () => {
  test('runs back from today', () => {
    expect(streaks(new Set(['2026-10-13', '2026-10-14', '2026-10-15']), '2026-10-15')).toEqual({ current: 3, best: 3 })
  })

  test('counts up to yesterday while today has nothing yet', () => {
    expect(streaks(new Set(['2026-10-13', '2026-10-14']), '2026-10-15').current).toBe(2)
  })

  test('a gap breaks it, and the best run is kept', () => {
    const active = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-14'])
    expect(streaks(active, '2026-10-15')).toEqual({ current: 1, best: 4 })
    expect(streaks(new Set(['2026-10-10']), '2026-10-15')).toEqual({ current: 0, best: 1 })
  })
})

describe('the view', () => {
  const rows: Row[] = [
    { ...row('2026-10-13', 'here', 120, 2), h: Object.assign(zeros(), { 22: 100, 9: 20 }) },
    { ...row('2026-10-14', 'other', 30, 1), h: Object.assign(zeros(), { 10: 30 }) },
    row('2026-10-15', 'here', 10, 1),
    row('2025-01-01', 'here', 999, 1), // outside the weeks shown
  ]

  test('starts on a Monday and ends today', () => {
    const v = buildView(rows, { today: '2026-10-15', weeks: 2 })
    expect(v.start).toBe('2026-10-05')
    expect(v.days.length).toBe(11)
    expect(v.days[v.days.length - 1]!.d).toBe('2026-10-15')
  })

  test('totals, peaks and top projects for the weeks shown', () => {
    const v = buildView(rows, { today: '2026-10-15', weeks: 2 })
    expect(v.totalMin).toBe(160)
    expect(v.sessions).toBe(4)
    expect(v.peakDay).toBe(1) // Tuesday 13 Oct
    expect(v.peakHour).toBe(22)
    expect(v.top.map(x => x.name)).toEqual(['here', 'other'])
    expect(Math.abs(v.top[0]!.share - 130 / 160) < 1e-9).toBe(true)
    expect(v.streak).toEqual({ current: 3, best: 3 })
  })

  test('one project keeps its own rows and has no top list', () => {
    const v = buildView(rows, { today: '2026-10-15', weeks: 2, project: 'here' })
    expect(v.totalMin).toBe(130)
    expect(v.top).toEqual([])
    expect(v.streak.current).toBe(1)
  })

  test('an empty ledger draws an empty grid', () => {
    const v = buildView([], { today: '2026-10-15', weeks: 1 })
    expect(v.days.length).toBe(4)
    expect(v.peakDay).toBe(null)
    expect(v.peakHour).toBe(null)
    expect(v.streak).toEqual({ current: 0, best: 0 })
  })
})

describe('layout', () => {
  test('fits weeks to the width, up to a year', () => {
    expect(weeksFor(200)).toBe(52)
    expect(weeksFor(80)).toBe(38)
    expect(weeksFor(50)).toBe(23)
    expect(weeksFor(3)).toBe(1)
  })

  test('shades by active minutes', () => {
    expect([level(0, 0), level(0, 1), level(14, 1), level(15, 1), level(60, 1), level(180, 1)]).toEqual([0, 1, 1, 2, 3, 4])
  })

  test('labels months over the week holding the 1st', () => {
    const labels = monthLabels('2026-09-07', 6) // weeks of Sep 7, 14, 21, 28, Oct 5, 12
    expect(labels).toBe('      Oct')
  })

  test('picks a ramp from the saved theme; Auto or unknown gets one that reads on both', () => {
    expect([rampFor('dark'), rampFor('dark-daltonized'), rampFor('light'), rampFor('light-ansi')]).toEqual(['dark', 'dark', 'light', 'light'])
    expect([rampFor('auto'), rampFor(undefined), rampFor(42), rampFor('')]).toEqual(['auto', 'auto', 'auto', 'auto'])
  })

  test('formats durations, days and names', () => {
    expect([duration(0), duration(47), duration(60), duration(192)]).toEqual(['0m', '47m', '1h', '3h 12m'])
    expect(dayLabel('2026-10-14')).toBe('Wed 14 Oct')
    expect(projectName('/home/me/code/mods', 'x')).toBe('mods')
    expect(projectName(null, '-home-me-code-mods')).toBe('-home-me-code-mods')
  })
})
