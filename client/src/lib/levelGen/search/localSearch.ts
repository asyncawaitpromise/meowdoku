import { makeRng } from '../rng'
import { allRegionsConnected, boundaryCount, hasCorridor, maxRegionSize, sizeStdDev } from '../growth'
import { profilePuzzle, type PuzzleProfile } from '../solver/profile'

// Re-labels regions by first appearance in raster order — the same canonical
// labelling the share-code decoder produces. The solver's symmetry detection
// is label-sensitive (half-turn partners are region ids N-1-reg), so profiling
// in canonical form means a pool entry's stats match what a client computes
// after decoding its share code.
export function canonicalize(regions: number[][], N: number): number[][] {
  const map = new Map<number, number>()
  return regions.map(row => row.map(v => {
    let id = map.get(v)
    if (id === undefined) { id = map.size; map.set(v, id) }
    return id
  })).slice(0, N)
}

export interface SearchState {
  regions: number[][]
  profile: PuzzleProfile
  fitness: number
}

export interface LocalSearchOptions {
  N: number
  solution: { r: number; c: number }[]   // solution[regionId] — in the labelling of `regions` as passed in
  fitness: (p: PuzzleProfile) => number  // higher is better; -Infinity for unusable
  minBoundaries: number
  maxRegion: number
  maxSizeStdDev?: number                 // soft ceiling on region-size spread (default: none)
  steps: number
  seed: number
  // Called whenever a state is accepted; return true to stop the search early.
  onAccept?: (s: SearchState) => boolean
  stats?: Record<string, number>
}

const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]

// Hill-climbing with annealing over region layouts. A mutation hands one border
// cell to a neighbouring region. The cat positions never move, so every
// mutation keeps "exactly one cat per region" true by construction; the
// logical solver then confirms the layout still has a unique solution (a
// logical solve is sound, so `solved` implies uniqueness) and scores its
// technique profile. Compared with blind rejection sampling, each accepted
// step starts from a puzzle that already works, so the search climbs toward a
// rare technique mix instead of waiting to stumble on it.
export function localSearch(start: number[][], opts: LocalSearchOptions): SearchState | null {
  const { N, solution, fitness, steps } = opts
  const rng = makeRng(opts.seed)
  const isCat = new Set(solution.map(s => s.r * N + s.c))

  // The generator's own output can already carry a corridor or an oversized
  // region, so these are soft penalties (the search can repair them) rather than
  // hard rejections that would freeze it. Callers that must not ship them check
  // the tier's `layoutAccepts` on the result.
  const layoutPenalty = (g: number[][]): number =>
    (hasCorridor(g, N) ? 50 : 0) + 10 * Math.max(0, maxRegionSize(g, N) - opts.maxRegion) +
    // pull toward a bit under the acceptance ceiling so accepted puzzles aren't borderline
    (opts.maxSizeStdDev === undefined ? 0 : 12 * Math.max(0, sizeStdDev(g, N) - (opts.maxSizeStdDev - 0.5)))

  const first = profilePuzzle(start, N)
  let cur: SearchState = { regions: start, profile: first, fitness: first.solved ? fitness(first) - layoutPenalty(start) : -Infinity }
  if (!first.solved) return null   // an unsolvable start (generator fell through to its last resort) isn't worth climbing from
  let best = cur
  if (opts.onAccept?.(cur)) return cur

  const st = opts.stats ?? {}
  const tick = (k: string) => { st[k] = (st[k] ?? 0) + 1 }
  for (let step = 0; step < steps; step++) {
    const temp = 3 * (1 - step / steps)
    const r = Math.floor(rng() * N), c = Math.floor(rng() * N)
    if (isCat.has(r * N + c)) { tick('cat'); continue }
    const from = cur.regions[r][c]
    const [dr, dc] = DIRS[Math.floor(rng() * 4)]
    const nr = r + dr, nc = c + dc
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
    const to = cur.regions[nr][nc]
    if (to === from) { tick('sameRegion'); continue }

    const moved = cur.regions.map(row => row.slice())
    moved[r][c] = to
    // Canonical labels before anything is scored: the solver visits regions in id
    // order, so its technique counts depend on the labelling — and the client
    // decodes a share code into exactly this canonical form.
    const next = canonicalize(moved, N)
    if (!allRegionsConnected(next, N)) { tick('disconnected'); continue }
    if (boundaryCount(next, N) < opts.minBoundaries) { tick('boundaries'); continue }

    const profile = profilePuzzle(next, N)
    if (!profile.solved) { tick('unsolved'); continue }
    tick('solved')
    const f = fitness(profile) - layoutPenalty(next)
    if (f === -Infinity) continue
    if (f >= cur.fitness || rng() < Math.exp((f - cur.fitness) / Math.max(temp, 0.01))) {
      cur = { regions: next, profile, fitness: f }
      if (f > best.fitness) best = cur
      if (opts.onAccept?.(cur)) return cur
    }
  }
  return best
}
