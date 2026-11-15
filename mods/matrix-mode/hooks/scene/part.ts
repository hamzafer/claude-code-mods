// What every part of the scene hands the composer, so index.ts can stack them alike.

export type Part = {
  // Gradients and shapes the part's drawing refers to.
  defs: string
  css: string
  // The classes the part animates, for the scene's one reduced-motion rule.
  animated: string[]
  // Extra declarations for that rule, for things that must still show when nothing moves.
  still: string
  svg: string
}
