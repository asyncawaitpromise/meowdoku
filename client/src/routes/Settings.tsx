import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Save, UserPlus, Copy, Check, RotateCcw } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useGameStore, type CatAnimation } from '../store/gameStore.ts'
import Navbar from '../components/Navbar.tsx'

const CAT_ANIMATIONS: { value: CatAnimation; label: string }[] = [
  { value: 'draw',    label: 'Draw' },
  { value: 'pop',     label: 'Pop' },
  { value: 'shatter', label: 'Shatter' },
  { value: 'none',    label: 'None' },
]

const EZ_XS_RULES: { key: 'adjacent' | 'rowCol' | 'color'; label: string; desc: string }[] = [
  { key: 'adjacent', label: 'Adjacent',    desc: "Cells touching a found cat can't hide another" },
  { key: 'rowCol',   label: 'Row & column', desc: "The rest of that row and column can't hide another" },
  { key: 'color',    label: 'Color',        desc: "The rest of that color zone can't hide another" },
]

const THEMES = [
  'meowdoku', 'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate',
  'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
  'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
  'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
  'night', 'coffee', 'winter', 'dim', 'nord', 'sunset',
]

// A tiny swatch of the theme's own palette, scoped with its own data-theme —
// daisyUI resolves bg-base-100/bg-primary/etc. against whichever data-theme
// is closest, so this genuinely previews each theme rather than describing
// it with text.
function ThemeSwatch({ theme, selected, onSelect }: { theme: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-theme={theme}
      onClick={onSelect}
      className={`bg-base-100 text-base-content rounded-lg border-2 p-2 flex flex-col items-center gap-1.5 transition-colors ${selected ? 'border-primary' : 'border-base-300 hover:border-base-content/30'}`}
    >
      <div className="flex gap-1">
        <span className="w-4 h-4 rounded-full bg-primary" />
        <span className="w-4 h-4 rounded-full bg-secondary" />
        <span className="w-4 h-4 rounded-full bg-accent" />
        <span className="w-4 h-4 rounded-full bg-neutral" />
      </div>
      <span className="text-xs capitalize">{theme}</span>
    </button>
  )
}

function DeviceLinkCard() {
  const { generateDeviceLink } = useAuthStore()
  const [status, setStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    setStatus('generating')
    setError('')
    const result = await generateDeviceLink()
    if (result.success && result.code) {
      setLink(`${window.location.origin}/link/${result.code}`)
      setStatus('ready')
    } else {
      setError(result.error ?? 'Failed to generate a link')
      setStatus('error')
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="card bg-base-200 p-5 space-y-3">
      <h2 className="font-semibold">Sign in on another device</h2>
      <p className="text-sm opacity-70">
        Generate a one-time link, then open it on your other device to sign into this same account and share progress. It expires in 10 minutes.
      </p>
      {status === 'ready' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm bg-base-300 rounded px-3 py-2 break-all">{link}</span>
          <button className="btn btn-sm btn-ghost gap-1" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={handleGenerate}>New link</button>
        </div>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={handleGenerate} disabled={status === 'generating'}>
          {status === 'generating' ? <span className="loading loading-spinner loading-xs" /> : 'Generate link'}
        </button>
      )}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
    </div>
  )
}

export default function Settings() {
  const { user, updateProfile } = useAuthStore()
  const {
    doubleTapToPlaceCat, setDoubleTapToPlaceCat,
    catAnimation, setCatAnimation,
    ezXsMode, setEzXsMode, ezXsRules, setEzXsRule,
    resetProgress,
  } = useGameStore()
  const [resetDone, setResetDone] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [theme, setTheme] = useState(user?.theme ?? 'meowdoku')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [invisibleSaving, setInvisibleSaving] = useState(false)

  const handleToggleInvisible = async (checked: boolean) => {
    setInvisibleSaving(true)
    await updateProfile({ invisible: checked })
    setInvisibleSaving(false)
  }

  const handleReset = () => {
    resetProgress()
    setResetDone(true)
    setTimeout(() => setResetDone(false), 2000)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('saving')
    setError('')
    const result = await updateProfile({ name: name || undefined, theme })
    if (result.success) {
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } else {
      setError(result.error ?? 'Failed to save')
      setStatus('error')
    }
  }

  return (
    // data-theme here previews the tapped swatch across the whole page —
    // it's local component state, so it never touches the app-wide theme
    // (App.tsx's <html>/preferredTheme), doesn't survive a refresh, and
    // isn't saved to the player until Save changes is submitted.
    <div className="min-h-screen flex flex-col" data-theme={theme}>
      <Navbar />

      <main className="flex-1 p-6 max-w-lg mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Settings</h1>

        {user?.is_anon && (
          <div className="card bg-primary text-primary-content p-5 mb-6 space-y-3">
            <h2 className="font-semibold">You're playing as a guest</h2>
            <p className="text-sm opacity-90">
              Create an account with a username and password to save your progress across devices.
            </p>
            <Link to="/signup" className="btn btn-sm w-fit">
              <UserPlus size={14} /> Create account
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="card bg-base-200 p-5 space-y-4">
            <h2 className="font-semibold">Profile</h2>

            <div className="form-control">
              <label className="label"><span className="label-text">Display name</span></label>
              <input
                type="text"
                className="input input-bordered"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                maxLength={40}
              />
            </div>

            {!user?.is_anon && (
              <div className="form-control">
                <label className="label"><span className="label-text">Username</span></label>
                <input type="text" className="input input-bordered" value={user?.username ?? ''} disabled />
              </div>
            )}
          </div>

          <div className="card bg-base-200 p-5 space-y-4">
            <h2 className="font-semibold">Theme</h2>
            <p className="text-sm opacity-70 -mt-2">Tap a theme to preview it live before saving.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
              {THEMES.map(t => (
                <ThemeSwatch key={t} theme={t} selected={theme === t} onSelect={() => setTheme(t)} />
              ))}
            </div>
          </div>

          {error && <div className="alert alert-error text-sm py-2">{error}</div>}

          <button type="submit" className="btn btn-primary gap-2" disabled={status === 'saving'}>
            {status === 'saving'
              ? <span className="loading loading-spinner loading-sm" />
              : <Save size={16} />}
            {status === 'saved' ? 'Saved!' : 'Save changes'}
          </button>
        </form>

        <div className="card bg-base-200 p-5 space-y-3 mt-6">
          <h2 className="font-semibold">Privacy</h2>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm">
              Appear offline to friends
              <span className="block text-xs opacity-60 mt-0.5">
                Hides your online status and the "spectate" eye icon from friends — the same as going offline, without disconnecting.
              </span>
            </span>
            <input
              type="checkbox"
              className="toggle toggle-primary shrink-0"
              checked={!!user?.invisible}
              disabled={invisibleSaving}
              onChange={e => handleToggleInvisible(e.target.checked)}
            />
          </label>
        </div>

        <div className="card bg-base-200 p-5 space-y-3 mt-6">
          <h2 className="font-semibold">Placing cats</h2>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm">
              Double-tap a cell to place a cat
              <span className="block text-xs opacity-60 mt-0.5">
                Turn off if a quick second tap places a cat by accident. Tap and hold a cell — then drag to cat, X, or ? — always works either way.
              </span>
            </span>
            <input
              type="checkbox"
              className="toggle toggle-primary shrink-0"
              checked={doubleTapToPlaceCat}
              onChange={e => setDoubleTapToPlaceCat(e.target.checked)}
            />
          </label>
        </div>

        <div className="card bg-base-200 p-5 space-y-3 mt-6">
          <h2 className="font-semibold">Cat animation</h2>
          <div className="join">
            {CAT_ANIMATIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`btn btn-sm join-item ${catAnimation === value ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCatAnimation(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="card bg-base-200 p-5 space-y-3 mt-6">
          <h2 className="font-semibold">Ez X's</h2>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm">
              Auto-X cells a found cat rules out
            </span>
            <input
              type="checkbox"
              className="toggle toggle-primary shrink-0"
              checked={ezXsMode}
              onChange={e => setEzXsMode(e.target.checked)}
            />
          </label>
          {ezXsMode && (
            <div className="space-y-2 pl-1 pt-1 border-t border-base-300">
              {EZ_XS_RULES.map(({ key, label, desc }) => (
                <label key={key} className="flex items-center justify-between gap-4 cursor-pointer pt-2">
                  <span className="text-sm">
                    {label}
                    <span className="block text-xs opacity-60 mt-0.5">{desc}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm shrink-0"
                    checked={ezXsRules[key]}
                    onChange={e => setEzXsRule(key, e.target.checked)}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="card bg-base-200 p-5 space-y-3 mt-6">
          <h2 className="font-semibold">Reset progress</h2>
          <p className="text-sm opacity-70">Clears your local level progress on this device.</p>
          <button type="button" className="btn btn-sm btn-error btn-outline gap-2 w-fit" onClick={handleReset}>
            <RotateCcw size={14} /> {resetDone ? 'Reset!' : 'Reset progress'}
          </button>
        </div>

        <div className="mt-6">
          <DeviceLinkCard />
        </div>

        <Link to="/animtest" className="block text-center text-xs opacity-40 mt-6">
          Anim test
        </Link>
      </main>
    </div>
  )
}
