// The city: three rows of buildings, lit windows, a landmark tower and two gargoyles.
// Pure: the same seed draws the same city.

import { SPIRE } from './layout.js'
import { seeded, type Random } from './random.js'

export type City = { far: string; mid: string; near: string; windows: string; landmarks: string; gargoyles: string }

// A crouched, winged stone figure for a rooftop corner, standing on 0,0.
const GARGOYLE =
  'M-22,0 L-20,-14 C-26,-18 -34,-30 -30,-46 C-24,-36 -18,-31 -12,-29 C-13,-37 -8,-43 -2,-45 ' +
  'L0,-54 L3,-45 C9,-43 13,-37 11,-29 C17,-31 24,-39 30,-48 C35,-32 27,-18 20,-14 L22,0 Z'

const AMBER = '#eaa53c'
const TEAL = '#7fc4bd'

function roof(r: Random, x: number, w: number, top: number, fill: string): string {
  const kind = r.next()
  const mid = x + w / 2
  if (kind < 0.28) {
    // A gothic pitched roof with a thin spire
    const peak = top - r.pick(30, 70)
    return (
      `<polygon points="${x},${top} ${mid},${peak} ${x + w},${top}" fill="${fill}"/>` +
      `<rect x="${mid - 1.5}" y="${peak - 30}" width="3" height="30" fill="${fill}"/>`
    )
  }
  if (kind < 0.5) {
    // Art-deco steps
    const s1 = w * 0.7
    const s2 = w * 0.42
    return (
      `<rect x="${mid - s1 / 2}" y="${top - 18}" width="${s1}" height="18" fill="${fill}"/>` +
      `<rect x="${mid - s2 / 2}" y="${top - 34}" width="${s2}" height="16" fill="${fill}"/>`
    )
  }
  return ''
}

type Windows = { amber: string[]; teal: string[]; flickering: string[] }

// One row of buildings across the scene; lit windows go into `windows` when given.
function row(r: Random, opts: { fill: string; min: number; max: number }, windows?: Windows): string {
  const parts: string[] = []
  let x = -30
  while (x < 1630) {
    const w = Math.floor(r.pick(48, 130))
    const h = Math.floor(r.pick(opts.min, opts.max))
    const top = 1000 - h
    parts.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${opts.fill}"/>`)
    parts.push(roof(r, x, w, top, opts.fill))
    if (windows !== undefined) {
      for (let wy = top + 14; wy < 985; wy += 17) {
        for (let wx = x + 7; wx < x + w - 9; wx += 13) {
          if (r.next() >= 0.13) continue
          const delay = r.pick(0, 11).toFixed(1)
          const teal = r.next() < 0.08
          if (r.next() < 0.22) {
            windows.flickering.push(
              `<use class="win" href="#w" x="${wx}" y="${wy}" fill="${teal ? TEAL : AMBER}" style="animation-delay:-${delay}s"/>`,
            )
          } else {
            windows[teal ? 'teal' : 'amber'].push(`<use href="#w" x="${wx}" y="${wy}"/>`)
          }
        }
      }
    }
    x += w + Math.floor(r.pick(0, 8))
  }
  return parts.join('')
}

const LANDMARKS = `
<g fill="#06090a">
  <rect x="250" y="430" width="110" height="570"/>
  <rect x="268" y="380" width="74" height="60"/>
  <rect x="286" y="330" width="38" height="60"/>
  <polygon points="286,330 305,250 324,330"/>
  <rect x="${SPIRE.x - 1.5}" y="${SPIRE.y}" width="3" height="90"/>
</g>
<circle class="beacon" cx="${SPIRE.x}" cy="${SPIRE.y}" r="4" fill="#ff2a1a"/>`

// They crouch on near-row roofs, so they are drawn in front of what passes behind.
const GARGOYLES = `
<path d="${GARGOYLE}" fill="#040607" transform="translate(1080 812) scale(1.1)"/>
<path d="${GARGOYLE}" fill="#040607" transform="translate(150 842) scale(-0.9 0.9)"/>`

// From hazy far towers to the dark near row with windows. Windows share one shape
// (#w in the scene's defs) and a color group, which keeps the scene small.
export function city(seed: number): City {
  const r = seeded(seed)
  const lit: Windows = { amber: [], teal: [], flickering: [] }
  const far = row(r, { fill: '#13211f', min: 210, max: 400 })
  const mid = row(r, { fill: '#0b1414', min: 150, max: 290 })
  const near = row(r, { fill: '#040607', min: 80, max: 210 }, lit)
  const windows =
    `<g fill="${AMBER}" opacity="0.8">${lit.amber.join('')}</g>` +
    `<g fill="${TEAL}" opacity="0.8">${lit.teal.join('')}</g>` +
    lit.flickering.join('')
  return { far, mid, near, windows, landmarks: LANDMARKS, gargoyles: GARGOYLES }
}
