type Oklch = { l: number; c: number; h: number }

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const [lr, lg, lb] = [r, g, b].map(v => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 }
}

function oklchToHex({ l: L, c, h }: Oklch): string {
  const a = c * Math.cos(h * Math.PI / 180)
  const b = c * Math.sin(h * Math.PI / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return '#' + lin.map(v => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255).toString(16).padStart(2, '0')).join('')
}

export function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.slice(1), 16)
  return rgbToOklch((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

// Rotating every region color by the same angle keeps their pairwise hue
// separation, so the palette stays distinguishable under any theme.
export function rotateHue(hex: string, degrees: number): string {
  if (!degrees) return hex
  const { l, c, h } = hexToOklch(hex)
  return oklchToHex({ l, c, h: (h + degrees + 360) % 360 })
}

// Black on light tiles, white on dark ones, judged by perceptual lightness.
export function inkFor(hex: string): string {
  return hexToOklch(hex).l > 0.62 ? '#000' : '#fff'
}
