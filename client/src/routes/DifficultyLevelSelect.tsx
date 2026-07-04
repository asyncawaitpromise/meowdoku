import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { Difficulty } from '../store/gameStore.ts'

const BG = '#f0e8e0'
const BROWN = '#5a2828'
const GREEN = '#3a8a50'

const VALID_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert']
const PUZZLES_PER_DIFFICULTY = 20

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

  // Puzzle N is unlocked if N === 1 or puzzle N-1 is completed
  function isUnlocked(puzzleNum: number) {
    if (puzzleNum === 1) return true
    return completedSet.has(puzzleNum - 1)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: BG,
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box',
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
          {completed.length}/{PUZZLES_PER_DIFFICULTY} done
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {Array.from({ length: PUZZLES_PER_DIFFICULTY }, (_, i) => {
            const puzzleNum = i + 1
            const isCompleted = completedSet.has(puzzleNum)
            const unlocked = isUnlocked(puzzleNum)
            const isNext = unlocked && !isCompleted

            return (
              <button
                key={puzzleNum}
                onClick={() => unlocked ? navigate(`/game/${difficulty}/${puzzleNum}`) : undefined}
                disabled={!unlocked}
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
                    ? BROWN
                    : '#c8bdb8',
                  color: isCompleted || isNext ? 'white' : '#8a7a75',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: unlocked ? 'pointer' : 'default',
                  opacity: unlocked ? 1 : 0.5,
                  boxShadow: isCompleted
                    ? '0 4px 12px rgba(58,138,80,0.25)'
                    : isNext
                    ? '0 4px 12px rgba(90,40,40,0.25)'
                    : '0 1px 4px rgba(0,0,0,0.08)',
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
                {!unlocked && <span style={{ fontSize: 10, lineHeight: 1 }}>🔒</span>}
              </button>
            )
          })}
        </div>
      </div>

    </div>
  )
}
