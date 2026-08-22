# Puzzle Quality Gap Analysis & Improvement Plan

Run external puzzle analysis: `node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('external-resources/puzzles2','utf8')); ..."`

---

## What quality looks like: external tier-3 10×10 puzzles

Analyzed `external-resources/puzzles2` — 200 working puzzles of the same type.

### Technique requirements

| Technique | Usage | Our solver bit | Our status |
|-----------|-------|---------------|------------|
| direct-single | 200/200 (100%) | Bit 1 | ✅ fires on all solvable |
| adjacency-propagation | 200/200 (100%) | Bit 1 (same) | ✅ |
| **contradiction-depth-1** | **200/200 (100%)** | **Bit 32** | ❌ **never fires** |
| unit-intersection | 196/200 (98%) | Bit 4 | ❌ rarely fires |
| common-neighbor | 195/200 (97.5%) | Bit 512 | ✅ fires on all solvable |
| locked-pair | 133/200 (66.5%) | Bit 2 | ❌ rarely fires |
| locked-subset | 103/200 (51.5%) | Bit 2 | ❌ rarely fires |
| symmetry-propagation | 49/200 (24.5%) | Bit 256 | ✅ fires when symmetric |
| forcing-chain | 63/200 (31.5%) | Bit 32 | ❌ never fires |

### Structural features

| Feature | External target | Our current |
|---------|----------------|-------------|
| Symmetry type | **180° half-turn** (dominant) | Transpose/diagonal (0% solvable) |
| BoundaryCount | avg 65, min 50 | min 40–55, avg unknown |
| RegionSizeStdDev | avg 7.12, range 3.87–14 | reject < 4, avg unknown |
| Singleton regions | ≈ 0 per puzzle | 2 per puzzle (anchors) |
| maxHypothesisDepth | 1 (all puzzles) | 0 (never needs backtrack) |
| Technique variety | 5–8 per puzzle | 2 (singleton + common-neighbor) |

### Typical deduction pattern (external tier-3)

```
[Easy cascade: ~30-40 adjacency + unit-intersection + common-neighbor steps]
→ stuck: still 2+ candidates in some regions
→ [contradiction-depth-1: try placing X, propagate, find contradiction → eliminate X]
→ [easy cascade resumes, solves fully]
```

Our generated puzzles: singleton fires → easy cascade solves everything. No hard step ever needed.

---

## Core gaps

### Gap 1: No contradiction-depth-1 (forcing chains) — the biggest gap

ALL external tier-3 puzzles require forcing chains. Ours never do. This is structural:

Forcing chains require: after easy deductions, some region R has exactly 2 candidates {A, B}. Placing R at A kills all candidates of another region → A is impossible → R must be at B.

This geometry never arises from random growth because:
- Random regions are spread out → many candidates remain after easy deductions
- The "kill zone" from one placement rarely eliminates a whole other region

### Gap 2: Phase 0 uses wrong symmetry type (0% solvability)

The external game uses **180° rotational (half-turn) symmetry**: `cell(r,c) ↔ cell(N-1-r, N-1-c)`. Our Phase 0 uses diagonal (transpose) symmetry and achieves 0% solvability.

Half-turn symmetry is easier to construct, produces well-bounded regions, and has strong evidence from the external puzzle set.

### Gap 3: Quality thresholds too low

| Metric | External min | Our threshold | Gap |
|--------|-------------|---------------|-----|
| BoundaryCount | 50 | 40–55 | Accepting too-simple shapes |
| RegionSizeStdDev | ~3.87 | 4 | Close, but avg should be 7+ |

### Gap 4: Singleton anchors drive trivial solutions

We use 2 singleton (1-cell) regions whose cat is immediately forced. External puzzles use 0. Our singletons bootstrap the cascade via trivial deduction — making puzzles too easy at the start and never requiring harder techniques.

---

## Improvements ranked by expected impact

### 1. ✅ Half-turn symmetric generation [IMPLEMENTED, ~2% solvability]

Replace Phase 0 (diagonal symmetric, 0% solvable) with half-turn symmetric growth.

**Constraint**: `catCols[r] + catCols[N-1-r] = N-1` for all r. Choosing first half (rows 0..4) determines second half.

**Growth**: 5 canonical pairs (can, N-1-can). When cell (r,c) assigned to region `can`, cell (N-1-r, N-1-c) assigned to region `N-1-can`. Size variation: 2 "anchor" pairs capped at 4 cells, 3 "body" pairs grow freely.

**Evidence**: All external puzzles have half-turn symmetry tag. Symmetry creates constraint structure by construction (symmetry-propagation fires in 24.5% of external puzzles).

**Status**: `findHalfTurnPlacement` + `growHalfTurnSymmetric` implemented, Phase 0 updated.

---

### 2. Targeted naked-pair geometry [NOT YET IMPLEMENTED]

To make unit-intersection (bit 4) and locked-pair (bit 2) fire consistently:

**Approach**: After choosing a placement, designate 2 "band regions" whose cells must stay within a single strip of 2 rows. When 2 regions together cover only 2 rows, the solver immediately fires naked-subset deduction.

**Implementation**: In `growSizeBalanced` or a new `growBandAnchored`, pick 2 rows at random. Grow 2 regions that must stay within those 2 rows (reject any frontier cell outside the band). When the Prim's for those 2 regions completes, all other regions are excluded from those 2 rows.

**Expected impact**: Makes bit 2 and bit 4 fire on ~80%+ of generated layouts.

---

### 3. Near-miss geometry for forcing chains [NOT YET IMPLEMENTED, HIGHEST VALUE]

To make contradiction-depth-1 (bit 32) fire — the single most impactful improvement.

**The forcing chain setup**:
1. After easy cascade, 2 "contestant" regions R1, R2 remain with candidates {A1, B1} and {A2, B2}
2. Place R1 at A1 → eliminates all of R2's candidates → contradiction → R1 must be at B1

**Construction approach** (post-solve):
1. Generate a solvable easy puzzle
2. Identify the last-solved region (the one solved by the last singleton propagation)
3. Add a "decoy arm" to its geometry: a cell that looks like a valid candidate but leads to contradiction when simulated
4. Verify the modified puzzle still solves with the forcing chain

**Alternative** (geometric seeding):
1. Choose solution. Pick 2 regions R1 and R2 with a "near-miss" configuration:
   - R1 has candidate cells where one candidate shares a row/col with R2's only valid area
   - Grow R1 with an arm into R2's "kill zone"
2. Grow remaining regions to avoid disturbing the near-miss

**Expected impact**: Would make ALL generated puzzles qualify as tier-3 quality (matches external 100% forcing chain rate).

---

### 3b. Band-anchored naked pair [IMPLEMENTED BUT INEFFECTIVE, needs redesign]

`growBandAnchored` designates 2 singleton anchors + 2 band-confined regions. Benchmarks show naked-pair (bit 2) fires on the output, but puzzles still can't be solved (0% solvable).

**Root cause**: Band regions perfectly fill their rows — no non-band regions have cells in band rows, so the naked-pair deduction provides zero new information (nothing to eliminate). The technique fires vacuously.

**Fix needed**: Allow non-band regions to grow INTO band rows so their candidates there get eliminated by the naked pair. This requires mixing the Prim's growth priorities so band rows are contested between band and non-band regions. Currently disabled in generate.ts (0 attempts).

---

### 4. ✅ Raise quality thresholds [IMPLEMENTED]

`minBoundaries` raised from 40/50/55 to 50/60/65. `sizeStdDev` minimum raised from 4 to 5.

**Measured impact** (from benchmarks):
- growSizeBalanced solvability: 4% → 11%
- growBalanced solvability: 15-20% → 31-38%

Higher boundary count correlates with more interleaved regions → more constraint structure → higher solvability rate. The accepted puzzles are higher quality even if the difficulty tier hasn't changed.

---

### 5. Replace singleton anchors with doublets [NOT YET IMPLEMENTED]

External puzzles never use 1-cell regions. Replace 2 singletons in `growSizeBalanced` with 2-cell doublets.

Effect: the cascade no longer trivially starts from a forced singleton. Instead the first step must be unit-intersection or common-neighbor, which is the external game's starting technique.

Risk: reduces Phase 1 solvability from ~4% to unknown (possibly lower). Should benchmark before landing.

---

### 6. Extend constructive cascade to medium difficulty [NOT YET IMPLEMENTED]

Current `growConstructive` achieves 84% solvability for easy (levels ≤3) using a cascade chain of singletons + doublets. The open problem: medium/hard/expert need crowding (bit 16) and forcing chains (bit 32) to fire.

**Approach**: After the singleton/doublet cascade chain fires, add one region designed to require forcing chains to solve. This "hard anchor" region needs 3-4 cells arranged so:
- After easy cascade, 2 candidates remain
- One of those candidates, when tried, leads to contradiction

---

## Implementation status

| Priority | Task | Status | Impact |
|----------|------|--------|--------|
| 1 | Half-turn symmetric growth (Phase 0) | ✅ ~2% solvable | Low (was 0%) |
| 2 | Raise quality thresholds | ✅ Done | Medium (+doubled solvability rate) |
| 3 | Band-anchored naked pair geometry | ⚠️ Fires bit 2 but 0% solvable | Needs redesign |
| 4 | Near-miss forcing chain seeding | ❌ Not implemented | Very High |
| 5 | Remove singleton anchors | ❌ Not implemented | Unknown |
| 6 | Constructive medium difficulty | ❌ Not implemented | High |

### Constructive medium difficulty — measured status

Re-checked `growConstructive` at HEAD. It remains easy-tier: its singleton/doublet
cascade plus a single filler region that absorbs most of the board (up to ~84 of
100 cells) guarantees solvability via singleton + common-neighbor only. A 3,000-layout
sample of the plain constructor produced **0** naked/hidden-pair (bit 2/4) and
**0** forcing-chain (bit 32) hits — every puzzle scores ~9-12 (easy).

Attempts to spread cells instead (capping filler sizes so no region grows large and
forks/hidden pairs become the only remaining intention) collapse solvability to
~0.3% and still never fire bit 32. Growth-rate sampling: `growConstructive` ~6%,
`growSizeBalanced` ~3%, `growBalanced` ~30% raw solvable on the same seed pool.

This is the known hard part: medium/hard/expert genuinely need either
hypothesis-grade forcing chains (bit 32) or a naked/hidden-pair band, and neither
is reachable by simply re-weighting the constructive cascade. `growBandAnchored`
remains the only native source of naked-pair, and `growForkAnchored` the only
source of forcing chains — both rare. Item 6 stays open; the achievable, stable
scope is the current easy-tier constructive cascade.

### Critical insight: the singleton dilemma

The biggest unsolved challenge in improving difficulty:
- **With singletons**: cascade solves everything easily → only bit 1+512 fire → easy tier only
- **Without singletons**: solver can't start the cascade → 0% solvable  

The external game sidesteps this by designing regions where 2-4 candidates naturally narrow via unit-intersection + common-neighbor (not singleton). Replicating this requires a true constructive design algorithm:

1. Pick cat positions
2. For each region in order: grow it so that after all PRIOR regions' cats are placed, this region has exactly 2 candidates that form a "naked pair" with another region
3. The combined deductions then progressively narrow all regions without ever trivially forcing via singleton

This is reverse-engineering the solver from first principles. The `growBandAnchored` approach is a step in this direction but incomplete.

---

## What to look for in benchmarks after changes

Run `npx tsx scripts/bench.ts` and check:

- Phase 0 (half-turn symmetric) solvability: was 0%, target ≥5%
- Strategy hit rates: want bit 4 (unit-intersection) firing on ≥50% of solvable
- Strategy hit rates: want bit 32 (forcing chains) firing on any solvable
- BoundaryCount avg of accepted puzzles: target ≥60
- RegionSizeStdDev avg of accepted puzzles: target ≥6

When forcing chains finally fire in benchmarks, that's the inflection point where puzzle quality matches the external game.
