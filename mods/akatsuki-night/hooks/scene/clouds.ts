// The red clouds: puffed crimson shapes with pale outlines and inner curls, in three
// layers that drift right to left at their own speeds. Pure: the same seed draws the same sky.
//
// Each layer is drawn once across the 1600 width and again just right of it, then carried
// one width left on a loop, so it wraps with no seam. A cloud's end caps and outline reach
// a little past its nominal width, so every cloud keeps a margin (`reach`) inside both
// edges of its copy: none crosses an edge, so none pops in or out as the loop resets.

import { seeded, type Random } from './random.js'

type Layer = { name: string; count: number; w: [number, number]; h: [number, number]; y: [number, number]; opacity: number; stroke: number; seconds: number }

const LAYERS: Layer[] = [
  { name: 'cfar', count: 5, w: [110, 180], h: [36, 56], y: [70, 420], opacity: 0.22, stroke: 1.4, seconds: 320 },
  { name: 'cmid', count: 4, w: [180, 260], h: [56, 84], y: [130, 480], opacity: 0.42, stroke: 1.9, seconds: 200 },
  { name: 'cnear', count: 2, w: [300, 380], h: [84, 110], y: [80, 270], opacity: 0.52, stroke: 2.4, seconds: 120 },
]

type Point = [number, number]
const f = (n: number) => n.toFixed(1)
// An arc to `to` that bulges clockwise, with a radius `bulge` times half the chord.
const arc = ([x1, y1]: Point, [x2, y2]: Point, bulge: number) => {
  const r = (Math.hypot(x2 - x1, y2 - y1) / 2) * bulge
  return `A${f(r)},${f(r)} 0 0 1 ${f(x2)},${f(y2)}`
}

// One cloud standing on 0,0, `w` wide: round lobes over the top, flat swells under it,
// and a curl inside the biggest lobes, echoing their outline.
function cloud(r: Random, w: number, h: number): { outline: string; curls: string } {
  const lobes = Math.round(r.pick(3, 5.4))
  const cuts = Array.from({ length: lobes - 1 }, () => r.pick(0.12, 0.88)).sort((a, b) => a - b)
  const xs = [0, ...cuts.map(c => c * w), w]
  const tops: Point[] = xs.map((x, n) => [x, n === 0 || n === lobes ? -h * 0.32 : -h * r.pick(0.42, 0.7)])
  let outline = `M0,0 ${arc([0, 0], tops[0]!, 1.1)}`
  const sized: { from: Point; to: Point }[] = []
  for (let n = 0; n < lobes; n++) {
    outline += ` ${arc(tops[n]!, tops[n + 1]!, 1.04)}`
    sized.push({ from: tops[n]!, to: tops[n + 1]! })
  }
  const under = w * r.pick(0.4, 0.6)
  outline += ` ${arc(tops[lobes]!, [w, 0], 1.1)} ${arc([w, 0], [under, 0], 1.5)} ${arc([under, 0], [0, 0], 1.5)} Z`

  // Curls in the two widest lobes: a smaller arc inside, ending in a little inward hook.
  const curls = sized
    .sort((a, b) => b.to[0] - b.from[0] - (a.to[0] - a.from[0]))
    .slice(0, 2)
    .map(({ from, to }) => {
      const cx = (from[0] + to[0]) / 2
      const cy = (from[1] + to[1]) / 2
      const ri = ((to[0] - from[0]) / 2) * 0.55
      return `M${f(cx - ri)},${f(cy + ri * 0.15)} A${f(ri)},${f(ri)} 0 0 1 ${f(cx + ri)},${f(cy + ri * 0.15)} A${f(ri * 0.35)},${f(ri * 0.35)} 0 0 1 ${f(cx + ri * 0.3)},${f(cy + ri * 0.4)}`
    })
    .join(' ')
  return { outline, curls }
}

// How far a cloud can reach past 0 and `w` on either side: its end caps bulge about a
// tenth of its height, a steep first or last lobe a little more, then half the stroke.
// Generous on purpose, so no cloud's edge can reach the seam.
const reach = (w: number, h: number, stroke: number) => h * 0.25 + w * 0.02 + stroke

function layer(r: Random, l: Layer): string {
  const slot = 1600 / l.count
  let svg = ''
  for (let n = 0; n < l.count; n++) {
    const w = r.pick(l.w[0], l.w[1])
    const h = r.pick(l.h[0], l.h[1])
    const pad = reach(w, h, l.stroke)
    const x = Math.min(Math.max(slot * n + r.pick(0, slot * 0.7), pad), 1600 - w - pad)
    const y = r.pick(l.y[0], l.y[1])
    const c = cloud(r, w, h)
    svg +=
      `<g transform="translate(${f(x)} ${f(y)})"><path d="${c.outline}"/>` +
      `<path d="${c.curls}" fill="none" stroke-linecap="round"/></g>`
  }
  return svg
}

export type Clouds = { css: string; animated: string[]; far: string; mid: string; near: string }

export function clouds(seed: number): Clouds {
  const r = seeded(seed)
  const drawn: Record<string, string> = {}
  let css = '@keyframes cdrift{from{transform:translateX(0px)}to{transform:translateX(-1600px)}}'
  for (const l of LAYERS) {
    const seconds = l.seconds
    // Start each layer part-way through its loop.
    const lead = r.next() * seconds
    css += `.${l.name}{animation:cdrift ${f(seconds)}s linear -${f(lead)}s infinite;will-change:transform}`
    drawn[l.name] =
      `<g class="${l.name}" fill="#7a1517" stroke="#f1d8cc" stroke-width="${l.stroke}" stroke-linejoin="round" opacity="${l.opacity}">` +
      `<g id="${l.name}0">${layer(r, l)}</g><use href="#${l.name}0" x="1600"/></g>`
  }
  return { css, animated: LAYERS.map(l => `.${l.name}`), far: drawn.cfar!, mid: drawn.cmid!, near: drawn.cnear! }
}
