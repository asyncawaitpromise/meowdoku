import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserPlus } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'

export default function SignUp() {
  const { user, signUp, promote, isLoading } = useAuthStore()
  const isPromoting = !!user?.is_anon
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const result = isPromoting
      ? await promote(username, password, passwordConfirm, name || undefined)
      : await signUp(username, password, passwordConfirm, name || undefined)
    if (result.success) {
      navigate('/dashboard')
    } else {
      setError(result.error ?? 'Sign up failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card bg-base-200 w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">
          {isPromoting ? 'Save your progress' : 'Create account'}
        </h1>
        {isPromoting && (
          <p className="text-sm opacity-60 mb-4 text-center">
            Add a username and password to keep your progress and sign in anywhere.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Nickname (optional)</span></label>
            <input
              type="text"
              className="input input-bordered"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
              maxLength={40}
            />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Username</span></label>
            <input
              type="text"
              className="input input-bordered"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              pattern="[a-zA-Z0-9_]{3,20}"
              title="3-20 characters: letters, numbers, or underscore"
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
              autoComplete="new-password"
              minLength={8}
            />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Confirm password</span></label>
            <input
              type="password"
              className="input input-bordered"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="alert alert-error text-sm py-2">{error}</div>
          )}

          <button type="submit" className="btn btn-primary w-full gap-2" disabled={isLoading}>
            {isLoading ? <span className="loading loading-spinner loading-sm" /> : <UserPlus size={16} />}
            {isPromoting ? 'Save progress' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm mt-4 opacity-60">
          Already have an account?{' '}
          <Link to="/signin" className="link link-primary">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
