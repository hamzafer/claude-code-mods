export type Slice = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

export type Reading = {
  slices: Slice[]
  total: number // tokens in use
  window: number // the window measured against
  percent: number
  compactsAt?: number // where auto-compaction runs, when it is on
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { reading: Reading | null; isHidden: boolean }
  }
}
