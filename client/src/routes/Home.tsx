import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { Difficulty } from '../store/gameStore.ts'
import UserMenu from '../components/UserMenu.tsx'

const BG = '#f0e8e0'
const BROWN = '#5a2828'
const BROWN_LIGHT = '#7a4545'
const WHITE = '#ffffff'

const DIFFICULTIES: { value: Difficulty; label: string; desc: string }[] = [
  { value: 'easy',   label: 'Easy',   desc: 'Just propagation' },
  { value: 'medium', label: 'Medium', desc: 'Row & column logic' },
  { value: 'hard',   label: 'Hard',   desc: 'Multi-step deduction' },
  { value: 'expert', label: 'Expert', desc: 'Advanced techniques' },
]

const cornerBtn: React.CSSProperties = {
  width: 42, height: 42, borderRadius: '50%',
  background: WHITE, border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 20,
}

export default function Home() {
  const navigate = useNavigate()
  const { lastLevel } = useGameStore()

  function handleDifficulty(d: Difficulty) {
    navigate(`/levels/${d}`)
  }

  return (
    <div className="phone-fullscreen" style={{
      backgroundColor: BG,
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      overflowY: 'auto',
    }}>

      {/* Account menu — same dropdown (Friends, Settings, sign out) as the friends page */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 1 }}>
        <UserMenu trigger={
          <div style={cornerBtn} title="Menu">
            ⚙️
          </div>
        } />
      </div>

      {/* Scrollable, centered column */}
      <div style={{
        margin: 'auto',
        padding: '88px 16px 32px',
        width: '100%', maxWidth: 320,
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {/* Logo */}
        <div style={{ fontSize: 80, lineHeight: 1, marginBottom: 16 }}>🐱</div>

        <h1 style={{ fontSize: 36, fontWeight: 800, color: BROWN, margin: '0 0 6px', letterSpacing: -0.5 }}>
          Meowdoku
        </h1>
        <p style={{ fontSize: 14, color: BROWN_LIGHT, margin: '0 0 32px', opacity: 0.7 }}>
          A cat-themed logic puzzle
        </p>

        {/* Difficulty grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: 260, marginBottom: 12 }}>
          {DIFFICULTIES.map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => handleDifficulty(value)}
              style={{
                background: WHITE, color: BROWN,
                border: `2px solid ${BROWN}`, borderRadius: 16,
                padding: '14px 12px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                boxShadow: '0 2px 8px rgba(90,40,40,0.10)',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.1 }}>{label}</span>
              <span style={{ fontSize: 11, color: BROWN_LIGHT, opacity: 0.75, textAlign: 'center', lineHeight: 1.3 }}>{desc}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate('/friends')}
          style={{
            background: BROWN, color: WHITE,
            border: 'none', borderRadius: 16,
            padding: '12px 24px', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            boxShadow: '0 2px 10px rgba(90,40,40,0.25)',
            width: 260,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.1 }}>⚔️ Play with a friend</span>
          <span style={{ fontSize: 11, color: '#f0e0d8', textAlign: 'center', lineHeight: 1.3 }}>
            Head-to-head · Co-op · Share puzzles
          </span>
        </button>

        <p style={{ marginTop: 28, fontSize: 12, color: BROWN_LIGHT, opacity: 0.4 }}>
          Last played: Level {lastLevel}
        </p>
      </div>

    </div>
  )
}
