import { CatMark } from './CatMark'
import { CatPopReveal, CatDrawReveal, CatShatterReveal } from './catAnimations'
import type { CatAnimation } from '../store/gameStore.ts'

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const DURATION = 1.5

export function CatReveal({ variant, tileColor }: { variant: CatAnimation; tileColor: string }) {
  switch (variant) {
    case 'draw':
      return <CatDrawReveal timing="linear" duration={DURATION} />
    case 'pop':
      return <CatPopReveal timing={SPRING} duration={DURATION} />
    case 'shatter':
      return <CatShatterReveal timing="linear" duration={DURATION} tileColor={tileColor} />
    case 'none':
      return <CatMark />
  }
}
