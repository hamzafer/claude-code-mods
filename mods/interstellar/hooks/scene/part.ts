// What every part of the scene hands back to the scene that composes it.
export type Part = {
  // Gradients and shapes for the scene's one <defs>.
  defs: string
  // Rules for the scene's one <style>.
  css: string
  // The classes this part animates, for the scene's one reduced-motion rule.
  animated: string[]
  // Rules for that same rule: how the part rests, still and in view, when nothing moves.
  still: string
  svg: string
}
