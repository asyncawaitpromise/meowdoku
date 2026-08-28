export function XMark({ color, opacity = 1, exiting = false, static: isStatic = false }: { color: string; opacity?: number; exiting?: boolean; static?: boolean }) {
  const anim = isStatic
    ? undefined
    : exiting
    ? 'xLineRemove 0.2s linear forwards'
    : 'xLineDraw 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <style>{`
        @keyframes xLineDraw  { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes xLineRemove { from { transform: scaleX(1); } to { transform: scaleX(0); } }
      `}</style>
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
