export type UsageMeterWindow = { kind: string; percentUsed: number; resetsAt?: string }
export type UsageMeterSnapshot = { rateLimits: UsageMeterWindow[]; costUsd?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      snapshot: UsageMeterSnapshot | null
      tick: number
      warned: Record<string, number>
    }
  }
}
