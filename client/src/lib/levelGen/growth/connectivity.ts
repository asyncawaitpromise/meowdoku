import { DIRS } from './directions'

export function isConnectedWithout(grid: number[][], N: number, skipR: number, skipC: number, reg: number): boolean {
  let start = -1, size = 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== reg) continue
      size++
      if (!(r === skipR && c === skipC) && start === -1) start = r * N + c
    }
  }
  if (size <= 1 || start === -1) return false
  const visited = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const r = Math.floor(cur / N), c = cur % N
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
      const nidx = nr * N + nc
      if (!visited.has(nidx) && grid[nr][nc] === reg && !(nr === skipR && nc === skipC)) {
        visited.add(nidx); queue.push(nidx)
      }
    }
  }
  return visited.size === size - 1
}

export function allRegionsConnected(grid: number[][], N: number): boolean {
  const visited = new Set<number>()
  const regionsSeen = new Set<number>()
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (visited.has(r * N + c)) continue
      const reg = grid[r][c]
      if (regionsSeen.has(reg)) return false
      regionsSeen.add(reg)
      const stack = [r * N + c]
      visited.add(r * N + c)
      while (stack.length > 0) {
        const cur = stack.pop()!
        const cr = Math.floor(cur / N), cc = cur % N
        for (const [dr, dc] of DIRS) {
          const nr = cr + dr, nc = cc + dc
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
          const nidx = nr * N + nc
          if (grid[nr][nc] !== reg || visited.has(nidx)) continue
          visited.add(nidx)
          stack.push(nidx)
        }
      }
    }
  }
  return true
}
