'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'

interface PlatformUser {
  id: string
  email: string
  name: string | null
  roles: string[]
  status: string
  emailVerified: boolean
  emailDraftingEnabled: boolean
  createdAt: string
  tenant: {
    id: string
    name: string
    atiId: string
    status: string
  } | null
}

export default function SuperAdminUsersPage() {
  const { token } = useAuth()
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async (searchQuery = '') => {
    if (!token) return
    try {
      setLoading(true)
      const url = searchQuery
        ? `/api/v1/platform/users?q=${encodeURIComponent(searchQuery)}`
        : '/api/v1/platform/users'
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Failed to fetch users')
      }
      const data = await res.json()
      setUsers(data.users || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleStatusChange = async (user: PlatformUser) => {
    if (!token) return
    const nextStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    try {
      const res = await fetch(`/api/v1/platform/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'change_status', status: nextStatus })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Failed to update status')
      }
      fetchUsers(query)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const handleEmailChange = async (user: PlatformUser) => {
    if (!token) return
    const newEmail = window.prompt(`Update email for ${user.name || user.email}`, user.email)
    if (!newEmail || newEmail.trim() === user.email) return

    try {
      const res = await fetch(`/api/v1/platform/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'change_email', newEmail: newEmail.trim() })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Failed to update email')
      }
      fetchUsers(query)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update email')
    }
  }

  const handleEmailDraftingToggle = async (user: PlatformUser) => {
    if (!token) return
    try {
      const res = await fetch(`/api/v1/platform/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'set_email_drafting_enabled',
          enabled: !user.emailDraftingEnabled
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Failed to update email drafting access')
      }
      fetchUsers(query)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update email drafting access')
    }
  }

  const handleResendVerification = async (user: PlatformUser) => {
    if (!token) return
    try {
      const res = await fetch(`/api/v1/platform/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'resend_verification_email' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.message || 'Failed to resend verification email')
      }
      alert(data.message || 'Verification email sent successfully')
      fetchUsers(query)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resend verification email')
    }
  }

  const handleForceVerify = async (user: PlatformUser) => {
    if (!token) return
    try {
      const res = await fetch(`/api/v1/platform/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'force_mark_email_verified' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.message || 'Failed to mark email as verified')
      }
      alert(data.message || 'User email marked as verified')
      fetchUsers(query)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to mark email as verified')
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Platform User Management</h1>
            <p className="mt-2 text-sm text-slate-400">
              Update tenant user email addresses and control who can submit email drafting requests.
            </p>
          </div>
          <div className="flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by email, name, or tenant"
              className="w-80 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
            />
            <button
              onClick={() => fetchUsers(query)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Search
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/70 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Email Drafting</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading users...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No users found.</td>
                  </tr>
                ) : users.map((user) => (
                  <tr key={user.id} className="align-top">
                    <td className="px-4 py-4">
                      <div className="font-medium text-white">{user.name || 'Unnamed user'}</div>
                      <div className="text-slate-400">{user.email}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${user.emailVerified ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {user.emailVerified ? 'Verified' : 'Verification Pending'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-300">
                      <div>{user.tenant?.name || 'No tenant'}</div>
                      <div className="text-xs text-slate-500">{user.tenant?.atiId || 'N/A'}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-300">{user.roles[0] || 'UNKNOWN'}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[11px] ${user.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[11px] ${user.emailDraftingEnabled ? 'bg-indigo-500/15 text-indigo-300' : 'bg-slate-700 text-slate-300'}`}>
                        {user.emailDraftingEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleEmailChange(user)}
                          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                        >
                          Edit Email
                        </button>
                        {!user.emailVerified && (
                          <button
                            onClick={() => handleResendVerification(user)}
                            className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10"
                          >
                            Resend Verification
                          </button>
                        )}
                        {!user.emailVerified && (
                          <button
                            onClick={() => handleForceVerify(user)}
                            className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/10"
                          >
                            Force Verify
                          </button>
                        )}
                        <button
                          onClick={() => handleEmailDraftingToggle(user)}
                          className="rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                        >
                          {user.emailDraftingEnabled ? 'Disable Email Drafting' : 'Enable Email Drafting'}
                        </button>
                        <button
                          onClick={() => handleStatusChange(user)}
                          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                        >
                          {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
