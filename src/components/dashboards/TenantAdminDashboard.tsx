'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'

interface ATIToken {
  id: string
  fingerprint: string
  status: string
  expires_at: string | null
  max_uses: number | null
  usage_count: number
  plan_tier: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export default function TenantAdminDashboard() {
  const { user, logout } = useAuth()
  const [tokens, setTokens] = useState<ATIToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [newToken, setNewToken] = useState({
    expires_at: '',
    max_uses: '',
    notes: ''
  })
  const [editingToken, setEditingToken] = useState<ATIToken | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editForm, setEditForm] = useState({
    status: '',
    expires_at: '',
    max_uses: '',
    notes: ''
  })

  useEffect(() => {
    fetchTokens()
  }, [])

  const fetchTokens = async () => {
    try {
      setError(null)
      const response = await fetch('/api/v1/admin/ati/list', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setTokens(data)
      } else {
        const errorData = await response.json().catch(() => ({}))
        setError(errorData.message || `Failed to load tokens (${response.status})`)
        setTokens([])
      }
    } catch (error) {
      console.error('Failed to fetch tokens:', error)
      setError('Network error: Unable to connect to server')
      setTokens([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      const response = await fetch('/api/v1/admin/ati/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          expires_at: newToken.expires_at || undefined,
          max_uses: newToken.max_uses ? parseInt(newToken.max_uses) : undefined,
          notes: newToken.notes || undefined
        })
      })

      if (response.ok) {
        const data = await response.json()
        setCreatedToken(data.token_display_once)
        setNewToken({ expires_at: '', max_uses: '', notes: '' })
        setShowCreateForm(false)
        fetchTokens()

        // Clear the displayed token after 30 seconds for security
        setTimeout(() => setCreatedToken(null), 30000)
      } else {
        const error = await response.json()
        alert(error.message || 'Failed to create token')
      }
    } catch (error) {
      console.error('Failed to create token:', error)
      alert('Failed to create token')
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this token? Users will no longer be able to use it.')) {
      return
    }

    try {
      const response = await fetch(`/api/v1/admin/ati/${tokenId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        fetchTokens()
      } else {
        alert('Failed to revoke token')
      }
    } catch (error) {
      console.error('Failed to revoke token:', error)
      alert('Failed to revoke token')
    }
  }

  const handleEditToken = (token: ATIToken) => {
    setEditingToken(token)
    setEditForm({
      status: token.status,
      expires_at: token.expires_at || '',
      max_uses: token.max_uses?.toString() || '',
      notes: token.notes || ''
    })
  }

  const handleUpdateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingToken) return

    setIsUpdating(true)

    try {
      const response = await fetch(`/api/v1/admin/ati/${editingToken.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          status: editForm.status || undefined,
          expires_at: editForm.expires_at || undefined,
          max_uses: editForm.max_uses ? parseInt(editForm.max_uses) : undefined,
          notes: editForm.notes || undefined
        })
      })

      if (response.ok) {
        setEditingToken(null)
        setEditForm({ status: '', expires_at: '', max_uses: '', notes: '' })
        fetchTokens()
      } else {
        const error = await response.json()
        alert(error.message || 'Failed to update token')
      }
    } catch (error) {
      console.error('Failed to update token:', error)
      alert('Failed to update token')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Tenant Admin Dashboard</h1>
              <p className="text-gray-600">Manage ATI tokens and team access for {user?.ati_id}</p>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => window.location.href = '/tenant-admin/analytics'}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                📊 Analytics
              </button>
              <span className="text-sm text-gray-500">Role: {user?.role}</span>
              <button
                onClick={logout}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Error Display */}
        {error && (
          <div className="mb-8 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-800">
                  Error Loading ATI Tokens
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                  <button
                    onClick={fetchTokens}
                    className="mt-2 inline-flex items-center px-3 py-1 border border-red-300 text-sm font-medium rounded-md text-red-800 bg-red-100 hover:bg-red-200"
                  >
                    Try Again
                  </button>
                </div>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={() => setError(null)}
                  className="inline-flex rounded-md p-1.5 text-red-400 hover:bg-red-100"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Token Display Warning */}
        {createdToken && (
          <div className="mb-8 bg-yellow-50 border border-yellow-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-yellow-800">
                  ATI Token Created Successfully
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p className="font-mono bg-yellow-100 p-2 rounded break-all">{createdToken}</p>
                  <p className="mt-2">
                    <strong>⚠️ Security Warning:</strong> Copy this token now and share it securely with your team members.
                    This token will never be shown again for security reasons.
                  </p>
                  <button
                    onClick={() => navigator.clipboard.writeText(createdToken)}
                    className="mt-2 inline-flex items-center px-3 py-1 border border-yellow-300 text-sm font-medium rounded-md text-yellow-800 bg-yellow-100 hover:bg-yellow-200"
                  >
                    Copy to Clipboard
                  </button>
                </div>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={() => setCreatedToken(null)}
                  className="inline-flex rounded-md p-1.5 text-yellow-400 hover:bg-yellow-100"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5 mb-8">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">A</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.filter(t => t.status === 'ACTIVE' || t.status === 'ISSUED').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">U</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Usage</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.reduce((sum, t) => sum + t.usage_count, 0)}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">R</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Revoked Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.filter(t => t.status === 'REVOKED').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">S</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Suspended Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.filter(t => t.status === 'SUSPENDED').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">T</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">{tokens.length}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Token Section */}
        <div className="bg-white shadow rounded-lg mb-8">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Create ATI Token</h3>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                {showCreateForm ? 'Cancel' : '+ Generate Token'}
              </button>
            </div>

            {showCreateForm && (
              <form onSubmit={handleCreateToken} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="expires_at" className="block text-sm font-medium text-gray-700">
                      Expiration Date (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      id="expires_at"
                      value={newToken.expires_at}
                      onChange={(e) => setNewToken(prev => ({ ...prev, expires_at: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="max_uses" className="block text-sm font-medium text-gray-700">
                      Max Uses (Optional)
                    </label>
                    <input
                      type="number"
                      id="max_uses"
                      value={newToken.max_uses}
                      onChange={(e) => setNewToken(prev => ({ ...prev, max_uses: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Unlimited if empty"
                      min="1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                      Notes (Optional)
                    </label>
                    <input
                      type="text"
                      id="notes"
                      value={newToken.notes}
                      onChange={(e) => setNewToken(prev => ({ ...prev, notes: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Purpose or recipient"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false)
                      setNewToken({ expires_at: '', max_uses: '', notes: '' })
                    }}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isCreating ? 'Generating...' : 'Generate Token'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Edit Token Section */}
        {editingToken && (
          <div className="bg-white shadow rounded-lg mb-8">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Edit ATI Token: {editingToken.fingerprint}
                </h3>
                <button
                  onClick={() => setEditingToken(null)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>

              <form onSubmit={handleUpdateToken} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="edit_status" className="block text-sm font-medium text-gray-700">
                      Status
                    </label>
                    <select
                      id="edit_status"
                      value={editForm.status}
                      onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="SUSPENDED">Suspended</option>
                      <option value="ISSUED">Issued</option>
                      <option value="REVOKED">Revoked</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="USED_UP">Used Up</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="edit_expires_at" className="block text-sm font-medium text-gray-700">
                      Expiration Date (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      id="edit_expires_at"
                      value={editForm.expires_at}
                      onChange={(e) => setEditForm(prev => ({ ...prev, expires_at: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="edit_max_uses" className="block text-sm font-medium text-gray-700">
                      Max Uses (Optional)
                    </label>
                    <input
                      type="number"
                      id="edit_max_uses"
                      value={editForm.max_uses}
                      onChange={(e) => setEditForm(prev => ({ ...prev, max_uses: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Unlimited if empty"
                      min="1"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="edit_notes" className="block text-sm font-medium text-gray-700">
                    Notes (Optional)
                  </label>
                  <input
                    type="text"
                    id="edit_notes"
                    value={editForm.notes}
                    onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="Purpose or recipient"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setEditingToken(null)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isUpdating ? 'Updating...' : 'Update Token'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tokens List */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900">ATI Token Management</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Manage access tokens for your organization
            </p>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading tokens...</p>
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-500">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No tokens yet</h3>
              <p className="mt-1 text-sm text-gray-500">Create your first ATI token to onboard team members.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {tokens.map((token) => (
                <li key={token.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-gray-900 font-mono">
                            {token.fingerprint}
                          </h4>
                          <div className="mt-1 flex items-center space-x-4 text-xs text-gray-500">
                            <span>Status: {token.status}</span>
                            {token.max_uses && (
                              <span>Usage: {token.usage_count}/{token.max_uses}</span>
                            )}
                            {token.plan_tier && (
                              <span>Tier: {token.plan_tier}</span>
                            )}
                          </div>
                          {token.expires_at && (
                            <div className="mt-1 text-xs text-gray-500">
                              Expires: {new Date(token.expires_at).toLocaleString()}
                            </div>
                          )}
                          {token.notes && (
                            <div className="mt-1 text-xs text-gray-500">
                              Notes: {token.notes}
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            token.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : token.status === 'INACTIVE'
                              ? 'bg-gray-100 text-gray-800'
                              : token.status === 'SUSPENDED'
                              ? 'bg-orange-100 text-orange-800'
                              : token.status === 'ISSUED'
                              ? 'bg-blue-100 text-blue-800'
                              : token.status === 'REVOKED'
                              ? 'bg-red-100 text-red-800'
                              : token.status === 'EXPIRED'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {token.status}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        Created {new Date(token.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEditToken(token)}
                        className="inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      {(token.status === 'ISSUED' || token.status === 'ACTIVE') && (
                        <button
                          onClick={() => handleRevokeToken(token.id)}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
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
