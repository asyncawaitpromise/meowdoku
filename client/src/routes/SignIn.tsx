import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn, GitHub } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'

export default function SignIn() {
  const { signIn, signInWithOAuth, isLoading } = useAuthStore()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const result = await signIn(email, password)
    if (result.success) {
      navigate('/dashboard')
    } else {
      setError(result.error ?? 'Sign in failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card bg-base-200 w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">Sign in</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Email</span></label>
            <input
              type="email"
              className="input input-bordered"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Password</span></label>
            <input
              type="password"
              className="input input-bordered"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="alert alert-error text-sm py-2">{error}</div>
          )}

          <button type="submit" className="btn btn-primary w-full gap-2" disabled={isLoading}>
            {isLoading ? <span className="loading loading-spinner loading-sm" /> : <LogIn size={16} />}
            Sign in
          </button>
        </form>

        <div className="divider text-xs opacity-40">or continue with</div>

        <div className="flex flex-col gap-2">
          <button
            className="btn btn-outline btn-sm gap-2"
            onClick={() => signInWithOAuth('github')}
          >
            <GitHub size={16} /> GitHub
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => signInWithOAuth('google')}
          >
            Google
          </button>
        </div>

        <p className="text-center text-sm mt-4 opacity-60">
          Don't have an account?{' '}
          <Link to="/signup" className="link link-primary">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
