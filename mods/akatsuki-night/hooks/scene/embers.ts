// Embers: small sparks rising off the land and drifting left on the same wind as the
// clouds, glowing then going out. Mostly at the sides, so the chat column stays calm.
// Pure: the same seed draws the same sparks.

import { GROUND } from './layout.js'
import { seeded } from './random.js'

const PATHS = 4
const COUNT = 26

export type Embers = { css: string; animated: string[]; svg: string }

export function embers(seed: number): Embers {
  const r = seeded(seed)
  let css = '.ember{opacity:0}'
  // A few rising paths with a sideways sway; every spark takes one at its own pace.
  for (let p = 0; p < PATHS; p++) {
    const sway = Math.round(r.pick(20, 60))
    const drift = Math.round(r.pick(120, 260))
    const rise = Math.round(r.pick(420, 700))
    // Numbers are worked out first and written with their own sign: a sway larger than
    // the drift so far swings right, and "--18px" would drop the whole stop.
    const at = (x: number, y: number) => `transform:translate(${Math.round(x)}px,${Math.round(y)}px)`
    css +=
      `@keyframes rise${p}{0%{${at(0, 0)};opacity:0}12%{opacity:1}` +
      `40%{${at(sway - drift * 0.35, -rise * 0.4)}}` +
      `70%{${at(-drift * 0.7 - sway, -rise * 0.7)};opacity:.8}` +
      `100%{${at(-drift, -rise)};opacity:0}}` +
      `.rise${p}{animation:rise${p} 12s linear infinite}`
  }
  let sparks = ''
  for (let n = 0; n < COUNT; n++) {
    const side = r.next() < 0.75
    const x = side ? (r.next() < 0.5 ? r.pick(0, 480) : r.pick(1180, 1640)) : r.pick(480, 1180)
    const y = r.pick(GROUND - 160, GROUND + 20)
    const seconds = r.pick(8, 16)
    // Only the timing is inline, so the reduced-motion rule can still stop the class.
    const path = `rise${Math.floor(r.next() * PATHS)}`
    const style = `animation-duration:${seconds.toFixed(1)}s;animation-delay:-${r.pick(0, seconds).toFixed(1)}s`
    sparks += `<circle class="ember ${path}" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.pick(1, 2.4).toFixed(1)}" style="${style}"/>`
  }
  return { css, animated: Array.from({ length: PATHS }, (_, p) => `.rise${p}`), svg: `<g fill="#ff8c4a">${sparks}</g>` }
}
