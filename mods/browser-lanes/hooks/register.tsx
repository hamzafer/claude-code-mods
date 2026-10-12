// Browser Lanes: is this session attached to a Playwright browser, and one driver at a time.
//   - A band says whether this session has its own browser, is ready, or is blocked because
//     another Claude process holds the shared Chrome profile (and which one). /browser says more.
//   - In this session the main loop and each subagent take turns on the browser: a second
//     driver's call waits until the first is done (closed it, finished, or idle 90 s).
//   - Screenshots are named by who took them (`login-test-03.png`).
//   - Another Claude session that used the browser in the last 90 s gets a warning.
//   - A band above the prompt says who has the browser and who waits.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Attachment, Lane } from '../types'
import { attachment, browsers, describeAttachment, otherHolders, parsePs } from './attach'

const BROWSER_TOOL = /^mcp__.*playwright.*__browser_/
const IDLE_MS = 90_000 // a driver this quiet lets go
const MAX_WAIT_MS = 5 * 60_000

let isWindows = false // set at session start: macOS and Linux have ps, lsof and kill; Windows has none of them

// Windows: every process as `pid ppid command`, as `ps -axo pid=,ppid=,command=` prints them. The first line is this
// PowerShell's own pid, and its parent is the Claude process. `powershell` is Windows PowerShell 5.1, on every Windows.
const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']
const WIN_PROCESSES = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::Out.Write(('' + $PID) + [char]10)
Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CommandLine | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, ($_.CommandLine -replace '[\\r\\n]+', ' ') }`

// Held by the host, so a reload keeps who holds the browser.
const holder = atom({ plugin: 'browser-lanes', key: 'holder' } as const, null as Lane | null)
const waiting = atom({ plugin: 'browser-lanes', key: 'waiting' } as const, [] as string[])
const attached = atom({ plugin: 'browser-lanes', key: 'attachment' } as const, null as Attachment | null)

export const register: Register = on => {
  const names = new Map<string, string>() // agent id → a short label
  const shots = new Map<string, number>() // label → screenshots taken

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    isWindows = (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
    await $.command.register({ name: 'browser', description: "Show if this session has a Playwright browser; /browser clean closes other sessions' browsers", argumentHint: '[clean]' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    void inspect($).catch(() => {})
    return r
  })

  on('command.run', { command: 'browser' }, async ($, e) => {
    if (e.args.trim() === 'clean') return { text: await clean($) }
    const a = await inspect($)
    return { text: browserReport(a) }
  })

  // Closing the session closes its browser too.
  on('session.end', async ($, e, next) => {
    const a = await read($, attached)
    if (a?.state === 'attached' && a.chromePid) await closeChrome($, a.chromePid)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) names.set(r.agentId, slug(e.name || e.description || e.subagentType))
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (!BROWSER_TOOL.test(e.tool)) return next(e)
    const owner = e.agentId ?? 'main'
    const label = e.agentId ? (names.get(e.agentId) ?? `agent-${e.agentId.slice(0, 6)}`) : 'main'

    await warnOtherSession($)

    // Wait for the lane: time inside $ calls doesn't count against the hook's limit.
    const started = Date.now()
    let isQueued = false
    while (!next.signal.aborted) {
      const lane = await read($, holder)
      if (!lane || lane.owner === owner || Date.now() - lane.last > IDLE_MS) break
      if (!isQueued) {
        isQueued = true
        await update($, waiting, w => [...w, label])
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        await update($, waiting, w => drop(w, label))
        return { deny: `browser-lanes: the browser has been busy with "${lane.label}" for over 5 minutes. Try again later, or ask the user.` }
      }
      await $.process.run(isWindows ? [...POWERSHELL, 'Start-Sleep -Milliseconds 500'] : ['sleep', '0.5']) // sleep, or Windows PowerShell where there is none: time inside a $ call is not the hook's
    }
    if (isQueued) await update($, waiting, w => drop(w, label))

    const at = Date.now()
    await update($, holder, lane => (lane && lane.owner === owner ? { ...lane, last: at } : { owner, label, since: at, last: at }))
    await claimAcrossSessions($, label)

    let call = e
    if (e.tool.endsWith('browser_take_screenshot')) {
      const n = (shots.get(label) ?? 0) + 1
      shots.set(label, n)
      const args = e as unknown as { filename?: string; type?: string }
      call = { ...e, filename: shotName(label, n, args.filename, args.type) } as typeof e
    }

    let r = await next(call)
    if (r.isError && /already in use/i.test(r.text ?? '')) {
      // Self-heal: offer to close the browser that blocks ours, then try once more.
      const a = await inspect($)
      if (a.state === 'blocked' && a.chromePid && (await closeBlocker($, a))) {
        await $.process.run(isWindows ? [...POWERSHELL, 'Start-Sleep -Milliseconds 1500'] : ['sleep', '1.5'])
        r = await next(call)
        void inspect($).catch(() => {})
      } else {
        $.ui.toast(`browser-lanes: ${describeAttachment(a)}. Run /browser clean.`, { timeoutMs: 8000 })
      }
    } else void inspect($).catch(() => {})
    if (e.tool.endsWith('browser_close')) await release($, owner)
    else await update($, holder, lane => (lane && lane.owner === owner ? { ...lane, last: Date.now() } : lane))
    return r
  })

  // A subagent that finished lets go of the browser.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) await release($, e.agentId)
    else void inspect($).catch(() => {})
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const a = await read($, attached)
    if (e.props.hasSurvey || !a || a.state === 'none') return rest
    const lane = await read($, holder)
    const isDriving = lane !== null && Date.now() - lane.last <= IDLE_MS
    const queue = await read($, waiting)
    const { Box, Text } = $.ui.resolve(e)
    const color = a.state === 'attached' ? 'green' : a.state === 'blocked' ? 'red' : undefined
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="magenta" bold>{' ◎ browser: '}</Text>
          <Text color={color} dimColor={a.state === 'ready'}>{describeAttachment(a)}</Text>
          {isDriving && <Text dimColor>{`  ·  driving: ${lane.label}`}</Text>}
          {queue.length > 0 && <Text color="yellow">{`  ·  ${queue.length} waiting (${queue.join(', ')})`}</Text>}
          {a.state === 'blocked' && <Text dimColor>{'  ·  /browser'}</Text>}
        </Text>
        {rest}
      </Box>
    )
  })
}

// Reads `ps` (on Windows, the process list from PowerShell) to see whose Chrome is whose, and keeps the answer for the band.
async function inspect($: EngineInterface): Promise<Attachment> {
  const { me, list } = await processes($)
  const cwds = new Map<number, string>()
  for (const pid of otherHolders(list, me)) {
    const cwd = await cwdOf($, pid)
    if (cwd) cwds.set(pid, cwd)
  }
  const a = attachment(list, me, await $.session.cwd(), cwds)
  await update($, attached, () => a)
  return a
}

// Closes one Playwright Chrome, after checking the pid still is one: between the process list and
// the kill the process may have ended and its pid gone to something else.
async function closeChrome($: EngineInterface, pid: number) {
  const command = await commandOf($, pid)
  if (command === null || !/--user-data-dir=/.test(command) || /Helper| --type=/.test(command)) return false
  return terminate($, pid)
}

// Asks before closing the Chrome another Claude holds; never touches that Claude itself.
async function closeBlocker($: EngineInterface, a: Attachment) {
  const where = a.holder?.cwd ? ` in ${a.holder.cwd.split(/[\\/]/).slice(-2).join('/')}` : ''
  try {
    const answer = await $.ui.ask(
      `browser-lanes: another Claude (pid ${a.holder?.claudePid}${where}) holds the browser this session needs. Close that browser and retry? Its Claude session stays open.`,
      { options: ['Close it and retry', 'Leave it'], header: 'Browser' },
    )
    if (answer !== 'Close it and retry') return false
  } catch {
    return false
  }
  return a.chromePid ? closeChrome($, a.chromePid) : false
}

// /browser clean: lists every Playwright browser and closes the ones the person picks.
async function clean($: EngineInterface) {
  const { me, list: running } = await processes($)
  const all = browsers(running, me)
  const others = all.filter(b => !b.isMine)
  const orphans = others.filter(b => b.claudePid === undefined)
  if (others.length === 0) return `${all.length === 1 ? 'Only this session has a browser.' : 'No Playwright browsers open.'} Nothing to clean.`

  const list = others.map(b => `- Chrome ${b.chromePid} · ${b.claude}`).join('\n')
  const options = [`Close all ${others.length} other browsers`, ...(orphans.length > 0 && orphans.length < others.length ? [`Close only the ${orphans.length} orphans`] : []), 'Keep them']
  let answer = 'Keep them'
  try {
    answer = await $.ui.ask(`browser-lanes: ${others.length} Playwright browser(s) belong to other Claude sessions. Close which? (The Claude sessions stay open.)`, { options, header: 'Browser' })
  } catch {
    // no one to ask: keep them
  }
  const chosen = answer.startsWith('Close all') ? others : answer.startsWith('Close only') ? orphans : []
  if (chosen.length === 0) return `Kept all browsers:\n${list}`
  const closed: number[] = []
  for (const b of chosen) {
    if (await closeChrome($, b.chromePid)) closed.push(b.chromePid)
  }
  void inspect($).catch(() => {})
  return `Closed ${closed.length} of ${chosen.length} browser(s):\n${chosen.map(b => `- Chrome ${b.chromePid} · ${b.claude}${closed.includes(b.chromePid) ? '' : ' (could not close)'}`).join('\n')}`
}

// Our Claude process and every process on the machine.
async function processes($: EngineInterface): Promise<{ me: number; list: Proc[] }> {
  if (isWindows) {
    const ps = await $.process.run([...POWERSHELL, WIN_PROCESSES], { timeoutMs: 20_000 })
    const list = parsePs(ps.stdout)
    const self = Number(ps.stdout.split('\n', 1)[0])
    return { me: list.find(p => p.pid === self)?.ppid ?? NaN, list }
  }
  const me = Number((await $.process.run(['sh', '-c', 'echo $PPID'])).stdout.trim()) // our Claude process
  const ps = await $.process.run(['ps', '-axo', 'pid=,ppid=,command='], { timeoutMs: 10_000 })
  return { me, list: parsePs(ps.stdout) }
}

// The folder another Claude works in. macOS and Linux ask lsof. Windows has no such tool, but Claude Code
// writes every running session to <config dir>/sessions/<pid>.json, with its cwd.
async function cwdOf($: EngineInterface, pid: number) {
  if (isWindows) {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? `${(await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''}/.claude`
    const text = await $.fs.read(`${dir}/sessions/${pid}.json`).catch(() => '')
    try {
      const session: unknown = JSON.parse(text)
      return session && typeof session === 'object' && 'cwd' in session && typeof session.cwd === 'string' ? session.cwd : undefined
    } catch {
      return undefined
    }
  }
  const lsof = await $.process.run(['lsof', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeoutMs: 10_000 }).catch(() => null)
  return lsof?.stdout.split('\n').find(l => l.startsWith('n'))?.slice(1)
}

// The command line of one process, or null when it is gone.
async function commandOf($: EngineInterface, pid: number) {
  const now = await $.process.run(isWindows ? [...POWERSHELL, `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`] : ['ps', '-p', String(pid), '-o', 'command='], { timeoutMs: isWindows ? 20_000 : 2_000 }).catch(() => null)
  return now && now.exitCode === 0 ? now.stdout : null
}

// Asks a process to end. Windows has no SIGTERM: a plain taskkill only closes windows (a headless Chrome reports success and
// stays), so it is /F, with /T to take the helpers too.
async function terminate($: EngineInterface, pid: number) {
  const argv = isWindows ? ['taskkill', '/PID', String(pid), '/T', '/F'] : ['kill', String(pid)]
  return (await $.process.run(argv, { timeoutMs: isWindows ? 10_000 : 2_000 }).catch(() => null))?.exitCode === 0
}

export function browserReport(a: Attachment) {
  const lines = [`Browser: ${describeAttachment(a)}`, `- This Claude process: pid ${a.claudePid}; Playwright servers running on this machine: ${a.servers}`]
  if (a.state === 'blocked') {
    lines.push(`- The shared profile ${a.profile ?? ''} is held by Chrome pid ${a.chromePid} under Claude pid ${a.holder?.claudePid}${a.holder?.cwd ? ` (${a.holder.cwd})` : ''}.`)
    lines.push('- Fix for good: run Playwright with --isolated so every session gets its own profile.')
    lines.push('- Right now: /browser clean closes it (the other Claude session stays open).')
  }
  if (a.state !== 'none' && !a.isolated) lines.push('- Not isolated: sessions share one Chrome profile, so only one can have the browser at a time.')
  return lines.join('\n')
}

async function release($: EngineInterface, owner: string) {
  await update($, holder, lane => (lane && lane.owner === owner ? null : lane))
}

// The store is shared by every session of this plugin: note who drives, warn on a clash.
async function claimAcrossSessions($: EngineInterface, label: string) {
  await $.store.set('driver', { session: await $.session.id(), label, at: Date.now() })
}

async function warnOtherSession($: EngineInterface) {
  const d = (await $.store.get('driver')) as { session?: string; label?: string; at?: number } | undefined
  if (!d?.session || !d.at || Date.now() - d.at > IDLE_MS) return
  if (d.session === (await $.session.id())) return
  $.ui.toast(`browser-lanes: another Claude session (${d.session.slice(0, 8)}, ${d.label}) used the browser ${Math.round((Date.now() - d.at) / 1000)}s ago`)
}

// `login-test-03.png`, or the asked-for name with the driver in front.
export function shotName(label: string, n: number, asked?: string, type?: string) {
  if (asked) {
    const base = asked.split(/[\\/]/).pop() ?? asked
    if (base.startsWith(`${label}-`)) return asked
    return asked.slice(0, asked.length - base.length) + `${label}-${base}`
  }
  return `${label}-${String(n).padStart(2, '0')}.${type ?? 'png'}`
}

export function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'agent'
  )
}

function drop(list: string[], one: string) {
  const i = list.indexOf(one)
  return i === -1 ? list : [...list.slice(0, i), ...list.slice(i + 1)]
}
