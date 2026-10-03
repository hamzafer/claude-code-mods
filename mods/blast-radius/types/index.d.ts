export type HeldCommand = {
  id: string
  command: string
  risk: 'delete' | 'force-push' | 'migration'
  summary: string
  details: string[]
  where: 'pane' | 'band'
  /** Seconds until the hold auto-cancels; null when it waits for a press forever. */
  secondsLeft: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': { held: HeldCommand | null }
  }
}
