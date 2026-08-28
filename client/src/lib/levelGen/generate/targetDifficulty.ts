// Smallest N in each tier's pickSize pool — the size all of this file's minScore/
// minSteps calibration comments above are actually measured against (band/fork
// growth is N=10-only; the generic phases were tuned by running them at whatever
// size a tier draws most often, which is its pool's floor). See targetDifficulty's
// N-scaling for why this matters.
function refSize(levelNum: number): number {
  return levelNum <= 3 ? 5 : levelNum <= 8 ? 6 : levelNum <= 15 ? 8 : 10
}

export function targetDifficulty(levelNum: number, N: number): { minScore: number; maxScore: number; minSteps: number; minHardSteps: number; minRounds: number; minStratBit: number; minVariety: number; maxSubsetSize: number } {
  // minStratBit: bitwise OR of strategy bits that MUST fire (any one is enough).
  //
  // Bit 4 (16, region crowding) and bit 3 (8, trap 2×2) can never fire on a
  // solved puzzle: both reduce to "eliminate X from region B because every
  // candidate of some region A conflicts with X" — exactly what common-neighbor
  // (bit 512) already checks, unconditionally, every round, before either of
  // them gets a turn. So they can only ever "fire" by eliminating a region's
  // last remaining candidate, which reports as unsolvable, not as progress.
  // Do not gate a tier on either bit.
  //
  // Bit 2 (naked-pair) / bit 4 (hidden-pair) are the cheapest *genuinely*
  // non-redundant techniques: they reason about the joint row/col span of
  // multiple regions at once, which a single pairwise common-neighbor check
  // structurally cannot replicate. growBandAnchored is the only growth
  // algorithm that reliably (if rarely) produces this geometry.
  //
  // Expert requires minStratBit=96 (= 32 | 64): forcing chains or branch rule
  // must fire. These are hypothesis-based techniques (try a placement, check for
  // contradiction) — the same "contradiction-depth-1" that all external tier-3
  // puzzles require. Forcing chains alone contribute 50 pts to difficultyScore,
  // guaranteeing expert scores ≥ 60 while hard (no hypothesis) tops out lower.
  //
  // Tiers require strictly more than the last: easy must exercise common-neighbor
  // (bit 512), medium must exercise naked/hidden-pair (bit 6, previously hard's
  // own bar), hard keeps that bar but demands more rounds and a wider ceiling so
  // it can also catch the rare hypothesis-based finds, and expert's floor is
  // raised so a bare-minimum forcing-chain puzzle no longer just barely qualifies.
  // Calibrated against external-resources/puzzles1: that set's easiest tier uses
  // common-neighbor/locked-pair/unit-intersection 95%+ of the time, so easy's
  // bar requires common-neighbor rather than allowing pure singleton chains.
  //
  // minVariety: minimum count of distinct strategy bits (techniqueVariety) that
  // must have fired. Stops a puzzle from passing on step-count alone while
  // leaning on only one or two techniques — reuse across a broader mix of the
  // solver's strategies is the point, not just clearing a score number.
  // Note on medium: naked/hidden-pair (bit 6) is only reliably produced by
  // growBandAnchored, which is itself only calibrated (and only runs) at
  // N=10 — see FORK_ATTEMPTS/BAND_ATTEMPTS in the phases. Medium's board-size
  // pool (pickSize) favors smaller boards (6-8), where that technique is
  // structurally unreachable, so mandating it here would starve medium down
  // to the slow bestRef fallback almost every time. Medium instead demands
  // more of the size-generic techniques (common-neighbor, more rounds, more
  // step volume, more variety) than easy — genuinely harder, but achievable
  // at every size medium can draw. Hard keeps the naked/hidden-pair mandate
  // since its pool stays mostly at N=10.
  //
  // maxSubsetSize: caps how large a naked/hidden subset (k regions/axis-values at
  // once) the solve is allowed to need. A k=2 pair ("these two columns only hold
  // two colors between them, so no other color can go there — and vice versa") is
  // the common, easy-to-spot case. k=3/4 (triples/quads) is the identical technique
  // but meaningfully harder for a human to hold in their head simultaneously.
  // Uncapped at easy/medium, a puzzle could clear every other gate while quietly
  // requiring a quad. Hard/expert are uncapped (Infinity): players at that tier
  // are expected to handle triples/quads, and hard's minStratBit=6 already
  // requires naked/hidden subset to fire at all.
  const base =
    levelNum <= 3  ? { minScore: 8,  maxScore: 22,  minSteps: 12, minHardSteps: 0, minRounds: 1, minStratBit: 512, minVariety: 2, maxSubsetSize: 2 } // easy: common-neighbor must fire, no more pure-singleton puzzles
  : levelNum <= 8  ? { minScore: 18, maxScore: 40,  minSteps: 24, minHardSteps: 0, minRounds: 3, minStratBit: 512, minVariety: 3, maxSubsetSize: 2 } // medium: more rounds/steps/variety than easy, still size-generic
  // minScore stays close to the original 16: measuring growBandAnchored directly
  // (4000 raw attempts, boundary>=59) shows naked/hidden-pair hits top out around
  // score 20.4 (the technique itself is only worth 3-6 pts; band-anchored puzzles
  // are short so they get little step-count bonus) — a higher floor here would
  // make the gate technically satisfy minStratBit but never actually be reachable,
  // silently forcing every hard puzzle to the slow bestRef fallback instead.
  // minStratBit=6 (naked/hidden-pair), not the score number, is what actually
  // makes a hard puzzle harder than medium.
  : levelNum <= 15 ? { minScore: 17, maxScore: 62,  minSteps: 20, minHardSteps: 0, minRounds: 2, minStratBit: 6,   minVariety: 3, maxSubsetSize: Infinity } // hard: naked/hidden-pair must fire
                     : { minScore: 60, maxScore: 320, minSteps: 24, minHardSteps: 0, minRounds: 3, minStratBit: 96,  minVariety: 3, maxSubsetSize: Infinity } // expert: forcing chain or branch rule must fire

  // Size scaling: every minScore/minSteps above is calibrated against refSize(levelNum),
  // the smallest (and most commonly drawn) board in this tier's pickSize pool. A bigger
  // board naturally produces more propagation steps and rounds from sheer cell/region
  // volume even when no single deduction is any harder — canSolveLogically's rounds and
  // step counts scale with N, not with per-cell reasoning difficulty (see solver's
  // difficultyScore). Left unscaled, a tier's floor is trivial to clear by dilution at
  // its larger sizes (e.g. hard's occasional N=8 draw vs its usual N=10) while remaining
  // a genuine bar at its smallest size. Scaling the floor up proportionally with N keeps
  // larger draws honest without touching the calibration at each tier's reference size.
  // maxScore/minStratBit/minVariety are left unscaled: maxScore is a ceiling that stays
  // safely above the scaled floor at every N this pool can draw, and strategy-presence/
  // variety are boolean checks that scaling wouldn't meaningfully affect.
  //
  // sqrt, not linear: linear scaling (score *= N/refN) pushed medium's bar too high at
  // its own dominant sizes (7/8 — 75% of medium's pool), regressing technique variety.
  // sqrt alone wasn't enough either — medium's *unscaled* score already sits right at
  // its own floor at every size in its pool (18.3@N6, 20@N7, 18.4@N7, 17.7@N8, all
  // clustered near minScore=18 with no real upward trend against N) — growBalanced's
  // ~4% hit rate is chronically marginal there, not size-diluted, so medium is exempted
  // below rather than forced through a scaling correction that only destabilizes an
  // already-thin generator without fixing a pattern that isn't actually present there.
  const scale = levelNum <= 8 ? 1 : Math.sqrt(N / refSize(levelNum))
  return {
    ...base,
    minScore: Math.round(base.minScore * scale * 10) / 10,
    minSteps: Math.round(base.minSteps * scale),
  }
}
