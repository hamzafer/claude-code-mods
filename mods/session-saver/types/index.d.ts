export type Parked = { leftOff: string; next: string; note: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'session-saver': { resumed: Parked | null; isShown: boolean }
  }
}
