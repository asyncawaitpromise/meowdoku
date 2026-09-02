import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, X, UserMinus, Copy, Users } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useFriendsStore, type Friend, type FriendProfile } from '../store/friendsStore.ts'
import { useCoopStore } from '../store/coopStore.ts'
import type { Difficulty } from '../store/gameStore.ts'
import Navbar from '../components/Navbar.tsx'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert']

const displayName = (profile: FriendProfile) => profile.name || (profile.is_anon ? 'Guest' : 'Player')

const puzzleSummary = (friend: Friend) =>
  DIFFICULTIES.map(d => `${d[0].toUpperCase()}${d.slice(1)} ${friend.progress.completedPuzzles[d]?.length ?? 0}`).join(' · ')

export default function Friends() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { friends, requests, isLoading, error, fetchAll, sendRequest, acceptRequest, declineRequest, unfriend } = useFriendsStore()
  const { invite, createMatch, joinSession, declineInvite } = useCoopStore()
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [copied, setCopied] = useState(false)
  const [coopDifficulty, setCoopDifficulty] = useState<Difficulty>('medium')
  const [invitingId, setInvitingId] = useState<string | null>(null)

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const handleInviteCoop = async (friend: Friend) => {
    setInvitingId(friend.id)
    const sessionId = await createMatch(coopDifficulty, friend.id)
    setInvitingId(null)
    if (sessionId) navigate(`/coop/${sessionId}`)
  }

  const handleAcceptInvite = async () => {
    if (!invite) return
    await joinSession(invite.sessionId)
    navigate(`/coop/${invite.sessionId}`)
  }

  const handleCopy = async () => {
    if (!user?.friend_code) return
    await navigator.clipboard.writeText(user.friend_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()
    setSendError('')
    setSending(true)
    const result = await sendRequest(code.trim())
    setSending(false)
    if (result.success) setCode('')
    else setSendError(result.error ?? 'Failed to send request')
  }

  const handleUnfriend = (friend: Friend) => {
    if (window.confirm(`Remove ${displayName(friend)} as a friend?`)) void unfriend(friend.id)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">
        <h1 className="text-3xl font-bold">Friends</h1>

        {invite && (
          <div className="card bg-primary text-primary-content p-5 space-y-3">
            <h2 className="font-semibold">🐱 Co-op invite</h2>
            <p className="text-sm opacity-90">
              {displayName(invite.from)} invited you to a {invite.difficulty} co-op puzzle.
            </p>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-neutral gap-1" onClick={handleAcceptInvite}>
                <Check size={14} /> Accept
              </button>
              <button className="btn btn-sm btn-ghost gap-1" onClick={declineInvite}>
                <X size={14} /> Decline
              </button>
            </div>
          </div>
        )}

        <div className="card bg-base-200 p-5 space-y-3">
          <h2 className="font-semibold">Start a co-op match</h2>
          <p className="text-sm opacity-70">Pick a difficulty, then invite a friend below to share one board.</p>
          <select
            className="select select-bordered w-full max-w-xs"
            value={coopDifficulty}
            onChange={e => setCoopDifficulty(e.target.value as Difficulty)}
          >
            {DIFFICULTIES.map(d => (
              <option key={d} value={d}>{d[0].toUpperCase()}{d.slice(1)}</option>
            ))}
          </select>
        </div>

        <div className="card bg-base-200 p-5 space-y-3">
          <h2 className="font-semibold">Your friend code</h2>
          <p className="text-sm opacity-70">Share this code so others can add you.</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg tracking-widest bg-base-300 rounded px-3 py-2">
              {user?.friend_code ?? '—'}
            </span>
            <button className="btn btn-sm btn-ghost gap-1" onClick={handleCopy} disabled={!user?.friend_code}>
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="card bg-base-200 p-5 space-y-3">
          <h2 className="font-semibold">Add a friend</h2>
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              type="text"
              className="input input-bordered flex-1"
              placeholder="Enter friend code"
              value={code}
              onChange={e => setCode(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !code.trim()}>
              {sending ? <span className="loading loading-spinner loading-sm" /> : 'Send request'}
            </button>
          </form>
          {sendError && <div className="alert alert-error text-sm py-2">{sendError}</div>}
        </div>

        {requests.length > 0 && (
          <div className="card bg-base-200 p-5 space-y-3">
            <h2 className="font-semibold">Pending requests</h2>
            <ul className="space-y-2">
              {requests.map(r => (
                <li key={r.id} className="flex items-center justify-between bg-base-100 rounded p-3">
                  <span>{displayName(r.requester)}</span>
                  <div className="flex gap-2">
                    <button className="btn btn-sm btn-success btn-outline" onClick={() => acceptRequest(r.id)}>
                      <Check size={14} />
                    </button>
                    <button className="btn btn-sm btn-error btn-outline" onClick={() => declineRequest(r.id)}>
                      <X size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card bg-base-200 p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Users size={16} /> Your friends
          </h2>

          {error && <div className="alert alert-error text-sm py-2">{error}</div>}

          {isLoading && friends.length === 0 ? (
            <span className="loading loading-spinner loading-sm" />
          ) : friends.length === 0 ? (
            <p className="text-sm opacity-50">No friends yet. Add one above!</p>
          ) : (
            <ul className="space-y-2">
              {friends.map(f => (
                <li key={f.id} className="flex items-center justify-between bg-base-100 rounded p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${f.online ? 'bg-success' : 'bg-base-300'}`}
                      title={f.online ? 'Online' : 'Offline'}
                    />
                    <div>
                      <p className="font-medium">{displayName(f)}</p>
                      <p className="text-xs opacity-60">
                        {f.progress.completedLevels.length} levels · {puzzleSummary(f)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="btn btn-sm btn-primary gap-1"
                      disabled={invitingId === f.id || !f.online}
                      onClick={() => handleInviteCoop(f)}
                      title={f.online
                        ? `Invite ${displayName(f)} to a ${coopDifficulty} co-op match`
                        : `${displayName(f)} must be online to join a co-op match`}
                    >
                      {invitingId === f.id ? <span className="loading loading-spinner loading-xs" /> : '🐱 Co-op'}
                    </button>
                    <button className="btn btn-sm btn-ghost text-error" onClick={() => handleUnfriend(f)}>
                      <UserMinus size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}
