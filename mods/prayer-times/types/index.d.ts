export type Tick = number // the last clock tick, so the line redraws each minute

declare module 'claude-code' {
  interface PluginState {
    'prayer-times': { now: Tick }
  }
}
