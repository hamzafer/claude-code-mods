// The reactor: tick rings, a ring of coils and a bright triangular core, drawn in thin
// luminous strokes and centred on 0,0. Working, its rings counter-rotate and the core
// breathes. Locked, the rings spin down into alignment (each ring's notch meets at the
// top) and the core flares from cyan to gold. Pure: the same seed locks the same way.
//
// The gold glow is a large animated element (a circle of r=320, fading its opacity in
// once). It is not full-size and never moves.

import { CYAN, GOLD, GOLD_HOT, HAZE, ICE, polar, seedKey, type Part } from './layout.js'
import { seeded } from './random.js'

// Seconds a locking reactor takes to spin down; the core flares as it settles.
export const LOCK_S = 1.6

// Evenly spaced ticks round a circle, drawn as one dashed stroke as wide as a tick is long.
function ticks(r: number, count: number, length: number, width: number, opacity: number): string {
  const gap = (2 * Math.PI * r) / count - width
  return `<circle r="${r}" stroke="${ICE}" stroke-opacity="${opacity}" stroke-width="${length}" stroke-dasharray="${width} ${gap.toFixed(3)}"/>`
}

// A small pointer on a ring at the top: when the rings lock, every notch lines up.
const notch = (r: number, color: string) => `<path d="M0,${-r + 7} L-5,${-r - 3} L5,${-r - 3} Z" fill="${color}"/>`

// One coil segment: a trapezoid between two radii with winding lines across it, at 0 degrees.
const COIL =
  `M${polar(98, -12)} L${polar(134, -15)} L${polar(134, 15)} L${polar(98, 12)} Z ` +
  [106, 115, 124].map(r => `M${polar(r, -12)} L${polar(r, 12)}`).join(' ')

function coils(): string {
  let out = ''
  for (let n = 0; n < 10; n++) out += `<path d="${COIL}" transform="rotate(${n * 36})"/>`
  return `<g fill="${CYAN}" fill-opacity="0.07" stroke="${CYAN}" stroke-opacity="0.85" stroke-width="1.3">${out}</g>`
}

// The rings, outside in, and how many seconds each takes to turn (negative turns back).
type Ring = { name: string; turn: number; svg: (mark: string) => string }
const RINGS: Ring[] = [
  {
    name: 'ra',
    turn: 80,
    svg: mark =>
      `<circle r="198" stroke="${ICE}" stroke-opacity="0.18" stroke-width="1" stroke-dasharray="60 14 6 14"/>` +
      `<circle r="188" stroke="${ICE}" stroke-opacity="0.4" stroke-width="1"/>` +
      ticks(178, 120, 8, 1.1, 0.5) +
      ticks(176, 12, 15, 2.4, 0.85) +
      notch(203, mark),
  },
  {
    name: 'rb',
    turn: -42,
    svg: mark =>
      `<circle r="160" stroke="${ICE}" stroke-opacity="0.22" stroke-width="1"/>` +
      `<circle r="151" stroke="${CYAN}" stroke-opacity="0.75" stroke-width="3" stroke-dasharray="214 102.2"/>` +
      `<circle r="143" stroke="${CYAN}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 6"/>` +
      notch(166, mark),
  },
  { name: 'rc', turn: 120, svg: () => coils() },
  {
    name: 'rd',
    turn: -18,
    svg: mark =>
      `<circle r="86" stroke="${CYAN}" stroke-opacity="0.6" stroke-width="5" stroke-dasharray="3 5"/>` +
      `<circle r="76" stroke="${ICE}" stroke-opacity="0.45" stroke-width="1"/>` +
      notch(92, mark),
  },
]

// A triangle pointing up, its corners on a circle of radius r.
const triangle = (r: number) => `M${polar(r, -90)} L${polar(r, 30)} L${polar(r, 150)} Z`

function core(disc: string, glow: string, line: string, glowR: number): string {
  return (
    `<circle r="${glowR}" fill="url(#${glow})"/>` +
    `<circle r="62" fill="none" stroke="${line}" stroke-opacity="0.7" stroke-width="1.5"/>` +
    `<path d="${triangle(54)}" fill="${line}" fill-opacity="0.06" stroke="${line}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<circle r="34" fill="url(#${disc})"/>`
  )
}

const DEFS =
  `<radialGradient id="aura"><stop offset="0" stop-color="${HAZE}" stop-opacity="0.55"/>` +
  `<stop offset="0.6" stop-color="${HAZE}" stop-opacity="0.12"/><stop offset="1" stop-color="${HAZE}" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="cyanDisc"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="${ICE}"/>` +
  `<stop offset="1" stop-color="${CYAN}" stop-opacity="0.2"/></radialGradient>` +
  `<radialGradient id="cyanGlow"><stop offset="0" stop-color="${CYAN}" stop-opacity="0.6"/>` +
  `<stop offset="1" stop-color="${CYAN}" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="goldDisc"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="${GOLD_HOT}"/>` +
  `<stop offset="1" stop-color="${GOLD}" stop-opacity="0.3"/></radialGradient>` +
  `<radialGradient id="goldGlow"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.7"/>` +
  `<stop offset="0.5" stop-color="${GOLD}" stop-opacity="0.18"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>`

const ANIMATED = ['.ra', '.rb', '.rc', '.rd', '.core', '.cool', '.hot', '.throb']

// Every ring turns about the reactor's centre, its own 0,0: said outright, never left to a default.
const PIVOT = RINGS.map(ring => `.${ring.name}`).join(',') + '{transform-origin:0 0}'

function rings(mark: string): string {
  return RINGS.map(ring => `<g class="${ring.name}">${ring.svg(mark)}</g>`).join('')
}

// Working: the rings turn for good, the core breathes.
function spinning(): Part {
  const css =
    PIVOT +
    RINGS.map(ring => `.${ring.name}{animation:${ring.turn < 0 ? 'spinBack' : 'spin'} ${Math.abs(ring.turn)}s linear infinite}`).join('') +
    '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
    '@keyframes spinBack{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}' +
    '.core{animation:breathe 4.2s ease-in-out infinite}' +
    '@keyframes breathe{0%,100%{opacity:.62}50%{opacity:1}}'
  const svg =
    `<circle r="330" fill="url(#aura)"/><g fill="none">${rings(ICE)}</g>` +
    `<g class="core">${core('cyanDisc', 'cyanGlow', ICE, 96)}</g>`
  return { defs: DEFS, css, animated: ANIMATED, svg }
}

// Locked: each ring spins down from its own angle to rest (its markup is the rest, so the
// keyframes only say where it starts); then cyan gives way to gold.
function locking(seed: number): Part {
  const r = seeded(seed)
  const k = seedKey('l', seed)
  let css = PIVOT
  for (const ring of RINGS) {
    const from = Math.sign(ring.turn) * -r.pick(150, 320)
    css +=
      `@keyframes ${k}${ring.name}{from{transform:rotate(${from.toFixed(0)}deg)}to{transform:rotate(0deg)}}` +
      `.${ring.name}{animation:${k}${ring.name} ${(LOCK_S * r.pick(0.8, 1)).toFixed(2)}s ease-out 1}`
  }
  css +=
    // Opacity only, so `both` holds the cyan core gone once it has faded.
    `.cool{animation:cool .5s ease-in ${LOCK_S - 0.2}s 1 both}` +
    '@keyframes cool{from{opacity:1}to{opacity:0}}' +
    // `both` keeps the gold hidden until it flares, yet with reduced motion it simply shows.
    `.hot{animation:heat .6s ease-out ${LOCK_S - 0.2}s 1 both}` +
    '@keyframes heat{0%{opacity:0}35%{opacity:1}55%{opacity:.55}100%{opacity:1}}' +
    `.throb{animation:throb 2.6s ease-in-out ${LOCK_S + 0.4}s infinite}` +
    '@keyframes throb{0%,100%{opacity:1}50%{opacity:.55}}'
  const svg =
    `<circle r="330" fill="url(#aura)"/><g class="hot"><circle r="320" fill="url(#goldGlow)" opacity="0.6"/></g>` +
    `<g fill="none">${rings(GOLD)}</g>` +
    `<g class="cool">${core('cyanDisc', 'cyanGlow', ICE, 96)}</g>` +
    `<g class="hot"><g class="throb">${core('goldDisc', 'goldGlow', GOLD_HOT, 150)}</g></g>`
  // With reduced motion nothing fades, so the cyan core is put away by hand: only gold shows.
  return { defs: DEFS, css, animated: ANIMATED, still: '.cool{opacity:0}', svg }
}

// No seed: the working reactor. A seed: the one that locks for this burst.
export function reactor(seed?: number): Part {
  return seed === undefined ? spinning() : locking(seed)
}
