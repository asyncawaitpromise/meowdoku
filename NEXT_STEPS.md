# Next Steps — Meowdoku Solver / Generation

**Delete this file after reading it** (`rm NEXT_STEPS.md`) — it is a one-time handoff note, not permanent docs.

---

## Context

Puzzle generation is broken. See `docs/generation-theory.md` for full background.
Short version: random region growth + filter produces 2% solvable puzzles, and only
the two simplest solver strategies ever fire. Generation takes 3+ minutes on mobile.

---

## What we just learned (external puzzle analysis)

`external-resources/puzzles1` — 7×7 tier-2 puzzles (can't import, wrong grid size)
`external-resources/puzzles2` — **10×10 tier-3 puzzles** (same game type, same constraints)

Key findings from puzzles2 (10×10):
- `adjacency-propagation`: 100% of puzzles, avg **35.8 uses** — already in our solver (same as singleton propagation + adjacency elimination)
- `common-neighbor`: 98% of puzzles, avg **6.2 uses** — **NOT in our solver**
- `unit-intersection`: 98%, avg **19.4** — same as our hidden subsets (implemented)
- `contradiction-depth-1`: **100% of puzzles**, avg **2.0** — shallow one-level backtracking (not in our solver)
- `maxHypothesisDepth`: **1 for all 200 puzzles** (not 0 like tier-2 7×7) — these require exactly 1 level of hypothetical reasoning

### What is `common-neighbor`?

Theory: for each pair of regions (A, B), for each candidate X in B — if ALL candidates of A are adjacent to X, then placing B's cat at X would kill A entirely. Therefore, eliminate X from B. This is a tighter loop of our existing region crowding (bit 16), run per-candidate per-pair after every elimination step, not just per round.

### What is `contradiction-depth-1`?

Place a candidate X tentatively; run all logical steps; if a contradiction is reached (some region empties), eliminate X. This is essentially our "forcing chains" (bit 32) or "branch rule" (bit 64) but run at depth 1. It's needed in 100% of these 10×10 puzzles.

---

## Suggested next task: implement `common-neighbor` and `contradiction-depth-1`

These two techniques cover 100% of 10×10 tier-3 puzzles from the external game.
If we add them to `canSolveLogically`, our solver should be able to solve similar layouts.

### 1. `common-neighbor` (add to `solver.ts`)

After each elimination round, for each region B and each candidate X in B:
- Check if ALL candidates of any other region A are adjacent to X
- If yes, eliminate X from B
- This is a tighter, per-pair version of region crowding

### 2. `contradiction-depth-1` (already partially there)

Our forcing chains (bit 32) does this but may not run enough iterations.
Verify that after placing a candidate tentatively, we run ALL other strategies (including common-neighbor) before checking for contradictions. If the tentative run is incomplete, shallow contradictions get missed.

---

## Then: re-benchmark

After adding the new strategies, run `npx tsx bench.ts` and update `docs/generation-theory.md`.
Check if solvability rate improves from the current 2% on Phase 1 layouts.

---

## Files to know

- `client/src/lib/levelGen/solver.ts` — add new strategies here
- `client/src/lib/levelGen/generate.ts` — generation pipeline
- `client/src/lib/levelGen/growth.ts` — region growth algorithms
- `bench.ts` — run with `npx tsx bench.ts` from project root
- `docs/generation-theory.md` — living theory doc, update after benchmarks
- `external-resources/puzzles2` — 200 real 10×10 puzzles to learn from / compare against
