// The signal's state machine, pure: the hooks turn Claude Code's events into these
// events, and every change of state goes through transition().
//
//   working ──turnEnded / questionOpened──────────────▶ waiting(burst)
//   working ──askRaised──▶ asking ──askUnanswered──────▶ waiting(burst)
//   asking / waiting ──turnStarted / questionAnswered / toolRan──▶ working
//
// Randomness comes in on the event (seed), so the machine itself stays deterministic.

import type { Signal } from '../types'

export type SignalEvent =
  | { type: 'turnStarted' }
  | { type: 'turnEnded'; seed: number }
  | { type: 'questionOpened'; seed: number }
  | { type: 'questionAnswered' }
  | { type: 'askRaised'; askId: string }
  | { type: 'askUnanswered'; askId: string; seed: number }
  | { type: 'toolRan' }

const WORKING: Signal = { mode: 'working' }

// Where a session starts. In Desktop the mod loads with your first message, so the
// first thing that happens is a turn: starting lit would flash the signal before the
// beams. The state survives a reload of the mod, so a reload mid-turn changes nothing.
export const INITIAL: Signal = WORKING

// Light the signal. Already lit keeps its burst, so a repeat doesn't replay the bats.
function light(state: Signal, seed: number): Signal {
  return state.mode === 'waiting' ? state : { mode: 'waiting', burst: seed }
}

export function transition(state: Signal, event: SignalEvent): Signal {
  switch (event.type) {
    case 'turnStarted':
    case 'questionAnswered':
    case 'toolRan':
      return state.mode === 'working' ? state : WORKING
    case 'turnEnded':
    case 'questionOpened':
      return light(state, event.seed)
    case 'askRaised':
      return state.mode === 'working' ? { mode: 'asking', askId: event.askId } : state
    case 'askUnanswered':
      // Only the ask that started the wait can end it; a stale timer does nothing.
      return state.mode === 'asking' && state.askId === event.askId ? light(state, event.seed) : state
  }
}
