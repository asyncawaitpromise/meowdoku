import catUrl from '../assets/cat.svg'

// Cute cat face (SVG Repo, CC0) that fills the cell. A soft cream disc sits
// behind so the face reads on any region color.
export function CatMark() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: '100%', height: '100%', display: 'block', flexShrink: 0, pointerEvents: 'none', position: 'relative', zIndex: 1 }}>
      <image href={catUrl} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}
