// The crows. While Claude works a few sit still on the gate, the roof and the trees.
// When Claude needs you they all burst up off their perches, dozens of them, each on its
// own path, speed, size, wobble and wingbeat, and later a straggler crosses now and then.
// Pure: the same seed draws the same flock; a new seed is a new burst.
//
// Desktop limit: a swarm that moved birds with scale() inside path keyframes, cubic-bezier
// easing or fill-mode `both` froze the whole scene in the desktop app while Chrome played
// it fine. These move by translate/opacity keyframes with keyword easing only; the
// wingbeat's scaleY sits on its own element, and never flattens past a third, so a small
// crow mid-beat still reads as a bird and not a dash.

import { seeded, type Random } from './random.js'

type Point = [number, number]

// A crow seen from below, wings spread: fingered primaries, a fanned tail, a small head.
// Centred on 0,0, about 46 wide; flapping squashes it vertically. Drawn as #crow.
export const CROW =
  'M0,-10 C2,-10 3,-8 2.5,-6 L4,-4 C10,-6 16,-7 20,-5 L23,-4 L20,-2.6 L23,-1.4 L19.5,-0.4 L22,0.6 L18,1.2 ' +
  'C13,1 8,0.4 4,2 L5.5,9 L2,8 L0,10 L-2,8 L-5.5,9 L-4,2 C-8,0.4 -13,1 -18,1.2 L-22,0.6 L-19.5,-0.4 L-23,-1.4 ' +
  'L-20,-2.6 L-23,-4 L-20,-5 C-16,-7 -10,-6 -4,-4 L-2.5,-6 C-3,-8 -2,-10 0,-10 Z'

// A crow sitting, side on, facing right, its feet at 0,0, about 20 tall. Drawn as #perched.
export const PERCHED =
  'M-10,-1 L-4,-7 C-2,-12 3,-14 7,-14 C8.5,-17.5 12,-18 13.5,-15.5 L18,-14.2 L13.5,-12.8 ' +
  'C13.5,-9.5 11,-6.5 8,-5 C5,-2.5 2.5,-1.5 1,-1.2 L1.5,0 L-0.5,0 L-0.8,-1.2 C-4,-1.6 -7,-0.6 -10,-1 Z'

const WOBBLES = 5
const STRAGGLERS = 6

const BODY = '#050202'
const RIM = 'stroke="#e7b9a8" stroke-opacity="0.3" stroke-width="0.9" stroke-linejoin="round"'

// Still crows on their perches. With `leave` (seconds) they vanish then, as the burst takes off.
export function perched(perches: Point[], leave?: number): { css: string; animated: string[]; svg: string } {
  const svg = perches
    .map(([x, y], n) => {
      const face = n % 3 === 1 ? -1 : 1
      const size = 1.15 + (n % 4) * 0.12
      return `<use href="#perched" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(face * size).toFixed(2)} ${size.toFixed(2)})"/>`
    })
    .join('')
  if (leave === undefined) return { css: '', animated: [], svg: `<g fill="${BODY}" ${RIM}>${svg}</g>` }
  return {
    css: `.perch{animation:perch .2s linear ${leave}s both}@keyframes perch{to{opacity:0}}`,
    animated: ['.perch'],
    svg: `<g class="perch" fill="${BODY}" ${RIM}>${svg}</g>`,
  }
}

// Fades in from the first point and out at the last, unless `seen` says it starts in view.
function keyframes(name: string, points: Point[], at: (n: number) => number, seen = false): string {
  return (
    `@keyframes ${name}{` +
    points
      .map(([x, y], n) => {
        const hidden = (n === 0 && !seen) || n === points.length - 1
        return `${at(n).toFixed(1)}%{transform:translate(${Math.round(x)}px,${Math.round(y)}px);opacity:${hidden ? 0 : 1}}`
      })
      .join('')
  )
}

function bird(r: Random, cls: string, size: number): string {
  const wobble = `animation:cw${Math.floor(r.next() * WOBBLES)} ${r.pick(0.6, 1.3).toFixed(2)}s ease-in-out infinite`
  const flap = `animation-duration:${r.pick(0.16, 0.26).toFixed(2)}s;animation-delay:-${r.pick(0, 0.26).toFixed(2)}s`
  return `<g class="crow ${cls}"><g style="${wobble}"><g transform="scale(${size.toFixed(2)})"><use class="beat" href="#crow" style="${flap}"/></g></g></g>`
}

export type Flock = { css: string; animated: string[]; still: string; svg: string }

// `after` holds the burst back, in seconds, until the eye has locked.
export function flock(seed: number, perches: Point[], after: number): Flock {
  const r = seeded(seed)
  // Class names carry the seed, so a new burst is new CSS and plays from the start.
  const k = `k${(seed % 46656).toString(36)}`
  let css =
    '.crow{opacity:0}' +
    '.beat{animation:beat .2s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}' +
    '@keyframes beat{0%{transform:scaleY(1)}100%{transform:scaleY(.35)}}'
  for (let w = 0; w < WOBBLES; w++) {
    const a = Math.round(r.pick(4, 10))
    const b = Math.round(r.pick(4, 12))
    css +=
      `@keyframes cw${w}{0%{transform:translate(0px,0px)}25%{transform:translate(${a}px,-${b}px)}` +
      `50%{transform:translate(-${b}px,${a}px)}75%{transform:translate(${b}px,${a}px)}100%{transform:translate(0px,0px)}}`
  }

  // The burst: every crow lifts off near a perch and climbs away, fanning outward. The
  // first one from each perch is the crow that sat there: it leaves from the spot, in full
  // view, the moment the sitting crow vanishes, so the perches never look empty first.
  const count = Math.round(r.pick(44, 60))
  let svg = ''
  let i = 0
  for (; i < count; i++) {
    const [px, py] = perches[i % perches.length]!
    const sitter = i < perches.length
    const sx = sitter ? px : px + r.pick(-40, 40)
    const sy = sitter ? py - 10 : py + r.pick(-30, 10)
    // Up and away from the middle, so the chat column clears first.
    const away = sx < 800 ? -1 : 1
    const angle = -Math.PI / 2 + away * r.pick(0.05, 0.95) + r.pick(-0.25, 0.25)
    const far = r.pick(900, 1500)
    const ex = sx + Math.cos(angle) * far
    const ey = sy + Math.sin(angle) * far
    const close = r.next() < 0.12
    const size = sitter ? 0.85 : close ? r.pick(1.8, 2.6) : r.pick(0.65, 1.35)
    const duration = close ? r.pick(1.8, 2.6) : r.pick(2.8, 5)
    const path: Point[] = [
      [sx, sy],
      [sx + (ex - sx) * 0.15 + r.pick(-40, 40), sy + (ey - sy) * 0.15 + r.pick(-40, 20)],
      [sx + (ex - sx) * 0.55 + r.pick(-140, 140), sy + (ey - sy) * 0.55 + r.pick(-120, 120)],
      [ex, ey],
    ]
    const start = sitter ? after : after + r.pick(0, 1.1)
    css += keyframes(`${k}${i}`, path, n => [0, 18, 60, 100][n]!, sitter) + '}'
    css += `.${k}${i}{animation:${k}${i} ${duration.toFixed(1)}s ease-in ${start.toFixed(2)}s 1}`
    svg += bird(r, `${k}${i}`, size)
  }

  // Stragglers: now and then one crosses the upper sky, on long, uneven cycles.
  for (let n = 0; n < STRAGGLERS; n++, i++) {
    const ltr = r.next() < 0.5
    const y = r.pick(60, 380)
    const [x1, x2] = ltr ? [-80, 1680] : [1680, -80]
    const cycle = r.pick(14, 32)
    // Fly across in the first part of the cycle, then stay hidden until it repeats.
    const flight = r.pick(4, 7) / cycle
    const path: Point[] = [
      [x1, y],
      [x1 + (x2 - x1) * 0.35, y + r.pick(-80, 80)],
      [x1 + (x2 - x1) * 0.7, y + r.pick(-80, 80)],
      [x2, y + r.pick(-100, 100)],
    ]
    css += keyframes(`${k}${i}`, path, j => flight * (j / 3) * 100) + `100%{transform:translate(${x2}px,0px);opacity:0}}`
    css += `.${k}${i}{animation:${k}${i} ${cycle.toFixed(1)}s linear ${(after + r.pick(4, 22)).toFixed(1)}s infinite}`
    svg += bird(r, `${k}${i}`, r.pick(0.45, 0.8))
  }

  // With reduced motion the burst is not shown at all.
  return { css, animated: ['.crow', '.beat'], still: '.crow { display: none; }', svg: `<g fill="${BODY}" ${RIM}>${svg}</g>` }
}
