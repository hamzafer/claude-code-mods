// The bats: a burst from a random origin when the signal lights, then a few stragglers.
// Every bat has its own path, speed, size, wobble and wingbeat, so it never looks synced.
// Pure: the same seed draws the same flock; a new seed is a new burst.
//
// Desktop limit: an earlier swarm froze the whole scene in the desktop app while Chrome
// played it fine. It moved each bat with scale() inside its path keyframes, cubic-bezier
// easing and fill-mode `both`; which of those did it was never isolated. This flock moves
// bats with translate/opacity keyframes and keyword easing only, and plays in Desktop.
// (The wingbeat's scaleY on its own element, and `both` on the signal, are fine there.)

import { SIGNAL } from './layout.js'
import { seeded, type Random } from './random.js'

export type Flock = { css: string; svg: string }

// A small bat seen from below: swept, pointed wings with a scalloped trailing edge.
// Centred on 0,0, about 44 wide; flapping squashes it vertically. Drawn as #bat.
export const BAT =
  'M0,-2 L1.5,-5 L2.5,-2 C6,-3 10,-7 13,-11 C16,-9 19,-8 22,-9 C20,-6 19,-3 19,0 ' +
  'C16,-1 14,0 13,2 C11,0 8,0 6,2 C5,1 3,1 2,3 L0,5 L-2,3 C-3,1 -5,1 -6,2 C-8,0 -11,0 -13,2 ' +
  'C-14,0 -16,-1 -19,0 C-19,-3 -20,-6 -22,-9 C-19,-8 -16,-9 -13,-11 C-10,-7 -6,-3 -2.5,-2 L-1.5,-5 Z'

// Where a burst comes from: a start point per bat, and the directions (in half turns) it flies.
type Origin = { start: (r: Random) => [number, number]; angle: [number, number] }
const ORIGINS: Origin[] = [
  { start: r => [SIGNAL.x + r.pick(-60, 60), SIGNAL.y + r.pick(-30, 30)], angle: [0.55, 1.35] },
  { start: r => [r.pick(150, 1450), r.pick(680, 740)], angle: [-0.9, -0.1] }, // the rooftops
  { start: r => [-60, r.pick(120, 640)], angle: [-0.3, 0.3] }, // the left edge
  { start: r => [1660, r.pick(120, 640)], angle: [0.7, 1.3] }, // the right edge
  { start: r => [r.pick(0, 1600), -60], angle: [0.2, 0.8] }, // diving from the sky
]

const WOBBLES = 5
const STRAGGLERS = 7

function keyframes(name: string, points: [number, number][], at: (n: number) => number): string {
  const stops = points
    .map(([x, y], n) => {
      const edge = n === 0 || n === points.length - 1
      return `${at(n).toFixed(1)}%{transform:translate(${Math.round(x)}px,${Math.round(y)}px);opacity:${edge ? 0 : 1}}`
    })
    .join('')
  return `@keyframes ${name}{${stops}`
}

function bat(r: Random, cls: string, size: number): string {
  const wobble = `animation:wb${Math.floor(r.next() * WOBBLES)} ${r.pick(0.5, 1.1).toFixed(2)}s ease-in-out infinite`
  const flap = `animation-duration:${r.pick(0.11, 0.2).toFixed(2)}s;animation-delay:-${r.pick(0, 0.2).toFixed(2)}s`
  return `<g class="bat ${cls}"><g style="${wobble}"><g transform="scale(${size.toFixed(2)})"><use class="flap" href="#bat" style="${flap}"/></g></g></g>`
}

// `after` holds the burst back, in seconds, until the signal has lit.
export function flock(seed: number, after = 0): Flock {
  const r = seeded(seed)
  // Class names carry the seed, so a new burst is new CSS and plays from the start.
  const k = `b${(seed % 46656).toString(36)}`
  let css =
    '.bat{opacity:0}' +
    '.flap{animation:flap .16s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}' +
    '@keyframes flap{0%{transform:scaleY(1)}100%{transform:scaleY(-.25)}}'
  let svg = ''
  for (let w = 0; w < WOBBLES; w++) {
    const a = Math.round(r.pick(4, 10))
    const b = Math.round(r.pick(4, 12))
    css +=
      `@keyframes wb${w}{0%{transform:translate(0px,0px)}25%{transform:translate(${a}px,-${b}px)}` +
      `50%{transform:translate(-${b}px,${a}px)}75%{transform:translate(${b}px,${a}px)}100%{transform:translate(0px,0px)}}`
  }

  // The burst: plays once, from one random origin.
  const origin = ORIGINS[Math.floor(r.next() * ORIGINS.length)]!
  const count = Math.round(r.pick(42, 64))
  let i = 0
  for (; i < count; i++) {
    const [sx, sy] = origin.start(r)
    const angle = Math.PI * r.pick(origin.angle[0], origin.angle[1])
    const far = r.pick(900, 1700)
    const ex = sx + Math.cos(angle) * far
    const ey = sy + Math.sin(angle) * far * 0.6
    const close = r.next() < 0.12
    const size = close ? r.pick(2.0, 3.2) : r.pick(0.45, 1.25)
    const duration = close ? r.pick(1.6, 2.4) : r.pick(2.6, 4.6)
    const path: [number, number][] = [
      [sx, sy],
      [sx + (ex - sx) * 0.25 + r.pick(-90, 90), sy + (ey - sy) * 0.25 + r.pick(-120, 120)],
      [sx + (ex - sx) * 0.6 + r.pick(-140, 140), sy + (ey - sy) * 0.6 + r.pick(-160, 160)],
      [ex, ey],
    ]
    css += keyframes(`${k}${i}`, path, n => (n / 3) * 100) + '}'
    css += `.${k}${i}{animation:${k}${i} ${duration.toFixed(1)}s ease-in ${(after + r.pick(0.5, 2.3)).toFixed(2)}s 1}`
    svg += bat(r, `${k}${i}`, size)
  }

  // Stragglers: now and then one crosses the sky, on long, uneven cycles.
  for (let n = 0; n < STRAGGLERS; n++, i++) {
    const ltr = r.next() < 0.5
    const y = r.pick(80, 520)
    const [x1, x2] = ltr ? [-80, 1680] : [1680, -80]
    const cycle = r.pick(13, 31)
    // Fly across in the first part of the cycle, then stay hidden until it repeats.
    const flight = r.pick(3.5, 6) / cycle
    const path: [number, number][] = [
      [x1, y],
      [x1 + (x2 - x1) * 0.35, y + r.pick(-120, 120)],
      [x1 + (x2 - x1) * 0.7, y + r.pick(-120, 120)],
      [x2, y + r.pick(-150, 150)],
    ]
    css += keyframes(`${k}${i}`, path, j => flight * (j / 3) * 100) + `100%{transform:translate(${x2}px,0px);opacity:0}}`
    css += `.${k}${i}{animation:${k}${i} ${cycle.toFixed(1)}s linear ${r.pick(3, 25).toFixed(1)}s infinite}`
    svg += bat(r, `${k}${i}`, r.pick(0.4, 0.9))
  }

  // Dark bodies with a faint warm rim, so they still read against the night sky.
  return {
    css,
    svg: `<g fill="#06080a" stroke="#d9c38f" stroke-opacity="0.32" stroke-width="0.9" stroke-linejoin="round">${svg}</g>`,
  }
}
