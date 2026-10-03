// Snake: play in a pane while Claude works; it pauses when Claude is done.
// Nothing opens until /snake; /snake stop turns it off again.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'snake'
const BEST_KEY = 'best'

// Held by the host, so a hot reload keeps the game's mode and scores.
const isPlaying = atom({ plugin: 'snake', key: 'isPlaying' } as const, false)
const score = atom({ plugin: 'snake', key: 'score' } as const, 0)
const best = atom({ plugin: 'snake', key: 'best' } as const, 0)
const isOn = atom({ plugin: 'snake', key: 'isOn' } as const, false)

export const register: Register = on => {
  let isWorking = false // a main-loop turn is running, whether or not Snake is on
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'snake', description: 'Play Snake in a pane while Claude works; /snake stop ends it', argumentHint: '[stop]' }).catch(() => {})
    const saved = Number(await $.store.get(BEST_KEY).catch(() => 0)) || 0
    await update($, best, b => Math.max(b, saved))
    return r
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    if (!(await read($, isOn))) return next(e) // opt-in: nothing until /snake
    await update($, isPlaying, () => true)
    void $.ui.open({ id: PANE, title: 'Snake' }) // seats from 144 columns when opened unasked; /snake opens it at any width
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      isWorking = false
      await update($, isPlaying, () => false)
    }
    return r
  })

  on('command.run', { command: 'snake' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'stop') {
      await update($, isOn, () => false)
      await update($, isPlaying, () => false)
      await $.ui.close({ id: PANE })
      return { text: 'Snake is off. /snake turns it back on.' }
    }
    await update($, isOn, () => true)
    await update($, isPlaying, () => isWorking) // turned on mid-turn: play now, not next turn
    await $.ui.open({ id: PANE, title: 'Snake', focus: true })
    return { text: 'Snake is on. It plays while Claude works. /snake stop turns it off.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Snake plays in the terminal or desktop app.</Text>
    }
    const { Client } = $.ui.resolve(e)
    const props = { isPlaying: await read($, isPlaying), best: await read($, best) }
    // An exact size: a percentage height has nothing to stretch against inside a pane.
    const width = Math.max(1, e.props.bodyColumns)
    const height = Math.max(1, e.props.scroll.bodyRows - 1)
    return <Client key="snake" module="./game.tsx" props={props} width={width} height={height} />
  })

  // The game posts its score whenever it eats or crashes.
  on('ui.message', async ($, e) => {
    const data = e.data as { score?: unknown }
    if (e.element !== 'snake' || typeof data?.score !== 'number') return {}
    const now = data.score
    await update($, score, () => now)
    const before = await read($, best)
    if (now > before) {
      await update($, best, () => now)
      await $.store.set(BEST_KEY, now)
    }
    return {}
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const playing = await read($, isPlaying)
    const points = await read($, score)
    if (!playing || points === 0) return next(e)
    const top = await read($, best)
    const text = e.props.message ?? e.props.word
    return next({ ...e, props: { ...e.props, message: `${text} · 🐍 ${points} (best ${top})` } })
  })
}
