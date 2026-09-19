import { useEffect, useRef, useState, type RefObject } from 'react'
import { useCoopCursorStore } from '../store/coopCursorStore.ts'
import { useCoopCursorBroadcast } from '../hooks/useCoopCursorBroadcast.ts'

const PARTNER_CURSOR_STALE_MS = 4000
const HUG_DISTANCE_PX = 48
const HUG_COOLDOWN_MS = 3000
const HUG_DURATION_MS = 1300

interface Point {
  x: number
  y: number
}

interface Hug {
  id: number
  x: number
  y: number
}

interface CoopCursorLayerProps {
  sessionId: string
  enabled: boolean
  screenRef: RefObject<HTMLElement>
  partnerName: string
}

// Draws the partner's live pointer over the whole game screen, and pops a
// hug where the two pointers meet. Positions arrive as screen fractions and
// are converted to pixels here, so both players see the same relative spot.
export function CoopCursorLayer({ sessionId, enabled, screenRef, partnerName }: CoopCursorLayerProps) {
  const partnerCursor = useCoopCursorStore(state => (state.sessionId === sessionId ? state.partnerCursor : null))
  const clearPartnerCursor = useCoopCursorStore(state => state.clear)
  const [localPoint, setLocalPoint] = useState<Point | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [hugs, setHugs] = useState<Hug[]>([])
  const lastHugAtRef = useRef(0)
  const nextHugIdRef = useRef(0)

  useCoopCursorBroadcast(sessionId, enabled, screenRef, setLocalPoint)

  useEffect(() => () => clearPartnerCursor(), [clearPartnerCursor])

  useEffect(() => {
    if (!partnerCursor) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [partnerCursor])

  const isPartnerVisible = !!partnerCursor && now - partnerCursor.updatedAt < PARTNER_CURSOR_STALE_MS
  const rect = screenRef.current?.getBoundingClientRect()
  const partnerPixels: Point | null = isPartnerVisible && rect
    ? { x: partnerCursor.x * rect.width, y: partnerCursor.y * rect.height }
    : null
  const localPixels: Point | null = localPoint && rect
    ? { x: localPoint.x * rect.width, y: localPoint.y * rect.height }
    : null

  useEffect(() => {
    if (!partnerPixels || !localPixels) return
    const distance = Math.hypot(partnerPixels.x - localPixels.x, partnerPixels.y - localPixels.y)
    const isCoolingDown = Date.now() - lastHugAtRef.current < HUG_COOLDOWN_MS
    if (distance > HUG_DISTANCE_PX || isCoolingDown) return

    lastHugAtRef.current = Date.now()
    const hug: Hug = {
      id: nextHugIdRef.current++,
      x: (partnerPixels.x + localPixels.x) / 2,
      y: (partnerPixels.y + localPixels.y) / 2,
    }
    setHugs(current => [...current, hug])
    setTimeout(() => setHugs(current => current.filter(h => h.id !== hug.id)), HUG_DURATION_MS)
  }, [partnerPixels?.x, partnerPixels?.y, localPixels?.x, localPixels?.y]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 60 }}>
      {partnerPixels && (
        <div style={{
          position: 'absolute', left: 0, top: 0,
          transform: `translate(${partnerPixels.x}px, ${partnerPixels.y}px)`,
          transition: 'transform 80ms linear',
        }}>
          <div style={{
            width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: '50%',
            background: '#c8641e', border: '2.5px solid white', boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
          }} />
          <span style={{
            position: 'absolute', left: 12, top: 8, whiteSpace: 'nowrap',
            fontSize: 11, fontWeight: 700, color: 'white', background: '#c8641e',
            borderRadius: 8, padding: '1px 6px',
          }}>
            {partnerName}
          </span>
        </div>
      )}
      {hugs.map(hug => (
        <span
          key={hug.id}
          style={{
            position: 'absolute', left: hug.x, top: hug.y, fontSize: 34,
            marginLeft: -17, marginTop: -17,
            animation: `coop-hug-pop ${HUG_DURATION_MS}ms ease-out forwards`,
          }}
        >
          🤗
        </span>
      ))}
      <style>{`@keyframes coop-hug-pop {
        0% { transform: translateY(0) scale(0.4); opacity: 0; }
        20% { transform: translateY(-8px) scale(1.2); opacity: 1; }
        100% { transform: translateY(-48px) scale(1); opacity: 0; }
      }`}</style>
    </div>
  )
}
