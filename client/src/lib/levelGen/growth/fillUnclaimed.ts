import { shuffle } from '../rng'
import { DIRS } from './directions'

// Assigns every remaining -1 cell to a neighboring already-claimed region,
// expanding outward in BFS passes — never by distance to a seed — so every
// resulting region stays a single connected component. A distance-based
// "nearest seed" fallback can weld a cell that's fully boxed in by *other*
// regions onto a faraway region it never actually touches, silently
// producing a disconnected fragment (see growForkAnchored/growBandAnchored:
// a corner cell sealed off by two capped anchor cells got glued onto an
// unrelated region purely because that region's seed was closest by
// Manhattan distance).
//
// `isPreferred(regionId, r, c)` picks which neighboring region to use when a
// cell borders more than one eligible region (e.g. still-growing regions
// over capped anchors); any other already-claimed neighbor is used only when
// no preferred one is adjacent yet. `onAssign` lets callers keep a `sizes`
// array in sync.
export function fillUnclaimedByAdjacency(
  grid: number[][], N: number, rng: () => number,
  isPreferred: (regionId: number, r: number, c: number) => boolean,
  onAssign?: (regionId: number, r: number, c: number) => void,
): void {
  let unclaimed: [number, number][] = []
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === -1) unclaimed.push([r, c])

  while (unclaimed.length > 0) {
    const stillUnclaimed: [number, number][] = []
    let progressed = false
    for (const [r, c] of shuffle(unclaimed, rng)) {
      let preferred = -1, any = -1
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
        const id = grid[nr][nc]
        if (id === -1) continue
        any = id
        if (preferred === -1 && isPreferred(id, r, c)) preferred = id
      }
      const chosen = preferred !== -1 ? preferred : any
      if (chosen === -1) { stillUnclaimed.push([r, c]); continue }
      grid[r][c] = chosen
      onAssign?.(chosen, r, c)
      progressed = true
    }
    // A fully-seeded grid always has progress to make each pass; this guards
    // against an infinite loop if that invariant is ever violated.
    if (!progressed) break
    unclaimed = stillUnclaimed
  }
}
