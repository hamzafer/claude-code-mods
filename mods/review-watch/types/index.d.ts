export type Review = {
  id: string
  kind: 'codex' | 'agent'
  model: string
  label: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  key?: string // a Codex review: a string of its command line, to find its process
  out?: string // a Codex review: the file its output goes to
  seen?: boolean // a Codex review: its process has shown up in ps
  polls?: number
  last: string
  findings?: string[] // a Codex review: P1, P2, ... per finding
}

declare module 'claude-code' {
  interface PluginState {
    'review-watch': { reviews: Review[]; now: number }
  }
}
