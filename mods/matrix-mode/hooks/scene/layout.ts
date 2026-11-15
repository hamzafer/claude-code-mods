// Where things sit in the 1600 x 1000 scene, shared by the parts that line up with them.

// The chat column: the rain stays thin and dim between these edges.
export const CHAT = { left: 440, right: 1160 }

// A window narrower than 4:3: the slice crop keeps little more than the chat column, so
// the rain there comes up and the prompt moves to the top centre.
export const TALL = '(max-aspect-ratio: 4/3)'

// Where the waiting prompt line sits, and how wide it is: upper right in a wide window,
// clear of the chat; top centre in a tall one.
const WIDTH = 210
export const PROMPT = {
  width: WIDTH,
  wide: { x: 1210, y: 250 },
  tall: { x: 800 - WIDTH / 2, y: 130 },
}

// The stretch of rain that parts around the prompt, wherever it sits.
export type Spot = { x: number; y: number }
export function parting(spot: Spot): [number, number] {
  return [spot.x - 50, spot.x + WIDTH + 90]
}
