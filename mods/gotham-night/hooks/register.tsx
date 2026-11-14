// The hooks: each turns a Claude Code event into a signal event, and the Backdrop
// hook draws the scene for the current signal. All state logic lives in state.ts.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { LOOK, SCENE_NAME, UNPAINTABLE } from './look.js'
import { sceneFor } from './scene/index.js'
import { INITIAL, transition, type SignalEvent } from './state.js'

// How long a permission ask waits unanswered before the signal lights. Auto mode's
// classifier settles most asks sooner, so it never trips the signal.
const ASK_DELAY_MS = 1500

const seed = () => Math.floor(Math.random() * 2 ** 31)

const signal = atom({ plugin: 'gotham-night', key: 'signal' } as const, INITIAL)

type Engine = Parameters<typeof read>[0]
const send = (engine: Engine, event: SignalEvent) => update(engine, signal, state => transition(state, event))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (UNPAINTABLE !== undefined) $.ui.toast(UNPAINTABLE)
    // The terminal draws no look (isDrawn: false there), so stay quiet about it.
    await $.theme.set(LOOK)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await send($, { type: 'turnStarted' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await send($, { type: 'turnEnded', seed: seed() })
    return next(e)
  })

  // Permission asks: a plugin that runs first can swallow the classic PermissionRequest
  // and Notification hooks, so watch the verdict on real calls instead.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const askId = e.tool_use_id
    if (askId !== undefined && e.approver === 'person' && verdict.decision === 'ask') {
      await send($, { type: 'askRaised', askId })
      $.clock.after(ASK_DELAY_MS, () => void send($, { type: 'askUnanswered', askId, seed: seed() }))
    }
    return verdict
  })

  // A question to you lights the signal until you answer; any other tool running
  // (after its prompt, if it had one) means Claude is working again.
  on('tool.call', async ($, e, next) => {
    const question = e.tool === 'AskUserQuestion'
    if (question) await send($, { type: 'questionOpened', seed: seed() })
    const result = await next(e)
    await send($, { type: question ? 'questionAnswered' : 'toolRan' })
    return result
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (e.props.plugin !== $.plugin.name || e.props.scene !== SCENE_NAME) return next(e)
    const now = await read($, signal)
    const { Svg } = $.ui.resolve(e)
    return (
      <Svg
        source={sceneFor(now)}
        alt={
          now.mode === 'waiting'
            ? 'A rainy city at night, a searchlight throwing a bat signal on the clouds: Claude needs you'
            : 'A rainy city at night, searchlights sweeping the clouds: Claude is working'
        }
        isInteractive
      />
    )
  })
}
