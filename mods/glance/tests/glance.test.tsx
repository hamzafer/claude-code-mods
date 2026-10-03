import { describe, expect, mock, test } from 'claude-code/testing'

import { cells, dmsFrom, fit, meetingPart, meetingsFrom, mergeDms, prsFrom, slackIdFrom } from '../hooks/pick'

const MIN = 60_000
const NOW = Date.parse('2026-10-05T07:42:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } }

const event = (summary: string, startMin: number, endMin: number, extra: object = {}) => ({
  summary,
  status: 'confirmed',
  eventType: 'DEFAULT',
  start: { dateTime: iso(NOW + startMin * MIN) },
  end: { dateTime: iso(NOW + endMin * MIN) },
  htmlLink: `https://calendar.test/${summary}`,
  ...extra,
})
const CALENDAR = {
  events: [
    { summary: 'Holiday', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }, // all-day: skipped
    event('Old sync', -60, -30), // over
    event('Declined review', 5, 35, { attendees: [{ self: true, responseStatus: 'declined' }] }),
    event('Team standup', 18, 48, { attendees: [{ self: true, responseStatus: 'accepted' }] }),
    event('Lunch', 120, 150),
  ],
}
const pr = (repo: string, number: number, extra: object = {}) => ({
  number, title: `Change ${number}`, url: `https://github.test/${repo}/pull/${number}`, repository: { name: repo }, ...extra,
})
const ci = (state: string | null) => ({ commits: { nodes: [{ commit: { statusCheckRollup: state && { state } } }] } })
const GITHUB = {
  data: {
    review: { nodes: [] },
    mine: {
      nodes: [
        pr('mods', 18, { isDraft: false, reviewDecision: null, ...ci('SUCCESS') }),
        pr('app', 7, { isDraft: true, reviewDecision: null, ...ci('FAILURE') }),
        pr('mods', 19, { isDraft: false, reviewDecision: null, ...ci('FAILURE') }),
        pr('api', 3, { isDraft: false, reviewDecision: 'CHANGES_REQUESTED', ...ci('SUCCESS') }),
      ],
    },
  },
}
const LINEAR = {
  issues: [
    { id: 'ENG-2', title: 'Older work', status: 'In Progress', url: 'https://linear.test/ENG-2', updatedAt: '2026-09-20T10:00:00Z' },
    { id: 'ENG-1', title: 'Ship the thing', status: 'In Review', url: 'https://linear.test/ENG-1', updatedAt: '2026-10-01T10:00:00Z' },
  ],
}
const slackResult = (n: number, from: string, ts: number, text: string) =>
  `### Result ${n} of 2\nChannel: DM (ID: D1)\nParticipants: ${from} (ID: U2), Me (ID: U1)\nFrom: ${from} <someone@example.test> (ID: U2) \nTime: x\nMessage_ts: ${ts}.000100\nPermalink: [link](https://slack.test/p${ts})\nText: \n${text}\n\n---\n\n`
const SLACK = {
  results: `# Search Results for: \n\n## Messages (2 results)\n${slackResult(1, 'Alex Doe', NOW / 1000 - 600, 'are you joining? :wave:')}${slackResult(2, 'Sam Roe', NOW / 1000 - 3000, 'thanks')}`,
}

const MENTIONS = {
  results: `## Messages (1 result)\n${slackResult(1, 'Kim Poe', NOW / 1000 - 300, 'can <@U1|me> look at <https://x.test/doc|the doc>?')}`,
}
const PROFILE = { result: 'User ID: U1\nUsername: me\n' }

const text = (value: object) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })

// Stands for the engine, the connectors and gh beneath the mod.
function engine(on: any, fail: string[] = []) {
  const clock = mock.clock(on, { now: NOW })
  const calls: { server: string; tool: string; args: any }[] = []
  let gh = 0
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' })
  })
  on('mcp.call', (_$: any, e: any) => {
    calls.push(e)
    if (fail.includes(e.server)) return { value: { content: [{ type: 'text', text: 'unauthorized' }], isError: true } }
    if (e.server === 'claude.ai Google Calendar') return text(CALENDAR)
    if (e.server === 'claude.ai Linear') return text(LINEAR)
    if (e.server === 'claude.ai Slack' && e.tool === 'slack_read_user_profile') return text(PROFILE)
    if (e.server === 'claude.ai Slack') return text(e.args.keywords ? MENTIONS : SLACK)
    return { value: { content: [], isError: true } }
  })
  on('process.run', (_$: any, e: any) => {
    gh++
    if (fail.includes('gh')) return { value: { exitCode: 1, stdout: '', stderr: 'not logged in' } }
    expect(e.argv.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
    return { value: { exitCode: 0, stdout: JSON.stringify(GITHUB), stderr: '' } }
  })
  return { clock, calls, ghCalls: () => gh }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the refresh runs in the background
const start = async ($: any) => {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle()
}
const mount = ($: any, bodyColumns = 160) => $.ui.mount({ plugin: 'glance', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns } })

describe('glance', () => {
  test('draws the most urgent item from each source on one line', async ($, on) => {
    const h = engine(on)
    await start($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /📅 Team standup in 18 min/ })).toBeDefined()
    // A review would come first; here it's the non-draft PR with failing CI, then 2 more.
    expect(await ui.find({ type: 'Text', text: /🔀 mods#19: CI failing \+2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /📋 ENG-1 In Review: Ship the thing \+1/ })).toBeDefined()
    // A channel mention (newest) merges with the DMs.
    expect(await ui.find({ type: 'Text', text: /💬 Kim: "can @me look at the doc\?" \+2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined() // stacked, not replaced
    await ui.unmount()

    const searches = h.calls.filter(c => c.tool === 'slack_search_public_and_private')
    expect(searches.map(c => c.args.filters ?? c.args.keywords)).toEqual(['to:me', ['<@U1>']])
    expect(searches[0]!.args).toMatchObject({ include_bots: false, after: String(NOW / 1000 - 7200) })
    expect(h.calls.find(c => c.server === 'claude.ai Linear')!.args).toMatchObject({ assignee: 'me', state: 'started' })
  })

  test('a narrow terminal shrinks Slack first and keeps the meeting', async ($, on) => {
    engine(on)
    await start($)
    const ui = await mount($, 70)
    expect(await ui.find({ type: 'Text', text: /📅 Team standup in 18 min/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /💬 3 new/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Kim/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the countdown moves each minute without fetching again', async ($, on) => {
    const h = engine(on)
    await start($)
    const before = h.calls.length
    await h.clock.advance(MIN)
    await settle()
    expect(h.calls.length).toBe(before)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /in 17 min/ })).toBeDefined()
    await ui.unmount()
  })

  test('fetches again after 5 minutes', async ($, on) => {
    const h = engine(on)
    await start($)
    expect(h.ghCalls()).toBe(1)
    await h.clock.advance(4 * MIN)
    await settle()
    expect(h.ghCalls()).toBe(1)
    await h.clock.advance(MIN)
    await settle()
    expect(h.ghCalls()).toBe(2)
  })

  test('a failing source is left out, and the others still show', async ($, on) => {
    engine(on, ['claude.ai Slack', 'gh'])
    await start($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /📅 Team standup/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /📋 ENG-1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /💬/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a source that stops answering keeps its last items, dimmed', async ($, on) => {
    const fail: string[] = []
    engine(on, fail)
    await start($)
    fail.push('claude.ai Linear')
    await $.command.run({ command: 'glance', args: '' } as any)
    const ui = await mount($)
    const issue = await ui.find({ type: 'Text', text: /📋 ENG-1/ })
    expect(issue?.props).toMatchObject({ dimColor: true })
    expect((await ui.find({ type: 'Text', text: /📅 Team standup/ }))?.props).toMatchObject({ dimColor: false })
    await ui.unmount()
  })

  test('nothing to show hides the line', async ($, on) => {
    engine(on, ['claude.ai Google Calendar', 'claude.ai Linear', 'claude.ai Slack', 'gh'])
    await start($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /📅|🔀|📋|💬/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('/glance refreshes and lists everything', async ($, on) => {
    const h = engine(on)
    await start($)
    const r: any = await $.command.run({ command: 'glance', args: '' } as any)
    expect(h.ghCalls()).toBe(2)
    expect(r.text).toMatch(/Team standup, in 18 min/)
    expect(r.text).toMatch(/Lunch/)
    expect(r.text).toMatch(/mods#19.*CI failing/)
    expect(r.text).toMatch(/api#3.*changes requested/)
    expect(r.text).toMatch(/ENG-2.*Older work/)
    expect(r.text).toMatch(/Sam Roe: thanks/)
    expect(r.text).toMatch(/Kim Poe: can @me look at the doc\?/)
  })
})

describe('glance picking', () => {
  test('meetings skip all-day, finished and declined events', () => {
    expect(meetingsFrom(CALENDAR, NOW).map(m => m.title)).toEqual(['Team standup', 'Lunch'])
  })

  test('a long block running now does not hide the next meeting', () => {
    const titles = meetingsFrom({ events: [event('Workshop', -60, 300), event('Call', 30, 60)] }, NOW).map(m => m.title)
    expect(titles).toEqual(['Call'])
  })

  test('a meeting in progress says until when', () => {
    const [m] = meetingsFrom({ events: [event('Planning', -10, 20)] }, NOW)
    expect(meetingPart(m!, NOW).levels[0]).toMatch(/^📅 now: Planning until \d\d:\d\d$/)
    expect(meetingPart(m!, NOW).color).toBe('cyan')
  })

  test('PRs rank reviews, then failing CI (drafts last), then changes requested', () => {
    const withReview = { data: { ...GITHUB.data, review: { nodes: [pr('web', 42)] } } }
    expect(prsFrom(withReview).map(p => `${p.repo}#${p.number} ${p.reason}`)).toEqual([
      'web#42 review', 'mods#19 ci', 'app#7 ci', 'api#3 changes',
    ])
  })

  test('Slack text drops emoji codes and keeps the first line', () => {
    const [first] = dmsFrom(SLACK)
    expect(first).toMatchObject({ from: 'Alex Doe', text: 'are you joining?', url: `https://slack.test/p${NOW / 1000 - 600}` })
  })

  test('Slack markup reads as text, and the user id comes from the profile', () => {
    expect(dmsFrom(MENTIONS)[0]!.text).toBe('can @me look at the doc?')
    expect(slackIdFrom(PROFILE)).toBe('U1')
    expect(slackIdFrom({ result: 'nothing here' })).toBeUndefined()
  })

  test('DMs and mentions merge newest first, each once', () => {
    const dm = (url: string, at: number) => ({ from: 'A', text: '', at, url })
    expect(mergeDms([dm('a', 1), dm('b', 3)], [dm('b', 3), dm('c', 2)]).map(d => d.url)).toEqual(['b', 'c', 'a'])
  })

  test('fit shrinks in order: Slack, then Linear and PRs, then the meeting', () => {
    const parts = [
      { levels: ['MMMMMMMMMM', 'MMMMM', 'M'] },
      { levels: ['PPPPPPPPPP', 'PPPPP', 'P'] },
      { levels: ['LLLLLLLLLL', 'LLLLL', 'L'] },
      { levels: ['SSSSSSSSSS', 'S'] },
    ]
    expect(fit(parts, 100)).toEqual(['MMMMMMMMMM', 'PPPPPPPPPP', 'LLLLLLLLLL', 'SSSSSSSSSS'])
    expect(fit(parts, 40)).toEqual(['MMMMMMMMMM', 'PPPPPPPPPP', 'LLLLLLLLLL', 'S'])
    expect(fit(parts, 30)).toEqual(['MMMMMMMMMM', 'PPPPP', 'LLLLL', 'S'])
    expect(fit(parts, 5)).toEqual(['M', 'P', 'L', 'S'])
  })

  test('emoji and CJK take two cells', () => {
    expect(cells('📅 a')).toBe(4)
    expect(cells('会議 x')).toBe(6)
  })
})
