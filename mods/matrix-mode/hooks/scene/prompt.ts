// The prompt: a terminal line typed out one character at a time in a dark clearing in
// the rain, then a block cursor that blinks for as long as Claude waits.
//
// No fill-mode anywhere: each character's resting state is shown, and its animation only
// hides it until its turn. The cursor rests at the end of the line, where markup puts it,
// and its keyframes only pull it back to the start and hop it forward a key at a time
// (steps(1) between stops). So with reduced motion the whole line simply stands, typed.
//
// Desktop limit: no transform in the stylesheet outside keyframes, one steps(1) timing.

import { FONT } from './glyphs.js'
import { PROMPT } from './layout.js'
import type { Part } from './part.js'

const LINE = '> your move'
const SIZE = 30
// Every character gets its own slot, so any monospace face lines up with the cursor.
const WIDTH = PROMPT.width
const ADVANCE = WIDTH / LINE.length
// Seconds before the first key, and between keys.
const START = 1.4
const KEY = 0.13
const TYPED = START + LINE.length * KEY

const keys = [...LINE]
  .map((c, i) =>
    c === ' '
      ? ''
      : `<text class="key" x="${(i * ADVANCE + ADVANCE / 2).toFixed(1)}" style="animation-duration:${(START + i * KEY).toFixed(2)}s">${c}</text>`,
  )
  .join('')

// One keyframe stop per key: the caret sits at the start until the first key, then
// stands one character further along from each key's moment.
const caretStops = [
  `0%{transform:translateX(${-WIDTH}px)}`,
  ...[...LINE].map((_, i) => {
    const at = ((START + i * KEY) / TYPED) * 100
    return `${at.toFixed(2)}%{transform:translateX(${((i + 1) * ADVANCE - WIDTH).toFixed(1)}px)}`
  }),
].join('')

export const PROMPT_PART: Part = {
  defs:
    '<radialGradient id="clearing"><stop offset="0.35" stop-color="#010302" stop-opacity="0.92"/>' +
    '<stop offset="1" stop-color="#010302" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="phosphor"><stop offset="0" stop-color="#5dff8f" stop-opacity="0.16"/>' +
    '<stop offset="1" stop-color="#5dff8f" stop-opacity="0"/></radialGradient>',
  css:
    '.key{animation:hide 1s steps(1) 1}@keyframes hide{from,to{opacity:0}}' +
    `.caret{animation:caret ${TYPED.toFixed(2)}s steps(1) 1}@keyframes caret{${caretStops}}` +
    '.blink{animation:blink 1.1s steps(1) infinite}@keyframes blink{50%{opacity:0}}',
  animated: ['.key', '.caret', '.blink'],
  still: '',
  svg:
    `<g class="spot" transform="translate(${PROMPT.at.x} ${PROMPT.at.y})">` +
    `<ellipse cx="${WIDTH / 2}" cy="-10" rx="${WIDTH + 140}" ry="230" fill="url(#clearing)"/>` +
    `<ellipse cx="${WIDTH / 2}" cy="-10" rx="${WIDTH * 0.85}" ry="70" fill="url(#phosphor)"/>` +
    `<g font-family="${FONT}" font-size="${SIZE}" font-weight="600" text-anchor="middle" fill="#b4ffc8">${keys}</g>` +
    `<g transform="translate(${WIDTH} 0)"><g class="caret"><rect class="blink" x="2" y="${-SIZE * 0.78}" width="${(ADVANCE - 3).toFixed(1)}" height="${SIZE}" fill="#c8ffd6"/></g></g>` +
    `</g>`,
}
