// What the band above the prompt draws.
export type Line = {
  kind: 'account' | 'key' | null // a management key sees the account; a regular key only itself
  left: number | null // account credit, or what the key's limit leaves; null when neither is known
  start: number | null // credits bought, or the key's limit, for the gauge
  today: number | null // spend in the current UTC day, null when it can't be told yet
  month: number | null // the key's spend this UTC month (regular key only)
  since: number | null // unix seconds: "today" counts from here when the mod first saw the day after it began
  top: string | null // the model the last 30 days' money mostly went to (management key only)
  error: 'no-key' | 'rejected' | 'offline' | null // offline keeps the last numbers, marked
  isLoaded: boolean
  hasData: boolean // a refresh has succeeded at least once
}

declare module 'claude-code' {
  interface PluginState {
    'openrouter-balance': { line: Line }
  }
}
