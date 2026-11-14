// The storm: forked lightning far behind the skyline, and the one bolt that hits the
// tower when the signal is about to light. Pure: the same seed draws the same bolts.
//
// Desktop limit: lightning never flashes the whole scene. A full-size rect on top whose
// opacity is animated stops every animation in the desktop app for good, from the moment
// it first flashes, while Chrome plays it fine. It did so as a one-off when the scene
// opened and as a loop 12 seconds in. A strike lights the sky with its own glow instead.

import { SPIRE } from './layout.js'
import { seeded, type Random } from './random.js'

type Point = [number, number]

const ANIMATED = ['.strike', '.hit']

// How long a strike is visible, whatever its cycle.
const STRIKE_S = 0.55

// A jagged line between two points: lightning never travels straight.
function jag(r: Random, [x1, y1]: Point, [x2, y2]: Point, sway: number): Point[] {
  const steps = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) / 46))
  const points: Point[] = [[x1, y1]]
  for (let n = 1; n < steps; n++) {
    const t = n / steps
    points.push([x1 + (x2 - x1) * t + r.pick(-sway, sway), y1 + (y2 - y1) * t + r.pick(-8, 8)])
  }
  points.push([x2, y2])
  return points
}

const line = (points: Point[]) => 'M' + points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' L')

// A trunk with a few thinner branches peeling off it: a soft glow under a hot core.
function bolt(r: Random, from: Point, to: Point, weight = 1): string {
  const trunk = jag(r, from, to, 26)
  const branches: string[] = []
  const count = Math.round(r.pick(2, 3))
  for (let n = 0; n < count; n++) {
    const [x, y] = trunk[1 + Math.floor(r.next() * (trunk.length - 3))]!
    const side = r.next() < 0.5 ? -1 : 1
    branches.push(line(jag(r, [x, y], [x + side * r.pick(70, 190), y + r.pick(70, 190)], 16)))
  }
  const forks = branches.join(' ')
  return (
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${line(trunk)} ${forks}" stroke="#b4c8ff" stroke-opacity="0.26" stroke-width="${11 * weight}"/>` +
    `<path d="${forks}" stroke="#eef3ff" stroke-opacity="0.8" stroke-width="1.3"/>` +
    `<path d="${line(trunk)}" stroke="#f6f9ff" stroke-width="${2.6 * weight}"/></g>`
  )
}

// One distant strike: where it falls and how often. `lead` is how far into its
// cycle the scene starts, so the two strikes are out of step and rarely meet.
type Distant = { name: string; from: Point; to: Point; every: number; lead: number }

function distant(lit: boolean): Distant[] {
  return [
    { name: 'sa', from: [1010, -20], to: [935, 700], every: lit ? 13 : 23, lead: 0 },
    { name: 'sb', from: [110, -20], to: [205, 730], every: lit ? 29 : 37, lead: lit ? 9 : 16 },
  ]
}

// Dark, a double flash, dark again, as the last STRIKE_S of the cycle.
function flicker(name: string, every: number): string {
  const at = (s: number) => (100 - ((STRIKE_S - s) / every) * 100).toFixed(2)
  return (
    `@keyframes ${name}{0%,${at(0)}%{opacity:0}${at(0.06)}%{opacity:1}${at(0.14)}%{opacity:.12}` +
    `${at(0.24)}%{opacity:.8}${at(0.4)}%{opacity:.3}100%{opacity:0}}`
  )
}

export type Storm = {
  css: string
  // The classes this part animates, for the scene's one reduced-motion rule.
  animated: string[]
  // The gradient the strikes glow with.
  defs: string
  // Behind the far towers, so each strike cuts the skyline out of the sky.
  sky: string
  // Lit scenes only: the bolt that hits the spire as the scene opens.
  hit: string
}

export function storm(seed: number, lit: boolean): Storm {
  const r = seeded(seed)
  // Hidden unless striking, so with reduced motion there is no lightning at all.
  let css = '.strike,.hit{opacity:0}'
  const defs =
    '<radialGradient id="skyflash"><stop offset="0" stop-color="#c9d8ff" stop-opacity="0.5"/>' +
    '<stop offset="1" stop-color="#c9d8ff" stop-opacity="0"/></radialGradient>'
  let sky = ''
  for (const s of distant(lit)) {
    css += flicker(s.name, s.every) + `.${s.name}{animation:${s.name} ${s.every}s linear -${s.lead}s infinite}`
    const cx = (s.from[0] + s.to[0]) / 2
    sky +=
      `<g class="strike ${s.name}"><ellipse cx="${cx}" cy="300" rx="560" ry="420" fill="url(#skyflash)"/>` +
      `${bolt(r, s.from, s.to)}</g>`
  }
  if (!lit) return { css, animated: ANIMATED, defs, sky, hit: '' }

  css +=
    '.hit{animation:hit .6s linear 1}' +
    '@keyframes hit{0%{opacity:1}10%{opacity:.15}20%{opacity:1}45%{opacity:.6}100%{opacity:0}}'
  const hit =
    `<g class="hit">${bolt(r, [SPIRE.x + 95, -20], [SPIRE.x, SPIRE.y], 1.6)}` +
    `<circle cx="${SPIRE.x}" cy="${SPIRE.y}" r="110" fill="url(#skyflash)"/></g>`
  return { css, animated: ANIMATED, defs, sky, hit }
}
