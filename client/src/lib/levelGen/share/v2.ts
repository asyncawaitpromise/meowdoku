import { GeneratedLevel } from '../types'
import { PALETTE, makeRng, shuffle } from '../rng'
import { canSolveLogically, difficultyScore, detectHalfTurnSymmetry, solveUnique } from '../solver'
import { boundaryCount } from '../growth'

// Compact share codec ("f" prefix). Encodes only `regions` — everything else
// a shared puzzle needs is either cosmetic (colors, regenerated on decode)
// or uniquely determined by regions (a valid puzzle always has exactly one
// logical solution, recovered here via solveUnique instead of being stored).
//
// Instead of one base36 character per cell (which wastes the gap between the
// ~log2(N) bits a cell actually needs and the ~5.2 bits a base36 digit can
// hold), this stores one bit per adjacent-cell pair — 1 if the pair is in
// different regions (a boundary), 0 if not — packed into a single integer
// and rendered in base62. Decoding rebuilds the labeled grid with union-find
// over the "same region" edges, canonically relabeling by first appearance
// in raster order so two encoders never disagree on which integer names
// which blob. Grid size N (always 4-11) is folded into the same integer's
// low 3 bits rather than stored as separate text, since inferring it from
// the string's length/magnitude alone is ambiguous — leading zero bits
// vanish once a bitstring becomes an integer.
const PREFIX = 'f'
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SIZE_BITS = 3n // ceil(log2(11 - 4 + 1)) — covers N in [4, 11]

function bigIntToBase62(n: bigint): string {
  if (n === 0n) return '0'
  let out = ''
  let v = n
  const base = BigInt(62)
  while (v > 0n) {
    out = BASE62[Number(v % base)] + out
    v /= base
  }
  return out
}

function base62ToBigInt(s: string): bigint | null {
  let v = 0n
  const base = BigInt(62)
  for (const ch of s) {
    const idx = BASE62.indexOf(ch)
    if (idx < 0) return null
    v = v * base + BigInt(idx)
  }
  return v
}

export function encodeShareCodeV2(level: GeneratedLevel): string {
  const { size: N, regions } = level
  const bits: number[] = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N - 1; c++) bits.push(regions[r][c] !== regions[r][c + 1] ? 1 : 0)
  }
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N; c++) bits.push(regions[r][c] !== regions[r + 1][c] ? 1 : 0)
  }
  let value = 0n
  for (const b of bits) value = value * 2n + BigInt(b)
  value = value * (1n << SIZE_BITS) + BigInt(N - 4)
  return `${PREFIX}${bigIntToBase62(value)}`
}

export function decodeShareCodeV2(code: string): GeneratedLevel | null {
  if (code.length < 2 || code[0] !== PREFIX) return null
  const payload = base62ToBigInt(code.slice(1))
  if (payload === null) return null

  const seed = Number(payload % 4294967296n) // for cosmetic color assignment only
  let value = payload

  const N = Number(value & ((1n << SIZE_BITS) - 1n)) + 4
  value >>= SIZE_BITS
  if (N < 4 || N > 11) return null

  const numBits = N * (N - 1) * 2
  const bits: number[] = new Array(numBits).fill(0)
  for (let i = numBits - 1; i >= 0; i--) {
    bits[i] = Number(value & 1n)
    value >>= 1n
  }
  if (value !== 0n) return null

  const hBit = (r: number, c: number) => bits[r * (N - 1) + c]
  const vBit = (r: number, c: number) => bits[N * (N - 1) + r * N + c]

  const parent = Array.from({ length: N * N }, (_, i) => i)
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]))
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let r = 0; r < N; r++) for (let c = 0; c < N - 1; c++) if (hBit(r, c) === 0) union(r * N + c, r * N + c + 1)
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N; c++) if (vBit(r, c) === 0) union(r * N + c, (r + 1) * N + c)

  const label = new Map<number, number>()
  const regions: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const root = find(r * N + c)
      let id = label.get(root)
      if (id === undefined) { id = label.size; label.set(root, id) }
      regions[r][c] = id
    }
  }
  if (label.size !== N) return null // this puzzle's rules require exactly N regions

  const solution = solveUnique(regions, N)
  if (!solution) return null

  const result = canSolveLogically(regions, N)
  const score = difficultyScore(result.strategiesUsed, result.easySteps, result.hardSteps, result.rounds)

  return {
    size: N,
    regions,
    solution,
    colors: shuffle([...PALETTE], makeRng(seed)),
    difficulty: score,
    easySteps: result.easySteps,
    hardSteps: result.hardSteps,
    boundaries: boundaryCount(regions, N),
    rounds: result.rounds,
    maxSubsetSize: result.maxSubsetSize,
    symmetric: detectHalfTurnSymmetry(regions, N),
    strategiesUsed: result.strategiesUsed,
    techniqueCounts: result.techniqueCounts ?? {},
    gateMet: result.solved,
  }
}
