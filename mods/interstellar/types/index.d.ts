// What the signal shows. One value, so a state that can't happen can't be written:
// only a lit signal has a bat burst, and only a pending ask has an ask id.
export type Signal =
  // Claude is busy: the disc turns and the ship is on its way.
  | { mode: 'working' }
  // A permission ask is up but may still be settled by Auto mode: keep working for now.
  | { mode: 'asking'; askId: string }
  // Claude needs you: the ship hails you, with this burst of shooting stars.
  | { mode: 'waiting'; burst: number }

declare module 'claude-code' {
  interface PluginState {
    'interstellar': {
      signal: Signal
    }
  }
}
