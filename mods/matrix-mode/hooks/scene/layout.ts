// Where things sit in the 1600 x 1000 scene, shared by the parts that line up with them.

// The chat column: the rain stays thin and dim between these edges.
export const CHAT = { left: 440, right: 1160 }

// Where the waiting prompt line sits, and how wide it is: upper right, clear of the chat.
const WIDTH = 210
export const PROMPT = {
  width: WIDTH,
  at: { x: 1210, y: 250 },
}

// The stretch of rain that parts around the prompt.
export type Spot = { x: number; y: number }
export function parting(spot: Spot): [number, number] {
  return [spot.x - 50, spot.x + WIDTH + 90]
}
