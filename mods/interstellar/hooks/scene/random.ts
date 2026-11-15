// A copy of shared/theme/random.ts: change it there, then copy it over again.
//
// A small seeded random (mulberry32): the same seed always draws the same scene.

export type Random = {
  // 0 to 1
  next: () => number
  // min to max
  pick: (min: number, max: number) => number
}

export function seeded(seed: number): Random {
  let t = seed >>> 0
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  return { next, pick: (min, max) => min + next() * (max - min) }
}
