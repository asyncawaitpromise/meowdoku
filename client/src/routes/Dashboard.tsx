import { useEffect, useState } from 'react'
import { Activity } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import Navbar from '../components/Navbar.tsx'

export default function Dashboard() {
  const { user, token } = useAuthStore()
  const [sseStatus, setSseStatus] = useState<'idle' | 'connected' | 'error'>('idle')
  const [events, setEvents] = useState<string[]>([])

  // SSE example — connect to the event stream
  useEffect(() => {
    if (!token) return
    const es = new EventSource(`/api/sse/stream?token=${encodeURIComponent(token)}`)

    es.addEventListener('connected', () => {
      setSseStatus('connected')
    })

    es.addEventListener('update', (e) => {
      setEvents(prev => [`${new Date().toLocaleTimeString()}: ${e.data}`, ...prev].slice(0, 10))
    })

    es.onerror = () => setSseStatus('error')

    return () => es.close()
  }, [token])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

        {/* User info */}
        <div className="card bg-base-200 p-5 mb-6">
          <h2 className="font-semibold mb-3">Signed in as</h2>
          <div className="text-sm space-y-1 opacity-70">
            <p><span className="font-medium">Email:</span> {user?.email}</p>
            {user?.name && <p><span className="font-medium">Name:</span> {user.name}</p>}
            {!!user?.is_admin && <span className="badge badge-warning badge-sm">Admin</span>}
          </div>
        </div>

        {/* SSE example */}
        <div className="card bg-base-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} />
            <h2 className="font-semibold">Live Events (SSE)</h2>
            <span className={`badge badge-sm ${sseStatus === 'connected' ? 'badge-success' : sseStatus === 'error' ? 'badge-error' : 'badge-ghost'}`}>
              {sseStatus}
            </span>
          </div>
          {events.length === 0 ? (
            <p className="text-sm opacity-50">No events yet. Emit one with <code>appEvents.emit(`update:{'{'}userId{'}'}`)</code> from the server.</p>
          ) : (
            <ul className="text-sm space-y-1 font-mono">
              {events.map((e, i) => <li key={i} className="opacity-70">{e}</li>)}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}
