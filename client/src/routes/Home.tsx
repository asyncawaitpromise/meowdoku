import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'

const BG = '#f0e8e0'
const BROWN = '#5a2828'
const BROWN_LIGHT = '#7a4545'

export default function Home() {
  const navigate = useNavigate()
  const { lastLevel, resetProgress } = useGameStore()
  const [showSettings, setShowSettings] = useState(false)

  function handleReset() {
    resetProgress()
    setShowSettings(false)
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
      <p style={{ fontSize: 14, color: BROWN_LIGHT, margin: '0 0 48px', opacity: 0.7 }}>
        A cat-themed logic puzzle
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 220 }}>
        <button
          onClick={() => navigate(`/game/${lastLevel}`)}
          style={{
            background: BROWN, color: 'white', border: 'none',
            borderRadius: 16, padding: '16px 0',
            fontSize: 17, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(90,40,40,0.25)', letterSpacing: 0.2,
          }}
        >
          ▶ Play
        </button>
        <button
          onClick={() => navigate('/levels')}
          style={{
            background: 'white', color: BROWN,
            border: `2px solid ${BROWN}`, borderRadius: 16,
            padding: '14px 0', fontSize: 17, fontWeight: 600,
            cursor: 'pointer', letterSpacing: 0.2,
          }}
        >
          Select Level
        </button>
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
