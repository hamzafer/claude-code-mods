// The crows: a few sit still on the gate, the roof and the trees.
// Pure: the same perches draw the same crows.

type Point = [number, number]

// A crow sitting, side on, facing right, its feet at 0,0, about 20 tall. Drawn as #perched.
export const PERCHED =
  'M-10,-1 L-4,-7 C-2,-12 3,-14 7,-14 C8.5,-17.5 12,-18 13.5,-15.5 L18,-14.2 L13.5,-12.8 ' +
  'C13.5,-9.5 11,-6.5 8,-5 C5,-2.5 2.5,-1.5 1,-1.2 L1.5,0 L-0.5,0 L-0.8,-1.2 C-4,-1.6 -7,-0.6 -10,-1 Z'

const BODY = '#050202'
const RIM = 'stroke="#e7b9a8" stroke-opacity="0.3" stroke-width="0.9" stroke-linejoin="round"'

// Still crows on their perches.
export function perched(perches: Point[]): { svg: string } {
  const svg = perches
    .map(([x, y], n) => {
      const face = n % 3 === 1 ? -1 : 1
      const size = 1.15 + (n % 4) * 0.12
      return `<use href="#perched" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(face * size).toFixed(2)} ${size.toFixed(2)})"/>`
    })
    .join('')
  return { svg: `<g fill="${BODY}" ${RIM}>${svg}</g>` }
}
