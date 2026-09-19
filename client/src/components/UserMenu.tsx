import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Settings, LogOut, UserPlus, Users } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useFriendsStore } from '../store/friendsStore.ts'

// The one dropdown menu for a signed-in user's account actions (Friends,
// Settings, sign out). Shared by Navbar and Home so both surfaces navigate
// to the same places instead of drifting into separate settings UIs.
export default function UserMenu({ trigger }: { trigger: ReactNode }) {
  const { user, signOut } = useAuthStore()
  const pendingRequestCount = useFriendsStore(s => s.requests.length)

  if (!user) return null

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button">{trigger}</div>
      <ul
        tabIndex={0}
        className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-48"
      >
        <li className="menu-title text-xs opacity-50 truncate px-4 py-1">
          {user.name || user.username || 'Guest'}
        </li>
        {user.is_anon && (
          <li>
            <Link to="/signup">
              <UserPlus size={14} /> Create account
            </Link>
          </li>
        )}
        <li>
          <Link to="/friends" className="justify-between">
            <span className="flex items-center gap-2"><Users size={14} /> Friends</span>
            {pendingRequestCount > 0 && (
              <span className="badge badge-primary badge-sm">{pendingRequestCount}</span>
            )}
          </Link>
        </li>
        <li>
          <Link to="/settings">
            <Settings size={14} /> Settings
          </Link>
        </li>
        <li>
          <button onClick={signOut}>
            <LogOut size={14} /> Sign out
          </button>
        </li>
      </ul>
    </div>
  )
}
