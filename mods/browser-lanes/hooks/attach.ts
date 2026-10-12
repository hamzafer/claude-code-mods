// Which Playwright browser belongs to which Claude process, read off `ps` (on Windows, off the same list from PowerShell).
//   claude ─ npm exec @playwright/mcp ─ node playwright-mcp ─ Google Chrome --user-data-dir=…
import type { Attachment } from '../types'

export type Proc = { pid: number; ppid: number; command: string }

// `ps -axo pid=,ppid=,command=` output, one process per line (Windows ends its lines with \r\n).
export function parsePs(stdout: string): Proc[] {
  return stdout
    .split(/\r?\n/)
    .map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? '' }))
}

// The server is `…/.bin/playwright-mcp`, or on Windows `…\@playwright\mcp\cli.js` (the bin shim's target; npx's own `@playwright/mcp@latest` is not it).
const isServer = (p: Proc) => /node(\.exe)?\b.*(playwright-mcp|playwright[\\/]mcp[\\/]cli\.js)/i.test(p.command) || /\bmcp-server-playwright\b/.test(p.command)
// The main Chrome only: its helpers carry `--type=` (or "Helper" in their name on macOS).
const isChrome = (p: Proc) => /[\\/](Google Chrome|Chromium|chrome)(\.exe)?"?( |$)/.test(p.command) && /--user-data-dir=/.test(p.command) && !/Helper| --type=/.test(p.command)
const isClaude = (p: Proc) => /(^|[\\/"])claude(\.exe)?"?( |$)/.test(p.command)
// `--user-data-dir=path`, with the path (on Windows, the whole argument) quoted when it has spaces.
const profileOf = (p: Proc) => {
  const m = /"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=(\S+)/.exec(p.command)
  return m?.[1] ?? m?.[2] ?? m?.[3]
}

// The Claude process a process runs under, if any.
function claudeOf(procs: Map<number, Proc>, pid: number): number | undefined {
  for (let p = procs.get(pid), i = 0; p && i < 12; p = procs.get(p.ppid), i++) if (isClaude(p)) return p.pid
  return undefined
}

// Claude processes, other than `me`, that run a Chrome on a shared Playwright profile:
// the ones whose working folder we look up (a profile is per folder).
export function otherHolders(list: Proc[], me: number): number[] {
  const procs = new Map(list.map(p => [p.pid, p]))
  const pids = list
    .filter(c => isChrome(c) && /ms-playwright-mcp[\\/]mcp-chrome/.test(profileOf(c) ?? ''))
    .map(c => claudeOf(procs, c.pid))
    .filter((pid): pid is number => pid !== undefined && pid !== me)
  return [...new Set(pids)]
}

// What this Claude process (`me`, working in `myCwd`) has: no server, a server without a
// browser, a browser, or a server whose profile (one per folder) another Claude holds.
export function attachment(list: Proc[], me: number, myCwd = '', cwds: ReadonlyMap<number, string> = new Map()): Attachment {
  const procs = new Map(list.map(p => [p.pid, p]))
  const servers = list.filter(isServer)
  const mine = servers.find(s => claudeOf(procs, s.pid) === me)
  const chromes = list.filter(isChrome)
  const base = { claudePid: me, servers: servers.length }
  if (!mine) return { ...base, state: 'none', isolated: false }

  const isolated = /--isolated\b/.test(mine.command)
  const ours = chromes.find(c => c.ppid === mine.pid)
  if (ours) return { ...base, state: 'attached', isolated, serverPid: mine.pid, chromePid: ours.pid, profile: profileOf(ours) }
  if (isolated) return { ...base, state: 'ready', isolated, serverPid: mine.pid }

  // Same folder, same shared profile: another Claude's Chrome there blocks ours.
  const other = chromes.find(c => {
    if (!/ms-playwright-mcp[\\/]mcp-chrome/.test(profileOf(c) ?? '')) return false
    const holder = claudeOf(procs, c.pid)
    return holder !== undefined && holder !== me && myCwd !== '' && cwds.get(holder) === myCwd
  })
  if (!other) return { ...base, state: 'ready', isolated, serverPid: mine.pid }
  const holderPid = claudeOf(procs, other.pid) ?? other.ppid
  return {
    ...base,
    state: 'blocked',
    isolated,
    serverPid: mine.pid,
    chromePid: other.pid,
    profile: profileOf(other),
    holder: { claudePid: holderPid, cwd: cwds.get(holderPid) ?? '', isThisSession: false },
  }
}

// Every Playwright browser on the machine: its Chrome, its server, the Claude it serves.
export type Browser = { chromePid: number; serverPid: number; claudePid?: number; claude: string; isMine: boolean }

export function browsers(list: Proc[], me: number): Browser[] {
  const procs = new Map(list.map(p => [p.pid, p]))
  return list
    .filter(c => isChrome(c) && procs.get(c.ppid) !== undefined && isServer(procs.get(c.ppid) as Proc))
    .map(c => {
      const claudePid = claudeOf(procs, c.pid)
      const resume = claudePid ? /--resume\s+(\S{8})/.exec(procs.get(claudePid)?.command ?? '')?.[1] : undefined
      return {
        chromePid: c.pid,
        serverPid: c.ppid,
        claudePid,
        claude: claudePid ? `Claude pid ${claudePid}${resume ? ` (session ${resume})` : ''}` : 'no Claude (orphan)',
        isMine: claudePid === me,
      }
    })
}

// One line a person reads.
export function describeAttachment(a: Attachment): string {
  if (a.state === 'none') return 'no Playwright server in this session'
  if (a.state === 'attached') return `attached · this session's Chrome${a.isolated ? ' · isolated' : ' · shared profile'}`
  if (a.state === 'ready') return `ready · browser not open yet${a.isolated ? ' · isolated' : ''}`
  const where = a.holder?.cwd ? ` in ${a.holder.cwd.split(/[\\/]/).slice(-2).join('/')}` : ''
  return `NOT attached · another Claude (pid ${a.holder?.claudePid}${where}) holds the shared profile`
}
