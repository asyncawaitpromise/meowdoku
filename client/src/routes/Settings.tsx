import { useState, type FormEvent } from 'react'
import { Save } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import Navbar from '../components/Navbar.tsx'

const THEMES = [
  'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate',
  'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
  'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
  'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
  'night', 'coffee', 'winter', 'dim', 'nord', 'sunset',
]

export default function Settings() {
  const { user, updateProfile } = useAuthStore()
  const [name, setName] = useState(user?.name ?? '')
  const [theme, setTheme] = useState(user?.theme ?? 'night')
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
              />
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text">Email</span></label>
              <input type="email" className="input input-bordered" value={user?.email ?? ''} disabled />
            </div>
          </div>

          <div className="card bg-base-200 p-5 space-y-4">
            <h2 className="font-semibold">Theme</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
              {THEMES.map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="theme"
                    className="radio radio-xs radio-primary"
                    checked={theme === t}
                    onChange={() => setTheme(t)}
                  />
                  <span className="text-sm">{t}</span>
                </label>
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
      </main>
    </div>
  )
}
