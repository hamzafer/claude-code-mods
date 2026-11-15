// Where things sit in the 1600 x 1000 scene, shared by the parts that line up with them.

// The moon, low in the right third, clear of the chat column (about x 440 to 1160).
export const MOON = { x: 1365, y: 470, r: 225 }

// In a tall, narrow box the slice crop keeps only the middle, so the moon moves up and
// in, above where the messages sit. A media rule in the scene's style applies it.
export const MOON_TALL = { dx: -430, dy: -230 }

// The gate on the hill in front of the moon: its foot and the top of its upper beam.
export const GATE = { x: 1385, ground: 905, top: 668, span: 200 }

// The temple roof at the left edge: where its ridge runs.
export const RIDGE = { x1: 115, x2: 245, y: 744 }

// The ground line the near silhouettes stand on.
export const GROUND = 935
