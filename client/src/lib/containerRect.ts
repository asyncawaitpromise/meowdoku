// `position: fixed` normally means "relative to the viewport" — except on
// desktop, where index.css puts a `transform` on `.phone-screen` to frame the
// app in a phone-sized box. A `transform` on an ancestor makes IT the
// containing block for fixed descendants, so any `position: fixed` element on
// desktop is actually positioned (and clipped) inside that small centered
// box, not the full window. clientX/clientY and getBoundingClientRect() are
// always viewport-relative regardless, so they must be translated into that
// box's local coordinates before use. On mobile .phone-screen has no
// transform and fills the viewport, so this is a no-op.
export function getContainerRect() {
  const el = document.querySelector('.phone-screen')
  const rect = el?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) return rect
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}
