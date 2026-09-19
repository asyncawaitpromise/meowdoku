import { useEffect, type RefObject } from 'react'
import { sendLiveMessage } from '../lib/liveEvents.ts'

const SEND_INTERVAL_MS = 50
const KEEPALIVE_INTERVAL_MS = 1500

interface NormalizedPoint {
  x: number
  y: number
}

const clampToUnit = (value: number) => Math.min(1, Math.max(0, value))

// Streams this player's pointer/finger position to the co-op partner as
// fractions of the game screen, so it works anywhere on screen (not just over
// the board) and regardless of the two devices' sizes. A touch pointer is
// only "present" while the finger is down; a mouse stays present until it
// leaves the window. Also reports each fresh position through `onLocalMove`.
export function useCoopCursorBroadcast(
  sessionId: string | undefined,
  enabled: boolean,
  screenRef: RefObject<HTMLElement>,
  onLocalMove: (point: NormalizedPoint | null) => void,
) {
  useEffect(() => {
    if (!sessionId || !enabled) return

    let latest: NormalizedPoint | null = null
    let lastSentAt = 0
    let trailingTimer: ReturnType<typeof setTimeout> | null = null

    const send = () => {
      lastSentAt = Date.now()
      sendLiveMessage({ type: 'cursor', sessionId, x: latest?.x ?? null, y: latest?.y ?? null })
    }

    const publish = (point: NormalizedPoint | null) => {
      latest = point
      onLocalMove(point)
      const sinceLastSend = Date.now() - lastSentAt
      if (point === null || sinceLastSend >= SEND_INTERVAL_MS) {
        if (trailingTimer) clearTimeout(trailingTimer)
        trailingTimer = null
        send()
      } else if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null
          send()
        }, SEND_INTERVAL_MS - sinceLastSend)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = screenRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return
      publish({
        x: clampToUnit((event.clientX - rect.left) / rect.width),
        y: clampToUnit((event.clientY - rect.top) / rect.height),
      })
    }
    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') publish(null)
    }
    const handleMouseLeaveWindow = (event: MouseEvent) => {
      if (event.relatedTarget === null) publish(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerdown', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    document.addEventListener('mouseout', handleMouseLeaveWindow)

    const keepAlive = setInterval(() => {
      if (latest) send()
    }, KEEPALIVE_INTERVAL_MS)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      document.removeEventListener('mouseout', handleMouseLeaveWindow)
      clearInterval(keepAlive)
      if (trailingTimer) clearTimeout(trailingTimer)
      latest = null
      send()
    }
  }, [sessionId, enabled, screenRef, onLocalMove])
}
