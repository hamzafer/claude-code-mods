// The rain: columns of glyphs falling in three depths. Far columns are small, dim and
// slow; near ones large, bright and quick. Each has a hot head and a tail that fades
// upward, and a glyph or two that keeps changing. Thick at the edges, thin and faint
// through the chat column (fuller there in a tall window, where the centre is all that
// shows). Pure: the columns are laid out once from a fixed seed, and a burst seed only
// picks which of them hold still while Claude waits.
//
// Desktop limit: each column moves as one group, by translate keyframes with linear
// easing, and glyphs change by steps() opacity on single small texts. No scale, no
// cubic-bezier, no fill-mode on anything that moves.

import { FONT, glyph } from './glyphs.js'
import { CHAT, TALL } from './layout.js'
import type { Part } from './part.js'
import { seeded, type Random } from './random.js'

type Layer = {
  size: [number, number]
  length: [number, number]
  // Seconds for one fall through the scene while Claude works.
  fall: [number, number]
  opacity: number
  // The average gap between columns.
  step: number
  // How far outside the chat column this depth may start, and its chance to fall inside it.
  edge: number
  inner: number
  // Glyphs per column that keep changing.
  flips: number
  tail: string
  head: string
}

// Back to front.
const LAYERS: Layer[] = [
  { size: [11, 14], length: [14, 28], fall: [10, 15], opacity: 0.62, step: 27, edge: 0, inner: 0.3, flips: 0, tail: 'tailFar', head: '#8ff0b0' },
  { size: [17, 22], length: [12, 22], fall: [5.5, 8], opacity: 0.78, step: 38, edge: 40, inner: 0.12, flips: 1, tail: 'tail', head: '#dcffe5' },
  { size: [27, 34], length: [8, 15], fall: [3.4, 4.8], opacity: 0.95, step: 78, edge: 110, inner: 0, flips: 2, tail: 'tail', head: '#f6fff8' },
]

// Glyph pitch, in sizes.
const PITCH = 1.18

// Held columns stay near their working brightness while the rest dims around them.
const HELD = 0.9

type Column = {
  layer: number
  x: number
  // Inside the chat column.
  inner: boolean
  size: number
  glyphs: string[]
  fall: number
  // How far into its fall the column starts, 0 to 1.
  lead: number
  // Which glyphs change, what they change to, and how often.
  flips: { at: number; to: string; every: number }[]
}

// Inside the chat column a column falls by the depth's `inner` chance; outside, the
// further from it, the likelier, so the rain thickens toward the edges.
function keeps(r: Random, layer: Layer, outside: number): boolean {
  if (outside < layer.edge) return outside < 0 && r.next() < layer.inner
  return r.next() < Math.min(1, 0.4 + (outside - layer.edge) / 260)
}

function columns(seed: number): Column[] {
  const r = seeded(seed)
  const all: Column[] = []
  LAYERS.forEach((layer, index) => {
    for (let x = r.pick(0, layer.step); x < 1600; x += layer.step * r.pick(0.6, 1.4)) {
      const outside = Math.max(CHAT.left - x, x - CHAT.right)
      if (!keeps(r, layer, outside)) continue
      const length = Math.round(r.pick(layer.length[0], layer.length[1]))
      all.push({
        layer: index,
        x: Math.round(x),
        inner: outside < 0,
        size: Math.round(r.pick(layer.size[0], layer.size[1])),
        glyphs: Array.from({ length }, () => glyph(r)),
        fall: r.pick(layer.fall[0], layer.fall[1]),
        lead: r.next(),
        flips: Array.from({ length: layer.flips }, () => ({
          at: 1 + Math.floor(r.next() * (length - 2)),
          to: glyph(r),
          every: r.pick(0.9, 2.6),
        })),
      })
    }
  })
  return all
}

const COLUMNS = columns(1999)

// How the rain falls: `pace` stretches every fall (1 while working), `dim` scales every
// depth's brightness, `hold` columns stop where they are, and none falls in `parted`.
export type Weather = { pace: number; dim: number; hold: number; parted?: [number, number] }

const n = (v: number) => Math.round(v)

function draw(c: Column, moving: boolean, pace: number): string {
  const layer = LAYERS[c.layer]!
  const gap = c.size * PITCH
  const last = c.glyphs.length - 1
  const flipAt = new Set(c.flips.map(f => f.at))
  const tail = c.glyphs.map((_, i) => i).filter(i => i < last && !flipAt.has(i))
  let svg =
    `<text x="${tail.map(() => 0).join(' ')}" y="${tail.map(i => n(i * gap)).join(' ')}" fill="url(#${layer.tail})">` +
    `${tail.map(i => c.glyphs[i]).join('')}</text>`
  for (const f of c.flips) {
    const at = `y="${n(f.at * gap)}" fill-opacity="${(0.25 + (0.6 * f.at) / last).toFixed(2)}"`
    if (!moving) {
      svg += `<text ${at}>${c.glyphs[f.at]}</text>`
      continue
    }
    const every = `style="animation-duration:${(f.every * pace).toFixed(2)}s"`
    svg += `<text class="fa" ${at} ${every}>${c.glyphs[f.at]}</text><text class="fb" ${at} ${every}>${f.to}</text>`
  }
  const headY = n(last * gap)
  svg +=
    `<circle cy="${n(headY - c.size * 0.35)}" r="${n(c.size * 0.8)}" fill="url(#halo)"/>` +
    `<text y="${headY}" fill="${layer.head}">${c.glyphs[last]}</text>`
  return svg
}

// Stopped mid-fall, its head somewhere on screen.
function held(c: Column, r: Random): string {
  const y = n(r.pick(240, 820) - (c.glyphs.length - 1) * c.size * PITCH)
  return `<g transform="translate(${c.x} ${y})" font-size="${c.size}">${draw(c, false, 1)}</g>`
}

function falling(c: Column, pace: number): string {
  const fall = c.fall * pace
  const style = `animation-duration:${fall.toFixed(2)}s;animation-delay:-${(c.lead * fall).toFixed(2)}s`
  return `<g transform="translate(${c.x} 0)" font-size="${c.size}"><g class="f${c.layer}" style="${style}">${draw(c, true, pace)}</g></g>`
}

function inside(x: number, range?: [number, number]): boolean {
  return range !== undefined && x >= range[0] && x <= range[1]
}

// Each depth falls from just above the scene, its longest column clear of the top, to
// just below it.
function keyframes(layer: Layer, index: number): string {
  const tallest = Math.ceil(layer.length[1] * layer.size[1] * PITCH)
  return (
    `.f${index}{animation:f${index} 6s linear infinite;will-change:transform}` +
    `@keyframes f${index}{from{transform:translateY(-${tallest}px)}to{transform:translateY(1040px)}}`
  )
}

export function rain(seed: number, weather: Weather): Part {
  const r = seeded(seed)
  // Only mid and near columns at the edges hold, and never one where the rain parts.
  const holdable = COLUMNS.filter(c => c.layer > 0 && !c.inner && !inside(c.x, weather.parted))
  const stopped = new Set<Column>()
  while (stopped.size < Math.min(weather.hold, holdable.length)) stopped.add(holdable[Math.floor(r.next() * holdable.length)]!)

  const depths = LAYERS.map((layer, index) => {
    const falls = COLUMNS.filter(c => c.layer === index && !stopped.has(c) && (index === 0 || !inside(c.x, weather.parted)))
    const edges = falls.filter(c => !c.inner).map(c => falling(c, weather.pace)).join('')
    const centre = falls.filter(c => c.inner).map(c => falling(c, weather.pace)).join('')
    const still = COLUMNS.filter(c => c.layer === index && stopped.has(c)).map(c => held(c, r)).join('')
    return (
      `<g opacity="${(layer.opacity * weather.dim).toFixed(2)}">${edges}<g class="inner">${centre}</g></g>` +
      (still === '' ? '' : `<g opacity="${(layer.opacity * HELD).toFixed(2)}">${still}</g>`)
    )
  }).join('')

  return {
    defs:
      '<linearGradient id="tailFar" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0c3a1d" stop-opacity="0"/><stop offset="0.6" stop-color="#178040" stop-opacity="0.75"/>' +
      '<stop offset="1" stop-color="#48d474"/></linearGradient>' +
      '<linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0f5a2a" stop-opacity="0"/><stop offset="0.5" stop-color="#1ea84e" stop-opacity="0.8"/>' +
      '<stop offset="1" stop-color="#72f79a"/></linearGradient>' +
      '<radialGradient id="halo"><stop offset="0" stop-color="#9dffbe" stop-opacity="0.35"/>' +
      '<stop offset="1" stop-color="#9dffbe" stop-opacity="0"/></radialGradient>',
    css:
      LAYERS.map(keyframes).join('') +
      '.fa{animation:fa 2s steps(1) infinite}.fb{animation:fb 2s steps(1) infinite}' +
      '@keyframes fa{0%{opacity:1}50%{opacity:0}}@keyframes fb{0%{opacity:0}50%{opacity:1}}' +
      `.inner{opacity:.3}@media ${TALL}{.inner{opacity:1}}`,
    animated: [...LAYERS.map((_, index) => `.f${index}`), '.fa', '.fb'],
    still: '.fb{display:none}',
    svg: `<g font-family="${FONT}" text-anchor="middle" fill="#3fd26f">${depths}</g>`,
  }
}
