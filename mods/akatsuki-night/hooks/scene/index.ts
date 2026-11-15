// The backdrop for a signal state: a blood moon over a temple, a gate and bare trees,
// red clouds drifting across it. While Claude works the eye in the moon turns slowly and
// crows sit still. When Claude needs you the eye spins up and locks, the moon brightens
// and the crows burst into the sky.
// Desktop draws it in a sandboxed frame; CSS animation only, no script.

import type { Signal } from '../../types'
import { clouds } from './clouds.js'
import { CROW, flock, PERCHED, perched, type Flock } from './crows.js'
import { embers } from './embers.js'
import { land } from './land.js'
import { moon } from './moon.js'
import { sky } from './sky.js'

const SKY = sky(3)
const LAND = land(7)
const EMBERS = embers(5)

// Seconds into a needs-you scene when the eye locks and the crows take off.
const SPIN = 1.4

const NO_BURST: Flock = { css: '', animated: [], still: '', svg: '' }

function build(lit: boolean, burst: Flock): string {
  const eye = moon(lit, SPIN)
  const drift = clouds(13, lit ? 0.6 : 1)
  const sitting = perched(LAND.perches, lit ? SPIN : undefined)
  // Each part names the classes it animates, so none can be left moving with reduced motion.
  const animated = [...eye.animated, ...drift.animated, ...sitting.animated, ...EMBERS.animated, ...burst.animated]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
  <path id="crow" d="${CROW}"/>
  <path id="perched" d="${PERCHED}"/>
  ${SKY.defs}
  ${eye.defs}
</defs>
<style>
  ${eye.css}
  ${drift.css}
  ${sitting.css}
  ${EMBERS.css}
  ${burst.css}
  @media (prefers-reduced-motion: reduce) {
    ${animated.join(', ')} { animation: none; }
    ${eye.still} ${burst.still}
  }
</style>
${SKY.svg}
${drift.far}
${drift.mid}
${eye.svg}
${LAND.far}
${drift.near}
${LAND.near}
${sitting.svg}
${EMBERS.svg}
${burst.svg}
</svg>`
}

// The working scene never changes. A needs-you scene is built once per burst and kept,
// so redraws of the same wait don't rebuild or replay it.
const WORKING = build(false, NO_BURST)
let waiting: { burst: number; svg: string } | undefined

export function sceneFor(signal: Signal): string {
  if (signal.mode !== 'waiting') return WORKING
  if (waiting?.burst !== signal.burst) {
    waiting = { burst: signal.burst, svg: build(true, flock(signal.burst, LAND.perches, SPIN)) }
  }
  return waiting.svg
}

// What a screen reader hears for the scene.
export function altFor(signal: Signal): string {
  return signal.mode === 'waiting'
    ? 'A blood moon flares as the eye in it locks, and crows burst into the night sky: Claude needs you'
    : 'Red clouds drift past a blood moon whose eye slowly turns, crows resting on a temple gate: Claude is working'
}
