import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCoopStore } from '../store/coopStore.ts'

const ROUTES_WITHOUT_TOAST = ['/friends', '/coop/']

export default function CoopInviteToast() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { invite, joinSession, declineInvite } = useCoopStore()
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState('')

  const inviteSessionId = invite?.sessionId
  useEffect(() => {
    setAcceptError('')
  }, [inviteSessionId])

  const isHiddenOnThisRoute = ROUTES_WITHOUT_TOAST.some(route => pathname.startsWith(route))
  if (!invite || isHiddenOnThisRoute) return null

  const handleAccept = async () => {
    setAccepting(true)
    setAcceptError('')
    await joinSession(invite.sessionId)
    setAccepting(false)

    if (useCoopStore.getState().invite) {
      setAcceptError(useCoopStore.getState().error ?? 'Could not join the co-op match')
    } else {
      navigate(`/coop/${invite.sessionId}`)
    }
  }

  return (
    <div className="fixed bottom-3 right-3 z-[200] w-64 rounded-xl bg-base-100 border border-base-300 shadow-lg p-3 space-y-2 text-sm">
      <p>
        🐱 <strong>{invite.from.name || 'A friend'}</strong> invited you to a {invite.difficulty} co-op puzzle.
      </p>
      <div className="flex gap-2">
        <button className="btn btn-xs btn-primary" onClick={handleAccept} disabled={accepting}>
          {accepting ? <span className="loading loading-spinner loading-xs" /> : 'Join'}
        </button>
        <button
          className="btn btn-xs btn-ghost"
          onClick={() => declineInvite(invite.sessionId)}
          disabled={accepting}
        >
          Decline
        </button>
      </div>
      {acceptError && <p className="text-xs text-error">{acceptError}</p>}
    </div>
  )
}
