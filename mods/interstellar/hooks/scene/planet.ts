// The ice planet low in the left corner: only its limb shows, lit from the upper right
// by the black hole, with pale cloud bands, a thin blue atmosphere and a small far moon.
// Still: nothing here moves.

import { PLANET } from './layout.js'
import type { Part } from './part.js'

const { x, y, r } = PLANET

// Cloud bands follow the curve of the limb, as arcs a little inside it.
function bands(): string {
  return [0.93, 0.88, 0.8, 0.71, 0.6]
    .map((k, n) => {
      const a = r * k
      const sweep = `M${x - a * 0.2},${y - a * 0.98} A${a},${a} 0 0 1 ${x + a * 0.75},${y - a * 0.66}`
      return `<path d="${sweep}" fill="none" stroke="#d6e4ef" stroke-width="${n % 2 ? 3 : 7}" stroke-opacity="${(0.07 - n * 0.008).toFixed(3)}" stroke-linecap="round"/>`
    })
    .join('')
}

export function planet(): Part {
  return {
    defs:
      `<radialGradient id="ice" gradientUnits="userSpaceOnUse" cx="${x + r * 0.55}" cy="${y - r * 0.7}" r="${r * 1.25}">` +
      '<stop offset="0" stop-color="#5d7488"/><stop offset="0.3" stop-color="#2a3a48"/>' +
      '<stop offset="0.62" stop-color="#0d141b"/><stop offset="1" stop-color="#05070a"/></radialGradient>' +
      `<radialGradient id="air" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${r + 26}">` +
      `<stop offset="${((r - 4) / (r + 26)).toFixed(3)}" stop-color="#8fb4d8" stop-opacity="0"/>` +
      `<stop offset="${(r / (r + 26)).toFixed(3)}" stop-color="#a8c8e8" stop-opacity="0.5"/>` +
      '<stop offset="1" stop-color="#6f94c0" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="moon" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#b8b2a6"/>' +
      '<stop offset="0.6" stop-color="#4c4842"/><stop offset="1" stop-color="#151413"/></radialGradient>',
    css: '',
    animated: [],
    still: '',
    svg:
      `<circle cx="${x}" cy="${y}" r="${r + 26}" fill="url(#air)"/>` +
      `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#ice)"/>` +
      bands() +
      `<circle cx="${x + r * 1.05}" cy="${y - r * 1.12}" r="6" fill="url(#moon)" opacity="0.8"/>`,
  }
}
