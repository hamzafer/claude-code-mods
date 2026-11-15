// The land under the moon: two far ridges, a temple roof at the left edge, a gate on a
// hill in front of the moon, a bare tree and the near ground. All still silhouettes.
// Pure: the same seed draws the same land. It also says where crows can perch on it.

import { GATE, GROUND, RIDGE } from './layout.js'
import { seeded, type Random } from './random.js'
import { tree } from './trees.js'

type Point = [number, number]
export type Land = { far: string; near: string; perches: Point[] }

const NEAR = '#060303'

// A ridge line across the scene, rising toward both edges so the middle stays low.
function ridge(r: Random, base: number, rise: number, rough: number, fill: string): string {
  let d = `M-20,1000 L-20,${base - rise}`
  for (let x = 0; x <= 1640; x += 60) {
    const edge = Math.abs(x - 800) / 800
    d += ` L${x},${(base - rise * edge ** 2 - r.pick(0, rough)).toFixed(0)}`
  }
  return `<path d="${d} L1640,1000 Z" fill="${fill}"/>`
}

// A gate: two posts, a curved top beam with lifted ends, a band under it and a tie beam.
function gate(): string {
  const { x, top, ground } = GATE
  const half = GATE.span / 2
  const post = (side: number) => {
    const px = x + side * half * 0.7
    return `<polygon points="${px - 7},${top + 22} ${px + 7},${top + 22} ${px + 9},${ground} ${px - 9},${ground}"/>`
  }
  return (
    `<g fill="${NEAR}">` +
    `<path d="M${x - half - 16},${top - 8} Q${x - half * 0.5},${top + 4} ${x},${top + 4} Q${x + half * 0.5},${top + 4} ${x + half + 16},${top - 8} ` +
    `L${x + half + 12},${top + 6} Q${x + half * 0.5},${top + 15} ${x},${top + 15} Q${x - half * 0.5},${top + 15} ${x - half - 12},${top + 6} Z"/>` +
    `<rect x="${x - half + 2}" y="${top + 14}" width="${GATE.span - 4}" height="9"/>` +
    `<rect x="${x - 5}" y="${top + 23}" width="10" height="26"/>` +
    `<rect x="${x - half * 0.92}" y="${top + 49}" width="${half * 1.84}" height="10"/>` +
    post(-1) +
    post(1) +
    `</g>`
  )
}

// A temple hall at the left edge: two tiers of roof with swept-up eaves and a ridge.
function temple(): string {
  const { x1, x2, y } = RIDGE
  const mid = (x1 + x2) / 2
  return (
    `<g fill="${NEAR}">` +
    `<rect x="70" y="790" width="220" height="210"/>` +
    `<path d="M-10,834 C40,830 70,820 92,806 L268,806 C290,820 320,830 372,834 L372,846 L-10,846 Z"/>` +
    `<rect x="${x1 - 5}" y="${y + 20}" width="${x2 - x1 + 10}" height="40"/>` +
    `<path d="M30,${y + 46} C72,${y + 42} 96,${y + 30} ${x1},${y + 8} L${x2},${y + 8} C264,${y + 30} 288,${y + 42} 330,${y + 46} L330,${y + 54} L30,${y + 54} Z"/>` +
    `<path d="M${x1 - 8},${y + 10} L${x1 - 6},${y - 8} L${x1 + 2},${y} L${x2 - 2},${y} L${x2 + 6},${y - 8} L${x2 + 8},${y + 10} Z"/>` +
    `<rect x="${mid - 3}" y="${y - 14}" width="6" height="16"/>` +
    `</g>` +
    // Two lit paper windows, the only warm light on the ground.
    `<g fill="#d0622e" opacity="0.3"><rect x="114" y="872" width="22" height="32"/><rect x="224" y="872" width="22" height="32"/></g>`
  )
}

// The near ground, with tufts of dry grass along its edge.
function ground(r: Random): string {
  let tufts = ''
  for (let x = 0; x < 1600; x += r.pick(18, 46)) {
    const h = r.pick(6, 22)
    tufts += `M${x.toFixed(0)},${GROUND} l${(r.pick(-6, 6)).toFixed(0)},-${h.toFixed(0)} l4,${h.toFixed(0)} `
  }
  return (
    `<path d="M-20,1000 L-20,${GROUND} Q400,${GROUND - 10} 800,${GROUND + 4} T1620,${GROUND - 6} L1620,1000 Z" fill="${NEAR}"/>` +
    `<path d="${tufts}" fill="${NEAR}"/>`
  )
}

export function land(seed: number): Land {
  const r = seeded(seed)
  const far = ridge(r, 820, 120, 26, '#220c0c') + ridge(r, 868, 90, 14, '#150808')
  const hill = `<path d="M1080,1000 Q1210,${GATE.ground - 6} ${GATE.x},${GATE.ground} Q1540,${GATE.ground + 4} 1640,${GATE.ground - 30} L1640,1000 Z" fill="${NEAR}"/>`
  const left = tree(r, [345, GROUND + 4], { trunk: 165, width: 24, lean: -0.34, depth: 5 })
  const near =
    `<g stroke="${NEAR}">${left.svg}</g>` + hill + gate() + temple() + ground(r)

  const { x, top } = GATE
  const perches: Point[] = [
    [RIDGE.x1 + 14, RIDGE.y],
    [RIDGE.x2 - 22, RIDGE.y],
    [x - 52, top + 4],
    [x + 30, top + 4],
    [x + GATE.span / 2 + 6, top - 6],
    ...left.perches.slice(0, 3),
  ]
  return { far, near, perches }
}
