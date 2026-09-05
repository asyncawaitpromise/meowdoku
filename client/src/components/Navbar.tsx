import { Link } from 'react-router-dom'
import { Home, Settings, LogOut, User, UserPlus, Users } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useFriendsStore } from '../store/friendsStore.ts'
import { useSharesStore } from '../store/sharesStore.ts'

export default function Navbar() {
  const { user, token, signOut } = useAuthStore()
  const pendingRequestCount = useFriendsStore(s => s.requests.length)
  const shareCount = useSharesStore(s => s.shares.length)
  const isAuthenticated = !!user && !!token

  return (
    <div className="navbar bg-base-200 px-4">
      <div className="navbar-start">
        <Link to="/" className="btn btn-ghost text-xl font-bold gap-1.5">
          <span aria-hidden="true">🐱</span> Meowdoku
        </Link>
      </div>

      <div className="navbar-end gap-2">
        {isAuthenticated ? (
          <>
            <Link to="/dashboard" className="btn btn-ghost btn-sm gap-1 hidden sm:flex">
              <Home size={15} />
              Dashboard
              {shareCount > 0 && (
                <span className="badge badge-primary badge-sm">{shareCount}</span>
              )}
            </Link>

            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-ghost btn-circle">
                <User size={20} />
              </div>
              <ul
                tabIndex={0}
                className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-48"
              >
                <li className="menu-title text-xs opacity-50 truncate px-4 py-1">
                  {user.is_anon ? 'Guest' : (user.name || user.username)}
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
          </>
        ) : (
          <>
            <Link to="/signin" className="btn btn-ghost btn-sm">Sign in</Link>
            <Link to="/signup" className="btn btn-primary btn-sm">Sign up</Link>
          </>
        )}
      </div>
    </div>
  )
}
