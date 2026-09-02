import { useAuthStore } from '../store/authStore.ts'
import Navbar from '../components/Navbar.tsx'

export default function Dashboard() {
  const { user } = useAuthStore()

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
      </main>
    </div>
  )
}
