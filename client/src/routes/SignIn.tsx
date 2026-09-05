import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'

export default function SignIn() {
  const { signIn, redeemDeviceLink, isLoading } = useAuthStore()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [deviceCode, setDeviceCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [deviceError, setDeviceError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const result = await signIn(username, password)
    if (result.success) {
      navigate('/dashboard')
    } else {
      setError(result.error ?? 'Sign in failed')
    }
  }

  const handleRedeem = async (e: FormEvent) => {
    e.preventDefault()
    setDeviceError('')
    setRedeeming(true)
    const result = await redeemDeviceLink(deviceCode.trim())
    setRedeeming(false)
    if (result.success) navigate('/dashboard')
    else setDeviceError(result.error ?? 'Could not sign in with that code')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card bg-base-200 w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">Sign in</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Username</span></label>
            <input
              type="text"
              className="input input-bordered"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
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

        <p className="text-center text-sm mt-4 opacity-60">
          Don't have an account?{' '}
          <Link to="/signup" className="link link-primary">Sign up</Link>
        </p>

        <div className="divider text-xs opacity-40">or</div>

        <form onSubmit={handleRedeem} className="space-y-2">
          <label className="label -mb-1"><span className="label-text text-xs">Have a 5-character device link code?</span></label>
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered flex-1 min-w-0 font-mono uppercase tracking-widest"
              value={deviceCode}
              onChange={e => setDeviceCode(e.target.value)}
              maxLength={5}
              placeholder="ABCDE"
            />
            <button type="submit" className="btn btn-outline" disabled={redeeming || deviceCode.trim().length < 5}>
              {redeeming ? <span className="loading loading-spinner loading-sm" /> : 'Use code'}
            </button>
          </div>
          {deviceError && <div className="alert alert-error text-sm py-2">{deviceError}</div>}
        </form>
      </div>
    </div>
  )
}
