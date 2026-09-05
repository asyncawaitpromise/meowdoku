import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.ts'

// Landing page for a "sign in on another device" link (see Settings.tsx's
// generator). Redeeming replaces this device's current guest session with
// the linked account outright — that's the point, sharing progress across
// devices — so it fires once on mount with no confirmation step.
export default function DeviceLink() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { redeemDeviceLink } = useAuthStore()
  const [error, setError] = useState('')
  const attempted = useRef(false)

  useEffect(() => {
    if (!code || attempted.current) return
    attempted.current = true
    redeemDeviceLink(code).then(result => {
      if (result.success) navigate('/dashboard', { replace: true })
      else setError(result.error ?? 'This link is invalid or has expired')
    })
  }, [code, redeemDeviceLink, navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card bg-base-200 w-full max-w-sm p-8 text-center space-y-3">
          <span className="text-4xl" aria-hidden="true">🙀</span>
          <p className="font-semibold">{error}</p>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/settings')}>Go to settings</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="loading loading-spinner loading-lg" />
    </div>
  )
}
