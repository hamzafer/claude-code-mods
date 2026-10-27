export type RadarKind = 'agent' | 'shell'

export type RadarAgent = {
  id: string
  description: string
  type: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  tools: number
  last: string
  model?: string // agent: the model it runs on, as agent.spawn resolved it
  kind?: RadarKind // absent: a subagent
  detail?: string // shell: the Bash description, else the program it runs (never the whole command line)
  out?: string // shell: the file Claude Code writes its output to
  seen?: boolean // shell: its output file has been seen open
  misses?: number // shell: consecutive polls that found its output file closed
  lines?: string[] // shell: the last lines of its output, for the pane
}

declare module 'claude-code' {
  interface PluginState {
    'agent-radar': { agents: RadarAgent[]; selected: string | null; now: number }
  }
}
