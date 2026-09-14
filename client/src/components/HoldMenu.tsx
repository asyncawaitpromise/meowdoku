import { HOLD_OPTIONS, HOLD_OPTION_RADIUS_PX, type HoldOption } from '../lib/holdMenuLayout.ts'
import { XMark } from './XMark'
import { CatMark } from './CatMark'
import { QuestionMark } from './QuestionMark'

const BUTTON_SIZE = 46
const EDGE_PADDING = 16

// This menu is `position: fixed`, which normally means "relative to the
// viewport" — except on desktop, where index.css puts a `transform` on
// `.phone-screen` to frame the app in a phone-sized box. A `transform` on an
// ancestor makes IT the containing block for fixed descendants, so on
// desktop this menu is actually positioned (and clipped by overflow-x) inside
// that small centered box, not the full window. clientX/clientY are always
// viewport-relative regardless, so they must be translated into that box's
// local coordinates before use. On mobile .phone-screen has no transform and
// fills the viewport, so its rect equals the window and this is a no-op.
function getContainerRect() {
  const el = document.querySelector('.phone-screen')
  const rect = el?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) return rect
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

// Keeps every option button on-screen even when the hold started near a
// screen edge (top row of the grid, or a narrow phone width).
function clampAnchor(clientX: number, clientY: number) {
  const container = getContainerRect()
  const x = clientX - container.left
  const y = clientY - container.top
  const half = HOLD_OPTION_RADIUS_PX + BUTTON_SIZE / 2 + EDGE_PADDING
  return {
    x: Math.min(Math.max(x, half), container.width - half),
    y: Math.min(Math.max(y, half), container.height - EDGE_PADDING),
  }
}

function OptionIcon({ option }: { option: HoldOption }) {
  if (option === 'cat') return <CatMark />
  if (option === 'x') return <XMark color="#462323" opacity={1} static />
  return <QuestionMark color="#5a2828" opacity={1} />
}

export function HoldMenu({ x, y, hoverOption }: { x: number; y: number; hoverOption: HoldOption | null }) {
  const anchor = clampAnchor(x, y)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: anchor.x - 7, top: anchor.y - 7,
        width: 14, height: 14, borderRadius: '50%',
        background: 'rgba(90, 40, 40, 0.25)',
      }} />
      {HOLD_OPTIONS.map(({ option, ux, uy }) => {
        const active = hoverOption === option
        return (
          <div
            key={option}
            style={{
              position: 'absolute',
              left: anchor.x + ux * HOLD_OPTION_RADIUS_PX - BUTTON_SIZE / 2,
              top: anchor.y + uy * HOLD_OPTION_RADIUS_PX - BUTTON_SIZE / 2,
              width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: '50%',
              background: 'white',
              boxShadow: active ? '0 0 0 3px #d4a830, 0 4px 14px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: active ? 'scale(1.2)' : 'scale(1)',
              opacity: hoverOption && !active ? 0.6 : 1,
              transition: 'transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease',
            }}
          >
            <OptionIcon option={option} />
          </div>
        )
      })}
    </div>
  )
}
