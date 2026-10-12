// Now Playing: what is Spotify playing?
//   One line above the prompt: the track and artist, a progress bar, the time, and the
//   lyric line being sung (synced lyrics from LRCLIB, fetched once per track). Paused, the
//   line dims; Spotify closed, it goes away. The mod never opens Spotify itself.
//   ⏮ ⏸ ⏭ at the end of the line are buttons: click them, or ctrl+x tab to the band and
//   press b, p or n. /music, /music next and /music prev do the same from the prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Lyrics, Track } from '../types'

const PLAYING_POLL_MS = 3_000 // between polls the position moves on with the clock
const IDLE_POLL_MS = 5_000 // paused or closed
const LYRICS_TIMEOUT_MS = 5_000
const BAR = 12
const LYRIC_LEAD_S = 0.3 // a line shows a moment early, as karaoke apps do
const LRCLIB = 'https://lrclib.net/api'
const AGENT = 'now-playing (https://github.com/hamzafer/claude-code-mods)'

// One osascript run: closed, stopped, or the player's state and track, a field per line.
// The `is running` check comes first, so asking never launches Spotify.
const READ_SCRIPT = `if application "Spotify" is running then
  tell application "Spotify"
    set s to player state as string
    if s is "stopped" then return "stopped"
    set t to current track
    return s & linefeed & (id of t) & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & (duration of t) & linefeed & (player position as string)
  end tell
end if
return "closed"`

// The same on Windows. Spotify publishes what it plays to the system media controls (SMTC), and Windows PowerShell 5.1
// can reach them (pwsh cannot load the Windows Runtime types). Output is the lines osascript prints: closed, or the
// state and track a field per line; the position is read now (SMTC keeps the last report), in a culture-free format.
const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']
const WIN_SESSION = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } | Select-Object -First 1
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(-1); $t.Result }
$lf = [string][char]10
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
if (-not $s) { [Console]::Out.Write('closed' + $lf); exit }`
const WIN_READ = `${WIN_SESSION}
$p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$state = switch ($s.GetPlaybackInfo().PlaybackStatus.ToString()) { 'Playing' { 'playing' } 'Paused' { 'paused' } default { 'stopped' } }
$t = $s.GetTimelineProperties()
$end = $t.EndTime.TotalSeconds
$pos = $t.Position.TotalSeconds
if ($state -eq 'playing') { $pos += ([DateTimeOffset]::UtcNow - $t.LastUpdatedTime).TotalSeconds }
$pos = [Math]::Max(0, [Math]::Min($pos, $end))
$c = [Globalization.CultureInfo]::InvariantCulture
[Console]::Out.Write((@($state, ($p.Title + '|' + $p.Artist + '|' + $p.AlbumTitle), $p.Title, $p.Artist, $p.AlbumTitle, [Math]::Round($end * 1000).ToString($c), $pos.ToString('0.0', $c)) -join $lf) + $lf)`
const WIN_ACTIONS = { toggle: 'TryTogglePlayPauseAsync', next: 'TrySkipNextAsync', prev: 'TrySkipPreviousAsync' } as const

// What reads Spotify's state on each system, and how long to wait for it: PowerShell starts slower than osascript.
const ASK = { darwin: { argv: ['osascript', '-e', READ_SCRIPT], timeoutMs: 5_000 }, win32: { argv: [...POWERSHELL, WIN_READ], timeoutMs: 10_000 } } as const

export const ACTIONS = { toggle: 'playpause', next: 'next track', prev: 'previous track' } as const
export type Action = keyof typeof ACTIONS
type Os = 'darwin' | 'win32'

// Held by the host, so the line survives a hot reload of this file.
const track = atom({ plugin: 'now-playing', key: 'track' } as const, null as Track | null)
const lyrics = atom({ plugin: 'now-playing', key: 'lyrics' } as const, null as Lyrics | null)
const now = atom({ plugin: 'now-playing', key: 'now' } as const, 0)

let polling: Promise<void> | null = null // a slow osascript must not let two polls overlap
// Module-level, so a hot reload (which runs register again) can cancel the old loop.
let timers: Timer[] = []
let os: Os | null = null // set at session start: how to ask Spotify here, or null when there is nothing to ask

export const register: Register = (on, options) => {
  const wantsLyrics = options.lyrics !== false
  let lastPoll = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    for (const t of timers) t.cancel()
    timers = []
    // Off macOS and Windows there is no Spotify to ask: no command, no polling, nothing runs again.
    os = await osOf($)
    if (!os) return r
    await $.command.register({ name: 'music', description: 'Spotify: play or pause. /music next, /music prev skip' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    lastPoll = await $.clock.now()
    timers = [
      $.clock.every(250, () => {
        void (async () => {
          const t = await $.clock.now()
          const cur = await read($, track)
          // Playing, the line moves on without running anything: 4 times a second while a lyric shows, else each second.
          const l = cur?.state === 'playing' ? await read($, lyrics) : null
          const hasLyrics = !!l && l.id === cur?.id && l.lines.length > 0
          if (cur?.state === 'playing' && (hasLyrics || t - (await read($, now)) >= 1000)) await update($, now, () => t)
          if (t - lastPoll >= (cur?.state === 'playing' ? PLAYING_POLL_MS : IDLE_POLL_MS)) {
            lastPoll = t
            await poll($, wantsLyrics)
          }
        })().catch(() => {})
      }),
    ]
    void poll($, wantsLyrics).catch(() => {})
    return r
  })

  on('session.end', async ($, e, next) => {
    for (const t of timers) t.cancel()
    timers = []
    return next(e)
  })

  on('command.run', { command: 'music' }, async ($, e) => {
    const action = actionOf(e.args)
    if (!action) return { text: 'Usage: /music (play or pause), /music next, /music prev' }
    const ok = await control($, action, wantsLyrics).catch(() => false)
    if (!ok) return { text: 'Spotify is not running. Open it first; /music never starts it' }
    const t = await read($, track)
    return { text: t ? `${t.state === 'playing' ? '🎵' : '⏸'} ${t.name} · ${t.artist}` : 'Done' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const t = await read($, track)
    const tick = await read($, now) // subscribes the line to the clock
    if (e.props.hasSurvey || !t) return rest
    const l = await read($, lyrics)
    const { Box, Button, Text } = $.ui.resolve(e)
    const press = (action: Action) => () => void control($, action, wantsLyrics).catch(() => false)
    const pos = positionAt(t, Math.max(tick, t.at))
    const line = l && l.id === t.id ? lyricAt(l, pos + LYRIC_LEAD_S) : ''
    const sung = isRtl(line) ? '' : line // a terminal draws right-to-left scripts garbled, cached lyrics included
    const isPaused = t.state !== 'playing'
    const b = bar(pos, t.duration, BAR)
    return (
      <Box flexDirection="column">
        <Box paddingX={1} flexDirection="row">
          {/* Narrow, the end of this Text goes first (the time, then the bar); the buttons stay. */}
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              {/* A leading emoji is drawn plain: some terminals shift or clip a bold one. */}
              <Text dimColor={isPaused}>{isPaused ? '⏸' : '🎵'}</Text>
              <Text bold={!isPaused} dimColor={isPaused}>{` ${t.name}`}</Text>
              <Text dimColor>{` · ${t.artist}`}</Text>
              {!isPaused && <Text color="#1db954">{`  ${b.done}`}</Text>}
              {!isPaused && <Text dimColor>{b.left}</Text>}
              {!isPaused && <Text dimColor>{` ${clock(pos)}/${clock(t.duration)}`}</Text>}
            </Text>
          </Box>
          <Box flexShrink={0} flexDirection="row" gap={0} marginLeft={2}>
            <Button key="prev" hotkey="b" label="⏮" onPress={press('prev')} />
            <Button key="toggle" hotkey="p" label={isPaused ? '▶' : '⏸'} onPress={press('toggle')} />
            <Button key="next" hotkey="n" label="⏭" onPress={press('next')} />
          </Box>
        </Box>
        {/* The lyric gets a line of its own, so the buttons never cut it. */}
        {!isPaused && sung !== '' && (
          <Box paddingX={1}>
            <Text dimColor italic wrap="truncate-end">{`   ♪ ${sung}`}</Text>
          </Box>
        )}
        {rest}
      </Box>
    )
  })
}

// Reads Spotify's state; on a new track, fetches its lyrics once. `fresh` waits out a poll
// already running and reads again, so a control action sees its own result.
async function poll($: EngineInterface, wantsLyrics: boolean, fresh = false) {
  if (polling && !fresh) return
  while (polling) await polling.catch(() => {})
  polling = pollOnce($, wantsLyrics)
  try {
    await polling
  } finally {
    polling = null
  }
}

async function pollOnce($: EngineInterface, wantsLyrics: boolean) {
  const before = await read($, track)
  // Closed last time: a cheap look at the process list before any osascript or PowerShell, so an idle session runs almost nothing.
  if (!before && !(await isRunning($))) return
  const asked = await $.clock.now()
  const { argv, timeoutMs } = ASK[os as Os] // a poll only runs once session.start found an os
  const out = await $.process.run([...argv], { timeoutMs }).catch(() => null)
  if (!out || out.exitCode !== 0) return
  // Spotify read its position partway through the call, not when the answer arrived.
  const t = parseTrack(out.stdout, asked + ((await $.clock.now()) - asked) / 2)
  await update($, track, () => t)
  if (t) await update($, now, () => t.at)
  if (t && wantsLyrics && t.id !== before?.id) void loadLyrics($, t).catch(() => {})
}

// Whether Spotify's process is there, without asking it anything, so asking never launches it.
async function isRunning($: EngineInterface) {
  if (os === 'win32') {
    // Get-Process takes about 0.35 s; tasklist, on the same machine, 1.5 s.
    const found = await $.process.run([...POWERSHELL, "if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) { 'running' }"], { timeoutMs: 10_000 }).catch(() => null)
    return !!found && found.stdout.includes('running')
  }
  const pg = await $.process.run(['pgrep', '-x', 'Spotify'], { timeoutMs: 3_000 }).catch(() => null)
  return !!pg && pg.exitCode === 0
}

// Sends one command to Spotify, then reads it back. False when Spotify is not running.
async function control($: EngineInterface, action: Action, wantsLyrics: boolean) {
  const mac = `if application "Spotify" is running then
  tell application "Spotify" to ${ACTIONS[action]}
  return "ok"
end if
return "closed"`
  const win = `${WIN_SESSION}
$ok = Await ($s.${WIN_ACTIONS[action]}()) ([bool])
[Console]::Out.Write($(if ($ok) { 'ok' } else { 'failed' }) + $lf)`
  const r = await $.process.run(os === 'win32' ? [...POWERSHELL, win] : ['osascript', '-e', mac], { timeoutMs: os === 'win32' ? 10_000 : 5_000 })
  if (r.exitCode === 0 && r.stdout.trim() === 'closed') await update($, track, () => null) // it quit since the last poll
  if (r.exitCode !== 0 || r.stdout.trim() !== 'ok') return false
  await poll($, wantsLyrics, true)
  return true
}

// macOS is asked through AppleScript, Windows through the media controls Spotify publishes. Elsewhere there is nothing to ask.
async function osOf($: EngineInterface): Promise<Os | null> {
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return 'win32'
  const uname = await $.process.run(['uname', '-s'], { timeoutMs: 3_000 }).catch(() => null)
  return uname?.stdout.trim() === 'Darwin' ? 'darwin' : null
}

// Fetches synced lyrics from LRCLIB: the exact match first, then a search. Silent on any error.
async function loadLyrics($: EngineInterface, t: Track) {
  const q = (p: Record<string, string>) => new URLSearchParams(p).toString()
  const seconds = String(Math.round(t.duration))
  let synced = await getJson($, `${LRCLIB}/get?${q({ track_name: t.name, artist_name: t.artist, album_name: t.album, duration: seconds })}`).then(
    (j: any) => (typeof j?.syncedLyrics === 'string' ? j.syncedLyrics : ''),
  )
  // Terminals can't draw right-to-left scripts (Urdu, Arabic, Persian, Hebrew) joined and in order,
  // so look for a romanized version; with none, show no lyric rather than garbled text.
  if (!synced || isRtl(synced)) {
    const list = await getJson($, `${LRCLIB}/search?${q({ track_name: t.name, artist_name: t.artist })}`)
    synced = pickSynced(Array.isArray(list) ? list : [], t.duration)
  }
  if ((await read($, track))?.id !== t.id) return // the track changed while we waited
  await update($, lyrics, () => ({ id: t.id, lines: parseLrc(synced) }))
}

async function getJson($: EngineInterface, url: string): Promise<unknown> {
  const timeout = $.clock.sleep(LYRICS_TIMEOUT_MS).then(() => null)
  const fetched = $.http
    .fetch(url, { headers: { 'User-Agent': AGENT, 'Lrclib-Client': AGENT } })
    .then(r => (r.ok ? JSON.parse(r.text) : null))
    .catch(() => null)
  return Promise.race([fetched, timeout])
}

export function actionOf(args: string): Action | null {
  const a = args.trim().toLowerCase()
  if (a === '' || a === 'play' || a === 'pause' || a === 'toggle') return 'toggle'
  if (a === 'next' || a === 'skip') return 'next'
  if (a === 'prev' || a === 'previous' || a === 'back') return 'prev'
  return null
}

// osascript's answer as a track; null when Spotify is closed or stopped.
export function parseTrack(stdout: string, at: number): Track | null {
  const f = stdout.replace(/\n$/, '').split('\n')
  if (f.length < 7) return null
  const [state, id, name, artist, album, ms, position] = f as [string, string, string, string, string, string, string]
  if (state !== 'playing' && state !== 'paused') return null
  const duration = Number(ms) / 1000
  const pos = Number(position.replace(',', '.')) // some locales print 38,7
  return {
    state,
    id,
    name: name || 'Unknown track',
    artist: artist || 'Unknown artist',
    album,
    duration: Number.isFinite(duration) ? duration : 0,
    position: Number.isFinite(pos) ? pos : 0,
    at,
  }
}

// Where playback is at `at`, moved on from the last poll while playing.
export function positionAt(t: Track, at: number) {
  const p = t.state === 'playing' ? t.position + Math.max(0, at - t.at) / 1000 : t.position
  return t.duration > 0 ? Math.min(p, t.duration) : p
}

// `[mm:ss.xx] words` lines, sorted, blank lines kept as pauses.
export function parseLrc(text: string): [number, string][] {
  const lines: [number, string][] = []
  for (const raw of text.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)]
    if (stamps.length === 0) continue
    const words = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) lines.push([Number(s[1]) * 60 + Number(s[2]!.replace(':', '.')), words])
  }
  return lines.sort((a, b) => a[0] - b[0])
}

export function lyricAt(l: Lyrics, seconds: number) {
  let line = ''
  for (const [at, words] of l.lines) {
    if (at > seconds) break
    line = words
  }
  return line
}

// The search result with synced lyrics whose length is closest to the track's (within 5 s),
// skipping right-to-left scripts the terminal would draw garbled.
export function pickSynced(list: any[], duration: number) {
  const ok = list
    .filter(x => typeof x?.syncedLyrics === 'string' && x.syncedLyrics && !isRtl(x.syncedLyrics) && Math.abs(Number(x.duration) - duration) <= 5)
    .sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))
  return ok[0]?.syncedLyrics ?? ''
}

// True when most letters are in a right-to-left script (Hebrew, Arabic, Urdu, Persian).
export function isRtl(text: string) {
  const letters = text.replace(/\[[^\]]*\]/g, '').match(/\p{L}/gu) ?? []
  if (letters.length === 0) return false
  const rtl = letters.filter(c => /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(c)).length
  return rtl / letters.length > 0.3
}

export function bar(pos: number, duration: number, width: number) {
  const n = duration > 0 ? Math.round(Math.min(1, Math.max(0, pos / duration)) * width) : 0
  return { done: '━'.repeat(n), left: '─'.repeat(width - n) }
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
