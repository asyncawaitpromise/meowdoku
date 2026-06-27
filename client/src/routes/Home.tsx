import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'

const BG = '#f0e8e0'
const BROWN = '#5a2828'
const BROWN_LIGHT = '#7a4545'

export default function Home() {
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
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0,
    }}>

      {/* Logo */}
      <div style={{ fontSize: 80, lineHeight: 1, marginBottom: 16 }}>🐱</div>

      {/* Title */}
      <h1 style={{ fontSize: 36, fontWeight: 800, color: BROWN, margin: '0 0 6px', letterSpacing: -0.5 }}>
        Meowdoku
      </h1>
      <p style={{ fontSize: 14, color: BROWN_LIGHT, margin: '0 0 48px', opacity: 0.7 }}>
        A cat-themed logic puzzle
      </p>

      {/* Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 220 }}>
        <button
          onClick={() => navigate(`/game/${lastLevel}`)}
          style={{
            background: BROWN,
            color: 'white',
            border: 'none',
            borderRadius: 16,
            padding: '16px 0',
            fontSize: 17,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(90,40,40,0.25)',
            letterSpacing: 0.2,
          }}
        >
          ▶ Play
        </button>

        <button
          onClick={() => navigate('/levels')}
          style={{
            background: 'white',
            color: BROWN,
            border: `2px solid ${BROWN}`,
            borderRadius: 16,
            padding: '14px 0',
            fontSize: 17,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: 0.2,
          }}
        >
          Select Level
        </button>
      </div>

      {/* Footer hint */}
      <p style={{ position: 'absolute', bottom: 24, fontSize: 12, color: BROWN_LIGHT, opacity: 0.4 }}>
        Last played: Level {lastLevel}
      </p>

    </div>
  )
}
