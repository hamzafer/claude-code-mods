// The lock-on, round the reactor when Claude needs you: four corner brackets close in as
// if targeting, then rings leave the reactor like a ping, one after another. Centred on 0,0.
//
// Desktop limit: the brackets rest where they close and animate only from their offset;
// a ping scales a ring in place (its stroke scales with it) and fades it. Nothing here
// animates a full-size element, uses a fill mode or a custom easing.

import { GOLD, ICE, type Part } from './layout.js'

// How far the brackets' corners sit from the centre once closed, and where they start.
const HALF = 206
const OPEN = 70
const ARM = 34

// Each corner: its direction out from the centre.
const CORNERS: [string, number, number][] = [
  ['tl', -1, -1],
  ['tr', 1, -1],
  ['br', 1, 1],
  ['bl', -1, 1],
]

function bracket([name, dx, dy]: [string, number, number]): string {
  const x = dx * HALF
  const y = dy * HALF
  return (
    `<g class="bracket ${name}"><path d="M${x - dx * ARM},${y} L${x},${y} L${x},${y - dy * ARM}"/>` +
    `<circle cx="${x}" cy="${y}" r="2.6" fill="${GOLD}" stroke="none"/></g>`
  )
}

const PINGS = 3
const PING_S = 4.2

// `after` is when the pings start, in seconds: once the reactor has locked.
export function target(after: number): Part {
  let css =
    `.brackets{animation:hold 3.2s ease-in-out ${after + 1}s infinite}` +
    '@keyframes hold{0%,100%{opacity:1}50%{opacity:.45}}' +
    '.ping{opacity:0;transform-origin:0 0}' +
    '@keyframes ping{0%{transform:scale(.85);opacity:0}12%{opacity:.75}100%{transform:scale(2.1);opacity:0}}'
  for (const [name, dx, dy] of CORNERS) {
    // No `to`: the bracket's own markup is where it ends.
    css +=
      `@keyframes c${name}{from{transform:translate(${dx * OPEN}px,${dy * OPEN}px);opacity:0}}` +
      `.${name}{animation:c${name} 1.5s ease-out 1}`
  }
  let pings = ''
  for (let n = 0; n < PINGS; n++) {
    css += `.p${n}{animation:ping ${PING_S}s ease-out ${(after + (n * PING_S) / PINGS).toFixed(2)}s infinite}`
    pings += `<circle class="ping p${n}" r="200"/>`
  }
  const svg =
    `<g class="target" fill="none" stroke="${ICE}">` +
    `<g stroke-opacity="0.55" stroke-width="1">${pings}</g>` +
    `<g class="brackets" stroke-width="2.2" stroke-linecap="square">${CORNERS.map(bracket).join('')}</g></g>`
  return { defs: '', css, animated: ['.bracket', '.brackets', '.ping'], svg }
}
