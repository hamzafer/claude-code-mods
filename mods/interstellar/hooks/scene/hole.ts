// The black hole: a pitch-black shadow inside a thin photon ring, the far side of its
// disc lensed into arcs over the top and under the bottom, and the near side crossing
// in front, nearly edge-on. Bright knots ride the near side around and the lensed light
// slowly turns. When the ship hails you, the photon ring burns brighter and pulses.
// Drawn around 0,0: the scene places it at HOLE.

import type { Part } from './part.js'

const ANIMATED = ['.swirl', '.knot', '.flare']

// The disc's tilt, in degrees.
const TILT = -7
// Half the near side's span and how far its front edge dips below the middle.
const REACH = 380
const DIP = 9

const SHADOW = 62

// The lensed arcs: the far side of the disc, bent over the top and, smaller, under the bottom.
// Each fills with a glow that fades out before its outer edge, so no rim shows. A glow is
// stretched upright by `tall`, so an arc is thickest straight over the shadow and thins
// toward the disc at its sides: the path is drawn squashed by that much and its group
// stretched back, which stretches the glow with it.
const arc = (rx: number, ry: number, tall: number, over: boolean): string => {
  const inner = SHADOW + (over ? 5 : 4)
  const outer = over ? 1 : 0
  const y = (v: number) => (v / tall).toFixed(2)
  return `M-${rx},0 A${rx},${y(ry)} 0 0 ${outer} ${rx},0 L${inner},0 A${inner},${y(inner)} 0 0 ${1 - outer} -${inner},0 Z`
}
const TOP = { tall: 1.25, path: arc(175, 205, 1.25, true) }
const LOW = { tall: 1.02, path: arc(130, 125, 1.02, false) }

// The lensed glow: white-hot at the shadow's edge, through amber, to nothing at `r` across.
function lens(id: string, r: number): string {
  const at = (d: number) => (d / r).toFixed(3)
  return (
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${r}">` +
    `<stop offset="${at(SHADOW + 4)}" stop-color="#fffaf0"/><stop offset="${at(SHADOW + 18)}" stop-color="#ffe0a4" stop-opacity="0.95"/>` +
    `<stop offset="${at(SHADOW + 28)}" stop-color="#f0a24a" stop-opacity="0.42"/><stop offset="${at(SHADOW + 52)}" stop-color="#a05418" stop-opacity="0.1"/>` +
    '<stop offset="1" stop-color="#5a2c0c" stop-opacity="0"/></radialGradient>'
  )
}

// Where a knot is, `share` of the way along the near side: a point on the front of the ellipse.
function spot(share: number): [number, string] {
  const t = share * Math.PI
  return [Math.round(-Math.cos(t) * (REACH - 50)), (Math.sin(t) * DIP).toFixed(1)]
}
const along = (share: number) => `translate(${spot(share)[0]}px,${spot(share)[1]}px)`
const rest = (share: number) => `translate(${spot(share)[0]} ${spot(share)[1]})`

// A knot rides the near side from one end to the other, brightest on the side coming toward you.
function knotKeyframes(name: string): string {
  const stops = [0, 20, 40, 60, 80, 100].map(pct => {
    const glow = pct === 0 || pct === 100 ? 0 : pct <= 40 ? 1 : pct === 60 ? 0.7 : 0.35
    return `${pct}%{transform:${along(pct / 100)};opacity:${glow}}`
  })
  return `@keyframes ${name}{${stops.join('')}}`
}

// Each knot: its length, how long one pass takes, and how far into it the scene starts.
const KNOTS = [
  { len: 34, every: 11, lead: 2 },
  { len: 22, every: 14, lead: 9 },
  { len: 46, every: 17, lead: 5 },
  { len: 18, every: 9, lead: 7 },
  { len: 28, every: 13, lead: 12 },
  { len: 16, every: 19, lead: 15 },
  { len: 38, every: 23, lead: 4 },
]

// Still, each knot rests where its markup puts it, spread along the disc; the orbit moves it from there.
function knots(): { css: string; still: string; svg: string } {
  let css = '.knot{opacity:0}' + knotKeyframes('orbit')
  let still = ''
  let svg = ''
  KNOTS.forEach((k, n) => {
    css += `.kn${n}{animation:orbit ${k.every}s linear -${k.lead}s infinite}`
    still += `.kn${n}{opacity:.75}`
    svg += `<g class="knot kn${n}" transform="${rest(0.1 + 0.8 * (n / (KNOTS.length - 1)))}"><ellipse rx="${k.len}" ry="1.6" fill="url(#streak)"/></g>`
  })
  return { css, still, svg }
}

// The lensed light turning: broken rings, all within the arcs, rotating about the shadow.
const SWIRL =
  `<g class="swirl">` +
  `<circle r="84" fill="none" stroke="#fff0d0" stroke-width="1.6" stroke-dasharray="60 14 22 40 90 20" opacity="0.22"/>` +
  `<circle r="103" fill="none" stroke="#ffd08a" stroke-width="1.2" stroke-dasharray="24 30 70 16 14 44" opacity="0.16"/>` +
  `<circle r="124" fill="none" stroke="#e8a050" stroke-width="1.4" stroke-dasharray="80 50 30 60" opacity="0.1"/>` +
  `</g>`

export function hole(hailing: boolean): Part {
  const k = knots()
  const defs =
    '<radialGradient id="farGlow"><stop offset="0" stop-color="#2a1a0c" stop-opacity="0.6"/>' +
    '<stop offset="0.3" stop-color="#1a120a" stop-opacity="0.35"/><stop offset="1" stop-color="#140e09" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="holeGlow"><stop offset="0" stop-color="#ffb860" stop-opacity="0.2"/>' +
    '<stop offset="0.35" stop-color="#b8681e" stop-opacity="0.08"/><stop offset="1" stop-color="#5a3010" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="haze"><stop offset="0" stop-color="#ffc678" stop-opacity="0.38"/>' +
    '<stop offset="0.45" stop-color="#c06a20" stop-opacity="0.12"/><stop offset="1" stop-color="#6a3410" stop-opacity="0"/></radialGradient>' +
    lens('lensTop', 160) +
    lens('lensLow', 118) +
    '<linearGradient id="streak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff6e0" stop-opacity="0"/>' +
    '<stop offset="0.5" stop-color="#fff6e0"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="disc" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#7a3a10" stop-opacity="0"/><stop offset="0.16" stop-color="#d27a2a" stop-opacity="0.55"/>' +
    '<stop offset="0.36" stop-color="#ffd08a" stop-opacity="0.95"/><stop offset="0.5" stop-color="#fff2d8"/>' +
    '<stop offset="0.66" stop-color="#ffbf6a" stop-opacity="0.8"/><stop offset="0.86" stop-color="#b0601e" stop-opacity="0.35"/>' +
    '<stop offset="1" stop-color="#6a3410" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="core" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#fffaf0" stop-opacity="0"/><stop offset="0.3" stop-color="#fffaf0" stop-opacity="0.9"/>' +
    '<stop offset="0.7" stop-color="#fffaf0" stop-opacity="0.7"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/></linearGradient>' +
    `<radialGradient id="flareRing" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${SHADOW + 21}">` +
    `<stop offset="${(SHADOW / (SHADOW + 21)).toFixed(3)}" stop-color="#fff4d8"/><stop offset="1" stop-color="#ffc870" stop-opacity="0"/></radialGradient>`

  // The photon ring: a hairline, and when hailing a hotter one with a pulsing halo.
  const ring = hailing
    ? `<circle class="flare" r="${SHADOW + 8}" fill="none" stroke="url(#flareRing)" stroke-width="26" opacity="0.4"/>` +
      `<circle r="${SHADOW + 1.5}" fill="none" stroke="#fffaf0" stroke-width="3"/>`
    : `<circle r="${SHADOW + 3}" fill="none" stroke="#ffcf88" stroke-width="4" opacity="0.3"/>` +
      `<circle r="${SHADOW + 1.5}" fill="none" stroke="#fff3dc" stroke-width="1.5" opacity="0.85"/>`

  return {
    defs,
    css:
      '.swirl{animation:swirl 90s linear infinite;transform-origin:0 0;will-change:transform}' +
      '@keyframes swirl{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
      '.flare{animation:flare 3.6s ease-in-out infinite}' +
      '@keyframes flare{0%,100%{opacity:.25}50%{opacity:.8}}' +
      k.css,
    animated: ANIMATED,
    still: k.still,
    svg:
      // The warm light the hole throws across the sky, so it goes wherever the hole goes.
      `<circle r="1500" fill="url(#farGlow)"/>` +
      `<circle r="620" fill="url(#holeGlow)" opacity="${hailing ? 1 : 0.75}"/>` +
      `<g transform="rotate(${TILT})">` +
      `<ellipse rx="560" ry="86" fill="url(#haze)"/>` +
      `<g transform="scale(1 ${TOP.tall})"><path d="${TOP.path}" fill="url(#lensTop)"/></g>` +
      `<g transform="scale(1 ${LOW.tall})" opacity="0.85"><path d="${LOW.path}" fill="url(#lensLow)"/></g>` +
      SWIRL +
      `<circle r="${SHADOW}" fill="#000"/>` +
      ring +
      `<ellipse cy="2" rx="${REACH + 40}" ry="17" fill="url(#disc)"/>` +
      `<ellipse cy="1" rx="${REACH - 120}" ry="3.5" fill="url(#core)"/>` +
      k.svg +
      `</g>`,
  }
}
