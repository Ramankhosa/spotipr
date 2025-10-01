'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

export default function Header() {
  const { user, logout, isLoading } = useAuth()

  const handleSignOut = () => {
    logout()
  }

  if (isLoading) {
    return (
      <header className="bg-white shadow-sm border-b border-gpt-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-gpt-gray-900">
                Spotipr
              </Link>
            </div>
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gpt-blue-600"></div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white shadow-sm border-b border-gpt-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link href="/dashboard" className="text-xl font-bold text-gpt-gray-900">
              Spotipr
            </Link>
          </div>

          {user && (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                  {user.email?.charAt(0) || 'U'}
                </div>
                <span className="text-sm text-gpt-gray-700">
                  {user.email}
                </span>
              </div>

              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
