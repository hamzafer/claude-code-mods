// The backdrop for a signal state: code rain while Claude works; when it needs you, the
// rain slows to a crawl and dims, a few columns stop where they are, and it parts for a
// prompt typed out in the upper right, its cursor
// blinking until you answer.
// Desktop draws it in a sandboxed frame; CSS animation only, no script.

import type { Signal } from '../../types'
import { GROUND, SHADE } from './ground.js'
import type { Part } from './part.js'
import { PROMPT_PART } from './prompt.js'
import { rain, type Weather } from './rain.js'

const WORKING_RAIN: Weather = { pace: 1, dim: 1, hold: 0, parts: false }
const WAITING_RAIN: Weather = { pace: 5, dim: 0.6, hold: 9, parts: true }

// Stacks the parts back to front, with one reduced-motion rule naming every part's
// animated classes, so a part's new class can't be left moving.
function build(parts: Part[]): string {
  const animated = parts.flatMap(p => p.animated)
  const still = parts.map(p => p.still).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>${parts.map(p => p.defs).join('')}</defs>
<style>
${parts.map(p => p.css).join('\n')}
@media (prefers-reduced-motion: reduce) {
  ${animated.join(', ')} { animation: none; }
  ${still}
}
</style>
${parts.map(p => p.svg).join('\n')}
</svg>`
}

// The working scene never changes. A waiting scene is built once per burst and kept,
// so redraws of the same wait don't rebuild or replay it.
const WORKING = build([GROUND, rain(0, WORKING_RAIN), SHADE])
let waiting: { burst: number; svg: string } | undefined

export function sceneFor(signal: Signal): string {
  if (signal.mode !== 'waiting') return WORKING
  if (waiting?.burst !== signal.burst) {
    waiting = { burst: signal.burst, svg: build([GROUND, rain(signal.burst, WAITING_RAIN), SHADE, PROMPT_PART]) }
  }
  return waiting.svg
}

// What a screen reader hears for the scene.
export function altFor(signal: Signal): string {
  return signal.mode === 'waiting'
    ? 'Green code rain slowed almost to a stop, parting for a blinking terminal cursor: Claude needs you'
    : 'Columns of green code raining down the dark: Claude is working'
}
