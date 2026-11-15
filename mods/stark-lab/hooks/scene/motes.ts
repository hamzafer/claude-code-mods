// The motes: specks of light rising slowly round the reactor, as if off its heat.
// A few shared drifts, each mote on its own speed and phase. Centred on the reactor's
// 0,0. Pure: the same seed scatters the same motes.

import { ICE, type Part } from './layout.js'
import { seeded } from './random.js'

const DRIFTS = 4
const COUNT = 26

export function motes(seed: number): Part {
  const r = seeded(seed)
  let css = '.mote{opacity:0}'
  for (let d = 0; d < DRIFTS; d++) {
    const sway = Math.round(r.pick(-40, 40))
    const rise = Math.round(r.pick(220, 420))
    css +=
      `@keyframes rise${d}{0%{transform:translate(0px,0px);opacity:0}20%{opacity:.85}` +
      `100%{transform:translate(${sway}px,-${rise}px);opacity:0}}` +
      `.d${d}{animation:rise${d} 10s linear infinite}`
  }
  let svg = ''
  for (let i = 0; i < COUNT; i++) {
    const x = Math.round(r.pick(-280, 260))
    const y = Math.round(r.pick(60, 420))
    const cycle = r.pick(7, 15)
    // Only the timing is inline, so the reduced-motion rule can still stop the drift.
    const timing = `animation-duration:${cycle.toFixed(1)}s;animation-delay:-${r.pick(0, cycle).toFixed(1)}s`
    svg += `<circle class="mote d${Math.floor(r.next() * DRIFTS)}" cx="${x}" cy="${y}" r="${r.pick(0.8, 2.2).toFixed(1)}" style="${timing}"/>`
  }
  return { defs: '', css, animated: ['.mote'], svg: `<g fill="${ICE}">${svg}</g>` }
}
