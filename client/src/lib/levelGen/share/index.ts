import { GeneratedLevel } from '../types'
import { encodeShareCodeV2, decodeShareCodeV2 } from './v2'
import { decodeShareCodeV1 } from './v1'

// New links always use v2 (see ./v2 for why it's this much smaller). v1 stays
// decode-only forever so links shared before this switch don't break — the
// prefix ("mwd1." vs "f") tells decodeShareCode which codec produced a given
// string, so there's no ambiguity or guessing between formats to add here
// when a future v3 shows up: just add another prefix check below.
export function encodeShareCode(level: GeneratedLevel): string {
  return encodeShareCodeV2(level)
}

export function decodeShareCode(code: string): GeneratedLevel | null {
  const trimmed = code.trim()
  if (trimmed.startsWith('mwd1.')) return decodeShareCodeV1(trimmed)
  return decodeShareCodeV2(trimmed)
}
