// The sky behind everything: near black at the top, warming to a dull red-brown at the
// horizon, with a scatter of faint stars kept clear of the moon. Still, and the same
// in both scenes. Pure: the same seed draws the same stars.

import { MOON } from './layout.js'
import { seeded } from './random.js'

export type Sky = { defs: string; svg: string }

export function sky(seed: number): Sky {
  const r = seeded(seed)
  let stars = ''
  for (let n = 0; n < 60; n++) {
    const x = r.pick(0, 1600)
    const y = r.pick(0, 560)
    const size = r.pick(0.5, 1.4)
    if (Math.hypot(x - MOON.x, y - MOON.y) < MOON.r * 1.8) continue
    stars += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${size.toFixed(1)}" opacity="${r.pick(0.2, 0.6).toFixed(2)}"/>`
  }
  return {
    defs: `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#060304"/>
  <stop offset="0.45" stop-color="#0f0607"/>
  <stop offset="0.72" stop-color="#1e0a0a"/>
  <stop offset="0.88" stop-color="#2e0f0c"/>
  <stop offset="1" stop-color="#1a0807"/>
</linearGradient>`,
    svg: `<rect width="1600" height="1000" fill="url(#sky)"/><g fill="#f3d9cf">${stars}</g>`,
  }
}
