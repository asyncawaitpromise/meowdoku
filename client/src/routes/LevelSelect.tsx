import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'

const TOTAL_LEVELS = 50
const BG = '#f0e8e0'
const BROWN = '#5a2828'

export default function LevelSelect() {
  const navigate = useNavigate()
  const lastLevel = useGameStore(s => s.lastLevel)

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
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {Array.from({ length: TOTAL_LEVELS }, (_, i) => {
            const level = i + 1
            const isCurrent = level === lastLevel
            return (
              <button
                key={level}
                onClick={() => navigate(`/game/${level}`)}
                style={{
                  aspectRatio: '1',
                  borderRadius: 14,
                  border: isCurrent ? `2.5px solid ${BROWN}` : '2px solid transparent',
                  background: isCurrent ? BROWN : 'white',
                  color: isCurrent ? 'white' : BROWN,
                  fontSize: 16,
                  fontWeight: isCurrent ? 700 : 500,
                  cursor: 'pointer',
                  boxShadow: isCurrent
                    ? '0 4px 12px rgba(90,40,40,0.25)'
                    : '0 1px 4px rgba(0,0,0,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 0.1s',
                }}
              >
                {level}
              </button>
            )
          })}
        </div>
      </div>

    </div>
  )
}
