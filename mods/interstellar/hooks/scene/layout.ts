// Where things sit in the 1600 x 1000 scene, shared by the parts that line up with them.

// The black hole, high in the right third, clear of the chat column and the message box.
export const HOLE = { x: 1290, y: 245 }

// Where the ship holds station when it hails you: below and right of the hole.
export const STATION = { x: 1415, y: 395 }

// In a tall window the slice crop keeps the middle, which would lose the hole on the right
// and the planet on the left: the hole (with its ship and glow) and the planet move in by
// these, and the signal rings shrink so they stay above the chat.
export const TALL = { subject: { x: -300, y: -25 }, world: { x: 400, y: 0 }, rings: 0.45 }

// The ice planet's centre and radius, below the lower left corner, so only its limb shows.
export const PLANET = { x: -150, y: 1210, r: 470 }

// The chat column and the message box below it: a part keeps its busy bits out of here.
export const COLUMN = { left: 470, right: 1130, top: 300 }
