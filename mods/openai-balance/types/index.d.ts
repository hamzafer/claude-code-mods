// What the band above the prompt draws.
export type Line = {
  left: number | null // estimated balance, null until one is set
  start: number | null // the balance it was set to, for the gauge
  today: number // spend in the current UTC day
  last: { at: number; model: string; key: string } | null // the newest request today (UTC)
  top: string | null // today's biggest cost line item, for spend with no usage row (Decisions)
  error: 'no-key' | 'rejected' | 'offline' | null // offline keeps the last numbers, marked
  isLoaded: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'openai-balance': { line: Line }
  }
}
