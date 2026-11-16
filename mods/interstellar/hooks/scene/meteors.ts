// Shooting stars for the needs-you scene: a seeded handful streak once as it opens,
// then now and then another on a long, uneven cycle. Pure: the same seed draws the same
// sky; a new seed is a new burst.
//
// Desktop limit: each streak sits in a group placed and angled by a static transform,
// and moves inside it with translate/opacity keyframes and keyword easing only.

import { COLUMN } from './layout.js'
import type { Part } from './part.js'
import { seeded, type Random } from './random.js'

const BURST = [4, 6]
const LATER = 3
const TAIL = 150

// A streak along +x ending at 0,0: a fading tail and a bright head.
const STREAK =
  `<line x1="-${TAIL}" y1="0" x2="0" y2="0" stroke="url(#tail)" stroke-width="1.6" stroke-linecap="round"/>` +
  `<circle r="1.5" fill="#f6f8ff"/>`

// Where a streak starts: high in the sky, left or right of the chat column.
function start(r: Random): [number, number] {
  const left = r.next() < 0.4
  return [left ? r.pick(60, COLUMN.left - 40) : r.pick(COLUMN.right - 120, 1560), r.pick(40, 340)]
}

// One streak's flight: dark until `from` percent of its animation, then in, across, out.
function flight(name: string, travel: number, from: number): string {
  const at = (p: number) => (from + (100 - from) * p).toFixed(2)
  return (
    `@keyframes ${name}{0%,${from.toFixed(2)}%{transform:translateX(0px);opacity:0}` +
    `${at(0.15)}%{opacity:1}${at(0.7)}%{opacity:.9}100%{transform:translateX(${travel}px);opacity:0}}`
  )
}

function streak(r: Random, cls: string, heading: number): string {
  const [x, y] = start(r)
  const angle = heading + r.pick(-8, 8)
  return `<g transform="translate(${Math.round(x)} ${Math.round(y)}) rotate(${angle.toFixed(1)})"><g class="meteor ${cls}">${STREAK}</g></g>`
}

export function meteors(seed: number): Part {
  const r = seeded(seed)
  // Class names carry the seed, so a new burst is new CSS and plays from the start.
  const k = `m${(seed % 46656).toString(36)}`
  // Every streak in a scene falls the same way, as if from one shower.
  const heading = r.next() < 0.5 ? r.pick(148, 162) : r.pick(18, 32)
  let css = '.meteor{opacity:0}'
  let svg = ''
  const count = Math.round(r.pick(BURST[0]!, BURST[1]!))
  for (let i = 0; i < count; i++) {
    const name = `${k}${i}`
    const travel = Math.round(r.pick(260, 460))
    css += flight(name, travel, 0)
    css += `.${name}{animation:${name} ${r.pick(0.8, 1.3).toFixed(2)}s ease-out ${r.pick(0.2, 2.6).toFixed(2)}s 1}`
    svg += streak(r, name, heading)
  }
  for (let i = 0; i < LATER; i++) {
    const name = `${k}l${i}`
    const cycle = r.pick(11, 23)
    const travel = Math.round(r.pick(260, 420))
    // Streak through the last second of the cycle, dark the rest of it.
    const from = 100 - (1.1 / cycle) * 100
    css += flight(name, travel, from)
    css += `.${name}{animation:${name} ${cycle.toFixed(1)}s linear ${r.pick(2, 9).toFixed(1)}s infinite}`
    svg += streak(r, name, heading)
  }
  return {
    defs:
      `<linearGradient id="tail" gradientUnits="userSpaceOnUse" x1="-${TAIL}" y1="0" x2="0" y2="0">` +
      '<stop offset="0" stop-color="#cfdcff" stop-opacity="0"/><stop offset="1" stop-color="#eef3ff" stop-opacity="0.95"/></linearGradient>',
    css,
    animated: ['.meteor'],
    // Only the shooting stars leave a still sky: a streak caught mid-flight would be wrong.
    still: '.meteor{display:none}',
    svg,
  }
}
