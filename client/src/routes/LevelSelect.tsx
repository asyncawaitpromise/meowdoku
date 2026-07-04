import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'

const TOTAL_LEVELS = 50
const BG = '#f0e8e0'
const BROWN = '#5a2828'
const GREEN = '#3a8a50'

export default function LevelSelect() {
  const navigate = useNavigate()
  const { completedLevels } = useGameStore()

  const completedSet = new Set(completedLevels)
  const maxCompleted = completedLevels.length > 0 ? Math.max(...completedLevels) : 0
  const nextLevel = Math.min(maxCompleted + 1, TOTAL_LEVELS)

  // Levels to show: all completed + next unlocked (sorted)
  const visibleLevels = [...new Set([...completedLevels, nextLevel])].sort((a, b) => a - b)

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
        <h1 style={{ fontSize: 20, fontWeight: 700, color: BROWN, margin: 0 }}>Select Level</h1>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#7a5040', fontWeight: 500 }}>
          {completedLevels.length}/{TOTAL_LEVELS} done
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {visibleLevels.map(level => {
            const isCompleted = completedSet.has(level)
            const isNext = level === nextLevel && !isCompleted
            return (
              <button
                key={level}
                onClick={() => navigate(`/game/${level}`)}
                style={{
                  aspectRatio: '1',
                  borderRadius: 14,
                  border: isCompleted ? `2.5px solid ${GREEN}` : isNext ? `2.5px solid ${BROWN}` : '2px solid transparent',
                  background: isCompleted ? GREEN : isNext ? BROWN : 'white',
                  color: isCompleted || isNext ? 'white' : BROWN,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
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
                {level}
                {isCompleted && <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span>}
              </button>
            )
          })}
        </div>

      </div>

    </div>
  )
}
