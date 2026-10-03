export type Recap = { goal: string; now: string; waiting: string; next: string }

declare module 'claude-code' {
  interface PluginState {
    'where-am-i': { recap: Recap | null; live: string }
    // Owned by the next-steps mod, read here. Kept the same as its own contract.
    'next-steps': { steps: { turnId: string; items: string[] } | null; active: boolean }
  }
}
