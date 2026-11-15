// The hooks every theme shares: each turns a Claude Code event into a signal event, and
// the Backdrop hook draws the theme's scene for the current signal. All state logic
// lives in state.ts. The theme's own parts are look.ts (LOOK, SCENE_NAME, UNPAINTABLE)
// and scene/index.ts (sceneFor, altFor).
//
// A copy of shared/theme/register.tsx: change it there, then copy it over again and
// put the mod's name back in the atom.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { LOOK, SCENE_NAME, UNPAINTABLE } from './look.js'
import { altFor, sceneFor } from './scene/index.js'
import { INITIAL, transition, type SignalEvent } from './state.js'

// How long a permission ask waits unanswered before the signal lights. Auto mode's
// classifier settles most asks sooner, so it never trips the signal.
const ASK_DELAY_MS = 1500

const seed = () => Math.floor(Math.random() * 2 ** 31)

// Claude Code reads the plugin and key here as written, so this is the one line that
// differs in each copy: '<theme>' becomes the mod's own name.
const signal = atom({ plugin: 'gotham-night', key: 'signal' } as const, INITIAL)

type Engine = Parameters<typeof read>[0]

// Every change goes through transition(); an event that changes nothing writes nothing,
// so tool calls while Claude works don't redraw the scene.
// The transition runs again inside update(), so a write that landed in between wins.
async function send(engine: Engine, event: SignalEvent) {
  const before = await read(engine, signal)
  if (transition(before, event) === before) return
  await update(engine, signal, state => transition(state, event))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (UNPAINTABLE !== undefined) $.ui.toast(UNPAINTABLE)
    // The terminal draws no look (isDrawn: false there), so stay quiet about it.
    await $.theme.set(LOOK)
    return next(e)
  })

  // Only the main loop's turns and tools count: a background subagent finishing, or
  // another plugin calling a tool, says nothing about whether Claude needs you.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await send($, { type: 'turnStarted' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await send($, { type: 'turnEnded', seed: seed() })
    return next(e)
  })

  // Permission asks: a plugin that runs first can swallow the classic PermissionRequest
  // and Notification hooks, so watch the verdict on real calls instead.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const askId = e.tool_use_id
    const asksYou = e.approver === 'person' && verdict.decision === 'ask'
    const fromClaude = e.agentId === undefined && next.origin.plugin === 'engine'
    if (askId !== undefined && fromClaude && asksYou) {
      await send($, { type: 'askRaised', askId })
      $.clock.after(ASK_DELAY_MS, () => {
        send($, { type: 'askUnanswered', askId, seed: seed() }).catch(() => {})
      })
    }
    return verdict
  })

  // A question to you lights the signal until you answer. Any other tool finishing means
  // Claude is working again. There is no event for the moment you approve a permission
  // prompt, so a lit signal stays until that tool has finished.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || next.origin.plugin !== 'engine') return next(e)
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
      <Svg source={sceneFor(now)} alt={altFor(now)} isInteractive />
    )
  })
}
