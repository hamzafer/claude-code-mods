// What the signal shows. One value, so a state that can't happen can't be written:
// only a lit signal has a bat burst, and only a pending ask has an ask id.
export type Signal =
  // Claude is busy: the reactor spins.
  | { mode: 'working' }
  // A permission ask is up but may still be settled by Auto mode: keep spinning for now.
  | { mode: 'asking'; askId: string }
  // Claude needs you: the reactor locks and flares, with this scatter of sparks.
  | { mode: 'waiting'; burst: number }

declare module 'claude-code' {
  interface PluginState {
    'stark-lab': {
      signal: Signal
    }
  }
}
