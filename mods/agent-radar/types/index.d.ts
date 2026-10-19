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
  kind?: RadarKind // absent: a subagent
  command?: string // shell: the Bash command
  detail?: string // shell: the Bash description, else the start of the command
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
