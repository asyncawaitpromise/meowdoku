import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

// Tracks the largest square that fits inside `wrapperRef`, so the puzzle grid
// (rendered at `gridRef`) can be sized explicitly rather than relying on CSS
// aspect-ratio tricks that fight a flex-column layout on resize.
export function useGridSize(): { wrapperRef: RefObject<HTMLDivElement>; gridRef: RefObject<HTMLDivElement>; gridSize: number } {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState(0)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      setGridSize(Math.min(width, height) - 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { wrapperRef, gridRef, gridSize }
}
