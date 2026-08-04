export const PALETTE = [
  '#f080b0', '#a07858', '#9888d8', '#f0d878', '#40b8c8',
  '#3d8b5a', '#88c870', '#6888c0', '#c0a820', '#d08888',
]

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────

export function makeRng(seed: number) {
  let s = seed | 0
  return (): number => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
