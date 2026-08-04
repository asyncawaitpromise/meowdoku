# Next Steps — Constructive Puzzle Generation

**Delete this file after reading it** (`rm NEXT_STEPS.md`) — one-time handoff note.

---

## What was just done

- Added `common-neighbor` solver strategy (bit 512): runs eagerly alongside singleton
  propagation every round. Fires on 100% of solvable puzzles.
- Strengthened forcing chains simulation to run common-neighbor internally.
- Fixed `growSizeBalanced` fallback: overflow now goes only to the 2 free medium regions,
  keeping anchor regions (singletons/doublets/triples) at their intended tiny sizes.
  Phase 1 solvability improved ~2% → ~5-6%.
- Added `sizeStdDev` utility; pipeline now rejects near-uniform layouts (stddev < 4).
- Added `growBimodal` function (in `growth.ts`) — NOT in the pipeline yet (see below).

---

## The core problem (still unsolved)

**Random generation + filter is not working at scale.** Best solvability rates:

| Function | Solvable | Notes |
|----------|----------|-------|
| `growSizeBalanced` | 5-6% | 8 tiny anchors + 2 medium |
| `growBalanced` | 15-20% | 9 tiny + 1 huge blob |
| `growBimodal` | 0% | 2 anchors not enough for random layouts |

External 10×10 tier-3 puzzles have 2 small + 6 medium + 2 large regions and are 100%
solvable — but they are **constructed**, not randomly grown. Their 2 tiny anchors work
because the region geometry is deliberately designed to cascade into a full solution.

Key insight: **matching the external size distribution alone doesn't help**. With random
region placement, you need ~8-9 tiny anchors to get any meaningful solvability rate.

---

## Proposed next task: constructive generation

Instead of "grow random regions, filter for solvability", build regions that **force**
specific constraint patterns by construction.

### Simplest constructive approach to try first

**"Anchor-first" construction:**

1. Pick a valid solution (cats already placed, one per row/col, no adjacency).
   Use `findPlacement()` for this.

2. Designate 2-3 "anchor" regions. For each anchor:
   - The anchor's cat is at position (r, c).
   - Choose a small set of 2-4 cells that are the ONLY cells in the grid that
     survive the row/col/adjacency constraints from the OTHER anchor.
   - i.e., deliberately make anchor A and anchor B mutually constraining:
     A's placement kills all of B's options except 1 (or 2), and vice versa.

3. Grow the remaining 7-8 regions to fill the rest of the grid using normal Prim's,
   ensuring they don't intrude on the anchor constraint zones.

4. Verify with `canSolveLogically` — the anchor cascade should propagate far enough
   to solve or nearly solve the puzzle.

### Alternative: constraint-pattern seeding

Choose a target constraint pattern first:
- "Naked pair": pick 2 rows and assign 2 regions whose cells lie entirely in those rows.
  All other regions must avoid those rows. Solver immediately fires naked-subset.
- "Hidden single": arrange region cells so exactly one region can occupy a given row.

Then grow remaining regions respecting those constraints.

### Key idea

The external game very likely uses something like: pick a solution → assign region
roles based on solution geometry → grow regions to enforce those roles. The region
shapes are outputs of the constraint structure, not inputs.

---

## Files to know

- `client/src/lib/levelGen/solver.ts` — solver; `canSolveLogically`, `canSolveFast`
- `client/src/lib/levelGen/growth.ts` — all growth functions including `growBimodal`
- `client/src/lib/levelGen/generate.ts` — pipeline: Phase 0 symm → Phase 1 growSizeBalanced → Phase 2 growBalanced → Phase 3 fallback
- `client/src/lib/levelGen/placement.ts` — `findPlacement()` returns valid cat columns
- `bench.ts` — run with `npx tsx bench.ts` to measure solvability rates
- `docs/generation-theory.md` — full theory doc, update after benchmarks
- `external-resources/puzzles2` — 200 real 10×10 tier-3 puzzles for reference

## Benchmark baseline (as of this session)

```
growSizeBalanced:  5-6% solvable, <2ms/layout
growBalanced:      15-20% solvable, <1ms/layout
growBimodal:       0% solvable, 400-600ms/layout (not in pipeline)
```

Difficulty pass rates are ~0% for medium/hard/expert across all methods —
puzzles that ARE solvable are trivially easy (singleton + common-neighbor only).
No harder strategies (crowding, forcing chains, trap 2×2) ever fire on generated layouts.
