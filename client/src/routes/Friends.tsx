import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, X, UserMinus, Copy, Link as LinkIcon, Grid, Edit2, Users, Zap, Eye } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useFriendsStore, type Friend, type FriendProfile } from '../store/friendsStore.ts'
import { useMatchesStore } from '../store/matchesStore.ts'
import { useCoopStore } from '../store/coopStore.ts'
import type { Difficulty } from '../store/gameStore.ts'
import Navbar from '../components/Navbar.tsx'
import FriendQrModal from '../components/FriendQrModal.tsx'
import { useAutoFriendRequest } from '../hooks/useAutoFriendRequest.ts'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert']

const displayName = (profile: FriendProfile & { nickname?: string | null }) => profile.nickname || profile.name || (profile.is_anon ? 'Guest' : 'Player')

const puzzleSummary = (friend: Friend) =>
  DIFFICULTIES.map(d => `${d[0].toUpperCase()}${d.slice(1)} ${friend.progress.completedPuzzles[d]?.length ?? 0}`).join(' · ')

export default function Friends() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, updateProfile } = useAuthStore()
  const [draftName, setDraftName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault()
    if (!draftName.trim()) return
    setSavingName(true)
    setNameError('')
    const result = await updateProfile({ name: draftName.trim() })
    setSavingName(false)
    if (result.success) setEditingName(false)
    else setNameError(result.error ?? 'Failed to save name')
  }

  const { friends, requests, isLoading, error, fetchAll, sendRequest, acceptRequest, declineRequest, unfriend, setFriendNickname } = useFriendsStore()
  const { createMatch } = useMatchesStore()
  const { invite, createMatch: createCoopMatch, joinSession, declineInvite } = useCoopStore()
  const [acceptingCoop, setAcceptingCoop] = useState(false)
  const [coopAcceptError, setCoopAcceptError] = useState('')
  const [friendCodeFromLink] = useState(() => searchParams.get('code'))
  const autoRequestStatus = useAutoFriendRequest(friendCodeFromLink)
  const [showQr, setShowQr] = useState(false)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [challengingId, setChallengingId] = useState<string | null>(null)
  const [challengeDifficulty, setChallengeDifficulty] = useState<Difficulty>('medium')
  const [startingMatch, setStartingMatch] = useState(false)
  const [coopDifficulty, setCoopDifficulty] = useState<Difficulty>('medium')
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [renamingFriendId, setRenamingFriendId] = useState<string | null>(null)
  const [draftFriendNickname, setDraftFriendNickname] = useState('')

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (searchParams.has('code')) setSearchParams(params => { params.delete('code'); return params }, { replace: true })
  }, [searchParams, setSearchParams])

  const handleInviteCoop = async (friend: Friend) => {
    setInvitingId(friend.id)
    const sessionId = await createCoopMatch(coopDifficulty, friend.id)
    setInvitingId(null)
    if (sessionId) navigate(`/coop/${sessionId}`)
  }

  const handleAcceptInvite = async () => {
    if (!invite) return
    setAcceptingCoop(true)
    setCoopAcceptError('')
    await joinSession(invite.sessionId)
    setAcceptingCoop(false)
    // joinSession clears `invite` on success but leaves it in place on
    // failure — checking the store directly (rather than the closed-over
    // `invite`) reflects whichever actually happened.
    if (useCoopStore.getState().invite) {
      setCoopAcceptError(useCoopStore.getState().error ?? 'Could not join the co-op match')
    } else {
      navigate(`/coop/${invite.sessionId}`)
    }
  }

  const handleCopy = async () => {
    if (!user?.friend_code) return
    await navigator.clipboard.writeText(user.friend_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const friendLink = user?.friend_code ? `${window.location.origin}/friends?code=${user.friend_code}` : ''

  const handleCopyLink = async () => {
    if (!friendLink) return
    await navigator.clipboard.writeText(friendLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1500)
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

  const handleStartRenaming = (friend: Friend) => {
    setDraftFriendNickname(friend.nickname ?? '')
    setRenamingFriendId(friend.id)
  }

  const handleSaveFriendNickname = async (friend: Friend) => {
    await setFriendNickname(friend.id, draftFriendNickname)
    setRenamingFriendId(null)
  }

  const handleUnfriend = (friend: Friend) => {
    if (window.confirm(`Remove ${displayName(friend)} as a friend?`)) void unfriend(friend.id)
  }

  const handleStartChallenge = async (friend: Friend) => {
    setStartingMatch(true)
    const session = await createMatch(challengeDifficulty, friend.id)
    setStartingMatch(false)
    if (session) navigate(`/match/${session.id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">
        <h1 className="text-3xl font-bold">Friends</h1>

        {autoRequestStatus.kind === 'sending' && (
          <div className="alert text-sm py-2">Sending friend request…</div>
        )}
        {autoRequestStatus.kind === 'sent' && (
          <div className="alert alert-success text-sm py-2">Friend request sent from the link you opened.</div>
        )}
        {autoRequestStatus.kind === 'failed' && (
          <div className="alert alert-error text-sm py-2">{autoRequestStatus.message}</div>
        )}

        {invite && (
          <div className="card bg-primary text-primary-content p-5 space-y-3">
            <h2 className="font-semibold">🐱 Co-op invite</h2>
            <p className="text-sm opacity-90">
              {displayName(invite.from)} invited you to a {invite.difficulty} co-op puzzle.
            </p>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-neutral gap-1" onClick={handleAcceptInvite} disabled={acceptingCoop}>
                {acceptingCoop ? <span className="loading loading-spinner loading-xs" /> : <Check size={14} />} Accept
              </button>
              <button className="btn btn-sm btn-ghost gap-1" onClick={() => { setCoopAcceptError(''); declineInvite(invite.sessionId) }} disabled={acceptingCoop}>
                <X size={14} /> Decline
              </button>
            </div>
            {coopAcceptError && <div className="alert alert-error text-sm py-2">{coopAcceptError}</div>}
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
          {editingName ? (
            <form onSubmit={handleSaveName} className="flex gap-2">
              <input
                type="text"
                className="input input-sm input-bordered flex-1 min-w-0"
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                maxLength={40}
                autoFocus
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={savingName || !draftName.trim()}>
                {savingName ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingName(false)}>Cancel</button>
            </form>
          ) : (
            <p className="text-sm">
              You appear to friends as <strong>{user?.name}</strong>{' '}
              <button
                className="btn btn-xs btn-ghost gap-1"
                onClick={() => { setDraftName(user?.name ?? ''); setNameError(''); setEditingName(true) }}
              >
                <Edit2 size={12} /> Change
              </button>
            </p>
          )}
          {nameError && <div className="alert alert-error text-sm py-2">{nameError}</div>}
          <p className="text-sm opacity-70">Share this code, or send a link that fills it in for them.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg tracking-widest bg-base-300 rounded px-3 py-2">
              {user?.friend_code ?? '—'}
            </span>
            <button className="btn btn-sm btn-ghost gap-1" onClick={handleCopy} disabled={!user?.friend_code}>
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy code'}
            </button>
            <button className="btn btn-sm btn-ghost gap-1" onClick={handleCopyLink} disabled={!user?.friend_code}>
              <LinkIcon size={14} /> {linkCopied ? 'Copied!' : 'Copy friend link'}
            </button>
            <button className="btn btn-sm btn-ghost gap-1" onClick={() => setShowQr(true)} disabled={!friendLink}>
              <Grid size={14} /> Show QR code
            </button>
          </div>
        </div>

        <div className="card bg-base-200 p-5 space-y-3">
          <h2 className="font-semibold">Add a friend</h2>
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              type="text"
              className="input input-bordered flex-1 min-w-0"
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
                <li key={f.id} className="bg-base-100 rounded p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block w-2 h-2 rounded-full shrink-0 ${f.online ? 'bg-success' : 'bg-base-300'}`}
                        title={f.online ? 'Online' : 'Offline'}
                      />
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {displayName(f)}
                          {f.nickname && <span className="text-xs opacity-50 font-normal"> ({f.name})</span>}
                        </p>
                        <p className="text-xs opacity-60 truncate">
                          {f.progress.completedLevels.length} levels · {puzzleSummary(f)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        className="btn btn-sm btn-ghost btn-square"
                        title="Set a nickname for this friend"
                        onClick={() => handleStartRenaming(f)}
                      >
                        <Edit2 size={14} />
                      </button>
                      {f.online && f.inGame && (
                        <button
                          className="btn btn-sm btn-ghost btn-square text-primary"
                          title={`Spectate ${displayName(f)}'s game`}
                          onClick={() => navigate(`/spectate/${f.id}`)}
                        >
                          <Eye size={14} />
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-ghost btn-square"
                        title="Challenge to head-to-head"
                        onClick={() => setChallengingId(challengingId === f.id ? null : f.id)}
                      >
                        <Zap size={14} />
                      </button>
                      <button
                        className="btn btn-sm btn-ghost gap-1 px-2"
                        disabled={invitingId === f.id}
                        onClick={() => handleInviteCoop(f)}
                        title={`Invite ${displayName(f)} to a ${coopDifficulty} co-op match`}
                      >
                        {invitingId === f.id ? <span className="loading loading-spinner loading-xs" /> : '🐱 Co-op'}
                      </button>
                      <button className="btn btn-sm btn-ghost btn-square text-error" onClick={() => handleUnfriend(f)}>
                        <UserMinus size={14} />
                      </button>
                    </div>
                  </div>

                  {renamingFriendId === f.id && (
                    <form
                      className="flex items-center gap-2 bg-base-200 rounded p-2"
                      onSubmit={e => { e.preventDefault(); void handleSaveFriendNickname(f) }}
                    >
                      <input
                        type="text"
                        className="input input-sm input-bordered flex-1 min-w-0"
                        placeholder={f.name ?? 'Nickname (only you see this)'}
                        value={draftFriendNickname}
                        onChange={e => setDraftFriendNickname(e.target.value)}
                        maxLength={40}
                        autoFocus
                      />
                      <button type="submit" className="btn btn-sm btn-primary">Save</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenamingFriendId(null)}>Cancel</button>
                    </form>
                  )}

                  {challengingId === f.id && (
                    <div className="flex items-center gap-2 bg-base-200 rounded p-2">
                      <select
                        className="select select-sm select-bordered flex-1 min-w-0"
                        value={challengeDifficulty}
                        onChange={e => setChallengeDifficulty(e.target.value as Difficulty)}
                      >
                        {DIFFICULTIES.map(d => (
                          <option key={d} value={d}>{d[0].toUpperCase()}{d.slice(1)}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={startingMatch}
                        onClick={() => handleStartChallenge(f)}
                      >
                        {startingMatch ? <span className="loading loading-spinner loading-xs" /> : 'Challenge'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {showQr && <FriendQrModal friendLink={friendLink} onClose={() => setShowQr(false)} />}
    </div>
  )
}
