import { describe, expect, mock, test } from 'claude-code/testing'

import { actionOf, bar, clock, lyricAt, parseLrc, parseTrack, pickSynced, positionAt } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } }
// A made-up track, as osascript prints it.
const PLAYING = 'playing\nspotify:track:demo1\nPaper Lanterns\nThe Night Owls\nCity Lights\n200000\n61,5\n'
const LRC = '[00:58.00] Hold the light up high\n[01:02.50] Paper lanterns in the sky\n[01:10.00]\n'

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the first poll runs in the background

// Stands for the engine beneath the mod: a Spotify that answers osascript, and LRCLIB.
function engine(on: any, spotify: { out: string; isRunning?: boolean; os?: string }) {
  const runs: string[][] = []
  const urls: string[] = []
  const commands: string[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => (commands.push(e.name), { value: undefined }))
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'uname') return { value: { exitCode: 0, stdout: `${spotify.os ?? 'Darwin'}\n`, stderr: '' } }
    runs.push(argv)
    if (argv[0] === 'pgrep') return { value: { exitCode: spotify.isRunning === false ? 1 : 0, stdout: '', stderr: '' } }
    const script = argv[2] ?? ''
    if (spotify.isRunning === false) return { value: { exitCode: 0, stdout: 'closed\n', stderr: '' } }
    if (/to playpause/.test(script)) spotify.out = spotify.out.replace(/^(playing|paused)/, s => (s === 'playing' ? 'paused' : 'playing'))
    if (/to (playpause|next track|previous track)/.test(script)) return { value: { exitCode: 0, stdout: 'ok\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: spotify.out, stderr: '' } }
  })
  on('http.fetch', (_$: any, e: any) => {
    urls.push(e.url)
    if (e.url.includes('/get?')) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ syncedLyrics: LRC }) } }
    return { value: { status: 200, ok: true, headers: {}, text: '[]' } }
  })
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  return { runs, urls, commands }
}

describe('now-playing', () => {
  test('helpers', () => {
    const t = parseTrack(PLAYING, 1_000)!
    expect(t).toEqual({ state: 'playing', id: 'spotify:track:demo1', name: 'Paper Lanterns', artist: 'The Night Owls', album: 'City Lights', duration: 200, position: 61.5, at: 1_000 })
    expect(parseTrack('closed\n', 0)).toBeNull()
    expect(parseTrack('stopped\n', 0)).toBeNull()
    expect(parseTrack(PLAYING.replace('61,5', '61.5'), 0)?.position).toBe(61.5) // either decimal mark

    expect(positionAt(t, 3_000)).toBe(63.5) // moves on with the clock while playing
    expect(positionAt({ ...t, state: 'paused' }, 9_000)).toBe(61.5)
    expect(positionAt(t, 1_000_000)).toBe(200) // never past the end

    const l = { id: t.id, lines: parseLrc(LRC) }
    expect(l.lines).toEqual([[58, 'Hold the light up high'], [62.5, 'Paper lanterns in the sky'], [70, '']])
    expect(lyricAt(l, 10)).toBe('')
    expect(lyricAt(l, 61.5)).toBe('Hold the light up high')
    expect(lyricAt(l, 65)).toBe('Paper lanterns in the sky')
    expect(lyricAt(l, 75)).toBe('') // an instrumental gap

    expect(pickSynced([{ duration: 260, syncedLyrics: 'far' }, { duration: 202, syncedLyrics: 'near' }, { duration: 200, syncedLyrics: null }], 200)).toBe('near')
    expect(pickSynced([], 200)).toBe('')

    expect(bar(50, 200, 12)).toEqual({ done: '━━━', left: '─────────' })
    expect(bar(0, 0, 4)).toEqual({ done: '', left: '────' })
    expect(clock(111)).toBe('1:51')
    expect(clock(3_725)).toBe('1:02:05')

    expect(actionOf('')).toBe('toggle')
    expect(actionOf(' Next ')).toBe('next')
    expect(actionOf('back')).toBe('prev')
    expect(actionOf('louder')).toBeNull()
  })

  test('draws the track, progress and lyric line, and fetches lyrics once', async ($, on) => {
    const clk = mock.clock(on, { now: 1_000_000 })
    const e = engine(on, { out: PLAYING })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'now-playing', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: '🎵' })).toBeDefined() // the icon is its own plain Text
    expect(await band.find({ type: 'Text', text: ' Paper Lanterns' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: ' · The Night Owls' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: ' 1:01/3:20' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: ' · ♪ Hold the light up high' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'band below' })).toBeDefined()
    await clk.advance(4_000) // the clock moves the line on, and polls again
    expect(await band.find({ type: 'Text', text: ' · ♪ Paper lanterns in the sky' })).toBeDefined()
    await band.unmount()
    await settle()
    expect(e.urls.length).toBe(1) // same track: no second fetch
    expect(e.urls[0]).toMatch(/^https:\/\/lrclib\.net\/api\/get\?track_name=Paper\+Lanterns&artist_name=The\+Night\+Owls/)
  })

  test('paused dims, and no lyrics are drawn', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    engine(on, { out: PLAYING.replace('playing', 'paused') })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'now-playing', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: '⏸' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /♪/ })).toBeUndefined()
    await band.unmount()
  })

  test('Spotify closed: no line, no osascript, and /music never starts it', async ($, on) => {
    const clk = mock.clock(on, { now: 1_000_000 })
    const e = engine(on, { out: PLAYING, isRunning: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await clk.advance(12_000)
    const band = await $.ui.mount({ plugin: 'now-playing', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /🎵|⏸/ })).toBeUndefined()
    await band.unmount()
    expect(e.runs.every(a => a[0] === 'pgrep')).toBe(true)
    expect((await $.command.run({ command: 'music', args: '' } as any)).text).toMatch(/^Spotify is not running/)
  })

  test('the ⏮ ⏸ ⏭ buttons and /music control Spotify', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const e = engine(on, { out: PLAYING })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const sent = () => e.runs.map(a => /to (playpause|next track|previous track)/.exec(a[2] ?? '')?.[1]).filter(Boolean)

    const band = await $.ui.mount({ plugin: 'now-playing', surface: 'terminal', ...BAND } as any)
    await band.press({ key: 'next' })
    await band.press({ key: 'toggle' })
    await settle()
    expect(sent()).toEqual(['next track', 'playpause'])
    expect(await band.find({ type: 'Text', text: '⏸' })).toBeDefined() // paused now: the line dims
    await band.press({ key: 'prev' })
    await settle()
    expect(sent()).toEqual(['next track', 'playpause', 'previous track'])
    await band.unmount()

    expect((await $.command.run({ command: 'music', args: '' } as any)).text).toBe('🎵 Paper Lanterns · The Night Owls') // the new state, read right after
    expect((await $.command.run({ command: 'music', args: 'next' } as any)).text).toBe('🎵 Paper Lanterns · The Night Owls')
    expect(sent()).toEqual(['next track', 'playpause', 'previous track', 'playpause', 'next track'])
    expect((await $.command.run({ command: 'music', args: 'louder' } as any)).text).toMatch(/^Usage/)
  })

  test('Spotify quits between polls: a button press clears the line', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const spotify = { out: PLAYING, isRunning: true }
    engine(on, spotify)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'now-playing', surface: 'terminal', ...BAND } as any)
    spotify.isRunning = false
    await band.press({ key: 'toggle' })
    await settle()
    expect(await band.find({ type: 'Text', text: /🎵|⏸/ })).toBeUndefined()
    await band.unmount()
  })

  test('off macOS: no command, nothing runs, no line', async ($, on) => {
    const clk = mock.clock(on, { now: 1_000_000 })
    const e = engine(on, { out: PLAYING, os: 'Linux' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await clk.advance(12_000)
    expect(e.commands).toEqual([])
    expect(e.runs).toEqual([])
    const band = await $.ui.mount({ plugin: 'now-playing', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /🎵|⏸/ })).toBeUndefined()
    await band.unmount()
  })

  test('lyrics off: nothing is fetched', { options: { lyrics: false } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const e = engine(on, { out: PLAYING })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect(e.urls).toEqual([])
  })
})
