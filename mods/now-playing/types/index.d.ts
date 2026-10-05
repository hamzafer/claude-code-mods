export type Track = {
  state: 'playing' | 'paused'
  id: string // Spotify's track URI
  name: string
  artist: string
  album: string
  duration: number // seconds
  position: number // seconds, at `at`
  at: number // when it was read, ms since the epoch
}

export type Lyrics = {
  id: string // the track they belong to
  lines: [number, string][] // seconds into the track, the line sung from then
}

declare module 'claude-code' {
  interface PluginState {
    'now-playing': { track: Track | null; lyrics: Lyrics | null; now: number }
  }
}
