// Heatmap: a GitHub-style grid of your Claude Code time, in a /heatmap pane.
// It keeps its own daily ledger, so the grid outlives Claude Code's log cleanup.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GridProps } from './grid'
import {
  MILESTONES,
  addDays,
  aggregate,
  buildView,
  dayOf,
  duration,
  formatLedger,
  hourLabel,
  localOffset,
  mergeLedger,
  monthLabels,
  parseLedger,
  parseTimes,
  projectName,
  rampFor,
  thousands,
  weekdayName,
  weeksFor,
} from './heat'
import type { Ramp, Row, SessionLog } from './heat'
import type { Scope } from '../types'

const PANE = 'heatmap'
const GRID = 'grid'
const TOASTED_KEY = 'toastedDay'
const GREP_BATCH = 8 // logs read at once
const BAR_COLUMNS = 12

// Held by the host, so a hot reload keeps the pane's scope.
const scope = atom({ plugin: 'heatmap', key: 'scope' } as const, 'all' as Scope)
const version = atom({ plugin: 'heatmap', key: 'version' } as const, 0) // bumped when the ledger changes
const isLoading = atom({ plugin: 'heatmap', key: 'isLoading' } as const, false)

// The ledger as last read or written; a hot reload starts over and reads it again.
let rows: Row[] | null = null
let refreshing: Promise<void> | null = null
let ramp: Ramp | null = null // from the person's theme, read once
let failure: string | null = null // why the last refresh failed, shown while there are no rows

export const register: Register = on => {
  let here = '' // this session's project folder

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    here = projectFolder(await $.session.root())
    await $.command.register({ name: 'heatmap', description: 'A GitHub-style grid of your Claude Code time' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    void (async () => {
      await refresh($)
      await milestoneToast($, rows ?? [])
    })()
    return r
  })

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('command.run', { command: 'heatmap' }, async $ => {
    await update($, isLoading, () => rows === null)
    await $.ui.open({ id: PANE, title: 'Heatmap', focus: true })
    void refresh($).then(() => update($, isLoading, () => false)) // today stays current mid-session
    return { text: 'Opened the heatmap' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Client } = $.ui.resolve(e)
    await read($, version) // redraw when the ledger changes
    const which = await read($, scope)
    const close = <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />

    if (rows === null) {
      if (failure) {
        return (
          <Box flexDirection="column">
            <Text color="error">{`Could not read your session history: ${failure}`}</Text>
            {close}
          </Box>
        )
      }
      if (!(await read($, isLoading))) void refresh($) // a hot reload dropped the rows
      return (
        <Box flexDirection="column">
          <Text dimColor>Reading your session history… the first time takes a few seconds.</Text>
          {close}
        </Box>
      )
    }
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return <Text dimColor>The heatmap draws in the terminal or desktop app.</Text>
    }

    const today = dayOf(Date.now(), localOffset)
    const weeks = weeksFor(e.props.bodyColumns)
    const isHere = which === 'here'
    const v = buildView(rows, { today, weeks, project: isHere ? here : undefined })
    const hereName = rows.find(r => r.p === here)?.n ?? 'this repo'
    const grid: GridProps = {
      weeks,
      start: v.start,
      cells: v.days.map(d => [d.min, d.s, d.top]),
      months: monthLabels(v.start, weeks),
      labels: v.days.map(d => d.d),
      ramp: (ramp ??= await themeRamp($)),
    }
    const toggle = () => update($, scope, s => (s === 'all' ? 'here' : 'all'))

    const stats = [`🔥 ${v.streak.current}-day streak · best ${v.streak.best}`, `${hours(v.totalMin)} active · ${thousands(v.sessions)} session${v.sessions === 1 ? '' : 's'}`]
    const peak = [v.peakDay === null ? null : weekdayName(v.peakDay), v.peakHour === null ? null : hourLabel(v.peakHour)].filter(Boolean).join(' · ')
    const nameWidth = Math.min(16, Math.max(0, ...v.top.map(t => t.name.length)))

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color="claude">{'Heatmap'}</Text>
          <Text>{` · ${isHere ? hereName : 'all projects'}`}</Text>
          <Text dimColor>{`  [p] ${isHere ? 'all projects' : 'this repo'}`}</Text>
        </Text>
        <Text> </Text>
        <Client key={GRID} module="./grid.tsx" props={grid} width={Math.max(1, e.props.bodyColumns)} height={12} />
        <Text> </Text>
        <Text wrap="truncate-end">{stats.join('   ')}</Text>
        {peak ? <Text dimColor>{`peak: ${peak}`}</Text> : null}
        {v.top.length > 0 ? <Text> </Text> : null}
        {v.top.map(t => (
          <Text wrap="truncate-end">
            <Text>{fit(t.name, nameWidth).padEnd(nameWidth + 1)}</Text>
            <Text color="claude">{'■'.repeat(Math.max(1, Math.round(t.share * BAR_COLUMNS)))}</Text>
            <Text dimColor>{` ${Math.round(t.share * 100)}% · ${duration(t.min)}`}</Text>
          </Text>
        ))}
        <Box flexDirection="row" gap={1}>
          <Button key="scope" label={isHere ? 'All projects' : 'This repo'} hotkey="p" onPress={toggle} />
          {close}
        </Box>
      </Box>
    )
  })

  // The grid posts its keys: p switches the scope, q closes.
  on('ui.message', async ($, e) => {
    if (e.element !== GRID) return {}
    const data = e.data as { scope?: unknown; close?: unknown }
    if (data?.scope === 'toggle') await update($, scope, s => (s === 'all' ? 'here' : 'all'))
    if (data?.close === true) await $.ui.close({ id: PANE })
    return {}
  })
}

/** One refresh at a time; a second caller waits on the first. */
function refresh($: EngineInterface): Promise<void> {
  refreshing ??= (async () => {
    try {
      rows = await refreshLedger($)
      failure = null
    } catch (err) {
      failure = String(err instanceof Error ? err.message : err)
      $.ui.log(`heatmap: could not read the session logs: ${failure}`, { to: 'debug' })
    } finally {
      refreshing = null
      await update($, version, v => v + 1)
    }
  })()
  return refreshing
}

/** The ramp for the saved theme; Claude Code keeps it in .claude.json. Auto, or unreadable: the ramp that reads on both. */
async function themeRamp($: EngineInterface): Promise<Ramp> {
  try {
    const custom = await $.env.get('CLAUDE_CONFIG_DIR')
    const file = custom ? `${custom.replace(/\/+$/, '')}/.claude.json` : `${await $.env.get('HOME')}/.claude.json`
    return rampFor((JSON.parse(await $.fs.read(file)) as { theme?: unknown }).theme)
  } catch {
    return 'auto'
  }
}

/** <projects folder>/<this>: the project root with each other character a dash, as Claude Code names it. */
function projectFolder(root: string) {
  return root.replace(/[^a-zA-Z0-9]/g, '-')
}

/** 412h past ten hours, 3h 12m below. */
function hours(min: number) {
  return min >= 600 ? `${thousands(Math.round(min / 60))}h` : duration(min)
}

function fit(name: string, width: number) {
  return name.length <= width ? name : `${name.slice(0, Math.max(0, width - 1))}…`
}

async function configDir($: EngineInterface) {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/\/+$/, '')
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set, so the Claude config folder is unknown.')
  return `${home}/.claude`
}

/**
 * Reads the ledger and brings it up to date from the session logs. With no ledger
 * (or an empty one) it backfills every day the logs hold. After that it replaces
 * the days from the ledger's last day (yesterday at the latest) on, reading only
 * logs touched since, so older days stay as they were.
 */
async function refreshLedger($: EngineInterface): Promise<Row[]> {
  const dir = await configDir($)
  const file = `${dir}/heatmap/days.jsonl`
  const parsed = (await $.fs.exists(file)) ? parseLedger(await $.fs.read(file)) : []
  const old = parsed.length > 0 ? parsed : null // an empty or broken ledger backfills again
  const yesterday = addDays(dayOf(Date.now(), localOffset), -1)
  const last = old ? old[old.length - 1]!.d : '' // rows are sorted by day
  const fromDay = old === null ? '' : last < yesterday ? last : yesterday
  const since = old === null ? 0 : Date.parse(`${addDays(fromDay, -1)}T00:00:00`) // local midnight, a day early for any clock shift

  const logs = await readLogs($, `${dir}/projects`, since)
  const merged = mergeLedger(old ?? [], aggregate(logs, localOffset, fromDay), fromDay)
  await $.fs.write(file, formatLedger(merged))
  return merged
}

/** The session logs touched since `since`: each one's project and message times, read with grep (logs can pass the 4 MiB read limit). */
async function readLogs($: EngineInterface, projects: string, since: number): Promise<SessionLog[]> {
  if (!(await $.fs.exists(projects))) return []
  const jobs: { folder: string; path: string }[] = []
  for (const folder of await $.fs.list(projects)) {
    if (folder.kind !== 'dir') continue
    const files = await $.fs.list(`${projects}/${folder.name}`).catch(() => [])
    for (const f of files) {
      if (f.kind === 'file' && f.name.endsWith('.jsonl') && f.mtimeMs >= since) jobs.push({ folder: folder.name, path: `${projects}/${folder.name}/${f.name}` })
    }
  }

  const names = new Map<string, string>()
  const logs: SessionLog[] = []
  for (let i = 0; i < jobs.length; i += GREP_BATCH) {
    await Promise.all(
      jobs.slice(i, i + GREP_BATCH).map(async job => {
        if (!names.has(job.folder)) {
          const cwd = await firstCwd($, job.path)
          if (cwd) names.set(job.folder, projectName(cwd, job.folder)) // a log without one leaves the next log to say
        }
        const r = await $.process.run(['grep', '-oE', '"timestamp": *"[0-9]{4}-[^"]*"', '--', job.path], { timeoutMs: 60_000 }).catch(() => null)
        if (!r) return
        if (r.isStdoutTruncated) $.ui.log(`heatmap: ${job.path} has more messages than one read holds; its latest are left out`, { to: 'debug' })
        const times = parseTimes(r.stdout)
        if (times.length > 0) logs.push({ p: job.folder, n: names.get(job.folder) ?? job.folder, times })
      }),
    )
  }
  return logs
}

async function firstCwd($: EngineInterface, path: string): Promise<string | null> {
  const r = await $.process.run(['grep', '-m1', '-oE', '"cwd": *"[^"]*"', '--', path], { timeoutMs: 30_000 }).catch(() => null)
  const m = r?.stdout.match(/"cwd": *"([^"]*)"/)
  return m ? m[1]!.replace(/\\\\/g, '\\') : null
}

/** One toast per streak as it reaches 7, 30 or 100 days. */
async function milestoneToast($: EngineInterface, rows: readonly Row[]) {
  const today = dayOf(Date.now(), localOffset)
  const { streak } = buildView(rows, { today, weeks: 1 })
  if (!MILESTONES.includes(streak.current)) return
  // The streak and the milestone together: the next day, before any activity, it still reads the same.
  const last = rows.some(r => r.d === today && (r.s > 0 || r.min > 0)) ? today : addDays(today, -1)
  const mark = `${addDays(last, 1 - streak.current)}:${streak.current}`
  if ((await $.store.get(TOASTED_KEY).catch(() => undefined)) === mark) return
  await $.store.set(TOASTED_KEY, mark)
  $.ui.toast(`🔥 ${streak.current}-day Claude streak · /heatmap`)
}
