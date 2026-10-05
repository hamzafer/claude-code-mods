// Now Playing: what is Spotify playing?
//   One line above the prompt: the track and artist, a progress bar, the time, and the
//   lyric line being sung (synced lyrics from LRCLIB, fetched once per track). Paused, the
//   line dims; Spotify closed, it goes away. The mod never opens Spotify itself.
//   With an empty prompt, ⌥ Space plays or pauses, ⌥ ← goes back and ⌥ → skips (the
//   terminal must send Option as Alt). /music, /music next and /music prev do the same.
import { atom, read, update } from 'claude-code'
import type { ClientKeyEvent, EngineInterface, Register, Timer } from 'claude-code'

import type { Lyrics, Track } from '../types'

const PLAYING_POLL_MS = 3_000 // between polls the position moves on with the clock
const IDLE_POLL_MS = 5_000 // paused or closed
const LYRICS_TIMEOUT_MS = 5_000
const BAR = 12
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

export const ACTIONS = { toggle: 'playpause', next: 'next track', prev: 'previous track' } as const
export type Action = keyof typeof ACTIONS

// Held by the host, so the line survives a hot reload of this file.
const track = atom({ plugin: 'now-playing', key: 'track' } as const, null as Track | null)
const lyrics = atom({ plugin: 'now-playing', key: 'lyrics' } as const, null as Lyrics | null)
const now = atom({ plugin: 'now-playing', key: 'now' } as const, 0)

let polling: Promise<void> | null = null // a slow osascript must not let two polls overlap
// Module-level, so a hot reload (which runs register again) can cancel the old loop.
let timers: Timer[] = []

export const register: Register = (on, options) => {
  const wantsLyrics = options.lyrics !== false
  let lastPoll = 0
  let isMac = false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    for (const t of timers) t.cancel()
    timers = []
    // Off macOS there is no Spotify to ask: no command, no polling, nothing runs again.
    const uname = await $.process.run(['uname', '-s'], { timeoutMs: 3_000 }).catch(() => null)
    isMac = uname?.stdout.trim() === 'Darwin'
    if (!isMac) return r
    await $.command.register({ name: 'music', description: 'Spotify: play or pause. /music next, /music prev skip' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    lastPoll = await $.clock.now()
    timers = [
      $.clock.every(1000, () => {
        void (async () => {
          const t = await $.clock.now()
          const cur = await read($, track)
          if (cur?.state === 'playing') await update($, now, () => t) // the bar moves each second without running anything
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

  // ⌥ Space, ⌥ ← and ⌥ → in an empty prompt control Spotify instead of editing.
  on('prompt.edit', async ($, e, next) => {
    const action = isMac && e.text === '' && e.start === 0 && e.end === 0 ? hotkey(e.key) : null
    if (!action || !(await read($, track))) return next(e)
    // Spotify may have quit since the last poll: then the key is the editor's after all.
    if (!(await control($, action, wantsLyrics).catch(() => false))) return next(e)
    return { text: '', cursor: 0 } // consumed: the box stays empty
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
    const { Box, Text } = $.ui.resolve(e)
    const pos = positionAt(t, Math.max(tick, t.at))
    const sung = l && l.id === t.id ? lyricAt(l, pos) : ''
    const isPaused = t.state !== 'playing'
    const b = bar(pos, t.duration, BAR)
    return (
      <Box flexDirection="column">
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            {/* A leading emoji is drawn plain: some terminals shift or clip a bold one. */}
            <Text dimColor={isPaused}>{isPaused ? '⏸' : '🎵'}</Text>
            <Text bold={!isPaused} dimColor={isPaused}>{` ${t.name}`}</Text>
            <Text dimColor>{` · ${t.artist}`}</Text>
            {!isPaused && <Text color="#1db954">{`  ${b.done}`}</Text>}
            {!isPaused && <Text dimColor>{b.left}</Text>}
            {!isPaused && <Text dimColor>{` ${clock(pos)}/${clock(t.duration)}`}</Text>}
            {!isPaused && sung !== '' && <Text dimColor italic>{` · ♪ ${sung}`}</Text>}
          </Text>
        </Box>
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
  // Closed last time: a cheap pgrep before any osascript, so an idle session runs almost nothing.
  if (!before) {
    const pg = await $.process.run(['pgrep', '-x', 'Spotify'], { timeoutMs: 3_000 }).catch(() => null)
    if (!pg || pg.exitCode !== 0) return
  }
  const out = await $.process.run(['osascript', '-e', READ_SCRIPT], { timeoutMs: 5_000 }).catch(() => null)
  if (!out || out.exitCode !== 0) return
  const t = parseTrack(out.stdout, await $.clock.now())
  await update($, track, () => t)
  if (t) await update($, now, () => t.at)
  if (t && wantsLyrics && t.id !== before?.id) void loadLyrics($, t).catch(() => {})
}

// Sends one command to Spotify, then reads it back. False when Spotify is not running.
async function control($: EngineInterface, action: Action, wantsLyrics: boolean) {
  const script = `if application "Spotify" is running then
  tell application "Spotify" to ${ACTIONS[action]}
  return "ok"
end if
return "closed"`
  const r = await $.process.run(['osascript', '-e', script], { timeoutMs: 5_000 })
  if (r.exitCode === 0 && r.stdout.trim() === 'closed') await update($, track, () => null) // it quit since the last poll
  if (r.exitCode !== 0 || r.stdout.trim() !== 'ok') return false
  await poll($, wantsLyrics, true)
  return true
}

// Fetches synced lyrics from LRCLIB: the exact match first, then a search. Silent on any error.
async function loadLyrics($: EngineInterface, t: Track) {
  const q = (p: Record<string, string>) => new URLSearchParams(p).toString()
  const seconds = String(Math.round(t.duration))
  let synced = await getJson($, `${LRCLIB}/get?${q({ track_name: t.name, artist_name: t.artist, album_name: t.album, duration: seconds })}`).then(
    (j: any) => (typeof j?.syncedLyrics === 'string' ? j.syncedLyrics : ''),
  )
  if (!synced) {
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

// ⌥ Space, ⌥ ←/→ (or the ⌥b and ⌥f a terminal may send for them) as an action.
export function hotkey(key: ClientKeyEvent | undefined): Action | null {
  if (!key?.meta || key.ctrl) return null
  if (key.key === ' ' || key.key === 'space') return 'toggle'
  if (key.key === 'left' || key.key === 'b') return 'prev'
  if (key.key === 'right' || key.key === 'f') return 'next'
  return null
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

// The search result with synced lyrics whose length is closest to the track's (within 5 s).
export function pickSynced(list: any[], duration: number) {
  const ok = list
    .filter(x => typeof x?.syncedLyrics === 'string' && x.syncedLyrics && Math.abs(Number(x.duration) - duration) <= 5)
    .sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))
  return ok[0]?.syncedLyrics ?? ''
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
