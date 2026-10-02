// One box in the "who" tree: the main loop, a subagent, or one tool call.
export type MissionNode = {
  id: string
  parent: string | null
  kind: 'main' | 'agent' | 'tool'
  label: string
  family: string // for tools: 'bash', 'edit', 'read', 'browser', 'mcp:<server>', ...
  status: 'running' | 'done' | 'failed'
  start: number
  end?: number
}

// One file in the code map.
export type MapFile = {
  path: string
  act: 'read' | 'edit' | 'write' | 'search'
  at: number
  changedTurn: number // the turn number it last changed in, 0 if never
  imports: string[] // resolved import targets, extension stripped
  why?: string
}

export type MissionFrame = { file: string; n: number } | null

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      nodes: MissionNode[]
      files: MapFile[]
      view: 'who' | 'code'
      frame: MissionFrame
      turn: number
      now: number
    }
  }
}
