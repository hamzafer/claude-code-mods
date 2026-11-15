// Where things sit in the 1600 x 1000 scene, and the colors every part draws with.

// The reactor's centre, right of the chat column and above the message box. The whole rig
// (outer arc 232 out, brackets 206) stays inside the frame down to an aspect of 1.45: a
// frame of aspect A shows x up to 800 + 500A, so the centre sits at 1525 - 232 or less.
export const REACTOR = { x: 1290, y: 330 }

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
// (for the scene's one reduced-motion rule), any CSS only reduced motion adds (`still`) and
// its drawing.
export type Part = { defs: string; css: string; animated: string[]; still?: string; svg: string }
