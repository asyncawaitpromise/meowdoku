import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { Difficulty } from '../store/gameStore.ts'

const BG = '#f0e8e0'
const BROWN = '#5a2828'
const GREEN = '#3a8a50'

const VALID_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert']

export default function DifficultyLevelSelect() {
  const navigate = useNavigate()
  const { difficulty: difficultyParam } = useParams<{ difficulty: string }>()
  const { completedPuzzles } = useGameStore()

  // Validate difficulty param
  if (!difficultyParam || !VALID_DIFFICULTIES.includes(difficultyParam as Difficulty)) {
    navigate('/')
    return null
  }

  const difficulty = difficultyParam as Difficulty
  const completed = completedPuzzles[difficulty] ?? []
  const completedSet = new Set(completed)

  const title = difficulty.charAt(0).toUpperCase() + difficulty.slice(1)

  // Puzzles are generated on demand (seeded off puzzleIndex), so there's no
  // fixed pool size to cap "next" against — every difficulty can go on forever.
  const maxCompleted = completed.length > 0 ? Math.max(...completed) : 0
  const nextPuzzle = maxCompleted + 1

  // Only completed puzzles plus the single next (grey) placeholder.
  const visiblePuzzles = [...new Set([...completed, nextPuzzle])].sort((a, b) => a - b)

  return (
    <div className="phone-fullscreen" style={{
      backgroundColor: BG,
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexShrink: 0 }}>
        <button
          onClick={() => navigate('/')}
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 18, color: '#7a4545', flexShrink: 0 }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: BROWN, margin: 0 }}>{title}</h1>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#7a5040', fontWeight: 500 }}>
          {completed.length} done
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {visiblePuzzles.map(puzzleNum => {
            const isCompleted = completedSet.has(puzzleNum)
            const isNext = puzzleNum === nextPuzzle && !isCompleted

            return (
              <button
                key={puzzleNum}
                onClick={() => navigate(`/game/${difficulty}/${puzzleNum}`)}
                style={{
                  aspectRatio: '1',
                  borderRadius: 14,
                  border: isCompleted
                    ? `2.5px solid ${GREEN}`
                    : isNext
                    ? `2.5px solid ${BROWN}`
                    : '2px solid transparent',
                  background: isCompleted
                    ? GREEN
                    : isNext
                    ? '#c8bdb8'
                    : GREEN,
                  color: isCompleted || isNext ? 'white' : 'white',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: isCompleted
                    ? '0 4px 12px rgba(58,138,80,0.25)'
                    : isNext
                    ? '0 1px 4px rgba(0,0,0,0.08)'
                    : '0 4px 12px rgba(58,138,80,0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  transition: 'transform 0.1s',
                  position: 'relative',
                }}
              >
                {puzzleNum}
                {isCompleted && <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span>}
              </button>
            )
          })}
        </div>
      </div>

    </div>
  )
}
