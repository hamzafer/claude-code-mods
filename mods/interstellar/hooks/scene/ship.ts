// The ship: a small ring of modules on spokes round a hub, seen at a slant, always slowly
// turning. voyage(): while Claude works it crosses the sky on a long arc and falls toward
// the hole. station(): when Claude needs you it holds below the hole, blinks a beacon and
// sends slow rings of signal out from itself.
// Both are drawn relative to the hole, so the scene can move the two together.
//
// Desktop limit: the voyage moves with translate keyframes and linear easing only; the
// spin's rotate sits on an element that does not also move, and the rings only fade.

import { HOLE, STATION } from './layout.js'
import type { Part } from './part.js'

type Point = [number, number]

const MODULES = 12
const RADIUS = 15

// The ring, flat in its own plane and centred on 0,0: modules, spokes and a hub.
function wheel(): string {
  let modules = ''
  for (let n = 0; n < MODULES; n++) {
    modules += `<rect x="-2.6" y="${-RADIUS - 2}" width="5.2" height="4" rx="0.8" transform="rotate(${n * (360 / MODULES)})"/>`
  }
  return (
    `<circle r="${RADIUS}" fill="none" stroke="#8f949c" stroke-width="1.4"/>` +
    `<path d="M-${RADIUS} 0H${RADIUS}M0 -${RADIUS}V${RADIUS}" stroke="#6f747c" stroke-width="0.9"/>` +
    `<g fill="#d9d5cc">${modules}</g><circle r="3" fill="#c9c4b8"/>`
  )
}

// The ship at a slant: the turning wheel squashed into an ellipse. `spin` is how many
// seconds one turn takes.
function craft(spin: number): string {
  return (
    `<g transform="rotate(-14) scale(1 0.42)"><g class="spin" style="animation-duration:${spin}s">${wheel()}</g></g>`
  )
}

// The long arc toward the hole, from low on the left over the top of the sky.
const ARC: Point[] = [
  [230, 720],
  [320, 460],
  [520, 250],
  [800, 130],
  [1060, 150],
  [1190, 212],
]

// Seconds one voyage takes, and how far into it the scene opens: the ship already aloft.
const VOYAGE_S = 150
const VOYAGE_LEAD = 82

// Still, the ship rests here: at the top of its arc, above the chat. It is the ship's
// markup position; the voyage moves it from there.
const PARKED = 3

// A point on the arc, as a translate from the hole the ship is drawn at.
const at = ([x, y]: Point) => `translate(${x - HOLE.x}px,${y - HOLE.y}px)`
const parked = `translate(${ARC[PARKED]![0] - HOLE.x} ${ARC[PARKED]![1] - HOLE.y})`

function voyageKeyframes(): string {
  const last = ARC.length - 1
  const stops = ARC.map((p, n) => {
    const pct = (n / last) * 96
    const opacity = n === 0 || n === last ? 0 : 1
    return `${pct.toFixed(1)}%{transform:${at(p)};opacity:${opacity}}`
  })
  return `@keyframes voyage{${stops.join('')}100%{transform:${at(ARC[last]!)};opacity:0}}`
}

const SPIN_CSS =
  '.spin{animation:spin 9s linear infinite;transform-origin:0 0}' +
  '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'

const DEFS =
  '<radialGradient id="engine"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.75"/>' +
  '<stop offset="1" stop-color="#ffb060" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="beam"><stop offset="0" stop-color="#fff2cc" stop-opacity="0.95"/>' +
  '<stop offset="0.25" stop-color="#ffd68a" stop-opacity="0.45"/><stop offset="1" stop-color="#ffb050" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="flash" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2cc" stop-opacity="0"/>' +
  '<stop offset="0.5" stop-color="#fff2cc" stop-opacity="0.9"/><stop offset="1" stop-color="#fff2cc" stop-opacity="0"/></linearGradient>'

export function voyage(): Part {
  return {
    defs: DEFS,
    css:
      SPIN_CSS +
      `.voyage{opacity:0;animation:voyage ${VOYAGE_S}s linear -${VOYAGE_LEAD}s infinite;will-change:transform}` +
      voyageKeyframes(),
    animated: ['.spin', '.voyage'],
    still: '.voyage{opacity:1}',
    svg: `<g class="voyage" transform="${parked}"><ellipse cx="-14" cy="5" rx="14" ry="7" fill="url(#engine)"/>${craft(9)}</g>`,
  }
}

// Seconds between one pulse of signal and the next; the beacon blinks with each.
const PING_S = 2.2
// Each pulse lights rings of growing radius one after another, a beat apart.
const RINGS = [40, 68, 104, 150]
const BEAT_S = 0.32

export function station(): Part {
  let rings = ''
  RINGS.forEach((r, n) => {
    rings += `<circle class="ping p${n}" r="${r}" fill="none" stroke="#ffd590" stroke-width="2.4" style="animation-delay:${(n * BEAT_S).toFixed(2)}s"/>`
  })
  return {
    defs: DEFS,
    css:
      SPIN_CSS +
      `.ping{opacity:0;animation:ping ${PING_S}s ease-out infinite}` +
      '@keyframes ping{0%{opacity:0}10%{opacity:.6}38%{opacity:0}100%{opacity:0}}' +
      `.beacon{animation:beacon ${PING_S}s steps(1) infinite}` +
      '@keyframes beacon{0%{opacity:1}7%{opacity:.12}13%{opacity:1}20%,100%{opacity:.08}}',
    animated: ['.spin', '.ping', '.beacon'],
    // Still, one faint ring stays round the ship and the beacon stays lit.
    still: '.ping.p1{opacity:.35}',
    svg:
      `<g class="hail" transform="translate(${STATION.x - HOLE.x} ${STATION.y - HOLE.y})">` +
      `<g class="pings">${rings}</g>` +
      craft(14) +
      `<g class="beacon"><circle r="46" fill="url(#beam)"/>` +
      `<ellipse rx="70" ry="1" fill="url(#flash)"/><circle cy="-1" r="2.6" fill="#fffaf0"/></g>` +
      `</g>`,
  }
}
