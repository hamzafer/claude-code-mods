// Where things sit in the 1600 x 1000 scene, and the colors every part draws with.

// The reactor's centre, right of the chat column and above the message box.
export const REACTOR = { x: 1370, y: 330 }

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

// What every part hands the scene: its gradients, its CSS, the classes that CSS animates
// (for the scene's one reduced-motion rule) and its drawing.
export type Part = { defs: string; css: string; animated: string[]; svg: string }
