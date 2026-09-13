import { apiClient } from '../services/apiClient.ts'
import { encodeShareCode, type GeneratedLevel } from './levelGen'

// Fire-and-forget: contributes a freshly-generated puzzle to the server-side
// catalog so client-side generation work (spread across every player's
// device) accumulates into a shared, reusable set instead of being thrown
// away once the player moves on. Never surfaced to the player — a failed
// submission just means one fewer puzzle recorded.
export function submitToPuzzleCatalog(level: GeneratedLevel, difficulty?: string) {
  apiClient.post('/api/puzzle-catalog', {
    shareCode: encodeShareCode(level),
    difficulty,
    gateMet: level.gateMet,
  }).catch(() => {})
}
