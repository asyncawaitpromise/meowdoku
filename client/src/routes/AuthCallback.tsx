import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.ts'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { setTokenFromCallback } = useAuthStore()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const error = params.get('error')

    if (error) {
      navigate('/signin?error=' + encodeURIComponent(error), { replace: true })
      return
    }

    if (token) {
      setTokenFromCallback(token).then(() => navigate('/dashboard', { replace: true }))
    } else {
      navigate('/signin', { replace: true })
    }
  }, [navigate, setTokenFromCallback])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="loading loading-spinner loading-lg"></span>
    </div>
  )
}
