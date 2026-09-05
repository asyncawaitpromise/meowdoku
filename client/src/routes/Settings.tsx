import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Save, UserPlus, Copy, Check } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import Navbar from '../components/Navbar.tsx'

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
  const [name, setName] = useState(user?.name ?? '')
  const [theme, setTheme] = useState(user?.theme ?? 'meowdoku')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

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
    <div className="min-h-screen flex flex-col">
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

        <div className="mt-6">
          <DeviceLinkCard />
        </div>
      </main>
    </div>
  )
}
