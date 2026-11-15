// The sparks: a scatter of short streaks thrown off the core once, as it flares to gold.
// Each has its own angle, reach, speed and color. Centred on 0,0. Pure: the same seed
// throws the same sparks; a new seed is a new scatter.
//
// Desktop limit: like the bats in the night-city theme, sparks move with translate and
// opacity keyframes and keyword easing only, and no fill-mode, so a swarm never freezes
// the scene.

import { GOLD, GOLD_HOT, ICE, seedKey, type Part } from './layout.js'
import { seeded } from './random.js'

const COLORS = [GOLD, GOLD_HOT, GOLD_HOT, ICE]

// `after` is when they fly, in seconds: the moment the core flares.
export function sparks(seed: number, after: number): Part {
  const r = seeded(seed)
  const k = seedKey('s', seed)
  let css = '.spark{opacity:0}'
  let svg = ''
  const count = Math.round(r.pick(22, 32))
  for (let i = 0; i < count; i++) {
    const a = r.pick(0, Math.PI * 2)
    const [c, s] = [Math.cos(a), Math.sin(a)]
    const near = r.pick(36, 60)
    const far = r.pick(170, 380)
    const sag = r.pick(10, 50) // falls a little as it flies
    const len = r.pick(10, 26)
    const name = `${k}${i}`
    css +=
      `@keyframes ${name}{0%{transform:translate(${Math.round(c * near)}px,${Math.round(s * near)}px);opacity:0}` +
      `8%{opacity:1}` +
      `100%{transform:translate(${Math.round(c * far)}px,${Math.round(s * far + sag)}px);opacity:0}}` +
      `.${name}{animation:${name} ${r.pick(1.3, 2.4).toFixed(2)}s ease-out ${(after + r.pick(0, 0.3)).toFixed(2)}s 1}`
    const color = COLORS[Math.floor(r.next() * COLORS.length)]!
    svg += `<g class="spark ${name}"><line x2="${(c * len).toFixed(1)}" y2="${(s * len).toFixed(1)}" stroke="${color}"/></g>`
  }
  return {
    defs: '',
    css,
    animated: ['.spark'],
    svg: `<g stroke-width="2.2" stroke-linecap="round">${svg}</g>`,
  }
}
