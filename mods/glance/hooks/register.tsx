// glance: one line above the prompt with what needs you: next meeting, PRs, Linear, Slack.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import type { Dm, Issue, Meeting, Pr, Source } from '../types'
import type { Part } from './pick'
import {
  PR_QUERY, SEPARATOR, clock, dmPart, dmsFrom, fit, issuePart, issuesFrom, meetingPart, meetingsFrom, mergeDms, prPart, prsFrom, slackIdFrom, when,
} from './pick'

const EVERY_MS = 5 * 60 * 1000
const TICK_MS = 60 * 1000 // the meeting countdown moves each minute without a fetch
const SLACK_WINDOW_S = 2 * 60 * 60

// Held by the host, so what was fetched survives a hot reload of this file.
const meetings = atom({ plugin: 'glance', key: 'meetings' } as const, { items: [], fetchedAt: 0, isFailed: false } as Source<Meeting>)
const prs = atom({ plugin: 'glance', key: 'prs' } as const, { items: [], fetchedAt: 0, isFailed: false } as Source<Pr>)
const issues = atom({ plugin: 'glance', key: 'issues' } as const, { items: [], fetchedAt: 0, isFailed: false } as Source<Issue>)
const dms = atom({ plugin: 'glance', key: 'dms' } as const, { items: [], fetchedAt: 0, isFailed: false } as Source<Dm>)
const triedAt = atom({ plugin: 'glance', key: 'triedAt' } as const, 0)
const minute = atom({ plugin: 'glance', key: 'minute' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'glance', description: 'Refresh glance and list everything that needs you' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    void refresh($, false).catch(() => {}) // in the background: a slow source never holds up the session
    $.clock.every(TICK_MS, () => void tick($).catch(() => {}))
    return result
  })

  on('command.run', { command: 'glance' }, async $ => {
    await refresh($, true)
    return { text: await details($) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    if (e.props.hasSurvey) return rest
    await read($, minute) // redraw each minute, for the countdown
    const now = await $.clock.now()
    const [m, p, i, d] = [await read($, meetings), await read($, prs), await read($, issues), await read($, dms)]

    const next1 = m.items.find(x => x.end > now)
    const parts = [
      dimmed(next1 && meetingPart(next1, now), m.isFailed),
      dimmed(prPart(p.items), p.isFailed),
      dimmed(issuePart(i.items), i.isFailed),
      dimmed(dmPart(d.items), d.isFailed),
    ]
    if (parts.every(x => !x)) return rest

    const texts = fit(parts, e.props.bodyColumns - 2)
    const { Box, Text } = $.ui.resolve(e)
    const shown = parts.map((part, k) => ({ part, text: texts[k] })).filter(x => x.part && x.text)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          {shown.map(({ part, text }, k) => (
            <Text key={String(k)} wrap="truncate" color={part!.isDim ? undefined : part!.color} dimColor={part!.isDim}>
              {(k > 0 ? SEPARATOR : '') + text}
            </Text>
          ))}
        </Box>
        {rest}
      </Box>
    )
  })
}

// A source that failed to refresh still shows its last answer, dimmed.
function dimmed(part: Part | undefined, isFailed: boolean): Part | undefined {
  return part && { ...part, isDim: isFailed }
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  await update($, minute, () => now)
  await refresh($, false)
}

// Every 5 minutes, unless /glance asked. Each source fails on its own and keeps its last answer.
async function refresh($: EngineInterface, isForced: boolean) {
  const now = await $.clock.now()
  if (!isForced && (await read($, triedAt)) > 0 && now - (await read($, triedAt)) < EVERY_MS) return
  await update($, triedAt, () => now)

  const [m, p, i, d] = await Promise.all([
    attempt(async () => meetingsFrom(await mcp($, 'claude.ai Google Calendar', 'list_events', { pageSize: 30, orderBy: 'startTime' }), now)),
    attempt(async () => {
      const { exitCode, stdout } = await $.process.run(['gh', 'api', 'graphql', '-f', `query=${PR_QUERY}`], { timeoutMs: 20_000 })
      if (exitCode !== 0) throw new Error('gh failed')
      return prsFrom(JSON.parse(stdout))
    }),
    attempt(async () =>
      issuesFrom(await mcp($, 'claude.ai Linear', 'list_issues', {
        assignee: 'me', state: 'started', limit: 25, fields: ['title', 'status', 'url', 'updatedAt'],
      }))),
    attempt(() => slack($, now)),
  ])
  await update($, meetings, s => settle(s, m, now))
  await update($, prs, s => settle(s, p, now))
  await update($, issues, s => settle(s, i, now))
  await update($, dms, s => settle(s, d, now))
}

// Slack's search has no "mentions me" filter: to:me finds DMs, and a second
// search for <@your-id> finds channel mentions. The id is looked up once and
// kept in memory only. Without it, DMs alone still show.
let slackId: string | undefined
async function slack($: EngineInterface, now: number) {
  const search = { after: String(Math.floor(now / 1000) - SLACK_WINDOW_S), sort: 'timestamp', limit: 10, include_bots: false, include_context: false, natural_language_query: '' }
  slackId ??= await mcp($, 'claude.ai Slack', 'slack_read_user_profile', { response_format: 'detailed' }).then(slackIdFrom, () => undefined)
  const [direct, mentions] = await Promise.all([
    mcp($, 'claude.ai Slack', 'slack_search_public_and_private', { ...search, filters: 'to:me' }).then(dmsFrom),
    slackId
      ? mcp($, 'claude.ai Slack', 'slack_search_public_and_private', { ...search, keywords: [`<@${slackId}>`], channel_types: 'public_channel,private_channel' }).then(dmsFrom, () => [])
      : [],
  ])
  return mergeDms(direct, mentions)
}

// The items, or undefined when the source failed.
async function attempt<T>(get: () => Promise<T[]>): Promise<T[] | undefined> {
  try {
    return await get()
  } catch {
    return undefined
  }
}

// A failed source keeps its last items and is marked, so the line dims it.
function settle<T>(s: Source<T>, items: T[] | undefined, now: number): Source<T> {
  return items ? { items, fetchedAt: now, isFailed: false } : { ...s, isFailed: true }
}

// A connector's answer is JSON in its first text block.
async function mcp($: EngineInterface, server: string, tool: string, args: Record<string, unknown>) {
  const result: McpToolResult = await $.mcp.call(server, tool, args)
  const block = result.content.find(c => c.type === 'text') as { text?: string } | undefined
  if (result.isError || !block?.text) throw new Error(`${server} ${tool} failed`)
  return JSON.parse(block.text)
}

// What /glance prints: everything behind the line.
async function details($: EngineInterface) {
  const now = await $.clock.now()
  const [m, p, i, d] = [await read($, meetings), await read($, prs), await read($, issues), await read($, dms)]
  const stale = (s: Source<unknown>) => (s.isFailed ? (s.fetchedAt ? ` _(couldn't refresh, from ${clock(s.fetchedAt)})_` : " _(couldn't reach it)_") : '')
  const lines: string[] = []

  lines.push(`**📅 Meetings**${stale(m)}`)
  const upcoming = m.items.filter(x => x.end > now).slice(0, 3)
  if (upcoming.length === 0) lines.push('- nothing in the next 7 days')
  for (const x of upcoming) lines.push(`- ${x.title}, ${when(x, now)}`)

  lines.push('', `**🔀 PRs that need you**${stale(p)}`)
  if (p.items.length === 0) lines.push('- none')
  const reason = { review: 'review requested', ci: 'CI failing', changes: 'changes requested' }
  for (const x of p.items) lines.push(`- [${x.repo}#${x.number}](${x.url}) ${x.title}: **${reason[x.reason]}**`)

  lines.push('', `**📋 Linear in progress**${stale(i)}`)
  if (i.items.length === 0) lines.push('- none')
  for (const x of i.items) lines.push(`- [${x.id}](${x.url}) ${x.status}: ${x.title}`)

  lines.push('', `**💬 Slack DMs and mentions, last 2 hours**${stale(d)}`)
  if (d.items.length === 0) lines.push('- nothing new')
  for (const x of d.items) lines.push(`- ${clock(x.at)} ${x.from}: ${x.text || '(no text)'}${x.url ? ` ([open](${x.url}))` : ''}`)

  return lines.join('\n')
}
