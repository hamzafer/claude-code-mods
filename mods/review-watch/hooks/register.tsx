// Review Watch: is my code review still running?
//   The band above the prompt has one live line per running review: a `codex review`
//   shell command or a subagent whose description says "review". It shows the model, what
//   is under review, the time, and Codex's latest output line. When a review ends a toast
//   says so, with the findings Codex reported, and its line shows a check for 30 s.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Review } from '../types'

const SHOW_DONE_MS = 30_000 // a finished review stays in the band this long
const BAND_ROWS = 4
const POLL_MS = 3_000
const UNSEEN_POLLS = 3 // a review whose process never shows up in ps is over after this many polls

// Held by the host, so the reviews survive a hot reload of this file.
const reviews = atom({ plugin: 'review-watch', key: 'reviews' } as const, [] as Review[])
const now = atom({ plugin: 'review-watch', key: 'now' } as const, 0)

export const register: Register = on => {
  let cwd = ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = e.cwd
    // A clock for the elapsed times, ticking only while something shows.
    $.clock.every(1000, () => {
      void (async () => {
        if ((await read($, reviews)).some(v => isShown(v, Date.now() - 3_000))) await update($, now, () => Date.now())
      })().catch(() => {})
    })
    $.clock.every(POLL_MS, () => void poll($).catch(() => {}))
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isCodexReview(e.command)) return next(e)
    const id = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const one: Review = {
      id,
      kind: 'codex',
      model: modelOf(e.command) ?? (await configModel($)),
      label: labelOf(e.command),
      status: 'running',
      startedAt: Date.now(),
      key: keyOf(e.command),
      out: outputOf(e.command, cwd),
      polls: 0,
      last: 'starting',
    }
    await update($, reviews, list => [one, ...list].slice(0, 20))
    const r = await next(e)
    if (r.deny || r.isError || !e.run_in_background) {
      await finish($, id, Boolean(r.deny || r.isError)) // it ran in the foreground: it is over
    } else if (!one.out) {
      const path = /written to: (\S+\.output)/.exec(r.text ?? '')?.[1] // where Claude Code keeps a background shell's output
      if (path) await update($, reviews, list => list.map(v => (v.id === id ? { ...v, out: path } : v)))
    }
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId && /review/i.test(e.description ?? '')) {
      const one: Review = { id: r.agentId, kind: 'agent', model: e.model || r.model || 'inherit', label: e.description, status: 'running', startedAt: Date.now(), last: e.subagentType }
      await update($, reviews, list => [one, ...list.filter(v => v.id !== one.id)].slice(0, 20))
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) await finish($, e.agentId, e.reason === 'error' || e.reason === 'aborted')
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    await read($, now) // subscribes the band to the clock
    const shown = (await read($, reviews)).filter(v => isShown(v))
    if (e.props.hasSurvey || shown.length === 0) return rest
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {shown.slice(0, BAND_ROWS).map(v => (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={color(v)} bold>{` ${icon(v)} ${v.kind === 'codex' ? 'codex' : 'agent'}`}</Text>
              <Text>{` · ${v.model} · ${v.label}`}</Text>
              {v.status !== 'running' && v.findings && <Text bold>{` · ${findingsText(v.findings)}`}</Text>}
              <Text dimColor>{`  ${elapsed(v)}`}</Text>
            </Text>
            {v.status === 'running' && v.kind === 'codex' && v.last !== '' && (
              <Text dimColor wrap="truncate-end">{`    └ ${v.last}`}</Text>
            )}
          </Box>
        ))}
        {shown.length > BAND_ROWS && <Text dimColor>{`   +${shown.length - BAND_ROWS} more`}</Text>}
        {rest}
      </Box>
    )
  })
}

// Checks each running Codex review: is its process still there, and what did it print last.
async function poll($: EngineInterface) {
  const running = (await read($, reviews)).filter(v => v.kind === 'codex' && v.status === 'running')
  if (running.length === 0) return
  const ps = await $.process.run(['ps', '-axww', '-o', 'command='], { timeoutMs: 5_000 })
  if (ps.exitCode !== 0) return
  const lines = ps.stdout.split('\n').filter(l => isCodexReview(l))
  for (const v of running) {
    const isAlive = lines.some(l => l.includes(v.key ?? 'codex'))
    const polls = (v.polls ?? 0) + 1
    if (!isAlive && (v.seen || polls >= UNSEEN_POLLS)) {
      await finish($, v.id, false)
      continue
    }
    const last = v.out ? await lastLine($, v.out) : v.last
    await update($, reviews, list => list.map(x => (x.id === v.id ? { ...x, polls, seen: x.seen || isAlive, last } : x)))
  }
}

async function finish($: EngineInterface, id: string, failed: boolean) {
  const v = (await read($, reviews)).find(x => x.id === id)
  if (!v || v.status !== 'running') return
  const findings = v.kind === 'codex' && v.out && !failed ? findingsOf(await tail($, ['-c', '40000', v.out])) : undefined
  const done: Review = { ...v, status: failed ? 'failed' : 'done', endedAt: Date.now(), findings }
  await update($, reviews, list => list.map(x => (x.id === id ? done : x)))
  const what = v.kind === 'codex' ? `codex review (${v.model})` : `${v.label} (${v.model})`
  const extra = findings ? ` · ${findingsText(findings)}` : ''
  $.ui.toast(`${failed ? '✗' : '✓'} ${what} ${failed ? 'stopped' : 'done'} · ${elapsed(done)}${extra}`)
}

async function tail($: EngineInterface, args: string[]) {
  const r = await $.process.run(['tail', ...args], { timeoutMs: 5_000 }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout : ''
}

async function lastLine($: EngineInterface, file: string) {
  const lines = clean(await tail($, ['-n', '30', file])).split('\n').map(l => l.trim()).filter(Boolean)
  return lines.at(-1)?.slice(0, 200) ?? ''
}

// The model from ~/.codex/config.toml, for a review run without one on its command line.
async function configModel($: EngineInterface) {
  const r = await $.process
    .run(['sh', '-c', 'grep -E "^model *=" "$HOME/.codex/config.toml" | head -n 1'], { timeoutMs: 3_000 })
    .catch(() => null)
  return (r && /=\s*["']?([\w.:-]+)/.exec(r.stdout)?.[1]) || 'default'
}

// True for a command that runs `codex review`, flags before `review` allowed.
export function isCodexReview(command: string) {
  return /(?:^|[\s;&|(/])codex\s+(?:\S+\s+){0,4}?review(?:\s|$)/.test(command)
}

export function modelOf(command: string) {
  return /model\s*=\s*\\?["']?([\w.:-]+)/.exec(command)?.[1] ?? /(?:--model|-m)[\s=]+["']?([\w.:-]+)/.exec(command)?.[1]
}

export function labelOf(command: string) {
  const title = /--title[\s=]+(["'])(.*?)\1/.exec(command)?.[2]
  if (title) return title
  const commit = /--commit[\s=]+["']?(\w+)/.exec(command)?.[1]
  if (commit) return `commit ${commit.slice(0, 7)}`
  const base = /--base[\s=]+["']?([^\s"']+)/.exec(command)?.[1]
  return base ? `changes vs ${base}` : 'uncommitted changes'
}

// What finds this review's process in ps: its title, or else any codex review.
function keyOf(command: string) {
  return /--title[\s=]+(["'])(.*?)\1/.exec(command)?.[2] || 'codex'
}

// The file the review's stdout goes to (`> file`), resolved against the session's folder.
export function outputOf(command: string, cwd: string) {
  const at = command.search(/codex\s/)
  const re = /(\d|&)?>>?\s*(["']?)([^\s"'&|;<>]+)\2/g
  for (const m of command.slice(Math.max(0, at)).matchAll(re)) {
    if (m[1] === '2' || m[3]!.startsWith('&')) continue
    const path = m[3]!
    if (path === '/dev/null') return undefined
    return path.startsWith('/') || path.startsWith('~') || !cwd ? path : `${cwd}/${path}`
  }
  return undefined
}

// Codex ends with a "Full review comments:" block of `- [P2] title — file:line` items.
export function findingsOf(text: string) {
  const at = text.lastIndexOf('Full review comments:')
  const part = at >= 0 ? text.slice(at) : text.slice(-4000)
  return [...part.matchAll(/^\s*-\s*\[(P\d)\]/gm)].map(m => m[1]!)
}

export function findingsText(findings: string[]) {
  if (findings.length === 0) return 'no findings'
  return `${findings.length} finding${findings.length === 1 ? '' : 's'} (${findings.join(', ')})`
}

export function isShown(v: Pick<Review, 'status' | 'endedAt'>, at = Date.now()) {
  return v.status === 'running' || at - (v.endedAt ?? 0) < SHOW_DONE_MS
}

export function elapsed(v: Pick<Review, 'startedAt' | 'endedAt'>) {
  const s = Math.max(0, Math.round(((v.endedAt ?? Date.now()) - v.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function clean(text: string) {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

function icon(v: Review) {
  return v.status === 'running' ? '⏳' : v.status === 'done' ? '✅' : '✗'
}

function color(v: Review) {
  return v.status === 'running' ? 'cyan' : v.status === 'done' ? 'green' : 'red'
}
