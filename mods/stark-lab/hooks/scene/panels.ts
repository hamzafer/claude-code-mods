// The holographic panels: a waveform, a dial and a bank of level bars floating high on
// the left, and thin arcs orbiting the reactor. Abstract shapes, no text. Live, the wave
// swells, the needle sweeps and the bars jump; hushed, they dim and hold, the needle
// resting in the gold.

import { CYAN, GOLD, ICE, point, polar, type Part } from './layout.js'

// A panel's outline: a rectangle with two corners cut off.
const frame = (x: number, y: number, w: number, h: number) =>
  `<path d="M${x + 12},${y} L${x + w},${y} L${x + w},${y + h - 12} L${x + w - 12},${y + h} L${x},${y + h} L${x},${y + 12} Z"/>`

// A wave of the given period and height, from x across to at most x + w. It stays in its
// panel by never moving sideways: it swells and flips about its midline instead.
function wave(x: number, y: number, w: number, period: number, height: number): string {
  let d = `M${x},${y} Q${x + period / 4},${y - height} ${x + period / 2},${y}`
  for (let px = x + period; px <= x + w; px += period / 2) d += ` T${px},${y}`
  return d
}

const WAVE = { x: 96, y: 96, w: 300, h: 96 }
const DIAL = { x: 152, y: 296, r: 50 }
const BARS = { x: 236, y: 340, count: 9, heights: [26, 44, 34, 58, 40, 50, 22, 38, 30] }

const WAVE_MID = WAVE.y + WAVE.h / 2 + 8

function wavePanel(): string {
  const { x, y, w, h } = WAVE
  const mid = WAVE_MID
  return (
    `<g fill="${CYAN}" fill-opacity="0.035" stroke="${ICE}" stroke-opacity="0.32" stroke-width="1">${frame(x, y, w, h)}</g>` +
    `<line x1="${x + 14}" y1="${y + 12}" x2="${x + 74}" y2="${y + 12}" stroke="${ICE}" stroke-opacity="0.5" stroke-width="3"/>` +
    `<line x1="${x + 82}" y1="${y + 12}" x2="${x + 104}" y2="${y + 12}" stroke="${ICE}" stroke-opacity="0.25" stroke-width="3"/>` +
    `<line x1="${x + 8}" y1="${mid}" x2="${x + w - 8}" y2="${mid}" stroke="${ICE}" stroke-opacity="0.12"/>` +
    `<g fill="none">` +
    `<path class="wave" d="${wave(x + 8, mid, w - 16, 48, 22)}" stroke="${CYAN}" stroke-opacity="0.85" stroke-width="1.5"/>` +
    `<path class="wave2" d="${wave(x + 8, mid, w - 16, 84, 12)}" stroke="${ICE}" stroke-opacity="0.35" stroke-width="1"/></g>`
  )
}

// Where the needle rests when hushed: rotate(56deg) from straight up.
const REST_DEG = 56
const GOLD_MARK = point(DIAL.r - 6, REST_DEG - 90)

function dialPanel(live: boolean): string {
  const { x, y, r } = DIAL
  const circ = 2 * Math.PI * (r - 6)
  return (
    `<g fill="none" stroke="${ICE}">` +
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${CYAN}" fill-opacity="0.04" stroke-opacity="0.3"/>` +
    `<circle cx="${x}" cy="${y}" r="${r - 6}" stroke-opacity="0.5" stroke-width="6" stroke-dasharray="1 ${(circ / 36 - 1).toFixed(3)}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r + 9}" stroke="${CYAN}" stroke-opacity="0.4" stroke-width="2" stroke-dasharray="${(circ * 0.45).toFixed(1)} ${circ}" transform="rotate(140 ${x} ${y})"/></g>` +
    `<circle cx="${x + GOLD_MARK[0]}" cy="${y + GOLD_MARK[1]}" r="3" fill="${GOLD}"/>` +
    `<g class="needle"${live ? '' : ` transform="rotate(${REST_DEG} ${x} ${y})"`}><line x1="${x}" y1="${y}" x2="${x}" y2="${y - r + 10}" stroke="${ICE}" stroke-width="2" stroke-linecap="round"/></g>` +
    `<circle cx="${x}" cy="${y}" r="4" fill="${ICE}"/>`
  )
}

function barsPanel(live: boolean): string {
  const { x, y, heights } = BARS
  const bars = heights
    .map((h, n) => `<rect class="bar" x="${x + n * 17}" y="${y - h}" width="9" height="${h}"${live ? '' : ` transform="translate(0 ${y * 0.75}) scale(1 .25)"`} style="animation-duration:${(0.7 + ((n * 37) % 11) / 10).toFixed(1)}s;animation-delay:-${((n * 53) % 9) / 10}s"/>`)
    .join('')
  return (
    `<g fill="${CYAN}" fill-opacity="0.5">${bars}</g>` +
    `<line x1="${x - 6}" y1="${y + 6}" x2="${x + heights.length * 17}" y2="${y + 6}" stroke="${ICE}" stroke-opacity="0.4"/>`
  )
}

// Thin arcs round the reactor's 0,0, outside its rings.
const ORBIT =
  `<g fill="none" stroke="${ICE}" stroke-linecap="round">` +
  `<path d="M${polar(262, 151.4)} A262,262 0 0 1 ${polar(262, 180)}" stroke-opacity="0.35" stroke-width="1.2"/>` +
  `<path d="M${polar(246, 243)} A246,246 0 0 0 ${polar(246, 217.2)}" stroke="${CYAN}" stroke-opacity="0.5" stroke-width="3" stroke-dasharray="14 6"/>` +
  `<path d="M${polar(246, 20)} A246,246 0 0 1 ${polar(246, 60.2)}" stroke-opacity="0.28"/></g>`

export type Panels = Part & { orbit: string }

export function panels(live: boolean): Panels {
  const css = live
    ? `.wave,.wave2{transform-origin:0px ${WAVE_MID}px}.wave{animation:swell 2.4s ease-in-out infinite alternate}.wave2{animation:swell 3.6s ease-in-out infinite alternate}` +
      '@keyframes swell{from{transform:scaleY(1)}to{transform:scaleY(-1)}}' +
      `.needle{transform-origin:${DIAL.x}px ${DIAL.y}px;animation:needle 3.4s ease-in-out infinite alternate}` +
      '@keyframes needle{from{transform:rotate(-120deg)}to{transform:rotate(60deg)}}' +
      '.bar{transform-box:fill-box;transform-origin:50% 100%;animation:level 1s ease-in-out infinite alternate}' +
      '@keyframes level{from{transform:scaleY(1)}to{transform:scaleY(.3)}}'
    : '' // Hushed: the needle and bars rest where their markup puts them.
  return {
    defs: '',
    css,
    animated: ['.wave', '.wave2', '.needle', '.bar'],
    svg: `<g opacity="${live ? 0.9 : 0.4}">${wavePanel()}${dialPanel(live)}${barsPanel(live)}</g>`,
    orbit: ORBIT,
  }
}
