// Where things sit in the 1600 x 1000 scene, shared by the parts that line up with them.

// The chat column: the rain stays thin and dim between these edges.
export const CHAT = { left: 440, right: 1160 }

// A window narrower than 4:3: the slice crop keeps little more than the chat column, so
// the rain there comes up and the prompt moves to the top centre.
export const TALL = '(max-aspect-ratio: 4/3)'

// Where the waiting prompt line starts: upper right in a wide window, clear of the chat;
// in a tall one, at `tallY`, centred.
export const PROMPT = { x: 1210, y: 250, tallY: 130 }

// The stretch of rain that parts around the prompt in a wide window.
export const PARTING: [number, number] = [PROMPT.x - 50, PROMPT.x + 300]
