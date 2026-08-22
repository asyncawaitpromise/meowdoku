# Puzzle Generation — Theory & Benchmarks

Run benchmarks: `npx tsx scripts/bench.ts`

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
| 512 | Common-neighbor | Eager region crowding: runs alongside singleton propagation every round, not just as fallback | 8 |

`canSolveFast` runs bits 1-16 + 512 (no forcing chains, no branch rule). ~1ms vs ~120ms unsolvable layouts.

Common-neighbor (bit 512) is logically equivalent to region crowding but runs eagerly in the
main propagation loop (alongside singleton). Also added to Branch Rule's runProp simulation and
to the forcing chains simulation, making contradiction-depth-1 detection more sensitive.

---

## Benchmark results (Aug 2026, desktop Node.js)

### Per-phase solvability (100 attempts each)

| Phase | Method | Solvable | Easy diff pass | Medium diff pass | Hard diff pass | Expert diff pass |
|-------|--------|----------|----------------|------------------|----------------|------------------|
| 0 | growDiagonalSymmetric | **0%** | 0% | 0% | 0% | 0% |
| 1 | growSizeBalanced | **4%** | 4% | 5% | 1% | 2% |
| 3 | growBalanced | **15-20%** | 20% | 20% | 15% | 17% |

(Phase 2 = growBalanced; Phases 1+2 shown separately in bench output)

### Strategy hit rates on solvable Phase 1 layouts (200 samples)

| Strategy | Hit rate |
|----------|----------|
| singleton | 100% |
| **common-neighbor** | **100%** |
| naked-subsets and all others | 0% |

`common-neighbor` fires on all solved puzzles. Other harder strategies still never fire —
the core issue is region layout quality, not solver power (see below).

### Timing

| Component | Time |
|-----------|------|
| canSolveFast on Phase 1 layout | ~1ms |
| canSolveLogically on Phase 1 layout | ~3ms |
| canSolveLogically on Voronoi layout (unsolvable) | ~120ms |
| growSizeBalanced | <1ms |

### Estimated worst-case generation time (all phases fail)

~22s desktop, ~60-100s mobile (see bench output for current figures).

Mobile is ~4× slower than desktop Node.js benchmarks.

---

## External puzzle analysis (Aug 2026)

Analyzed `external-resources/puzzles1` — 200 puzzles from a working game of the same type.

### Key facts
- Grid: **7×7** (cannot be directly imported — wrong grid size)
- Tier: 2 (mid-difficulty)
- **maxHypothesisDepth = 0 for all 200 puzzles** — no backtracking, all logically deducible

### Technique usage (their naming)

| Technique | % of puzzles | Avg uses |
|-----------|-------------|----------|
| direct-single | 100% | 6.8 |
| adjacency-propagation | 100% | 17.0 |
| unit-intersection | 96% | 11.4 |
| common-neighbor | 98% | 6.0 |
| locked-pair | 96% | 5.7 |
| symmetry-propagation | 8% | 20.4 |
| forcing-chain | 0% | — |

### Mapping to our solver

| Their technique | Our equivalent | Status |
|----------------|----------------|--------|
| direct-single | Bit 1: singleton propagation | ✅ implemented |
| adjacency-propagation | Bit 1: propagating row/col/adjacency after singleton | ✅ implemented (same thing) |
| locked-pair / locked-subset | Bit 2: naked subsets | ✅ implemented |
| unit-intersection | Bit 4: hidden subsets | ✅ implemented |
| symmetry-propagation | Bit 8 (256): symmetry propagation | ✅ implemented |
| common-neighbor | Bit 512: common-neighbor | ✅ **implemented Aug 2026** |
| contradiction-depth-1 | Bit 32: forcing chains | ✅ implemented (simulation now includes common-neighbor) |
| forcing-chain | Bit 32: forcing chains | ✅ implemented |

### What is `common-neighbor`?

For each pair of regions (A, B), for each candidate X in B: if ALL candidates of A would be killed
by placing B at X, then X is impossible for B — eliminate it.

This is logically equivalent to region crowding (bit 16) but runs EAGERLY every propagation round
alongside singleton, rather than as a later fallback. Added to the solver Aug 2026 (bit 512).
Also added to the Branch Rule simulation and the forcing chains simulation for better
contradiction-depth-1 detection.

### Region size distribution (7×7 grid, 49 cells, 7 regions)

Most common region sizes per puzzle:
- 2–6 cells: ~4 regions (small anchors)
- 7–13 cells: ~2 regions (medium)
- 25–27 cells: ~0.03 regions (rare large blob)

**Key insight**: Even working puzzles have one large blob-like region (~25 cells = 51% of grid).
This validates that blob regions are acceptable as long as anchor regions constrain the solution.
The anchor pattern (several small regions) IS the right approach — the blob itself isn't the problem.

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

**Evidence from external game**: All 200 analyzed puzzles are logically solvable with no
backtracking. The external game very likely uses constructive generation — these puzzles
weren't generated by random growth + filter, they were designed to need specific techniques.

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
- 75% null rate (fails to fill grid), 0% solvable on what does fill, ~200ms per attempt
- NOT in main generation pipeline; kept in growth.ts for reference

---

## Open questions

1. Can constructive generation work at scale? What patterns produce interesting puzzles?
2. Harder strategies (crowding, forcing chains, trap 2×2) still never fire on generated layouts.
   Root cause: random growth doesn't produce the geometric constraint patterns these need.
3. Is there a minimal set of constraint patterns that covers easy/medium/hard/expert?
4. Can region shapes be synthesized from a target constraint structure rather than grown randomly?
5. Would a growth strategy that specifically creates trap-2×2 or crowding geometry help?
6. The external 10×10 puzzles need contradiction-depth-1 in 100% of cases. Our generated puzzles
   never reach this — means our layouts are fundamentally different in structure from real puzzles.
