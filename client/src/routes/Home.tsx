import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { CatAnimation, Difficulty } from '../store/gameStore.ts'

const BG = '#f0e8e0'
const BROWN = '#5a2828'
const BROWN_LIGHT = '#7a4545'

const DIFFICULTIES: { value: Difficulty; label: string; desc: string }[] = [
  { value: 'easy',   label: 'Easy',   desc: 'Just propagation' },
  { value: 'medium', label: 'Medium', desc: 'Row & column logic' },
  { value: 'hard',   label: 'Hard',   desc: 'Multi-step deduction' },
  { value: 'expert', label: 'Expert', desc: 'Advanced techniques' },
]

const CAT_ANIMATIONS: { value: CatAnimation; label: string }[] = [
  { value: 'draw',    label: 'Draw' },
  { value: 'pop',     label: 'Pop' },
  { value: 'shatter', label: 'Shatter' },
  { value: 'none',    label: 'None' },
]

export default function Home() {
  const navigate = useNavigate()
  const { lastLevel, resetProgress, catAnimation, setCatAnimation } = useGameStore()
  const [showSettings, setShowSettings] = useState(false)

  function handleReset() {
    resetProgress()
    setShowSettings(false)
  }

  function handleDifficulty(d: Difficulty) {
    navigate(`/levels/${d}`)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: BG,
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>

      {/* Gear button */}
      <button
        onClick={() => setShowSettings(true)}
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 42, height: 42, borderRadius: '50%',
          background: 'white', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 20,
        }}
        title="Settings"
      >
        ⚙️
      </button>

      {/* Logo */}
      <div style={{ fontSize: 80, lineHeight: 1, marginBottom: 16 }}>🐱</div>

      <h1 style={{ fontSize: 36, fontWeight: 800, color: BROWN, margin: '0 0 6px', letterSpacing: -0.5 }}>
        Meowdoku
      </h1>
      <p style={{ fontSize: 14, color: BROWN_LIGHT, margin: '0 0 32px', opacity: 0.7 }}>
        A cat-themed logic puzzle
      </p>

      {/* Difficulty grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: 260, marginBottom: 14 }}>
        {DIFFICULTIES.map(({ value, label, desc }) => (
          <button
            key={value}
            onClick={() => handleDifficulty(value)}
            style={{
              background: 'white', color: BROWN,
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

      <p style={{ position: 'absolute', bottom: 24, fontSize: 12, color: BROWN_LIGHT, opacity: 0.4 }}>
        Last played: Level {lastLevel}
      </p>

      {/* Settings modal */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: '20px 20px 0 0',
              padding: '8px 0 40px', width: '100%', maxWidth: 480,
            }}
          >
            {/* Handle */}
            <div style={{ width: 36, height: 4, background: '#e0d0c8', borderRadius: 2, margin: '12px auto 20px' }} />

            <h2 style={{ textAlign: 'center', fontSize: 17, fontWeight: 700, color: BROWN, margin: '0 0 24px' }}>
              Settings
            </h2>

            <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 8 }}>
                  Cat animation
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {CAT_ANIMATIONS.map(({ value, label }) => (
                    <label key={value} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: catAnimation === value ? BROWN : '#f5ece6',
                      color: catAnimation === value ? 'white' : BROWN,
                      borderRadius: 20, padding: '8px 14px',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}>
                      <input
                        type="radio"
                        name="catAnimation"
                        checked={catAnimation === value}
                        onChange={() => setCatAnimation(value)}
                        style={{ display: 'none' }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={handleReset}
                style={{
                  background: '#fff0f0', color: '#b03030',
                  border: '1.5px solid #f0c0c0', borderRadius: 12,
                  padding: '14px 0', fontSize: 15, fontWeight: 600,
                  cursor: 'pointer', width: '100%',
                }}
              >
                Reset progress
              </button>
              <Link
                to="/animtest"
                style={{
                  display: 'block', textAlign: 'center',
                  background: 'transparent', color: BROWN_LIGHT,
                  border: 'none', padding: '10px 0',
                  fontSize: 13, opacity: 0.5, textDecoration: 'none',
                }}
              >
                Anim test
              </Link>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: 'transparent', color: BROWN_LIGHT,
                  border: 'none', padding: '10px 0',
                  fontSize: 15, cursor: 'pointer', width: '100%',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
