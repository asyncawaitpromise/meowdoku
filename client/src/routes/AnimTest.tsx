import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { CatMark } from '../components/CatMark'

const TIMINGS = [
  { label: 'spring',     value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  { label: 'elastic',    value: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' },
  { label: 'anticipate', value: 'cubic-bezier(0.36, -0.4, 0.64, 1.4)' },
  { label: 'expo',       value: 'cubic-bezier(0.19, 1, 0.22, 1)' },
  { label: 'wobbly',     value: 'cubic-bezier(0.87, -0.41, 0.19, 1.44)' },
]

const BROWN = '#5a2828'
const BROWN_LIGHT = '#7a4545'
const CELL_BG = '#b8d4a8'

function XMark({ color, opacity = 1, timing, duration }: { color: string; opacity?: number; timing: string; duration: number }) {
  const anim = `xLineDraw ${duration}s ${timing} forwards`
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <style>{`@keyframes xLineDraw { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
      <g opacity={opacity}>
        <g transform="rotate(45, 10, 10)">
          <line x1="3" y1="10" x2="17" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transformOrigin: '10px 10px', animation: anim }} />
        </g>
        <g transform="rotate(-45, 10, 10)">
          <line x1="3" y1="10" x2="17" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transformOrigin: '10px 10px', animation: anim }} />
        </g>
      </g>
    </svg>
  )
}

// --- Cat animation candidates -------------------------------------------

function CatPop({ timing, duration }: { timing: string; duration: number }) {
  return (
    <div style={{ width: '100%', height: '100%', animation: `catPop ${duration}s ${timing} forwards`, transformOrigin: 'center' }}>
      <style>{`@keyframes catPop { from { transform: scale(0); } to { transform: scale(1); } }`}</style>
      <CatMark />
    </div>
  )
}

// Outline traced first (pathLength=1 trick makes stroke-dasharray/offset
// work regardless of each path's actual geometry), then the fill fades in.
const CAT_PATHS = [
  'M6.09485 4.25C5.48148 4.25 4.77463 4.42871 4.20882 4.91616C3.62226 5.4215 3.27004 6.18781 3.27004 7.1875V9.0625L3.27005 9.06545C3.2712 9.35941 3.3211 9.94757 3.4888 10.4392C3.54365 10.6001 3.63129 10.8134 3.77764 11.0058C3.49364 11.5688 3.35904 12.1495 3.29787 12.7095C3.2468 13.1771 3.24611 13.6679 3.25424 14.1211C2.5932 14.3507 1.90877 14.6349 1.5932 14.8387C1.24524 15.0634 1.14534 15.5277 1.37006 15.8756C1.59478 16.2236 2.05903 16.3235 2.40698 16.0988C2.5234 16.0236 2.86686 15.8664 3.31867 15.6939C3.38755 16.173 3.52716 16.6095 3.7221 17.0063C3.56621 17.1035 3.42847 17.1935 3.31889 17.2652C3.27694 17.2926 3.23912 17.3173 3.20599 17.3387C2.85803 17.5634 2.75813 18.0277 2.98285 18.3756C3.20757 18.7236 3.67182 18.8235 4.01978 18.5988C4.0609 18.5722 4.10473 18.5436 4.15098 18.5134C4.28216 18.4278 4.43287 18.3294 4.59701 18.2288C5.18653 18.8313 5.91865 19.2964 6.67916 19.6462C8.45998 20.4654 10.569 20.75 12.0001 20.75C13.4311 20.75 15.5402 20.4654 17.321 19.6462C18.0815 19.2964 18.8136 18.8313 19.4031 18.2288C19.5673 18.3294 19.718 18.4278 19.8491 18.5134C19.8954 18.5436 19.9392 18.5722 19.9803 18.5988C20.3283 18.8235 20.7925 18.7236 21.0173 18.3756C21.242 18.0277 21.1421 17.5634 20.7941 17.3387C20.761 17.3173 20.7232 17.2926 20.6812 17.2652C20.5716 17.1935 20.4339 17.1035 20.2781 17.0063C20.473 16.6095 20.6127 16.173 20.6815 15.6938C21.1335 15.8663 21.4771 16.0236 21.5936 16.0988C21.9415 16.3235 22.4058 16.2236 22.6305 15.8756C22.8552 15.5277 22.7553 15.0634 22.4074 14.8387C22.0917 14.6349 21.4071 14.3506 20.7459 14.121C20.7541 13.6678 20.7534 13.177 20.7023 12.7095C20.6412 12.1495 20.5065 11.5688 20.2225 11.0058C20.3689 10.8134 20.4565 10.6001 20.5114 10.4392C20.6791 9.94758 20.729 9.35941 20.7301 9.06545L20.7302 9.0625V7.18761C20.7302 6.18792 20.3779 5.42162 19.7914 4.91628C19.2256 4.42882 18.5187 4.25011 17.9054 4.25011C17.4969 4.25011 17.0744 4.40685 16.7337 4.56076C16.3726 4.72392 15.9952 4.9359 15.6558 5.13136C15.5828 5.17339 15.5119 5.21444 15.443 5.25432L15.441 5.25548C15.177 5.4084 14.9427 5.5441 14.7339 5.65167C14.6042 5.7185 14.5035 5.7643 14.4285 5.79206C14.3969 5.80377 14.3767 5.80966 14.3663 5.81242C14.1129 5.81102 13.9514 5.79033 13.7181 5.76044C13.6681 5.75403 13.6147 5.74719 13.5564 5.74003C13.2098 5.69743 12.7722 5.65636 12.0001 5.65636C11.228 5.65636 10.7905 5.69743 10.4438 5.74003C10.3855 5.74719 10.3322 5.75403 10.2821 5.76044C10.0489 5.79033 9.88738 5.81102 9.63388 5.81242C9.62352 5.80966 9.60332 5.80376 9.57174 5.79206C9.49678 5.7643 9.39604 5.71849 9.26633 5.65166C9.05755 5.54408 8.82331 5.40842 8.55926 5.25548C8.48975 5.21523 8.41818 5.17377 8.34446 5.13132C8.00502 4.93584 7.62764 4.72384 7.26652 4.56067C6.92587 4.40675 6.50329 4.25 6.09485 4.25ZM6.16192 17.6138C6.49595 17.8657 6.8808 18.0879 7.30604 18.2835C8.83694 18.9877 10.7179 19.25 12.0001 19.25C13.2823 19.25 15.1632 18.9877 16.6941 18.2835C17.1194 18.0879 17.5042 17.8657 17.8382 17.6138C17.4858 17.5524 17.2179 17.245 17.2179 16.875C17.2179 16.4608 17.5537 16.125 17.9679 16.125C18.2951 16.125 18.6295 16.2068 18.9399 16.3204C19.0985 15.9885 19.1959 15.625 19.2226 15.2271C18.9249 15.1544 18.7193 15.125 18.6134 15.125C18.1992 15.125 17.8634 14.7892 17.8634 14.375C17.8634 13.9608 18.1992 13.625 18.6134 13.625C18.8081 13.625 19.0284 13.6542 19.2504 13.6974C19.2505 13.4213 19.2415 13.1502 19.2112 12.8724C19.1407 12.227 18.958 11.6541 18.5269 11.1447C18.3727 10.9625 18.1809 10.7813 17.9402 10.6045C17.6063 10.3594 17.5344 9.88999 17.7796 9.55611C18.0247 9.22224 18.4941 9.15031 18.828 9.39546C18.9471 9.48292 19.0597 9.57282 19.1659 9.66506C19.2099 9.43686 19.2295 9.19817 19.2302 9.06087V7.18761C19.2302 6.56231 19.0238 6.23486 18.8123 6.0527C18.5801 5.85266 18.2496 5.75011 17.9054 5.75011C17.835 5.75011 17.659 5.78868 17.3513 5.92771C17.064 6.0575 16.7432 6.23612 16.4043 6.43125C16.3407 6.4679 16.2759 6.50544 16.2106 6.54328C15.9428 6.69843 15.666 6.85883 15.4209 6.98509C15.2663 7.06473 15.1052 7.14099 14.9495 7.19867C14.8058 7.25192 14.607 7.3125 14.3941 7.3125C14.0223 7.3125 13.7617 7.27877 13.5115 7.2464C13.4654 7.24043 13.4196 7.23449 13.3735 7.22883C13.0848 7.19336 12.7084 7.15636 12.0001 7.15636C11.2919 7.15636 10.9154 7.19336 10.6267 7.22883C10.5807 7.23449 10.5349 7.24042 10.4887 7.24639C10.2386 7.27877 9.97796 7.3125 9.6061 7.3125C9.39326 7.3125 9.19445 7.25191 9.05069 7.19866C8.89497 7.14098 8.73386 7.06471 8.57928 6.98506C8.33423 6.8588 8.05742 6.69839 7.78968 6.54325C7.72435 6.50539 7.65955 6.46784 7.59589 6.43118C7.25702 6.23603 6.93614 6.05741 6.64888 5.92761C6.34115 5.78856 6.16522 5.75 6.09485 5.75C5.75062 5.75 5.42007 5.85254 5.18787 6.05259C4.97643 6.23475 4.77004 6.56219 4.77004 7.1875V9.06088C4.7707 9.19819 4.79025 9.43686 4.83425 9.66506C4.94053 9.57281 5.05309 9.48292 5.1722 9.39546C5.50608 9.15031 5.97547 9.22224 6.22062 9.55612C6.46577 9.88999 6.39385 10.3594 6.05997 10.6045C5.81926 10.7813 5.62748 10.9625 5.47331 11.1447C5.04223 11.6541 4.85949 12.227 4.789 12.8724C4.75865 13.1502 4.74966 13.4213 4.74975 13.6975C4.97192 13.6543 5.19231 13.625 5.38719 13.625C5.80141 13.625 6.13719 13.9608 6.13719 14.375C6.13719 14.7892 5.80141 15.125 5.38719 15.125C5.28121 15.125 5.07549 15.1544 4.77758 15.2271C4.80434 15.625 4.90168 15.9885 5.06027 16.3203C5.37069 16.2068 5.70504 16.125 6.03224 16.125C6.44646 16.125 6.78224 16.4608 6.78224 16.875C6.78224 17.245 6.51433 17.5524 6.16192 17.6138Z',
  'M14.0365 12.6464C14.2015 12.38 14.5274 12.0625 15.0163 12.0625C15.5051 12.0625 15.831 12.38 15.996 12.6464C16.1681 12.9243 16.2501 13.2612 16.2501 13.5938C16.2501 13.9263 16.1681 14.2632 15.996 14.5411C15.831 14.8075 15.5051 15.125 15.0163 15.125C14.5274 15.125 14.2015 14.8075 14.0365 14.5411C13.8644 14.2632 13.7824 13.9263 13.7824 13.5938C13.7824 13.2612 13.8644 12.9243 14.0365 12.6464Z',
  'M9.01634 12.0625C8.52751 12.0625 8.20161 12.38 8.03658 12.6464C7.86445 12.9243 7.78247 13.2612 7.78247 13.5938C7.78247 13.9263 7.86445 14.2632 8.03658 14.5411C8.20161 14.8075 8.52751 15.125 9.01634 15.125C9.50518 15.125 9.83108 14.8075 9.9961 14.5411C10.1682 14.2632 10.2502 13.9263 10.2502 13.5938C10.2502 13.2612 10.1682 12.9243 9.9961 12.6464C9.83108 12.38 9.50518 12.0625 9.01634 12.0625Z',
  'M12.0196 14.9374C11.7284 14.9374 11.4307 14.9818 11.1784 15.0796C11.0546 15.1275 10.9032 15.2031 10.7699 15.3252C10.6361 15.4479 10.4632 15.6749 10.4632 15.9999C10.4632 16.3249 10.6361 16.5519 10.7699 16.6745C10.9032 16.7967 11.0546 16.8722 11.1784 16.9202C11.4307 17.018 11.7284 17.0624 12.0196 17.0624C12.3109 17.0624 12.6085 17.018 12.8609 16.9202C12.9846 16.8722 13.136 16.7967 13.2693 16.6745C13.4032 16.5519 13.5761 16.3249 13.5761 15.9999C13.5761 15.6749 13.4032 15.4479 13.2693 15.3252C13.136 15.2031 12.9846 15.1275 12.8609 15.0796C12.6085 14.9818 12.3109 14.9374 12.0196 14.9374Z',
]

function CatDraw({ timing, duration }: { timing: string; duration: number }) {
  const drawDur = duration * 0.75
  const fillDur = Math.max(duration * 0.25, 0.05)
  const fillDelay = drawDur
  return (
    <svg viewBox="0 0 24 24" style={{ width: '100%', height: '100%', display: 'block' }}>
      <style>{`
        @keyframes catStrokeDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes catFillIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <g fill="none" stroke="#1C274C" strokeWidth="0.4" strokeLinecap="round" strokeLinejoin="round">
        {CAT_PATHS.map((d, i) => (
          <path key={`stroke-${i}`} d={d} pathLength={1}
            style={{
              strokeDasharray: 1, strokeDashoffset: 1,
              animation: `catStrokeDraw ${drawDur}s ${timing} ${i * drawDur * 0.12}s forwards`,
            }} />
        ))}
      </g>
      <g fill="#1C274C" fillRule="evenodd" style={{ opacity: 0, animation: `catFillIn ${fillDur}s ease-out ${fillDelay}s forwards` }}>
        {CAT_PATHS.map((d, i) => <path key={`fill-${i}`} d={d} />)}
      </g>
    </svg>
  )
}

const FLICKER_EMOJI = ['🐱', '😺', '🐈']

function CatFlicker({ resetKey, timing, duration }: { resetKey: number; timing: string; duration: number }) {
  const [phase, setPhase] = useState(0) // 0,1,2 = emoji frames, 3 = final svg

  useEffect(() => {
    setPhase(0)
    const step = Math.max(duration / 4, 0.05) * 1000
    const timers = [1, 2, 3].map(p => setTimeout(() => setPhase(p), step * p))
    return () => timers.forEach(clearTimeout)
  }, [resetKey, duration])

  if (phase < 3) {
    return (
      <div key={phase} style={{ fontSize: '92cqw', lineHeight: 1, animation: `catFlickerPop 0.18s ${timing}` }}>
        <style>{`@keyframes catFlickerPop { from { transform: scale(0.5); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }`}</style>
        {FLICKER_EMOJI[phase]}
      </div>
    )
  }
  return (
    <div style={{ width: '100%', height: '100%', animation: `catFlickerSettle 0.3s ${timing} forwards` }}>
      <style>{`@keyframes catFlickerSettle { from { transform: scale(0.6); } to { transform: scale(1); } }`}</style>
      <CatMark />
    </div>
  )
}

// 3x2 grid of "tile" shards that fly outward from the cell center, revealing
// the cat that's been sitting underneath the whole time.
const SHARD_COLS = 3
const SHARD_ROWS = 2
const SHARDS = (() => {
  const shards: { poly: string; tx: number; ty: number; rot: number; delay: number }[] = []
  for (let r = 0; r < SHARD_ROWS; r++) {
    for (let c = 0; c < SHARD_COLS; c++) {
      const x0 = (c / SHARD_COLS) * 100
      const x1 = ((c + 1) / SHARD_COLS) * 100
      const y0 = (r / SHARD_ROWS) * 100
      const y1 = ((r + 1) / SHARD_ROWS) * 100
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const dx = (cx - 50) / 50
      const dy = (cy - 50) / 50
      const i = r * SHARD_COLS + c
      shards.push({
        poly: `polygon(${x0}% ${y0}%, ${x1}% ${y0}%, ${x1}% ${y1}%, ${x0}% ${y1}%)`,
        tx: dx * 90,
        ty: dy * 90,
        rot: i % 2 === 0 ? 22 : -22,
        delay: i * 0.02,
      })
    }
  }
  return shards
})()

function ShatterCell({ timing, duration }: { timing: string; duration: number }) {
  const [shardsVisible, setShardsVisible] = useState(true)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0 }}><CatMark /></div>
      {shardsVisible && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
          <style>{`
            @keyframes shardFly {
              0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
              10%  { transform: translate(calc(var(--tx) * 0.15), calc(var(--ty) * 0.15)) rotate(calc(var(--rot) * 0.15)); opacity: 1; }
              45%  { transform: translate(calc(var(--tx) * 0.35), calc(var(--ty) * 0.35)) rotate(calc(var(--rot) * 0.35)); opacity: 1; }
              75%  { transform: translate(calc(var(--tx) * 0.8), calc(var(--ty) * 0.8)) rotate(calc(var(--rot) * 0.85)); opacity: 1; }
              100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)); opacity: 0; }
            }
          `}</style>
          {SHARDS.map((s, i) => (
            <div
              key={i}
              onAnimationEnd={i === SHARDS.length - 1 ? () => setShardsVisible(false) : undefined}
              style={{
                position: 'absolute', inset: 0,
                background: CELL_BG,
                clipPath: s.poly,
                animation: `shardFly ${duration}s ${timing} ${s.delay}s forwards`,
                '--tx': `${s.tx}%`,
                '--ty': `${s.ty}%`,
                '--rot': `${s.rot}deg`,
              } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Page ----------------------------------------------------------------

const TARGETS = [
  { label: 'X mark', value: 'x' as const },
  { label: 'Cat', value: 'cat' as const },
]

const CAT_MODES = [
  { label: 'Pop', value: 'pop' as const },
  { label: 'Draw', value: 'draw' as const },
  { label: 'Flicker', value: 'flicker' as const },
  { label: 'Shatter', value: 'shatter' as const },
]

function Pills<T extends string>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(o => (
        <label key={o.value} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: value === o.value ? BROWN : 'white',
          color: value === o.value ? 'white' : BROWN,
          borderRadius: 20, padding: '7px 14px',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          border: `2px solid ${value === o.value ? BROWN : 'transparent'}`,
          transition: 'background 0.15s, color 0.15s',
        }}>
          <input
            type="radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ display: 'none' }}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

export default function AnimTest() {
  const navigate = useNavigate()
  const [target, setTarget] = useState<'x' | 'cat'>('x')
  const [catMode, setCatMode] = useState<'pop' | 'draw' | 'flicker' | 'shatter'>('pop')
  const [marked, setMarked] = useState(false)
  const [key, setKey] = useState(0)
  const [timing, setTiming] = useState(TIMINGS[0].value)
  const [duration, setDuration] = useState(0.5)

  const toggle = () => {
    if (!marked) setKey(k => k + 1)
    setMarked(m => !m)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#f0e8e0',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexShrink: 0 }}>
        <button
          onClick={() => navigate('/')}
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', fontSize: 18, color: BROWN_LIGHT, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
        >←</button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: BROWN, margin: 0 }}>Anim Test</h1>
      </div>

      {/* Cell */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 32px' }}>
        <div
          onClick={toggle}
          style={{
            width: '100%', maxWidth: 340, aspectRatio: '1',
            backgroundColor: CELL_BG,
            borderRadius: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            overflow: 'visible',
            position: 'relative',
            containerType: 'inline-size',
          } as CSSProperties}
        >
          {marked && target === 'x' && <XMark key={key} color="#462323" opacity={0.7} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'pop' && <CatPop key={key} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'draw' && <CatDraw key={key} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'flicker' && <CatFlicker key={key} resetKey={key} timing={timing} duration={duration} />}
          {marked && target === 'cat' && catMode === 'shatter' && <ShatterCell key={key} timing={timing} duration={duration} />}
        </div>
      </div>

      {/* Controls */}
      <div style={{ flexShrink: 0, padding: '0 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Target radio */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Testing</div>
          <Pills options={TARGETS} value={target} onChange={setTarget} />
        </div>

        {/* Cat mode radio */}
        {target === 'cat' && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cat style</div>
            <Pills options={CAT_MODES} value={catMode} onChange={setCatMode} />
          </div>
        )}

        {/* Timing radio */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Timing</div>
          <Pills options={TIMINGS} value={timing} onChange={setTiming} />
        </div>

        {/* Speed slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: BROWN_LIGHT, textTransform: 'uppercase', letterSpacing: 0.5 }}>Speed</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: BROWN }}>{duration.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min={0.05} max={5} step={0.05}
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            style={{ width: '100%', accentColor: BROWN }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: BROWN_LIGHT, opacity: 0.6, marginTop: 4 }}>
            <span>fast</span><span>slow</span>
          </div>
        </div>

        <p style={{ textAlign: 'center', color: BROWN_LIGHT, fontSize: 13, opacity: 0.6, margin: 0 }}>
          tap cell to toggle
        </p>
      </div>
    </div>
  )
}
