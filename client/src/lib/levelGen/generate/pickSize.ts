// Per-tier board-size pool: easy/medium favor the smaller sizes (shorter scans,
// tighter deduction chains); hard/expert stay mostly at N=10 since fork/band
// -anchored growth — their only reliable route to naked-pair and hypothesis
// geometry — is calibrated specifically for it and is skipped entirely at any
// other size. The occasional N=8 hard or N=11 expert draw therefore falls back
// to the generic phases and often lands on the bestRef safety net below its
// tier's normal score bar — still a valid, solvable puzzle, just softer than a
// same-tier N=10 one.
export function pickSize(levelNum: number, rng: () => number): number {
  const pools: [number, number][] = // [size, weight]
    levelNum <= 3  ? [[5, 0.35], [6, 0.35], [7, 0.30]] :
    levelNum <= 8  ? [[6, 0.25], [7, 0.45], [8, 0.30]] :
    levelNum <= 15 ? [[8, 0.25], [10, 0.75]] :
                      [[10, 0.7], [11, 0.3]]
  const total = pools.reduce((a, [, w]) => a + w, 0)
  let rv = rng() * total
  for (const [size, w] of pools) { rv -= w; if (rv <= 0) return size }
  return pools[pools.length - 1][0]
}
