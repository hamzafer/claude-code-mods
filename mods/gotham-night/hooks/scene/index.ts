// The backdrop for a signal state: the city plus, when lit, the signal and a bat burst.
// Desktop draws it in a sandboxed frame; CSS animation only, no script.

import type { Signal } from '../../types'
import { city } from './city.js'
import { BAT, flock, type Flock } from './flock.js'
import { LAMP, SIGNAL } from './layout.js'

// The signal's emblem, centred on 0,0, about 200 wide.
const EMBLEM =
  'M0,-14 L6,-27 L10,-14 C20,-16 30,-26 34,-40 C60,-36 85,-20 100,0 C88,-2 80,6 76,16 ' +
  'C68,6 56,6 50,14 C44,6 32,8 26,20 C18,12 8,14 0,28 C-8,14 -18,12 -26,20 C-32,8 -44,6 -50,14 ' +
  'C-56,6 -68,6 -76,16 C-80,6 -88,-2 -100,0 C-85,-20 -60,-36 -34,-40 C-30,-26 -20,-16 -10,-14 L-6,-27 Z'

const CITY = city(11)
const NO_BATS: Flock = { css: '', svg: '' }

function build(lit: boolean, bats: Flock): string {
  const beams = lit
    ? `<g transform="translate(${LAMP.x} ${LAMP.y}) rotate(5.7)"><polygon class="lock" points="-16,0 16,0 150,-700 -150,-700" fill="url(#beam)"/></g>
<g transform="translate(330 1000)"><g class="beam2"><polygon points="-10,0 10,0 80,-1150 -80,-1150" fill="url(#beam)" opacity="0.3"/></g></g>
<g class="signal" transform="translate(${SIGNAL.x} ${SIGNAL.y}) scale(1.15)">
  <ellipse rx="200" ry="118" fill="url(#halo)"/>
  <ellipse rx="140" ry="82" fill="#fff0c2" opacity="0.8"/>
  <path d="${EMBLEM}" fill="#0a0c10" opacity="0.92"/>
</g>`
    : `<g transform="translate(${LAMP.x} ${LAMP.y})"><g class="beam fast"><polygon points="-14,0 14,0 120,-1250 -120,-1250" fill="url(#beam)"/></g></g>
<g transform="translate(330 1000)"><g class="beam2 fast"><polygon points="-10,0 10,0 80,-1150 -80,-1150" fill="url(#beam)" opacity="0.7"/></g></g>
<ellipse cx="1180" cy="170" rx="180" ry="70" fill="url(#glow)" class="fogA"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
  <rect id="w" width="5" height="8"/>
  <path id="bat" d="${BAT}"/>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#04070a"/>
    <stop offset="0.42" stop-color="#0a1517"/>
    <stop offset="0.7" stop-color="#16272a"/>
    <stop offset="0.88" stop-color="#33291a"/>
    <stop offset="1" stop-color="#4a3219"/>
  </linearGradient>
  <radialGradient id="flare" cx="0.5" cy="1" r="0.75">
    <stop offset="0" stop-color="#c0170f" stop-opacity="0.9"/>
    <stop offset="0.5" stop-color="#6e0d0a" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#3a0605" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#ffe9b0" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#ffe9b0" stop-opacity="${lit ? 0.12 : 0}"/>
  </linearGradient>
  <radialGradient id="glow">
    <stop offset="0" stop-color="#ffe2a0" stop-opacity="0.3"/>
    <stop offset="1" stop-color="#ffe2a0" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="halo">
    <stop offset="0.55" stop-color="#ffe7a8" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="moon">
    <stop offset="0" stop-color="#e8dcc0" stop-opacity="0.85"/>
    <stop offset="0.5" stop-color="#c9b48a" stop-opacity="0.4"/>
    <stop offset="1" stop-color="#c9b48a" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fogband" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2f4446" stop-opacity="0"/>
    <stop offset="0.55" stop-color="#2f4446" stop-opacity="0.42"/>
    <stop offset="1" stop-color="#2f4446" stop-opacity="0.1"/>
  </linearGradient>
  <radialGradient id="fogpuff">
    <stop offset="0" stop-color="#2c3d40" stop-opacity="0.8"/>
    <stop offset="1" stop-color="#2c3d40" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="fogpuff2">
    <stop offset="0" stop-color="#3a5052" stop-opacity="0.8"/>
    <stop offset="1" stop-color="#3a5052" stop-opacity="0"/>
  </radialGradient>
  <pattern id="rain" width="60" height="120" patternUnits="userSpaceOnUse">
    <line x1="10" y1="0" x2="1" y2="32" stroke="#a9bcc4" stroke-opacity="${lit ? 0.26 : 0.2}" stroke-width="1.2"/>
    <line x1="42" y1="55" x2="34" y2="85" stroke="#a9bcc4" stroke-opacity="0.15" stroke-width="1"/>
  </pattern>
</defs>
<style>
  .beam { animation: sweep 14s ease-in-out infinite alternate; transform-origin: 0 0; }
  .beam2 { animation: sweep2 19s ease-in-out infinite alternate; transform-origin: 0 0; }
  .beam.fast { animation-duration: 3.2s; }
  .beam2.fast { animation-duration: 4.1s; }
  @keyframes sweep { from { transform: rotate(-38deg); } to { transform: rotate(-4deg); } }
  @keyframes sweep2 { from { transform: rotate(8deg); } to { transform: rotate(34deg); } }
  .signal { animation: lit 0.9s ease-out both, pulse 3.5s ease-in-out 0.9s infinite; }
  .lock { animation: lit 0.6s ease-out both; }
  @keyframes lit { 0% { opacity: 0; } 30% { opacity: 1; } 45% { opacity: 0.3; } 60%, 100% { opacity: 1; } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.74; } }
  .flare { animation: flare 4s ease-in-out infinite; }
  @keyframes flare { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  .fogA, .fogB, .rain, .beam, .beam2 { will-change: transform; }
  .fogA { animation: drift 70s ease-in-out infinite alternate; }
  .fogB { animation: drift 45s ease-in-out -20s infinite alternate-reverse; }
  @keyframes drift { from { transform: translateX(-120px); } to { transform: translateX(120px); } }
  .rain { animation: fall 0.8s linear infinite; }
  @keyframes fall { from { transform: translate(0, -120px); } to { transform: translate(-32px, 0); } }
  .win { animation: flicker 11s steps(1) infinite; }
  @keyframes flicker { 0% { opacity: 0.85; } 40% { opacity: 0.85; } 41% { opacity: 0.12; } 63% { opacity: 0.12; } 64% { opacity: 0.7; } 100% { opacity: 0.7; } }
  .beacon { animation: beacon 2.4s steps(1) infinite; }
  @keyframes beacon { 0% { opacity: 1; } 18% { opacity: 0.08; } 100% { opacity: 0.08; } }
  .flash { animation: lightning ${lit ? 13 : 23}s linear infinite; opacity: 0; }
  @keyframes lightning { 0%, 95% { opacity: 0; } 95.5% { opacity: 0.24; } 96% { opacity: 0.04; } 96.6% { opacity: 0.18; } 97.6%, 100% { opacity: 0; } }
  ${bats.css}
  @media (prefers-reduced-motion: reduce) {
    .beam, .beam2, .fogA, .fogB, .rain, .win, .flash, .signal, .lock, .flare, .beacon { animation: none; }
    .bat { display: none; }
  }
</style>
<rect width="1600" height="1000" fill="url(#sky)"/>
${lit ? '<rect class="flare" width="1600" height="1000" fill="url(#flare)"/>' : ''}
<circle cx="600" cy="130" r="120" fill="url(#moon)"/>
<g class="fogA" fill="url(#fogpuff)" opacity="0.75">
  <ellipse cx="280" cy="230" rx="420" ry="60"/>
  <ellipse cx="1020" cy="130" rx="480" ry="66"/>
  <ellipse cx="1480" cy="270" rx="320" ry="52"/>
</g>
${beams}
${CITY.far}
<rect y="560" width="1600" height="440" fill="url(#fogband)"/>
${CITY.mid}
${CITY.landmarks}
${CITY.near}
${CITY.windows}
<g class="fogB" fill="url(#fogpuff2)" opacity="0.5">
  <ellipse cx="400" cy="930" rx="520" ry="50"/>
  <ellipse cx="1250" cy="960" rx="560" ry="55"/>
</g>
${bats.svg}
<g class="rain"><rect x="-100" y="-120" width="1800" height="1240" fill="url(#rain)"/></g>
<rect class="flash" width="1600" height="1000" fill="#dfe8ff"/>
</svg>`
}

// The sweeping scene never changes. A lit scene is built once per burst and kept,
// so redraws of the same lit signal don't rebuild or replay it.
const SWEEPING = build(false, NO_BATS)
let lit: { burst: number; svg: string } | undefined

export function sceneFor(signal: Signal): string {
  if (signal.mode !== 'waiting') return SWEEPING
  if (lit?.burst !== signal.burst) lit = { burst: signal.burst, svg: build(true, flock(signal.burst)) }
  return lit.svg
}
