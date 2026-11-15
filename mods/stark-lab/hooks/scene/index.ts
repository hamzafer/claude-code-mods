// The backdrop for a signal state: a holographic workshop at night with a reactor to the
// right. Working, the reactor spins and the lab hums. When Claude needs you the lab
// hushes, the reactor locks and flares gold, brackets close in and it pings, with a
// scatter of sparks.
// Desktop draws it in a sandboxed frame; CSS animation only, no script.

import type { Signal } from '../../types'
import { lab } from './lab.js'
import { REACTOR, type Part } from './layout.js'
import { motes } from './motes.js'
import { panels } from './panels.js'
import { LOCK_S, reactor } from './reactor.js'
import { sparks } from './sparks.js'
import { target } from './target.js'

const MOTES = motes(7)

// The reactor and all that hangs round it move as one rig. In a narrower box the rig
// steps up and in, so it stays in view clear of the chat column and the message box.
// Each step is where the reactor's centre lands, and its size. Off its spot the reactor
// no longer stands over the floor, so its pool of light there goes.
const STEPS: { below: string; x: number; y: number; scale: number }[] = [
  { below: '3/2', x: 1240, y: 250, scale: 0.7 },
  { below: '1/1', x: 880, y: 215, scale: 0.68 },
]

function placed(x: number, y: number, scale: number): string {
  const tx = x - REACTOR.x * scale
  const ty = y - REACTOR.y * scale
  return `.rig{transform:translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${scale})}.pool{display:none}`
}

const PLACEMENT = STEPS.map(s => `@media (max-aspect-ratio: ${s.below}){${placed(s.x, s.y, s.scale)}}`).join('')

function build(burst?: number): string {
  const live = burst === undefined
  const room = lab(live)
  const core = reactor(burst)
  const hud = panels(live)
  const lock: Part[] = live ? [] : [target(LOCK_S), sparks(burst, LOCK_S)]
  const parts = [room.back, core, hud, MOTES, ...lock]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
  <radialGradient id="room" gradientUnits="userSpaceOnUse" cx="1150" cy="320" r="1250">
    <stop offset="0" stop-color="#0c1c2c"/>
    <stop offset="0.4" stop-color="#070e18"/>
    <stop offset="1" stop-color="#030508"/>
  </radialGradient>
  ${parts.map(p => p.defs).join('')}
</defs>
<style>
  .rig { transform-origin: 0 0; }
  ${PLACEMENT}
  ${parts.map(p => p.css).join('\n  ')}
  @media (prefers-reduced-motion: reduce) {
    ${[...new Set(parts.flatMap(p => p.animated))].join(', ')} { animation: none; }
  }
</style>
<rect width="1600" height="1000" fill="url(#room)"/>
${room.back.svg}
${hud.svg}
<g class="rig"><g transform="translate(${REACTOR.x} ${REACTOR.y})">
${hud.orbit}
${core.svg}
${lock.map(p => p.svg).join('\n')}
${MOTES.svg}
</g></g>
${room.front}
</svg>`
}

// The working scene never changes. A needs-you scene is built once per burst and kept,
// so redraws while Claude still waits don't rebuild or replay it.
const WORKING = build()
let waiting: { burst: number; svg: string } | undefined

export function sceneFor(signal: Signal): string {
  if (signal.mode !== 'waiting') return WORKING
  if (waiting?.burst !== signal.burst) waiting = { burst: signal.burst, svg: build(signal.burst) }
  return waiting.svg
}

// What a screen reader hears for the scene.
export function altFor(signal: Signal): string {
  return signal.mode === 'waiting'
    ? 'A workshop at night, its holographic reactor locked and glowing gold, pinging softly: Claude needs you'
    : 'A workshop at night, a holographic reactor turning slowly beside floating panels: Claude is working'
}
