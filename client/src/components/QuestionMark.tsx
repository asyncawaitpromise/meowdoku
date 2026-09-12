export function QuestionMark({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <style>{`
        @keyframes questionPop { from { transform: scale(0); } to { transform: scale(1); } }
      `}</style>
      <text
        x="10" y="15" textAnchor="middle"
        fontSize="16" fontWeight="700" fontFamily="system-ui, sans-serif"
        fill={color} opacity={opacity}
        style={{ transformOrigin: '10px 10px', animation: 'questionPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
      >?</text>
    </svg>
  )
}
