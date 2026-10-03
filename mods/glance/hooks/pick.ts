// Pure parts of glance: read each source's answer, rank it, and fit the line.
import type { Dm, Issue, Meeting, Pr } from '../types'

const MIN = 60_000
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---- Calendar ---------------------------------------------------------------

type CalEvent = {
  summary?: string
  status?: string
  eventType?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  htmlLink?: string
}

/** Timed events that haven't ended and that you haven't declined, soonest first. */
export function meetingsFrom(answer: { events?: CalEvent[] }, now: number): Meeting[] {
  return (answer.events ?? [])
    .filter(e => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime) // all-day events have only a date
    .filter(e => e.eventType === undefined || e.eventType === 'DEFAULT' || e.eventType === 'FROM_GMAIL')
    .filter(e => e.attendees?.find(a => a.self)?.responseStatus !== 'declined')
    .map(e => ({
      title: e.summary?.trim() || '(no title)',
      start: Date.parse(e.start!.dateTime!),
      end: Date.parse(e.end!.dateTime!),
      url: e.htmlLink ?? '',
    }))
    .filter(m => m.end > now)
    .sort((a, b) => a.start - b.start)
}

// ---- GitHub -----------------------------------------------------------------

// One call: reviews asked of you, and your own open PRs with their CI and review state.
export const PR_QUERY = `query {
  review: search(query: "is:open is:pr review-requested:@me archived:false", type: ISSUE, first: 20) {
    nodes { ... on PullRequest { number title url repository { name } } }
  }
  mine: search(query: "is:open is:pr author:@me archived:false", type: ISSUE, first: 50) {
    nodes { ... on PullRequest { number title url isDraft reviewDecision repository { name }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }
  }
}`

type PrNode = {
  number?: number
  title?: string
  url?: string
  isDraft?: boolean
  reviewDecision?: string | null
  repository?: { name: string }
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

/** PRs that need you: reviews asked of you, then yours with failing CI (drafts last), then yours with changes requested. */
export function prsFrom(answer: { data?: { review?: { nodes: PrNode[] }; mine?: { nodes: PrNode[] } } }): Pr[] {
  const pr = (n: PrNode, reason: Pr['reason']): Pr => ({
    repo: n.repository?.name ?? '',
    number: n.number ?? 0,
    title: n.title ?? '',
    url: n.url ?? '',
    reason,
  })
  const mine = (answer.data?.mine?.nodes ?? []).filter(n => n.number)
  const ciState = (n: PrNode) => n.commits?.nodes[0]?.commit.statusCheckRollup?.state
  const isFailing = (n: PrNode) => ciState(n) === 'FAILURE' || ciState(n) === 'ERROR'
  const out = [
    ...(answer.data?.review?.nodes ?? []).filter(n => n.number).map(n => pr(n, 'review')),
    ...mine.filter(n => isFailing(n) && !n.isDraft).map(n => pr(n, 'ci')),
    ...mine.filter(n => isFailing(n) && n.isDraft).map(n => pr(n, 'ci')),
    ...mine.filter(n => !isFailing(n) && n.reviewDecision === 'CHANGES_REQUESTED').map(n => pr(n, 'changes')),
  ]
  const seen = new Set<string>()
  return out.filter(p => !seen.has(p.url) && seen.add(p.url))
}

// ---- Linear -----------------------------------------------------------------

type LinearIssue = { id?: string; title?: string; status?: string; url?: string; updatedAt?: string }

/** Your started issues (In Progress, In Review), most recently touched first. */
export function issuesFrom(answer: { issues?: LinearIssue[] }): Issue[] {
  return (answer.issues ?? [])
    .filter(i => i.id)
    .map(i => ({ id: i.id!, title: i.title ?? '', status: i.status ?? '', url: i.url ?? '', updatedAt: Date.parse(i.updatedAt ?? '') || 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---- Slack ------------------------------------------------------------------

/**
 * Messages from Slack's search answer, newest first. The connector answers in
 * markdown, one "### Result" block per message with From, Message_ts,
 * Permalink and Text lines.
 */
export function dmsFrom(answer: { results?: string }): Dm[] {
  const blocks = (answer.results ?? '').split(/^### Result /m).slice(1)
  const out: Dm[] = []
  for (const block of blocks) {
    const from = /^From: (.+?)(?: <[^>]*>)?(?: \(ID: [^)]*\))?\s*$/m.exec(block)?.[1]?.trim()
    const ts = Number(/^Message_ts: ([\d.]+)/m.exec(block)?.[1])
    if (!from || !ts) continue
    const url = /^Permalink: \[[^\]]*\]\(([^)]+)\)/m.exec(block)?.[1] ?? ''
    const at = block.search(/^Text:/m)
    const body = at < 0 ? '' : block.slice(at).replace(/^Text: */, '').split(/\n---/)[0] ?? ''
    const text = body
      .split('\n')
      .map(line => line.replace(/:[a-z0-9_+-]+:/gi, '').replace(/\s+/g, ' ').trim())
      .find(line => line !== '') ?? ''
    out.push({ from, text, at: Math.round(ts * 1000), url })
  }
  return out.sort((a, b) => b.at - a.at)
}

// ---- The line ---------------------------------------------------------------

/** One part of the line: its texts from fullest to shortest. */
export type Part = { levels: string[]; color?: string; isDim?: boolean }

/** Clock time as 24-hour HH:MM in the machine's time zone. */
export function clock(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dayKey(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** When a meeting is, said the shortest way that's still clear. */
export function when(m: Meeting, now: number) {
  if (m.start <= now) return `now until ${clock(m.end)}`
  const mins = Math.ceil((m.start - now) / MIN)
  if (mins < 60) return `in ${mins} min`
  if (dayKey(m.start) === dayKey(now)) return `at ${clock(m.start)}`
  if (dayKey(m.start) === dayKey(now + 86_400_000)) return `tomorrow ${clock(m.start)}`
  return `${WEEKDAY[new Date(m.start).getDay()]} ${clock(m.start)}`
}

export function meetingPart(m: Meeting, now: number): Part {
  const w = when(m, now)
  const isNow = m.start <= now
  const isSoon = !isNow && m.start - now <= 15 * MIN
  const say = (title: string) => (isNow ? `📅 now: ${title} until ${clock(m.end)}` : `📅 ${title} ${w}`)
  return {
    levels: [say(m.title), say(cut(m.title, 16)), `📅 ${w}`],
    color: isNow ? 'cyan' : isSoon ? 'yellow' : undefined,
  }
}

const REASON: Record<Pr['reason'], string> = { review: 'review requested', ci: 'CI failing', changes: 'changes requested' }

export function prPart(prs: Pr[]): Part | undefined {
  const [top] = prs
  if (!top) return undefined
  const more = prs.length > 1 ? ` +${prs.length - 1}` : ''
  return {
    levels: [
      `🔀 ${top.repo}#${top.number}: ${REASON[top.reason]}${more}`,
      `🔀 #${top.number} ${REASON[top.reason]}${more}`,
      `🔀 ${prs.length} PR${prs.length === 1 ? '' : 's'}`,
    ],
    color: top.reason === 'ci' ? 'red' : top.reason === 'review' ? 'yellow' : undefined,
  }
}

export function issuePart(issues: Issue[]): Part | undefined {
  const [top] = issues
  if (!top) return undefined
  const more = issues.length > 1 ? ` +${issues.length - 1}` : ''
  return {
    levels: [
      `📋 ${top.id} ${top.status}: ${cut(top.title, 28)}${more}`,
      `📋 ${top.id} ${top.status}${more}`,
      `📋 ${issues.length} active`,
    ],
  }
}

export function dmPart(dms: Dm[]): Part | undefined {
  const [top] = dms
  if (!top) return undefined
  const more = dms.length > 1 ? ` +${dms.length - 1}` : ''
  const name = top.from.split(' ')[0]
  return {
    levels: [
      top.text ? `💬 ${name}: "${cut(top.text, 30)}"${more}` : `💬 ${name}${more}`,
      `💬 ${dms.length} new`,
    ],
  }
}

export const SEPARATOR = ' · '

/**
 * Shrinks the parts until the line fits `columns`. Parts are in line order
 * (meeting, PRs, Linear, Slack); Slack gives way first and the meeting last.
 * Returns each part's chosen text, in order.
 */
export function fit(parts: (Part | undefined)[], columns: number): (string | undefined)[] {
  const level = parts.map(() => 0)
  const text = () => parts.map((p, i) => p && p.levels[Math.min(level[i] ?? 0, p.levels.length - 1)])
  const width = () => text().filter(Boolean).reduce((sum, t, i) => sum + cells(t!) + (i > 0 ? SEPARATOR.length : 0), 0)
  // Each step shortens one part by one level: Slack, then Linear and PRs, then all three again, then the meeting.
  const steps = [3, 2, 1, 3, 2, 1, 0, 0]
  for (const i of steps) {
    if (width() <= columns) break
    level[i] = (level[i] ?? 0) + 1
  }
  return text()
}

/** Terminal cells a string takes: wide emoji count two, variation selectors none. */
export function cells(s: string) {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 0xfe0f || c === 0x200d) continue
    n += c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf) ? 2 : 1
  }
  return n
}

export function cut(s: string, max: number) {
  const chars = [...s]
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}
