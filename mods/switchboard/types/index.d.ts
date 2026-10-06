export type Tier = 'haiku' | 'sonnet' | 'opus'

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// One subagent spawn and what the router did with it.
export type Route = {
  id: string // the Agent tool call's id
  agentId?: string
  description: string
  type: string
  asked: string // the model the caller asked for, or the parent's when it asked for none
  picked: Tier
  by: 'jev' | 'rules'
  confidence?: number // Jev's, 0 to 1
  reason: string
  applied: boolean // false in suggest mode, or when the pick matched what was asked
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  model?: string // what it ran on, as the API reports it
  usage?: Usage
  costUsd?: number // at API prices, for the tokens it used
  askedUsd?: number // the same tokens at the asked model's prices
  jevUsd?: number // what the routing call itself cost
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: { routes: Route[]; now: number }
  }
}
