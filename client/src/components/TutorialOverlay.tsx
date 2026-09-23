export interface SpotlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GesturePrompt {
  kind: 'tap' | 'doubletap' | 'hold'
  x: number
  y: number
}

const GESTURE_LABEL: Record<GesturePrompt['kind'], string> = {
  tap: 'Tap',
  doubletap: 'Tap twice',
  hold: 'Press and hold',
}

function GestureIcon({ gesture }: { gesture: GesturePrompt }) {
  return (
    <div style={{
      position: 'fixed', left: gesture.x, top: gesture.y, zIndex: 152,
      transform: 'translate(-50%, -50%)', pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        background: 'rgba(255, 210, 63, 0.85)', border: '2px solid #fff',
        animation: gesture.kind === 'doubletap' ? 'tutorialPulse 0.7s ease-in-out infinite' : 'tutorialPulse 1s ease-in-out infinite',
      }} />
      <span style={{
        fontSize: 12, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.55)',
        borderRadius: 8, padding: '2px 8px', whiteSpace: 'nowrap',
      }}>
        {GESTURE_LABEL[gesture.kind]}
      </span>
      <style>{`
        @keyframes tutorialPulse {
          0% { transform: scale(0.7); opacity: 0.9; }
          70% { transform: scale(1.35); opacity: 0; }
          100% { transform: scale(0.7); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

export interface TutorialOverlayProps {
  spotlights: SpotlightRect[]
  message: string
  gesture?: GesturePrompt
  onNext?: () => void
  nextLabel?: string
}

// Dims the whole screen except cut-out holes over the cells a step is
// teaching about, plus a floating message box and an optional gesture icon.
// Rendered with pointerEvents: 'none' at the root so the real grid underneath
// stays fully interactive through the holes — only the message box itself
// (and its button) intercepts taps.
export function TutorialOverlay({ spotlights, message, gesture, onNext, nextLabel }: TutorialOverlayProps) {
  const maskId = 'tutorial-spotlight-mask'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, pointerEvents: 'none' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlights.map((s, i) => (
              <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={8} fill="black" />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(20,12,12,0.68)" mask={`url(#${maskId})`} />
        {spotlights.map((s, i) => (
          <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={8} fill="none" stroke="#ffd23f" strokeWidth={3} />
        ))}
      </svg>

      {gesture && <GestureIcon gesture={gesture} />}

      <div style={{
        position: 'fixed', left: 16, right: 16, bottom: 28, zIndex: 153,
        background: '#fffaf5', borderRadius: 16, padding: '14px 16px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.3)', pointerEvents: 'auto',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5a2828', fontWeight: 500 }}>
          {message}
        </p>
        {onNext && (
          <button
            onClick={onNext}
            style={{
              alignSelf: 'flex-end', background: '#3a8a50', color: 'white', border: 'none',
              borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {nextLabel ?? 'Got it →'}
          </button>
        )}
      </div>
    </div>
  )
}
