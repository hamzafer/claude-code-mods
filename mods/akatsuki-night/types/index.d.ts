// What the signal shows. One value, so a state that can't happen can't be written:
// only a lit signal has a burst, and only a pending ask has an ask id.
export type Signal =
  // Claude is busy: clouds drift and the eye in the moon slowly turns.
  | { mode: 'working' }
  // A permission ask is up but may still be settled by Auto mode: stay calm for now.
  | { mode: 'asking'; askId: string }
  // Claude needs you: the eye locks and the moon flares, with this burst of crows.
  | { mode: 'waiting'; burst: number }

declare module 'claude-code' {
  interface PluginState {
    'akatsuki-night': {
      signal: Signal
    }
  }
}
