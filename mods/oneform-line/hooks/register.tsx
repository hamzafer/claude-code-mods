// OneForm Line: your OneForm day above the prompt, and /oneform for the whole of it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OneFormDay, OneFormPlanItem, OneFormToday } from '../types'

const EVERY_MS = 10 * 60 * 1000
const PLAN_LABEL: Record<string, string> = {
  strength: 'Strength',
  run: 'Run',
  long_run: 'Long run',
  recovery: 'Recovery',
  travel: 'Travel',
}
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Held by the host, so the day survives a hot reload of this file.
const day = atom({ plugin: 'oneform-line', key: 'day' } as const, { today: null, plan: [], fetchedAt: 0, error: null } as OneFormDay)
const triedAt = atom({ plugin: 'oneform-line', key: 'triedAt' } as const, 0)

export const register: Register = (on, options) => {
  const url = String(options.url ?? '').replace(/\/+$/, '')
  const key = String(options.key ?? '')
  const isSetUp = url !== '' && key !== ''

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'oneform', description: 'Your OneForm day: meals, training, check-in and the week ahead' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    if (isSetUp) await refresh($, url, key, false)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (isSetUp && !e.agentId) await refresh($, url, key, false) // main-loop turns only, not subagents
    return result
  })

  on('command.run', { command: 'oneform' }, async $ => {
    if (!isSetUp) return { text: SETUP }
    await refresh($, url, key, true)
    return { text: fullDay(await read($, day)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const now = await read($, day)
    if (e.props.hasSurvey || !isSetUp) return rest

    const { Box, Text } = $.ui.resolve(e)
    if (now.error === 'key') {
      return (
        <Box flexDirection="column">
          <Box paddingX={1}><Text color="red">💪 OneForm: key rejected</Text></Box>
          {rest}
        </Box>
      )
    }

    const bits = pieces(now, e.props.bodyColumns >= 60)
    if (bits.length === 0) return rest

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          <Text>{'💪 '}</Text>
          {bits.map((b, i) => (
            <Text key={String(i)} color={b.color} dimColor={!b.color}>{(i > 0 ? ' · ' : '') + b.text}</Text>
          ))}
          {now.error === 'network' && now.fetchedAt > 0 && <Text dimColor>{` · as of ${clock(now.fetchedAt)}`}</Text>}
        </Box>
        {rest}
      </Box>
    )
  })
}

const SETUP = [
  'OneForm Line is not set up yet. It needs two settings:',
  '',
  '- **url**: where your OneForm runs',
  '- **key**: a OneForm client key, e.g. from `pnpm keys:create claude-code-band`',
  '',
  'Set them in `/config` (the key goes to secure storage), then restart the session.',
].join('\n')

// At most once every 10 minutes, unless /oneform asked.
async function refresh($: EngineInterface, url: string, key: string, isForced: boolean) {
  const now = await $.clock.now()
  if (!isForced && now - (await read($, triedAt)) < EVERY_MS) return
  await update($, triedAt, () => now)

  try {
    const [today, plan] = await Promise.all([
      call($, url, key, 'get_today', {}),
      call($, url, key, 'get_plan', { window: '7d' }),
    ])
    await update($, day, () => ({ today, plan: plan.plan_items ?? [], fetchedAt: now, error: null }))
  } catch (err) {
    const error: OneFormDay['error'] = err instanceof KeyRejected ? 'key' : 'network'
    await update($, day, d => ({ ...d, error }))
  }
}

class KeyRejected extends Error {}

async function call($: EngineInterface, url: string, key: string, tool: string, input: object) {
  const res = await $.http.fetch(`${url}/api/tools/${tool}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (res.status === 401) throw new KeyRejected()
  if (!res.ok) throw new Error(`${tool}: ${res.status}`)
  return JSON.parse(res.text)
}

type Piece = { text: string; color?: string }

function pieces({ today, plan }: OneFormDay, isWide: boolean): Piece[] {
  const out: Piece[] = []
  const next = nextSession(plan, today?.logical_date)

  if (today?.sleep_hours != null) {
    const isShort = today.sleep_hours < today.targets.sleep_hours
    out.push({ text: `🌙 ${hours(today.sleep_hours)}/${hours(today.targets.sleep_hours)}`, color: isShort ? 'yellow' : 'white' })
  }
  if (today && today.meals.length > 0) {
    const p = today.remaining.protein
    out.push(p > 0 ? { text: `🍗 ${p}g protein left`, color: 'white' } : { text: `🍗 +${-p}g over`, color: 'green' })
    if (isWide) {
      const c = today.remaining.calories
      out.push(c >= 0 ? { text: `🔥 ${num(c)} kcal left`, color: 'white' } : { text: `🔥 ${num(-c)} kcal over`, color: 'yellow' })
    }
  }
  if (isWide && today) {
    for (const a of today.activities.slice(0, 2)) {
      out.push({ text: `🏃 ${a.strava_sport_type ?? a.name} ${Math.round(a.moving_time_s / 60)}m`, color: 'cyan' })
    }
    if (today.workout && today.workout.sets_count > 0) {
      const live = today.workout.status === 'in_progress' ? ' (live)' : ''
      out.push({ text: `🏋️ ${today.workout.sets_count} sets${live}`, color: 'cyan' })
    }
  }
  if (next && today) out.push({ text: `📅 ${PLAN_LABEL[next.type] ?? next.type} ${when(next.logical_date, today.logical_date)}` })
  return out
}

// The first plan item from today on that nothing has done yet.
function nextSession(plan: OneFormPlanItem[], todayDate: string | undefined) {
  if (!todayDate) return undefined
  return plan
    .filter(i => i.logical_date >= todayDate && i.status === 'planned' && i.satisfied_by === null)
    .sort((a, b) => a.logical_date.localeCompare(b.logical_date))[0]
}

function when(date: string, todayDate: string) {
  const days = Math.round((Date.parse(date) - Date.parse(todayDate)) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]
}

function fullDay({ today, plan, error, fetchedAt }: OneFormDay) {
  if (error === 'key') return 'OneForm refused the key (401). Check the **key** setting in `/config`.'
  if (!today) return "Couldn't reach OneForm, and there's no earlier answer to show."
  const lines: string[] = [`## OneForm, ${today.logical_date}`]
  if (error === 'network') lines.push(`_Couldn't reach OneForm. This is from ${clock(fetchedAt)}._`)

  lines.push('', '**Food**')
  if (today.meals.length === 0) lines.push('- nothing logged yet')
  for (const m of today.meals) lines.push(`- ${m.description}: ${m.protein_estimate}g protein, ${num(m.calories_estimate)} kcal`)
  lines.push(`- **total** ${today.totals.protein_estimate}/${today.targets.protein_g}g protein, ${num(today.totals.calories_estimate)}/${num(today.targets.calories_kcal)} kcal`)

  lines.push('', '**Training**')
  if (today.activities.length === 0 && !today.workout) lines.push('- nothing yet')
  for (const a of today.activities) lines.push(`- ${a.strava_sport_type ?? a.name}, ${Math.round(a.moving_time_s / 60)} min`)
  if (today.workout) lines.push(`- workout ${today.workout.status.replace('_', ' ')}, ${today.workout.sets_count} sets`)

  const checkin = [
    today.sleep_hours != null && `sleep ${hours(today.sleep_hours)}`,
    today.energy != null && `energy ${today.energy}`,
    today.soreness != null && `soreness ${today.soreness}`,
    today.stress != null && `stress ${today.stress}`,
  ].filter(Boolean)
  lines.push('', '**Check-in**', checkin.length ? `- ${checkin.join(', ')}` : '- nothing logged yet')

  const week = plan.filter(i => i.logical_date >= today.logical_date).sort((a, b) => a.logical_date.localeCompare(b.logical_date))
  lines.push('', '**Next 7 days**')
  if (week.length === 0) lines.push('- nothing planned')
  for (const i of week) {
    const isDone = i.satisfied_by !== null || i.status === 'done'
    const mark = isDone ? '✅' : i.status === 'planned' ? '⬜' : `(${i.status})`
    lines.push(`- ${mark} ${when(i.logical_date, today.logical_date)}: ${PLAN_LABEL[i.type] ?? i.type}${i.notes ? `, ${i.notes}` : ''}`)
  }
  return lines.join('\n')
}

function hours(h: number) {
  const total = Math.round(h * 60)
  const whole = Math.floor(total / 60)
  const min = total % 60
  return min === 0 ? `${whole}h` : `${whole}h${String(min).padStart(2, '0')}`
}

function num(n: number) {
  return Math.round(n).toLocaleString('en-US')
}

function clock(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
