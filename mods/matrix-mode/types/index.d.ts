// What the signal shows. One value, so a state that can't happen can't be written:
// only a waiting signal has a burst (it picks the columns that hold), and only a pending
// ask has an ask id.
export type Signal =
  // Claude is busy: the code rains.
  | { mode: 'working' }
  // A permission ask is up but may still be settled by Auto mode: keep raining for now.
  | { mode: 'asking'; askId: string }
  // Claude needs you: the rain slows for the prompt, and this burst picks the columns that hold.
  | { mode: 'waiting'; burst: number }

declare module 'claude-code' {
  interface PluginState {
    'matrix-mode': {
      signal: Signal
    }
  }
}
