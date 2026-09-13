import { Link } from 'react-router-dom'
import { Home, User } from 'react-feather'
import { useAuthStore } from '../store/authStore.ts'
import { useSharesStore } from '../store/sharesStore.ts'
import UserMenu from './UserMenu.tsx'

export default function Navbar() {
  const { user, token } = useAuthStore()
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

            <UserMenu trigger={
              <div className="btn btn-ghost btn-circle">
                <User size={20} />
              </div>
            } />
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
