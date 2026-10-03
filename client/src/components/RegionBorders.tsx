import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore.ts'

// Matches the cell borderRadius used by every grid screen.
const CELL_RADIUS = 5
const GUTTER_FILL = 'oklch(var(--p))'

type Point = [number, number]

function regionLoops(regions: number[][], regionId: number): Point[][] {
  const size = regions.length
  const same = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && regions[r][c] === regionId
  const outgoing = new Map<string, Point[]>()
  const addEdge = (from: Point, to: Point) => {
    const k = from.join(',')
    outgoing.set(k, [...(outgoing.get(k) ?? []), to])
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!same(r, c)) continue
      if (!same(r - 1, c)) addEdge([c, r], [c + 1, r])
      if (!same(r, c + 1)) addEdge([c + 1, r], [c + 1, r + 1])
      if (!same(r + 1, c)) addEdge([c + 1, r + 1], [c, r + 1])
      if (!same(r, c - 1)) addEdge([c, r + 1], [c, r])
    }
  }
  const loops: Point[][] = []
  for (const [startKey, targets] of outgoing) {
    while (targets.length) {
      const start = startKey.split(',').map(Number) as Point
      const loop: Point[] = [start]
      let prev = start
      let cur = targets.shift()!
      while (cur[0] !== start[0] || cur[1] !== start[1]) {
        loop.push(cur)
        const options = outgoing.get(cur.join(','))!
        const dx = cur[0] - prev[0]
        const dy = cur[1] - prev[1]
        // Where two cells touch only at a corner, turn right to keep loops separate.
        let pick = options.findIndex(([x, y]) => (x - cur[0]) * -dy + (y - cur[1]) * dx > 0)
        if (pick < 0) pick = 0
        prev = cur
        cur = options.splice(pick, 1)[0]
      }
      loops.push(loop)
    }
  }
  return loops
}

// Region is on the right-hand side of every edge, so each lattice vertex (a
// gutter intersection) is pushed inward by half a gutter along both normals.
function roundedPath(loop: Point[], px: (p: Point) => Point, gapX: number, gapY: number): string {
  const n = loop.length
  const dirs = loop.map((p, i) => {
    const q = loop[(i + 1) % n]
    return [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])] as Point
  })
  const parts: string[] = []
  loop.forEach((p, i) => {
    const a = dirs[(i - 1 + n) % n]
    const b = dirs[i]
    if (a[0] === b[0] && a[1] === b[1]) return
    const [x, y] = px(p)
    const vx = x + (-a[1] - b[1]) * gapX / 2
    const vy = y + (a[0] + b[0]) * gapY / 2
    const sweep = a[0] * b[1] - a[1] * b[0] > 0 ? 1 : 0
    parts.push(`${parts.length ? 'L' : 'M'}${vx - a[0] * CELL_RADIUS} ${vy - a[1] * CELL_RADIUS}A${CELL_RADIUS} ${CELL_RADIUS} 0 0 ${sweep} ${vx + b[0] * CELL_RADIUS} ${vy + b[1] * CELL_RADIUS}`)
  })
  return parts.join('') + 'Z'
}

// Paints the gutters between regions as one rounded shape: a gutter-coloured
// base with each region's rounded outline (white like the board, so same-region
// gaps keep their separation) on top. Rendered before the cells so they sit above it.
export function RegionBorders({ regions, inset, gap }: { regions: number[][]; inset: number; gap: number }) {
  const enabled = useGameStore(s => s.regionBorders)
  const ref = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      setBox({ w: width, h: height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled])

  const size = regions.length
  const pitchX = (box.w + gap) / size
  const pitchY = (box.h + gap) / size

  const shapes = useMemo(() => {
    if (box.w === 0) return []
    const px = ([x, y]: Point): Point => [x * pitchX - gap / 2, y * pitchY - gap / 2]
    return [...new Set(regions.flat())].map(id => ({
      id,
      d: regionLoops(regions, id).map(loop => roundedPath(loop, px, gap, gap)).join(''),
    }))
  }, [regions, box.w, pitchX, pitchY, gap])

  if (!enabled) return null

  return (
    <svg
      ref={ref}
      style={{ position: 'absolute', top: inset, left: inset, width: `calc(100% - ${inset * 2}px)`, height: `calc(100% - ${inset * 2}px)`, pointerEvents: 'none', overflow: 'visible' }}
    >
      <rect width={box.w} height={box.h} rx={CELL_RADIUS} fill={GUTTER_FILL} />
      {shapes.map(s => <path key={s.id} d={s.d} fill="oklch(var(--b2))" />)}
    </svg>
  )
}
