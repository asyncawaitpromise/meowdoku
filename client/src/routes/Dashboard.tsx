import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Gift, X } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useSharesStore } from '../store/sharesStore.ts'
import Navbar from '../components/Navbar.tsx'

const displayName = (name: string | null, isAnon: number) => name || (isAnon ? 'Guest' : 'Player')

export default function Dashboard() {
  const { user } = useAuthStore()
  const { shares, isLoading, error, fetchAll, dismiss } = useSharesStore()

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>

        {/* User info */}
        <div className="card bg-base-200 p-5">
          <h2 className="font-semibold mb-3">Signed in as</h2>
          <div className="text-sm space-y-1 opacity-70">
            <p><span className="font-medium">Email:</span> {user?.email}</p>
            {user?.name && <p><span className="font-medium">Name:</span> {user.name}</p>}
            {!!user?.is_admin && <span className="badge badge-warning badge-sm">Admin</span>}
          </div>
        </div>

        {/* Shared puzzles */}
        <div className="card bg-base-200 p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Gift size={16} /> Shared with you
          </h2>

          {error && <div className="alert alert-error text-sm py-2">{error}</div>}

          {isLoading && shares.length === 0 ? (
            <span className="loading loading-spinner loading-sm" />
          ) : shares.length === 0 ? (
            <p className="text-sm opacity-50">No puzzles shared with you yet.</p>
          ) : (
            <ul className="space-y-2">
              {shares.map(share => (
                <li key={share.id} className="flex flex-wrap items-center justify-between gap-2 bg-base-100 rounded p-3">
                  <span className="text-sm min-w-0 truncate">
                    <span className="font-medium">{displayName(share.from.name, share.from.is_anon)}</span> sent you a puzzle
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link to={`/shared/${share.shareCode}`} className="btn btn-sm btn-primary">Play</Link>
                    <button className="btn btn-sm btn-ghost btn-square text-error" onClick={() => dismiss(share.id)}>
                      <X size={14} />
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
