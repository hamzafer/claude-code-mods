// Where things sit in the 1600 x 1000 scene, and the colors every part draws with.

// The reactor's centre, right of the chat column and above the message box.
export const REACTOR = { x: 1370, y: 330 }

// How far right of its centre the reactor draws (the outer arc; brackets reach 206),
// at full size, and the gap it keeps from the frame's edge.
const REACH = 232
const MARGIN = 8

// With xMidYMid slice, a frame of aspect A (width / height, under 1.6) shows x from
// 800 - 500A to 800 + 500A. So in a band of aspects down to `lower`, the reactor at a
// given scale stays whole when x + REACH * scale <= 800 + 500 * lower - MARGIN, and each
// step's x is exactly that. Steps run widest first; the scene's own spot needs 1.6.
type Step = { below: [number, number]; lower: number; y: number; scale: number }
const BANDS: Step[] = [
  { below: [8, 5], lower: 1.5, y: 300, scale: 0.85 },
  { below: [3, 2], lower: 1.3, y: 250, scale: 0.7 },
  { below: [13, 10], lower: 1, y: 225, scale: 0.6 },
  // Down to a phone held upright.
  { below: [1, 1], lower: 0.45, y: 215, scale: 0.62 },
]

// Where the reactor's centre lands below each aspect, and its size.
export const PLACES = BANDS.map(({ below, lower, y, scale }) => ({
  below: `${below[0]}/${below[1]}`,
  x: Math.floor(800 + 500 * lower - REACH * scale - MARGIN),
  y,
  scale,
}))

// Where the floor meets the back wall, and the point the floor grid runs to.
export const HORIZON = 640
export const VANISH_X = 800

// A projected hologram: ice-white lines, a cyan glow, a deep blue haze.
export const ICE = '#d8f6ff'
export const CYAN = '#5fd4f4'
export const HAZE = '#1d6f9a'
// The one warm color, kept for the core when Claude needs you and a few small lights.
export const GOLD = '#f5bf5a'
export const GOLD_HOT = '#fff1cf'
// Machinery in the dark.
export const SHADOW = '#04070b'

// A point on a circle round 0,0, at an angle in degrees, rounded for the drawing.
export function point(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10]
}
export const polar = (r: number, deg: number) => point(r, deg).join(',')

// A short key from a seed, for class and keyframe names: a new seed is new CSS, so a
// new burst plays from the start.
export const seedKey = (prefix: string, seed: number) => `${prefix}${(seed % 46656).toString(36)}`

// What every part hands the scene: its gradients, its CSS, the classes that CSS animates
// (for the scene's one reduced-motion rule) and its drawing.
export type Part = { defs: string; css: string; animated: string[]; svg: string }
