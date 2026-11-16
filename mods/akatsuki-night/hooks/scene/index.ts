// The backdrop: a blood moon over a temple, a gate and bare trees, red clouds drifting
// across it. The eye in the moon turns slowly and the crows sit still.
// One scene, whatever Claude is doing. A needs-you scene (the eye locking, crows bursting
// into the sky) froze the scene in the desktop app, so the theme draws one scene for now.
// Desktop draws it in a sandboxed frame; CSS animation only, no script.

import type { Signal } from '../../types'
import { clouds } from './clouds.js'
import { PERCHED, perched } from './crows.js'
import { embers } from './embers.js'
import { land } from './land.js'
import { moon } from './moon.js'
import { sky } from './sky.js'

const SKY = sky(3)
const LAND = land(7)
const EMBERS = embers(5)

function build(): string {
  const eye = moon()
  const drift = clouds(13)
  const sitting = perched(LAND.perches)
  // Each part names the classes it animates, so none can be left moving with reduced motion.
  const animated = [...eye.animated, ...drift.animated, ...EMBERS.animated]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
  <path id="perched" d="${PERCHED}"/>
  ${SKY.defs}
  ${eye.defs}
</defs>
<style>
  ${eye.css}
  ${drift.css}
  ${EMBERS.css}
  @media (prefers-reduced-motion: reduce) {
    ${animated.join(', ')} { animation: none; }
    ${eye.still}
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
</svg>`
}

const SCENE = build()

export function sceneFor(_signal: Signal): string {
  return SCENE
}

// What a screen reader hears for the scene.
export function altFor(_signal: Signal): string {
  return 'Red clouds drift past a blood moon whose eye slowly turns, crows resting on a temple gate'
}
