export type Recap = { goal: string; now: string; waiting: string; next: string }

declare module 'claude-code' {
  interface PluginState {
    'where-am-i': { recap: Recap | null; live: string }
  }
}
