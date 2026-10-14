import { describe, expect, test } from 'claude-code/testing'

import { addDays, dayOf, localOffset } from '../hooks/heat'

const PANE = { component: 'Pane', requestId: 'heatmap', props: { title: 'Heatmap', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } }
const PROJECTS = '/home/me/.claude/projects'
const LEDGER = '/home/me/.claude/heatmap/days.jsonl'

// Local noon `back` days ago, and a few minutes after it: never near midnight.
function noon(back: number, plusMin = 0) {
  const day = addDays(dayOf(Date.now(), localOffset), -back)
  return new Date(Date.parse(`${day}T12:00:00`) + plusMin * 60_000).toISOString()
}

type World = { files: Record<string, string>; logs: Record<string, { cwd: string; times: string[] }>; toasts: string[]; saved: Record<string, unknown> }

// Stands for the engine beneath the mod: a home folder with session logs, grep, a store.
function engine(on: any, world: World, closed: string[] = []) {
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.root', () => ({ value: '/work/mods' }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: e.path === PROJECTS || e.path in world.files }))
  on('fs.read', (_$: any, e: any) => ({ value: world.files[e.path] ?? '' }))
  on('fs.write', (_$: any, e: any) => ((world.files[e.path] = e.text), { value: undefined }))
  on('fs.list', (_$: any, e: any) => {
    const paths = Object.keys(world.logs)
    if (e.path === PROJECTS) {
      const folders = [...new Set(paths.map(p => p.split('/')[0]!))]
      return { value: folders.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
    }
    const folder = e.path.slice(PROJECTS.length + 1)
    const files = paths.filter(p => p.startsWith(`${folder}/`)).map(p => p.slice(folder.length + 1))
    return { value: files.map(name => ({ name, kind: 'file', size: 1, mtimeMs: Date.now(), isLink: false })) }
  })
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv as string[]
    const log = world.logs[argv[argv.length - 1]!.slice(PROJECTS.length + 1)]
    const stdout = !log ? '' : argv.includes('-m1') ? `"cwd":"${log.cwd}"\n` : log.times.map(t => `"timestamp":"${t}"`).join('\n')
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('store.get', (_$: any, e: any) => ({ value: world.saved[e.key] }))
  on('store.set', (_$: any, e: any) => ((world.saved[e.key] = e.value), { value: undefined }))
  on('ui.toast', (_$: any, e: any) => (world.toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_$: any, e: any) => (closed.push(e.id), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
}

function sampleWorld(): World {
  const week = Array.from({ length: 7 }, (_, back) => [noon(back), noon(back, 3)]).flat() // 7 days in a row, 3 minutes each
  return {
    files: {},
    logs: {
      '-work-mods/a.jsonl': { cwd: '/work/mods', times: week },
      '-work-other/b.jsonl': { cwd: '/work/other', times: [noon(5), noon(5, 4), noon(5, 60)] }, // the hour-long pause adds nothing
    },
    toasts: [],
    saved: {},
  }
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/mods' })
  await $.session.end({ reason: 'other', sessionId: 's', resume: {} }) // waits on the refresh the start began
}

describe('heatmap mod', () => {
  test('backfills the ledger from the logs and shows the stats', async ($, on) => {
    const world = sampleWorld()
    engine(on, world)
    await start($)

    const ledger = world.files[LEDGER]!.trim().split('\n').map(l => JSON.parse(l))
    expect(ledger.length).toBe(8) // 7 days of mods, 1 of other
    expect(ledger.find((r: any) => r.p === '-work-other')).toMatchObject({ n: 'other', min: 4, s: 1 })

    expect((await $.command.run({ command: 'heatmap', args: '' } as any)).text).toBe('Opened the heatmap')
    const ui: any = await $.ui.mount({ plugin: 'heatmap', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: / · all projects$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /🔥 7-day streak · best 7/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /25m active · 8 sessions/ })).toBeDefined() // 7 × 3m + 4m
    expect(await ui.find({ type: 'Text', text: /^peak: \w{3} · 12:00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^mods +$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 84% · 21m$/ })).toBeDefined()

    await ui.press({ key: 'scope' }) // p: this repo only
    expect(await ui.find({ type: 'Text', text: / · mods$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /7 sessions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^other/ })).toBeUndefined() // no top list for one project
    await ui.unmount()
  })

  test('older days survive a log cleanup', async ($, on) => {
    const world = sampleWorld()
    engine(on, world)
    await start($)
    delete world.logs['-work-other/b.jsonl'] // Claude Code deleted the old log
    await start($)
    const ledger = world.files[LEDGER]!.trim().split('\n').map(l => JSON.parse(l))
    expect(ledger.some((r: any) => r.p === '-work-other')).toBe(true) // 5 days ago: outside the refresh window, kept
    expect(ledger.filter((r: any) => r.p === '-work-mods').length).toBe(7)
  })

  test('a streak milestone toasts once', async ($, on) => {
    const world = sampleWorld()
    engine(on, world)
    await start($)
    await start($)
    expect(world.toasts).toEqual(['🔥 7-day Claude streak · /heatmap'])
  })

  test('arrows move the day cursor; the grid posts p and q', async ($, on) => {
    const world = sampleWorld()
    const closed: string[] = []
    engine(on, world, closed)
    await start($)
    await $.command.run({ command: 'heatmap', args: '' } as any)
    const ui: any = await $.ui.mount({ plugin: 'heatmap', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: / · 3m · 1 session · top: mods$/, in: 'grid' })).toBeDefined() // starts on today

    await ui.key({ key: 'left' }) // a week back: still in the streak
    await ui.key({ key: 'up' })
    await ui.key({ key: 'up' }) // 9 days back: nothing
    expect(await ui.find({ type: 'Text', text: / · no activity$/, in: 'grid' })).toBeDefined()
    await ui.key({ key: 'down' })
    await ui.key({ key: 'down' })
    await ui.key({ key: 'down' }) // 6 days back
    expect(await ui.find({ type: 'Text', text: / · 3m · 1 session · top: mods$/, in: 'grid' })).toBeDefined()

    await ui.key({ key: 'p' })
    expect(await ui.find({ type: 'Text', text: / · mods$/ })).toBeDefined()
    await ui.key({ key: 'q' })
    expect(closed).toEqual(['heatmap'])
    await ui.unmount()
  })
})
