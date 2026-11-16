// The backdrop for a signal state: deep space with a black hole high on the right and an
// ice planet's limb low on the left. While Claude works the disc turns and a small ship
// crosses toward the hole; when Claude needs you the ship holds station and hails you
// with its beacon, the photon ring burns brighter and shooting stars streak by.
// Desktop draws it in a sandboxed frame; CSS animation only, no script.

import type { Signal } from '../../types'
import { hole } from './hole.js'
import { HOLE } from './layout.js'
import { meteors } from './meteors.js'
import type { Part } from './part.js'
import { planet } from './planet.js'
import { voyage, station } from './ship.js'
import { stars } from './stars.js'

const SKY = stars(7)
const PLANET = planet()

function build(parts: { hole: Part; ship: Part; meteors?: Part }): string {
  const all = [SKY, PLANET, parts.hole, parts.ship, ...(parts.meteors ? [parts.meteors] : [])]
  const animated = all.flatMap(p => p.animated)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="space" x1="1" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0a0807"/>
    <stop offset="1" stop-color="#040304"/>
  </linearGradient>
  ${all.map(p => p.defs).join('')}
</defs>
<style>
  ${all.map(p => p.css).join('')}
  @media (prefers-reduced-motion: reduce) {
    ${animated.join(', ')} { animation: none; }
    ${all.map(p => p.still).join('')}
  }
</style>
<rect width="1600" height="1000" fill="url(#space)"/>
${SKY.svg}
${PLANET.svg}
<g transform="translate(${HOLE.x} ${HOLE.y})">${parts.hole.svg}${parts.ship.svg}</g>
${parts.meteors?.svg ?? ''}
</svg>`
}

// The working scene never changes. A needs-you scene is built once per burst and kept,
// so redraws of the same signal don't rebuild or replay it.
const WORKING = build({ hole: hole(false), ship: voyage() })
let hailing: { burst: number; svg: string } | undefined

export function sceneFor(signal: Signal): string {
  if (signal.mode !== 'waiting') return WORKING
  if (hailing?.burst !== signal.burst) {
    hailing = { burst: signal.burst, svg: build({ hole: hole(true), ship: station(), meteors: meteors(signal.burst) }) }
  }
  return hailing.svg
}

// What a screen reader hears for the scene.
export function altFor(signal: Signal): string {
  return signal.mode === 'waiting'
    ? 'Deep space by a black hole, a small ship holding near it and flashing its beacon: Claude needs you'
    : 'Deep space by a black hole, its glowing disc turning as a small ship drifts toward it: Claude is working'
}
