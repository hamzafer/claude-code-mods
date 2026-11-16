// The blood moon and the eye in it: three comma marks on a ring turn a third at a time,
// like something thinking. Every glow is the moon's own: nothing here covers the whole scene.

import { MOON } from './layout.js'

// One comma mark: a round head at 0,0 (radius 1) and a tail sweeping back along the ring.
const COMMA = 'M0,-1 A1,1 0 1,1 -0.85,0.53 C-1.3,1.05 -2.4,1.2 -3.4,0.9 C-2.5,0.75 -1.6,0.15 -0.95,-0.3 A1,1 0 0,1 0,-1 Z'

const R = MOON.r
const RING = R * 0.56
const DARK = '#160404'

const thirds = (draw: (turn: number) => string) => [0, 120, 240].map(draw).join('')

const commas = thirds(
  turn =>
    `<g transform="rotate(${turn})"><path d="${COMMA}" transform="translate(0 ${-RING}) scale(${(R * 0.078).toFixed(1)})"/></g>`,
)

const DEFS = `
<radialGradient id="moonface" cx="0.42" cy="0.38" r="0.68">
  <stop offset="0" stop-color="#cf3b2a"/>
  <stop offset="0.5" stop-color="#a11b17"/>
  <stop offset="0.85" stop-color="#761110"/>
  <stop offset="1" stop-color="#560b0b"/>
</radialGradient>
<radialGradient id="haze">
  <stop offset="0.3" stop-color="#8e1810" stop-opacity="0.42"/>
  <stop offset="0.55" stop-color="#5a0d0b" stop-opacity="0.18"/>
  <stop offset="1" stop-color="#3a0707" stop-opacity="0"/>
</radialGradient>`

// The moon's face, with a few darker seas so it reads as a moon before it reads as an eye.
const HAZE = `<circle r="${R * 2.4}" fill="url(#haze)"/>`

const FACE = `
<circle r="${R}" fill="url(#moonface)"/>
<g fill="#3e0606" opacity="0.16">
  <ellipse cx="${-R * 0.42}" cy="${-R * 0.5}" rx="${R * 0.22}" ry="${R * 0.15}"/>
  <ellipse cx="${R * 0.5}" cy="${R * 0.36}" rx="${R * 0.18}" ry="${R * 0.24}"/>
  <ellipse cx="${-R * 0.3}" cy="${R * 0.62}" rx="${R * 0.24}" ry="${R * 0.12}"/>
  <ellipse cx="${R * 0.62}" cy="${-R * 0.42}" rx="${R * 0.1}" ry="${R * 0.08}"/>
</g>
<circle r="${R - 1.5}" fill="none" stroke="#ff8a5a" stroke-opacity="0.22" stroke-width="3"/>`

const PUPIL = `<circle r="${RING}" fill="none" stroke="${DARK}" stroke-opacity="0.8" stroke-width="3.5"/>
<circle r="${R * 0.12}" fill="${DARK}"/>`

export type Moon = { defs: string; css: string; animated: string[]; still: string; svg: string }

// The marks rest where they are; the animation only turns the group, a third at a time.
export function moon(): Moon {
  return {
    defs: DEFS,
    css:
      '.think{animation:think 15s ease-in-out infinite}' +
      '@keyframes think{0%{transform:rotate(0deg)}30%,33.3%{transform:rotate(120deg)}63.3%,66.6%{transform:rotate(240deg)}96.6%,100%{transform:rotate(360deg)}}',
    animated: ['.think'],
    still: '',
    svg: `<g class="moon" transform="translate(${MOON.x} ${MOON.y})">${HAZE}${FACE}<g fill="${DARK}">${PUPIL}<g class="think">${commas}</g></g></g>`,
  }
}
