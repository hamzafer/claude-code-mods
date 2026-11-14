// What the signal shows. One value, so a state that can't happen can't be written:
// only a lit signal has a bat burst, and only a pending ask has an ask id.
export type Signal =
  // Claude is busy: searchlights sweep.
  | { mode: 'working' }
  // A permission ask is up but may still be settled by Auto mode: keep sweeping for now.
  | { mode: 'asking'; askId: string }
  // Claude needs you: the signal is lit, with this burst of bats.
  | { mode: 'waiting'; burst: number }

declare module 'claude-code' {
  interface PluginState {
    'gotham-night': {
      signal: Signal
    }
  }
}
