// A bare winter tree: a gnarled trunk splitting into ever thinner branches. Pure: the
// same random draws the same tree. It also says where along its level boughs a crow could sit.

import type { Random } from './random.js'

type Point = [number, number]
export type Tree = { svg: string; perches: Point[] }

const f = (n: number) => n.toFixed(1)

// A point `t` along a quadratic curve.
const along = (a: Point, c: Point, b: Point, t: number): Point => [
  (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0],
  (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1],
]

// `lean` tips the whole tree, in radians from upright; `depth` is how often it splits.
export function tree(r: Random, foot: Point, opts: { trunk: number; width: number; lean: number; depth: number }): Tree {
  // One path per thickness keeps the drawing small.
  const levels: string[] = Array.from({ length: opts.depth + 1 }, () => '')
  const perches: Point[] = []

  const grow = (from: Point, angle: number, len: number, level: number) => {
    const to: Point = [from[0] + Math.sin(angle) * len, from[1] - Math.cos(angle) * len]
    const bend = r.pick(-0.16, 0.16) * len
    const bow: Point = [(from[0] + to[0]) / 2 + Math.cos(angle) * bend, (from[1] + to[1]) / 2 + Math.sin(angle) * bend]
    levels[level] += `M${f(from[0])},${f(from[1])} Q${f(bow[0])},${f(bow[1])} ${f(to[0])},${f(to[1])}`
    // A near-level bough at the second or third split can hold a crow.
    if ((level === 2 || level === 3) && Math.abs(Math.sin(angle)) > 0.72) perches.push(along(from, bow, to, 0.62))
    if (level === opts.depth) return
    const forks = r.next() < 0.3 ? 3 : 2
    for (let n = 0; n < forks; n++) {
      const side = forks === 3 ? n - 1 : n === 0 ? -1 : 1
      const spread = side * r.pick(0.3, 0.68) + r.pick(-0.1, 0.1)
      grow(to, angle + spread, len * r.pick(0.64, 0.8), level + 1)
    }
  }
  grow(foot, opts.lean, opts.trunk, 0)

  const svg = levels
    .map((d, level) => `<path d="${d}" stroke-width="${f(Math.max(0.8, opts.width * 0.6 ** level))}"/>`)
    .join('')
  return { svg: `<g fill="none" stroke-linecap="round">${svg}</g>`, perches }
}
