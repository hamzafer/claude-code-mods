// The blood moon and the eye in it. While Claude works, three comma marks on a ring
// turn a third at a time, like something thinking. When Claude needs you they spin up,
// vanish into a three-blade pinwheel that locks and throbs, and the moon brightens.
// Every glow is the moon's own: nothing here covers the whole scene.

import { MOON } from './layout.js'

// One comma mark: a round head at 0,0 (radius 1) and a tail sweeping back along the ring.
const COMMA = 'M0,-1 A1,1 0 1,1 -0.85,0.53 C-1.3,1.05 -2.4,1.2 -3.4,0.9 C-2.5,0.75 -1.6,0.15 -0.95,-0.3 A1,1 0 0,1 0,-1 Z'

// One pinwheel blade on a unit moon: from the pupil, curving out to a point near the ring.
const BLADE = 'M0.13,0.02 C0.36,-0.2 0.46,-0.52 0.24,-0.8 C0.26,-0.52 0.12,-0.3 -0.07,-0.13 Z'

const R = MOON.r
const RING = R * 0.56
const DARK = '#160404'

const thirds = (draw: (turn: number) => string) => [0, 120, 240].map(draw).join('')

const commas = thirds(
  turn =>
    `<g transform="rotate(${turn})"><path d="${COMMA}" transform="translate(0 ${-RING}) scale(${(R * 0.078).toFixed(1)})"/></g>`,
)

const blades = thirds(turn => `<path d="${BLADE}" transform="rotate(${turn}) scale(${R})"/>`)

const DEFS = `
<radialGradient id="moonface" cx="0.42" cy="0.38" r="0.68">
  <stop offset="0" stop-color="#cf3b2a"/>
  <stop offset="0.5" stop-color="#a11b17"/>
  <stop offset="0.85" stop-color="#761110"/>
  <stop offset="1" stop-color="#560b0b"/>
</radialGradient>
<radialGradient id="moonlit" cx="0.42" cy="0.38" r="0.68">
  <stop offset="0" stop-color="#ff7a4e"/>
  <stop offset="0.55" stop-color="#e0342a"/>
  <stop offset="1" stop-color="#9a1814"/>
</radialGradient>
<radialGradient id="haze">
  <stop offset="0.3" stop-color="#8e1810" stop-opacity="0.42"/>
  <stop offset="0.55" stop-color="#5a0d0b" stop-opacity="0.18"/>
  <stop offset="1" stop-color="#3a0707" stop-opacity="0"/>
</radialGradient>
<radialGradient id="corona">
  <stop offset="0.6" stop-color="#ff5232" stop-opacity="0"/>
  <stop offset="0.69" stop-color="#ff5232" stop-opacity="0.55"/>
  <stop offset="1" stop-color="#ff5232" stop-opacity="0"/>
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

// `spin` is how long, in seconds, the marks spin up before the pinwheel locks (lit only).
// Every end state is the markup's own resting pose; animations only fade layers (opacity,
// held with `both`) or move something that rests where it ends, so no fill mode holds a move.
export function moon(lit: boolean, spin: number): Moon {
  const place = (inner: string) =>
    `<g class="moon" transform="translate(${MOON.x} ${MOON.y})">${inner}</g>`

  if (!lit) {
    return {
      defs: DEFS,
      css:
        '.think{animation:think 15s ease-in-out infinite}' +
        '@keyframes think{0%{transform:rotate(0deg)}30%,33.3%{transform:rotate(120deg)}63.3%,66.6%{transform:rotate(240deg)}96.6%,100%{transform:rotate(360deg)}}',
      animated: ['.think'],
      still: '',
      svg: place(`${HAZE}${FACE}<g fill="${DARK}">${PUPIL}<g class="think">${commas}</g></g>`),
    }
  }

  const lit0 = (spin - 0.3).toFixed(2)
  const lock = (spin - 0.15).toFixed(2)
  const throb = (spin + 0.6).toFixed(2)
  return {
    defs: DEFS,
    css:
      // The marks spin fast on an inner group while the outer one fades them out for good.
      '.spinturn{animation:spinturn .45s linear infinite}' +
      '@keyframes spinturn{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
      `.spinup{animation:spinout ${spin}s ease-in both}` +
      '@keyframes spinout{0%,80%{opacity:1}100%{opacity:0}}' +
      `.bright{animation:fadein 1.2s ease-out ${lit0}s both}` +
      '@keyframes fadein{from{opacity:0}to{opacity:1}}' +
      // The pinwheel rests locked: it fades in, then throbs; its quarter turn is on the inner group.
      `.wheel{animation:fadein .7s ease-out ${lock}s both,throb 2.4s ease-in-out ${throb}s infinite}` +
      `.lock{animation:lock .7s ease-out ${lock}s}` +
      '@keyframes lock{from{transform:rotate(-90deg)}}' +
      '@keyframes throb{0%,100%{opacity:1}50%{opacity:.72}}' +
      `.corona{animation:coronain 1.2s ease-out ${lit0}s both,corona 2.4s ease-in-out ${throb}s infinite}` +
      '@keyframes coronain{from{opacity:0}to{opacity:.35}}' +
      '@keyframes corona{0%,100%{opacity:.35}50%{opacity:1}}',
    animated: ['.spinturn', '.spinup', '.bright', '.wheel', '.lock', '.corona'],
    // With reduced motion the scene shows where the opening ends: bright, the pinwheel locked.
    still: '.spinup { opacity: 0; }',
    svg: place(
      `${HAZE}<circle class="corona" r="${R * 1.45}" fill="url(#corona)"/>${FACE}` +
        `<circle class="bright" r="${R}" fill="url(#moonlit)"/>` +
        `<g fill="${DARK}">${PUPIL}<g class="spinup"><g class="spinturn">${commas}</g></g>` +
        `<g class="wheel"><g class="lock">${blades}</g></g></g>`,
    ),
  }
}
