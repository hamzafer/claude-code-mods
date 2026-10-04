// Review Watch: is my code review still running?
//   The band above the prompt has one live line per running review: a `codex review`
//   shell command or a subagent whose description says "review". It shows the model, what
//   is under review, the time, and Codex's latest output line. When a review ends a toast
//   says so, with the findings Codex reported, and its line shows a check for 30 s.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Review } from '../types'

const SHOW_DONE_MS = 30_000 // a finished review stays in the band this long
const BAND_ROWS = 4
const POLL_MS = 3_000
const UNSEEN_POLLS = 3 // a review whose process never shows up in ps is over after this many polls

// Held by the host, so the reviews survive a hot reload of this file.
const reviews = atom({ plugin: 'review-watch', key: 'reviews' } as const, [] as Review[])
const now = atom({ plugin: 'review-watch', key: 'now' } as const, 0)

let isPolling = false // a slow ps must not let two polls overlap

export const register: Register = on => {
  let cwd = ''
  let timers: Timer[] = []

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = e.cwd
    // A review agent that is no longer running (a resumed or new session) has no line to keep.
    const live = new Set((await $.agent.list().catch(() => [])).filter(a => a.status === 'running').map(a => a.id))
    await update($, reviews, list => list.filter(v => v.kind === 'codex' || v.status !== 'running' || live.has(v.id)))
    for (const t of timers) t.cancel()
    timers = []
    // A clock for the elapsed times, ticking only while something shows.
    timers.push($.clock.every(1000, () => {
      void (async () => {
        if ((await read($, reviews)).some(v => isShown(v, Date.now() - 3_000))) await update($, now, () => Date.now())
      })().catch(() => {})
    }))
    timers.push($.clock.every(POLL_MS, () => void poll($).catch(() => {})))
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
      out: outputOf(e.command, cwd, (await $.env.get('HOME').catch(() => undefined)) ?? ''),
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
    if (r.agentId && isReviewAgent(e.description ?? '')) {
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
  if (isPolling) return
  isPolling = true
  try {
    await pollOnce($)
  } finally {
    isPolling = false
  }
}

async function pollOnce($: EngineInterface) {
  const running = (await read($, reviews)).filter(v => v.kind === 'codex' && v.status === 'running')
  if (running.length === 0) return
  const ps = await $.process.run(['ps', '-axww', '-o', 'command='], { timeoutMs: 5_000 })
  if (ps.exitCode !== 0) return
  const lines = ps.stdout.split('\n').filter(l => isCodexReview(l)).map(plain)
  for (const v of running) {
    const isAlive = lines.some(l => `${l} `.includes(`${v.key ?? 'codex review'} `)) // whole arguments: `--base main` is not `--base main2`
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
  // Claimed in one update, so two callers (a poll and the tool call) never both toast.
  let v: Review | undefined
  await update($, reviews, list =>
    list.map(x => (x.id === id && x.status === 'running' ? (v = { ...x, status: failed ? 'failed' : 'done', endedAt: Date.now() }) : x)),
  )
  if (!v) return
  const done = v
  const findings = done.kind === 'codex' && done.out && !failed ? findingsOf(await tail($, ['-c', '40000', '--', done.out])) : undefined
  if (findings) await update($, reviews, list => list.map(x => (x.id === id ? { ...x, findings } : x)))
  const what = done.kind === 'codex' ? `codex review (${done.model})` : `${done.label} (${done.model})`
  const extra = findings ? ` · ${findingsText(findings)}` : ''
  $.ui.toast(`${failed ? '✗' : '✓'} ${what} ${failed ? 'stopped' : 'done'} · ${elapsed(done)}${extra}`)
}

async function tail($: EngineInterface, args: string[]) {
  const r = await $.process.run(['tail', ...args], { timeoutMs: 5_000 }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout : ''
}

async function lastLine($: EngineInterface, file: string) {
  const lines = clean(await tail($, ['-n', '30', '--', file])).split('\n').map(l => l.trim()).filter(Boolean)
  return lines.at(-1)?.slice(0, 200) ?? ''
}

// The model from ~/.codex/config.toml, for a review run without one on its command line.
async function configModel($: EngineInterface) {
  const r = await $.process
    .run(['sh', '-c', 'grep -E "^model *=" "$HOME/.codex/config.toml" | head -n 1'], { timeoutMs: 3_000 })
    .catch(() => null)
  return (r && /=\s*["']?([\w.:-]+)/.exec(r.stdout)?.[1]) || 'default'
}

// `codex review` where a command starts (after `;`, `&&`, `|`, `timeout 900` and the like), flags before `review` allowed.
const CODEX_REVIEW =
  /(?:^|[;&|(])\s*(?:(?:timeout|nohup|nice|env|time|command)(?:\s+[-\w.=:]+)*\s+)?(?:\S*\/)?codex(?:\s+-{1,2}[\w-]+(?:[\s=]+(?!-)\S+)?)*\s+review(?=\s|$)/

export function isCodexReview(command: string) {
  return CODEX_REVIEW.test(command)
}

// A subagent whose description says review (not "preview" or "interview").
export function isReviewAgent(description: string) {
  return /\breview(?:s|er|ers|ing)?\b/i.test(description)
}

const TITLE = /--title(?:\s+|=)(?:(["'])(.*?)\1|([^\s"';&|<>]+))/

// The `codex ... review ...` part of a command, up to where the next command starts.
function codexPart(command: string) {
  const m = CODEX_REVIEW.exec(command)
  if (!m) return ''
  const rest = command.slice(m.index).replace(TITLE, '--title _')
  return rest.split(/\s*(?:&&|\|\||;|\|(?!&))\s*/)[0]!
}

export function modelOf(command: string) {
  const part = codexPart(command)
  return /\s-c\s+["']?model\s*=\s*\\?["']?([\w.:-]+)/.exec(part)?.[1] ?? /\s(?:--model|-m)(?:\s+|=)["']?([\w.:-]+)/.exec(part)?.[1]
}

export function labelOf(command: string) {
  const title = titleOf(command)
  if (title) return title
  const part = codexPart(command)
  const commit = /--commit(?:\s+|=)["']?(\w+)/.exec(part)?.[1]
  if (commit) return `commit ${commit.slice(0, 7)}`
  const base = /--base(?:\s+|=)["']?([^\s"']+)/.exec(part)?.[1]
  return base ? `changes vs ${base}` : 'uncommitted changes'
}

function titleOf(command: string) {
  const m = TITLE.exec(command.slice(Math.max(0, command.search(CODEX_REVIEW))))
  return m ? (m[2] ?? m[3] ?? '') : ''
}

// What finds this review's process in ps: its arguments as ps prints them (quotes gone).
export function keyOf(command: string) {
  const m = CODEX_REVIEW.exec(command)
  if (!m) return 'codex review'
  const rest = command.slice(m.index + m[0].search(/codex\s/))
  // Up to the first redirect or the next command, past a quoted title.
  const masked = rest.replace(TITLE, x => x.replace(/[;&|<>]/g, '_'))
  const cut = masked.search(/\s(?:\d?>|&>)|\s*(?:&&|\|\||;|\|)/)
  return plain(cut >= 0 ? rest.slice(0, cut) : rest)
}

// The file the review's stdout goes to (`> file`): `~` from HOME, a relative one from a `cd` before it or the session's folder.
export function outputOf(command: string, cwd: string, home = '') {
  const at = Math.max(0, command.search(CODEX_REVIEW))
  const re = /(\d|&)?>>?\s*(["']?)([^\s"'&|;<>]+)\2/g
  const rest = command.slice(at).replace(TITLE, '--title _')
  for (const m of rest.matchAll(re)) {
    if (m[1] === '2' || m[3]!.startsWith('&')) continue
    let path = m[3]!
    if (path === '/dev/null' || path.includes('$')) return undefined
    if (path.startsWith('~/')) {
      if (!home) return undefined
      path = home + path.slice(1)
    }
    if (path.startsWith('/')) return path
    const cds = [...command.slice(0, at).matchAll(/(?:^|[;&|])\s*cd\s+(["']?)([^\s"';&|]+)\1/g)]
    const dir = cds.at(-1)?.[2]
    const base = dir ? (dir.startsWith('/') ? dir : dir.startsWith('~/') && home ? home + dir.slice(1) : `${cwd}/${dir}`) : cwd
    return base ? `${base}/${path}` : undefined
  }
  return undefined
}

// Codex ends with a "Full review comments:" block of `- [P2] title — file:line` items.
// Undefined when the output says neither (an error, a killed run, an unreadable file).
export function findingsOf(text: string): string[] | undefined {
  const at = text.lastIndexOf('Full review comments:')
  if (at >= 0) return [...text.slice(at).matchAll(/^\s*-\s*\[(P\d)\]/gm)].map(m => m[1]!)
  if (/\b(?:no (?:issues|findings|problems|bugs)|did not (?:find|identify)|didn't (?:find|identify)|looks good)\b/i.test(text.slice(-3000))) return []
  return undefined
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

// A command line as ps prints it: no quotes, single spaces.
function plain(text: string) {
  return text.replace(/["']/g, '').replace(/\s+/g, ' ').trim()
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
