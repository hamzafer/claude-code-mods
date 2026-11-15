// The prompt: a terminal line typed out one character at a time in a dark clearing in
// the rain, then a block cursor that blinks for as long as Claude waits.
//
// No fill-mode anywhere: each character's resting state is shown, and its animation only
// hides it until its turn. The cursor rests at the end of the line and is carried there.
// So with reduced motion the whole line simply stands, typed.

import { FONT } from './glyphs.js'
import { PROMPT, TALL } from './layout.js'
import type { Part } from './part.js'

const LINE = '> your move'
const SIZE = 30
// Every character gets its own slot, so any monospace face lines up with the cursor.
const ADVANCE = 19
const WIDTH = LINE.length * ADVANCE
// Seconds before the first key, and between keys.
const START = 1.4
const KEY = 0.13
const TYPED = START + LINE.length * KEY

const keys = [...LINE]
  .map((c, i) =>
    c === ' '
      ? ''
      : `<text class="key" x="${i * ADVANCE + ADVANCE / 2}" style="animation-duration:${(START + i * KEY).toFixed(2)}s">${c}</text>`,
  )
  .join('')

const at = (x: number, y: number) => `transform:translate(${x}px,${y}px)`

export const PROMPT_PART: Part = {
  defs:
    '<radialGradient id="clearing"><stop offset="0.35" stop-color="#010302" stop-opacity="0.92"/>' +
    '<stop offset="1" stop-color="#010302" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="phosphor"><stop offset="0" stop-color="#5dff8f" stop-opacity="0.16"/>' +
    '<stop offset="1" stop-color="#5dff8f" stop-opacity="0"/></radialGradient>',
  css:
    `.spot{${at(PROMPT.x, PROMPT.y)}}` +
    `@media ${TALL}{.spot{${at(800 - WIDTH / 2, PROMPT.tallY)}}}` +
    '.key{animation:hide 1s steps(1) 1}@keyframes hide{from,to{opacity:0}}' +
    `.caret{transform:translateX(${WIDTH}px);animation:caret ${TYPED.toFixed(2)}s steps(${LINE.length},start) 1}` +
    `@keyframes caret{0%,${((START / TYPED) * 100).toFixed(1)}%{transform:translateX(0px)}100%{transform:translateX(${WIDTH}px)}}` +
    '.blink{animation:blink 1.1s steps(1) infinite}@keyframes blink{50%{opacity:0}}',
  animated: ['.key', '.caret', '.blink'],
  still: '',
  svg:
    `<g class="spot">` +
    `<ellipse cx="${WIDTH / 2}" cy="-10" rx="${WIDTH + 140}" ry="230" fill="url(#clearing)"/>` +
    `<ellipse cx="${WIDTH / 2}" cy="-10" rx="${WIDTH * 0.85}" ry="70" fill="url(#phosphor)"/>` +
    `<g font-family="${FONT}" font-size="${SIZE}" font-weight="600" text-anchor="middle" fill="#b4ffc8">${keys}</g>` +
    `<g class="caret"><rect class="blink" x="2" y="${-SIZE * 0.78}" width="${ADVANCE - 3}" height="${SIZE}" fill="#c8ffd6"/></g>` +
    `</g>`,
}
