// The sky behind everything: a faint band of dust, far and near star layers that drift
// very slowly at different speeds, and a few dozen stars that twinkle on their own.
// Pure: the same seed draws the same sky.
//
// Desktop limit: a layer that spans the whole scene only ever moves, it never fades.
// Twinkling is done star by star, on small elements, so no full-size opacity animates.

import { COLUMN, HOLE } from './layout.js'
import type { Part } from './part.js'
import { seeded, type Random } from './random.js'

type Point = [number, number]

const ANIMATED = ['.driftA', '.driftB', '.tw']

// Most stars that land on the chat column are dropped, so the words sit on calm dark.
function calm(r: Random, [x, y]: Point): boolean {
  const inColumn = x > COLUMN.left && x < COLUMN.right && y > COLUMN.top
  return !inColumn || r.next() < 0.25
}

// Clear of the black hole, whose own light would swallow them.
const clearOfHole = ([x, y]: Point, gap: number) => Math.hypot(x - HOLE.x, (y - HOLE.y) * 2.2) > gap

function places(r: Random, count: number, keep: (p: Point) => boolean): Point[] {
  const points: Point[] = []
  while (points.length < count) {
    const p: Point = [r.pick(-70, 1670), r.pick(-30, 1030)]
    if (keep(p)) points.push(p)
  }
  return points
}

// Many dots as one path of zero-length strokes: round caps draw each as a dot.
const dots = (points: Point[]) => points.map(([x, y]) => `M${Math.round(x)} ${Math.round(y)}h.1`).join('')

function layer(points: Point[], color: string, width: number, opacity: number): string {
  return `<path d="${dots(points)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`
}

// The dust band: a soft warm haze across the upper left, with a sprinkle of faint stars.
function dust(r: Random): string {
  const grains: Point[] = []
  for (let n = 0; n < 170; n++) grains.push([r.pick(-1000, 1000), r.pick(-1, 1) * r.pick(0, 1) * r.pick(0, 1) * 120])
  return (
    `<g transform="translate(380 330) rotate(-38)">` +
    `<ellipse rx="1150" ry="170" fill="url(#dust)"/>` +
    `<ellipse cx="-120" rx="520" ry="70" fill="url(#dust)"/>` +
    `${layer(grains, '#cbbca6', 1, 0.3)}</g>`
  )
}

// A twinkle per star: its own speed and phase, so the sky never pulses in step.
function twinkle(r: Random): string {
  return `animation-duration:${r.pick(2.6, 6.5).toFixed(1)}s;animation-delay:-${r.pick(0, 6).toFixed(1)}s`
}

// A bright star: a soft glow and a thin four-point glint.
function bright(r: Random, [x, y]: Point): string {
  const s = r.pick(4, 8).toFixed(1)
  return (
    `<g transform="translate(${Math.round(x)} ${Math.round(y)})"><g class="tw" style="${twinkle(r)}">` +
    `<circle r="${(+s * 1.6).toFixed(1)}" fill="url(#glint)"/>` +
    `<path d="M-${s} 0H${s}M0 -${s}V${s}" stroke="#eaf0ff" stroke-width="0.7" opacity="0.8"/>` +
    `<circle r="1.3" fill="#f4f7ff"/></g></g>`
  )
}

export function stars(seed: number): Part {
  const r = seeded(seed)
  const keep = (p: Point) => calm(r, p) && clearOfHole(p, 170)
  const far = layer(places(r, 260, keep), '#9fb0d4', 1.1, 0.5) + layer(places(r, 140, keep), '#c8d0e2', 1.3, 0.4)
  const near = layer(places(r, 60, keep), '#e2e9ff', 1.9, 0.8)
  const twinkling = places(r, 34, keep)
    .map(([x, y]) => `<use class="tw" href="#star" x="${Math.round(x)}" y="${Math.round(y)}" style="${twinkle(r)}"/>`)
    .join('')
  const outside = (p: Point) => calm(r, p) && clearOfHole(p, 260) && r.next() < 0.7
  const glints = places(r, 9, outside)
    .map(p => bright(r, p))
    .join('')

  return {
    defs:
      '<circle id="star" r="1.2" fill="#eef2ff"/>' +
      '<radialGradient id="glint"><stop offset="0" stop-color="#dfe8ff" stop-opacity="0.55"/>' +
      '<stop offset="1" stop-color="#dfe8ff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="dust"><stop offset="0" stop-color="#6e5b47" stop-opacity="0.16"/>' +
      '<stop offset="0.6" stop-color="#4a3c30" stop-opacity="0.07"/><stop offset="1" stop-color="#4a3c30" stop-opacity="0"/></radialGradient>',
    css:
      '.driftA,.driftB{will-change:transform}' +
      '.driftA{animation:driftA 240s ease-in-out infinite alternate}' +
      '@keyframes driftA{from{transform:translate(0px,0px)}to{transform:translate(-36px,9px)}}' +
      '.driftB{animation:driftB 240s ease-in-out infinite alternate}' +
      '@keyframes driftB{from{transform:translate(0px,0px)}to{transform:translate(-70px,16px)}}' +
      '.tw{animation:tw 4s ease-in-out infinite}' +
      '@keyframes tw{0%,100%{opacity:1}50%{opacity:.25}}',
    animated: ANIMATED,
    still: '',
    svg: `${dust(r)}<g class="driftA">${far}</g><g class="driftB">${near}${twinkling}${glints}</g>`,
  }
}
