export type NextSteps = { turnId: string; items: string[] }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { steps: NextSteps | null; active: boolean }
  }
}
