// The still layers: the green-black ground behind the rain, and the shade in front of it
// that keeps the chat column and the message box at the foot calm and dark.
// Nothing here moves: Desktop stops every animation for good once a full-size layer's
// opacity is animated, so the shade is drawn, never faded.

import type { Part } from './part.js'

const STILL = { css: '', animated: [], still: '' }

export const GROUND: Part = {
  ...STILL,
  defs:
    '<radialGradient id="ground" cx="0.5" cy="0.45" r="0.75">' +
    '<stop offset="0" stop-color="#010302"/><stop offset="0.6" stop-color="#030a05"/>' +
    '<stop offset="1" stop-color="#06160b"/></radialGradient>',
  svg: '<rect width="1600" height="1000" fill="url(#ground)"/>',
}

export const SHADE: Part = {
  ...STILL,
  defs:
    // Darkest down the middle, where the words sit.
    '<linearGradient id="calm" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0.2" stop-color="#010302" stop-opacity="0"/>' +
    '<stop offset="0.36" stop-color="#010302" stop-opacity="0.55"/>' +
    '<stop offset="0.64" stop-color="#010302" stop-opacity="0.55"/>' +
    '<stop offset="0.8" stop-color="#010302" stop-opacity="0"/></linearGradient>' +
    // And at the foot, where the message box sits.
    '<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#010302" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="#010302" stop-opacity="0.8"/></linearGradient>' +
    // Faint scanlines, the glass of an old monitor.
    '<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">' +
    '<rect width="4" height="1.4" fill="#000" fill-opacity="0.32"/></pattern>',
  svg:
    '<rect width="1600" height="1000" fill="url(#calm)"/>' +
    '<rect y="760" width="1600" height="240" fill="url(#foot)"/>' +
    '<rect width="1600" height="1000" fill="url(#scan)"/>',
}
