import { expect, test } from 'claude-code/testing'

import { INITIAL, transition } from '../hooks/state.js'

test('a session starts sweeping, so the first prompt never flashes the signal', () => {
  expect(INITIAL).toEqual({ mode: 'working' })
})

test('a turn sweeps, its end lights the signal with a new burst', () => {
  const working = transition(INITIAL, { type: 'turnStarted' })
  expect(working).toEqual({ mode: 'working' })
  expect(transition(working, { type: 'turnEnded', seed: 7 })).toEqual({ mode: 'waiting', burst: 7 })
})

test('lighting an already lit signal keeps its burst', () => {
  const lit = { mode: 'waiting', burst: 7 } as const
  expect(transition(lit, { type: 'turnEnded', seed: 9 })).toBe(lit)
  expect(transition(lit, { type: 'questionOpened', seed: 9 })).toBe(lit)
})

test('an ask lights the signal only if it is the same ask, still unanswered', () => {
  const asking = transition({ mode: 'working' }, { type: 'askRaised', askId: 'a' })
  expect(asking).toEqual({ mode: 'asking', askId: 'a' })
  expect(transition(asking, { type: 'askUnanswered', askId: 'old', seed: 3 })).toBe(asking)
  expect(transition(asking, { type: 'askUnanswered', askId: 'a', seed: 3 })).toEqual({ mode: 'waiting', burst: 3 })
})

test('an ask settled before its timer leaves nothing behind', () => {
  const asking = transition({ mode: 'working' }, { type: 'askRaised', askId: 'a' })
  const ran = transition(asking, { type: 'toolRan' })
  expect(ran).toEqual({ mode: 'working' })
  expect(transition(ran, { type: 'askUnanswered', askId: 'a', seed: 3 })).toBe(ran)
})

test('an ask while the signal is lit changes nothing', () => {
  const lit = { mode: 'waiting', burst: 1 } as const
  expect(transition(lit, { type: 'askRaised', askId: 'a' })).toBe(lit)
})
