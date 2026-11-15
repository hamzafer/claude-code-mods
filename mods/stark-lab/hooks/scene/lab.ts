// The workshop: a dark room with a perspective floor grid running to the horizon, and a
// workbench with a jointed robot arm low at the left. Live, a scan line sweeps the floor
// and the arm idles; hushed, the room holds still.

import { CYAN, GOLD, HAZE, HORIZON, ICE, REACTOR, SHADOW, VANISH_X, type Part } from './layout.js'

// Floor lines: where the rays meet the foot of the scene, and how deep each cross line is.
const RAY_STEP = 210
const DEPTHS = [1, 1.3, 1.7, 2.2, 2.9, 3.8, 5, 6.8, 9.5, 14]

function floor(): string {
  let d = ''
  for (let k = -9; k <= 9; k++) d += `M${VANISH_X},${HORIZON} L${VANISH_X + k * RAY_STEP},1000 `
  for (const z of DEPTHS) {
    const y = Math.round(HORIZON + (1000 - HORIZON) / z)
    d += `M0,${y} L1600,${y} `
  }
  return `<path d="${d.trim()}" fill="none" stroke="url(#floorFade)" stroke-width="1"/>`
}

// Faint seams on the back wall, so the dark reads as a room and not a void.
function wall(): string {
  let d = ''
  for (let x = 100; x < 1600; x += 220) d += `M${x},40 L${x},${HORIZON} `
  return (
    `<path d="${d.trim()} M0,170 L1600,170" stroke="${ICE}" stroke-opacity="0.035" fill="none"/>` +
    `<rect y="${HORIZON - 70}" width="1600" height="140" fill="url(#horizonGlow)"/>` +
    `<line x1="0" y1="${HORIZON}" x2="1600" y2="${HORIZON}" stroke="${ICE}" stroke-opacity="0.16"/>`
  )
}

// The projector on the bench throws the panels up into the air: a faint cone of light.
const CONE = `<polygon points="82,770 94,770 404,356 88,356" fill="url(#cone)"/>`

// The reactor's light pooled on the floor below it: cyan at work, gold when it calls.
const pool = (live: boolean) =>
  `<ellipse cx="${REACTOR.x}" cy="${HORIZON + 46}" rx="330" ry="38" fill="url(#${live ? 'poolCyan' : 'poolGold'})"/>`

// The scan line and the soft wash trailing it, at the horizon; the keyframes carry it down.
const SCAN =
  `<g class="scan"><rect y="${HORIZON - 26}" width="1600" height="26" fill="url(#scanWash)"/>` +
  `<line x1="0" y1="${HORIZON}" x2="1600" y2="${HORIZON}" stroke="${CYAN}" stroke-opacity="0.5" stroke-width="1.4"/></g>`

// A dark shape with a faint cool rim: drawn twice, the rim a little wider underneath.
const rimmed = (d: string, width: number) =>
  `<path d="${d}" stroke="${ICE}" stroke-opacity="0.22" stroke-width="${width + 2.4}"/>` +
  `<path d="${d}" stroke="${SHADOW}" stroke-width="${width}"/>`

// The arm stands on the bench: shoulder, elbow, wrist.
const SHOULDER = [252, 806] as const
const ELBOW = [168, 636] as const
const WRIST = [326, 566] as const

const BENCH =
  `<g fill="${SHADOW}" stroke="${ICE}" stroke-opacity="0.2">` +
  `<rect x="-20" y="836" width="470" height="16"/>` +
  `<rect x="20" y="852" width="16" height="160"/><rect x="398" y="852" width="16" height="160"/>` +
  `<rect x="20" y="944" width="394" height="10"/>` +
  `<rect x="40" y="782" width="96" height="54" rx="3"/>` +
  `<rect x="52" y="768" width="70" height="14" rx="2"/>` +
  `<rect x="350" y="806" width="56" height="30" rx="2"/><rect x="368" y="792" width="20" height="14"/>` +
  `<rect x="214" y="820" width="78" height="16" rx="3"/></g>` +
  `<rect x="58" y="790" width="22" height="4" fill="${CYAN}" opacity="0.5"/>` +
  `<rect x="86" y="790" width="10" height="4" fill="${CYAN}" opacity="0.3"/>`

function arm(live: boolean): string {
  const [sx, sy] = SHOULDER
  const [ex, ey] = ELBOW
  const [wx, wy] = WRIST
  const gripper = `M${wx},${wy} l26,4 l12,16 M${wx},${wy} l18,20 l2,18`
  return (
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    rimmed(`M${sx},${sy} L${ex},${ey}`, 22) +
    `<circle cx="${sx}" cy="${sy}" r="20" fill="${SHADOW}" stroke="${ICE}" stroke-opacity="0.22"/>` +
    `<g${live ? ' class="arm"' : ''}>` +
    rimmed(`M${ex},${ey} L${wx},${wy}`, 15) +
    rimmed(gripper, 5) +
    `<circle cx="${wx}" cy="${wy}" r="10" fill="${SHADOW}" stroke="${ICE}" stroke-opacity="0.25"/>` +
    `<circle cx="${wx + 4}" cy="${wy + 12}" r="26" fill="url(#lamp)" stroke="none"/>` +
    `<circle cx="${wx}" cy="${wy}" r="2.6" fill="${GOLD}" stroke="none"/></g>` +
    `<circle cx="${ex}" cy="${ey}" r="15" fill="${SHADOW}" stroke="${ICE}" stroke-opacity="0.25"/>` +
    `<circle cx="${ex}" cy="${ey}" r="4" fill="${CYAN}" fill-opacity="0.6" stroke="none"/></g>`
  )
}

const DEFS =
  `<linearGradient id="floorFade" gradientUnits="userSpaceOnUse" x1="0" y1="${HORIZON}" x2="0" y2="1000">` +
  `<stop offset="0" stop-color="${ICE}" stop-opacity="0"/><stop offset="0.3" stop-color="${ICE}" stop-opacity="0.07"/>` +
  `<stop offset="1" stop-color="${ICE}" stop-opacity="0.17"/></linearGradient>` +
  `<linearGradient id="horizonGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HAZE}" stop-opacity="0"/>` +
  `<stop offset="0.5" stop-color="${HAZE}" stop-opacity="0.16"/><stop offset="1" stop-color="${HAZE}" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="scanWash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CYAN}" stop-opacity="0"/>` +
  `<stop offset="1" stop-color="${CYAN}" stop-opacity="0.12"/></linearGradient>` +
  `<linearGradient id="cone" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CYAN}" stop-opacity="0.13"/>` +
  `<stop offset="0.75" stop-color="${CYAN}" stop-opacity="0.03"/><stop offset="1" stop-color="${CYAN}" stop-opacity="0"/></linearGradient>` +
  `<radialGradient id="poolCyan"><stop offset="0" stop-color="${CYAN}" stop-opacity="0.22"/>` +
  `<stop offset="1" stop-color="${CYAN}" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="poolGold"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.3"/>` +
  `<stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="lamp"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.45"/>` +
  `<stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>`

export type Lab = { back: Part; front: string }

export function lab(live: boolean): Lab {
  const css = live
    ? `.scan{animation:scan 6s ease-in infinite}` +
      `@keyframes scan{0%{transform:translateY(0px);opacity:0}12%{opacity:1}85%{opacity:.8}100%{transform:translateY(${1000 - HORIZON}px);opacity:0}}` +
      `.arm{transform-origin:${ELBOW[0]}px ${ELBOW[1]}px;animation:idle 9s ease-in-out infinite alternate}` +
      '@keyframes idle{from{transform:rotate(-6deg)}to{transform:rotate(5deg)}}'
    : ''
  return {
    back: {
      defs: DEFS,
      css,
      animated: ['.scan', '.arm'],
      svg: wall() + floor() + pool(live) + CONE + (live ? SCAN : ''),
    },
    front: BENCH + arm(live),
  }
}
