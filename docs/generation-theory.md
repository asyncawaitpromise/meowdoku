# Puzzle Generation — Theory & Benchmarks

Run benchmarks: `npx tsx bench.ts`

---

## How the game works

10×10 grid, 10 regions. Place one cat per region such that:
- Exactly one cat per row
- Exactly one cat per column
- No two cats are adjacent (including diagonally)

This is an n-queens variant with irregular region constraints instead of a chessboard.

---

## Solver strategies (levelGen.ts — `canSolveLogically`)

| Bit | Strategy | Description | Difficulty weight |
|-----|----------|-------------|-------------------|
| 1 | Singleton propagation | Region has 1 candidate → eliminate that row/col/adjacency from all others | 1 |
| 2 | Naked subsets | k regions span exactly k rows/cols → eliminate those rows/cols from all others | 3 |
| 4 | Hidden subsets | k rows/cols contain exactly k regions → restrict those regions to those rows/cols | 6 |
| 8 | Trap 2×2 | Region fits in a 2×2 bounding box → no other region can be in that box | 4 |
| 16 | Region crowding | Placing cat X would leave another region with 0 candidates → eliminate X | 10 |
| 32 | Forcing chains | Simulate placing each candidate; if it leads to contradiction, eliminate it | 8 |
| 64 | Branch rule | For 2-candidate regions: try both; eliminate cells absent from all valid branches | 7 |
| 128 | X-wing | 4 regions all confined to same 2 rows × 2 cols → those 4 cells reserved | 7 |
| 256 | Symmetry propagation | If layout has diagonal symmetry, mismatched candidates can be eliminated | 2 |

`canSolveFast` runs bits 1-16 only (no forcing chains, no branch rule). ~1.2ms vs ~2.3ms.

---

## Benchmark results (Aug 2026, desktop Node.js)

### Per-phase solvability (100 attempts each)

| Phase | Method | Solvable | Easy diff pass | Medium diff pass | Hard diff pass | Expert diff pass |
|-------|--------|----------|----------------|------------------|----------------|------------------|
| 0 | growDiagonalSymmetric | **0%** | 0% | 0% | 0% | 0% |
| 1 | growSizeBalanced | **2%** | 2% | 0% | 1% | 0% |
| 2 | growBalanced | **7-8%** | 7% | 1% | 1% | 1% |

### Strategy hit rates on solvable Phase 1 layouts

Only **singleton** and **naked-subsets** ever fire. All other strategies: 0%.
This means puzzles are either trivially solvable by the two cheapest strategies,
or completely unsolvable by the logical solver (despite having a unique solution).

### Timing

| Component | Time |
|-----------|------|
| canSolveFast on Phase 1 layout | ~1.2ms |
| canSolveLogically on Phase 1 layout | ~2.3ms |
| canSolveLogically on Voronoi layout | ~166ms |
| growSizeBalanced | <1ms |

### Estimated worst-case generation time (all phases fail)

| Phase | Attempts | Cost | Total |
|-------|----------|------|-------|
| Phase 0 | 10 | ~2ms/attempt | ~23ms |
| Phase 1 | 500 | ~2.3ms direct + 80 × ~1.3ms gated refine | ~52s |
| Phase 2 | 500 | ~2.3ms | ~1.1s |
| Phase 3 | 200 | ~2.3ms | ~0.5s |
| **Total** | | | **~54s desktop, ~3.5 min mobile** |

Mobile is ~4× slower than desktop Node.js benchmarks.

---

## Core problem: random generation + filter doesn't work

**The gap**: `countSolutions == 1` (unique solution) rate is ~11% for Phase 1 layouts.
`canSolveLogically` (fully deducible) rate is ~2%. The gap means ~9% of valid puzzles
are being discarded because the solver can't deduce them even though they have unique solutions.

**Why harder strategies don't fire**: The strategies that make puzzles interesting
(crowding, forcing chains, trap 2×2) require specific geometric constraint patterns:

- **Trap 2×2** needs a region whose cells all fit in a 2×2 bounding box
- **Region crowding** needs near-miss geometry where placing one cat kills another region
- **Forcing chains** needs a chain of mutual exclusion constraints

Random region growth almost never produces these patterns. The current approach generates
regions first and hopes they have good constraint structure — they almost never do.

---

## Hypothesis: constructive / deductive generation

Instead of "grow random regions, filter for solvability":
**Design region shapes from known constraint patterns, then verify.**

Example — constructing a "naked pair":
1. Choose 2 rows (e.g., rows 3 and 7)
2. Place 2 regions whose cells are entirely within those 2 rows
3. All other regions must avoid rows 3 and 7
4. Solver can immediately apply naked-subset deduction

This gives the solver something to work with by construction, rather than by luck.

**Analogy**: Quality Sudoku puzzles are constructed by choosing which techniques are needed,
then building a grid that forces exactly those techniques. Random Sudoku generation has the
same problem — random valid grids are usually either trivial or require trial-and-error.

---

## What's been tried (approaches that failed)

### Region size caps
- Capping Prim's growth at 22 cells: overflow lands on anchor seeds → anchors grow → cascade destroyed → 0% solvability
- Root cause: the fallback assignment ignores caps, so capping growth doesn't cap final size

### Pure size-balanced growth (all 10 regions compete equally)
- 0% unique solutions because balanced regions have too many valid cat arrangements
- Need at least 8 anchor regions (singletons/doublets/triples) to start constraint cascade

### Diagonal symmetric layout (Phase 0)
- Small regions (~18 cell cap), symmetric constraint should help solver
- 0% solvable in practice; probably difficulty targeting mismatch
- Reduced from 300 to 10 attempts since it contributes nothing

### Constrained sections (growConstrainedSections)
- Zones constrained to row/col bands, small section caps
- Implemented but not in main generation pipeline; untested at scale

---

## Open questions

1. Can constructive generation work at scale? What patterns produce interesting puzzles?
2. What do good puzzles from other games look like? (User has examples)
3. Is there a minimal set of constraint patterns that covers easy/medium/hard/expert?
4. Can region shapes be synthesized from a target constraint structure rather than grown randomly?
