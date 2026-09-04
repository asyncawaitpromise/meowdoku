import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { CatPopReveal, CatDrawReveal, CatShatterReveal } from '../components/catAnimations'

const TIMINGS = [
  { label: 'linear',     value: 'linear' },
  { label: 'spring',     value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  { label: 'elastic',    value: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' },
  { label: 'anticipate', value: 'cubic-bezier(0.36, -0.4, 0.64, 1.4)' },
  { label: 'expo',       value: 'cubic-bezier(0.19, 1, 0.22, 1)' },
  { label: 'wobbly',     value: 'cubic-bezier(0.87, -0.41, 0.19, 1.44)' },
]

const BROWN = '#5a2828'
const BROWN_LIGHT = '#7a4545'
const CELL_BG = '#b8d4a8'

function XMark({ color, opacity = 1, timing, duration }: { color: string; opacity?: number; timing: string; duration: number }) {
  const anim = `xLineDraw ${duration}s ${timing} forwards`
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <style>{`@keyframes xLineDraw { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
      <g opacity={opacity}>
        <g transform="rotate(45, 10, 10)">
          <line x1="3" y1="10" x2="17" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transformOrigin: '10px 10px', animation: anim }} />
        </g>
        <g transform="rotate(-45, 10, 10)">
          <line x1="3" y1="10" x2="17" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transformOrigin: '10px 10px', animation: anim }} />
        </g>
      </g>
    </svg>
  )
}

// --- Page ----------------------------------------------------------------

const TARGETS = [
  { label: 'X mark', value: 'x' as const },
  { label: 'Cat', value: 'cat' as const },
]

const CAT_MODES = [
  { label: 'Pop', value: 'pop' as const },
  { label: 'Draw', value: 'draw' as const },
  { label: 'Shatter', value: 'shatter' as const },
]

function Pills<T extends string>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(o => (
        <label key={o.value} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: value === o.value ? BROWN : 'white',
          color: value === o.value ? 'white' : BROWN,
          borderRadius: 20, padding: '7px 14px',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          border: `2px solid ${value === o.value ? BROWN : 'transparent'}`,
          transition: 'background 0.15s, color 0.15s',
        }}>
          <input
            type="radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ display: 'none' }}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

export default function AnimTest() {
  const navigate = useNavigate()
  const [target, setTarget] = useState<'x' | 'cat'>('x')
  const [catMode, setCatMode] = useState<'pop' | 'draw' | 'shatter'>('pop')
  const [marked, setMarked] = useState(false)
  const [key, setKey] = useState(0)
  const [timing, setTiming] = useState(TIMINGS[0].value)
  const [duration, setDuration] = useState(0.5)

  const toggle = () => {
    if (!marked) setKey(k => k + 1)
    setMarked(m => !m)
  }

  return (
    <div className="phone-fullscreen" style={{
      backgroundColor: '#f0e8e0',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexShrink: 0 }}>
        <button
          onClick={() => navigate('/')}
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', fontSize: 18, color: BROWN_LIGHT, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
        >←</button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: BROWN, margin: 0 }}>Anim Test</h1>
      </div>

      {/* Cell */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 32px' }}>
        <div
          onClick={toggle}
          style={{
            width: '100%', maxWidth: 340, aspectRatio: '1',
            backgroundColor: CELL_BG,
            borderRadius: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            overflow: 'visible',
            position: 'relative',
            containerType: 'inline-size',
          } as CSSProperties}
        >
          {marked && target === 'x' && <XMark key={key} color="#462323" opacity={0.7} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'pop' && <CatPopReveal key={key} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'draw' && <CatDrawReveal key={key} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'shatter' && <CatShatterReveal key={key} timing={timing} duration={duration} tileColor={CELL_BG} />}
        </div>
      </div>

      {/* Controls */}
      <div style={{ flexShrink: 0, padding: '0 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Target radio */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Testing</div>
          <Pills options={TARGETS} value={target} onChange={setTarget} />
        </div>

        {/* Cat mode radio */}
        {target === 'cat' && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cat style</div>
            <Pills options={CAT_MODES} value={catMode} onChange={setCatMode} />
          </div>
        )}

        {/* Timing radio */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Timing</div>
          <Pills options={TIMINGS} value={timing} onChange={setTiming} />
        </div>

        {/* Speed slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, textTransform: 'uppercase', letterSpacing: 0.5 }}>Speed</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: BROWN }}>{duration.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min={0.05} max={5} step={0.05}
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            style={{ width: '100%', accentColor: BROWN }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: BROWN_LIGHT, opacity: 0.6, marginTop: 4 }}>
            <span>fast</span><span>slow</span>
          </div>
        </div>

        <p style={{ textAlign: 'center', color: BROWN_LIGHT, fontSize: 13, opacity: 0.6, margin: 0 }}>
          tap cell to toggle
        </p>
      </div>
    </div>
  )
}
