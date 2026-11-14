// What moves through the city: an elevated train behind the near rooftops, and an
// airship drifting under the clouds. Both are drawn off-screen and carried across by
// translate keyframes, so with reduced motion they simply stay out of view.

// The top of the viaduct's deck.
const DECK = 806
const CARS = 5
const CAR = 92
const GAP = 6
const TRAIN_LENGTH = CARS * (CAR + GAP)
// Parked just off the left edge; the keyframes carry it past the right one.
const TRAIN_X = -TRAIN_LENGTH - 60
const TRAIN_TRAVEL = 1600 - TRAIN_X + 60

function viaduct(): string {
  let pillars = ''
  for (let x = 20; x < 1600; x += 96) pillars += `<rect x="${x}" y="${DECK}" width="7" height="200"/>`
  return `<g fill="#070c0d"><rect y="${DECK}" width="1600" height="6"/>${pillars}</g>`
}

function train(): string {
  let cars = ''
  for (let n = 0; n < CARS; n++) {
    const x = TRAIN_X + n * (CAR + GAP)
    cars +=
      `<rect x="${x}" y="${DECK - 16}" width="${CAR}" height="16" rx="2" fill="#04070a"/>` +
      `<line x1="${x + 7}" y1="${DECK - 9}" x2="${x + CAR - 5}" y2="${DECK - 9}" stroke="#ffd58a" stroke-opacity="0.9" stroke-width="5" stroke-dasharray="8 5"/>`
  }
  const nose = TRAIN_X + TRAIN_LENGTH
  return (
    `<g class="train">${cars}` +
    `<circle cx="${nose + 6}" cy="${DECK - 7}" r="34" fill="url(#glow)"/>` +
    `<circle cx="${nose - 4}" cy="${DECK - 6}" r="2.4" fill="#fff3c8"/></g>`
  )
}

// Nose to the left, the way it drifts. Centred on 0,0, about 170 long.
const AIRSHIP =
  `<g class="airship"><g transform="translate(1750 212)">` +
  `<g fill="#030506" stroke="#3b5052" stroke-opacity="0.55" stroke-width="1">` +
  `<polygon points="52,-4 92,-24 88,0 92,24 52,4"/>` +
  `<ellipse rx="84" ry="20"/>` +
  `<rect x="-22" y="19" width="40" height="9" rx="3"/></g>` +
  `<circle class="beacon" cx="-2" cy="30" r="2.6" fill="#ff2a1a"/></g></g>`

// `animated` lists the classes this part animates, for the scene's one reduced-motion rule.
export type Transit = { css: string; animated: string[]; viaduct: string; train: string; airship: string }

// Each lead is how far into its cycle that traveller starts, in seconds, so a scene can
// open with the train a while away and the airship clear of what matters in the sky.
export function transit(lead: { train: number; airship: number }): Transit {
  return {
    css:
      `.train{animation:train 53s linear -${lead.train}s infinite;will-change:transform}` +
      `@keyframes train{0%{transform:translateX(0px)}17%,100%{transform:translateX(${TRAIN_TRAVEL}px)}}` +
      `.airship{animation:airship 160s linear -${lead.airship}s infinite;will-change:transform}` +
      '@keyframes airship{0%{transform:translateX(0px)}100%{transform:translateX(-1900px)}}',
    animated: ['.train', '.airship'],
    viaduct: viaduct(),
    train: train(),
    airship: AIRSHIP,
  }
}
