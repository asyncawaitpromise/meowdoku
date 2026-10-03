import { useCallback, useMemo } from 'react'
import { useAuthStore } from '../store/authStore.ts'
import { hexToOklch, rgbToOklch, rotateHue } from '../lib/themeColors'

// Hue of the original meowdoku theme's primary; puzzle colors were tuned against it.
const BASE_HUE = hexToOklch('#5a2828').h
const MIN_CHROMA = 0.03

function themePrimaryHue(theme: string): number | null {
  const probe = document.createElement('div')
  probe.setAttribute('data-theme', theme)
  probe.style.cssText = 'position:absolute;visibility:hidden;color:oklch(var(--p))'
  document.body.appendChild(probe)
  const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number)
  probe.remove()
  if (!rgb || rgb.length < 3) return null
  const { c, h } = rgbToOklch(rgb[0], rgb[1], rgb[2])
  // Greyscale themes (lofi, black, ...) have no meaningful hue to follow.
  return c < MIN_CHROMA ? null : h
}

// Returns a mapper that tints a puzzle region color toward the active theme.
export function useThemeColor(): (hex: string) => string {
  const theme = useAuthStore(s => s.user?.theme || s.preferredTheme)
  const shift = useMemo(() => {
    const hue = themePrimaryHue(theme)
    return hue === null ? 0 : hue - BASE_HUE
  }, [theme])
  return useCallback((hex: string) => rotateHue(hex, shift), [shift])
}
