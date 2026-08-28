export function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const result: T[][] = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      result.push([arr[i], ...rest])
  return result
}
