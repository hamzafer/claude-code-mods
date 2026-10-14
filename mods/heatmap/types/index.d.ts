export type Scope = 'all' | 'here'

declare module 'claude-code' {
  interface PluginState {
    'heatmap': { scope: Scope; version: number; isLoading: boolean }
  }
}
