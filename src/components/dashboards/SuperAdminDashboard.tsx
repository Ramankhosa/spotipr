'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

interface Tenant {
  id: string
  name: string
  ati_id: string
  status: string
  user_count: number
  ati_token_count: number
  created_at: string
}

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateTenant, setShowCreateTenant] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [isCheckingNotifications, setIsCheckingNotifications] = useState(false)
  const [notificationStatus, setNotificationStatus] = useState<{
    expiringTokensCount: number
    tokens: any[]
  } | null>(null)
  const [createdTokenInfo, setCreatedTokenInfo] = useState<{
    token: string
    fingerprint: string
    tenantName: string
  } | null>(null)
  const [newTenant, setNewTenant] = useState({
    name: '',
    atiId: '',
    generateInitialToken: true, // Re-enable ATI token generation
    expires_at: '',
    max_uses: '',
    plan_tier: 'BASIC',
    notes: 'Initial tenant onboarding token'
  })
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    fetchTenants()
  }, [])

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/v1/platform/tenants', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setTenants(data)
      }
    } catch (error) {
      console.error('Failed to fetch tenants:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTenant.name.trim() || !newTenant.atiId.trim()) {
      alert('Please fill in all fields')
      return
    }

    setIsCreating(true)

    try {
      const requestBody: any = {
        name: newTenant.name.trim(),
        atiId: newTenant.atiId.trim().toUpperCase(),
        generateInitialToken: true // Enable ATI token generation for tenant onboarding
      }

      if (newTenant.generateInitialToken) {
        const initialTokenConfig: any = {}

        if (newTenant.expires_at && newTenant.expires_at.trim()) {
          initialTokenConfig.expires_at = newTenant.expires_at.trim()
        }

        if (newTenant.max_uses && newTenant.max_uses.trim()) {
          initialTokenConfig.max_uses = parseInt(newTenant.max_uses.trim())
        }

        if (newTenant.plan_tier && newTenant.plan_tier.trim()) {
          initialTokenConfig.plan_tier = newTenant.plan_tier.trim()
        }

        if (newTenant.notes && newTenant.notes.trim()) {
          initialTokenConfig.notes = newTenant.notes.trim()
        }

        // Only include initialTokenConfig if it has at least one property
        if (Object.keys(initialTokenConfig).length > 0) {
          requestBody.initialTokenConfig = initialTokenConfig
        }
      }

      const response = await fetch('/api/v1/platform/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (response.ok) {
        setShowCreateTenant(false)
        setNewTenant({
          name: '',
          atiId: '',
          generateInitialToken: true,
          expires_at: '',
          max_uses: '',
          plan_tier: 'BASIC',
          notes: 'Initial tenant onboarding token'
        })
        fetchTenants()

        // Show success message with token info if generated
        if (data.initial_token) {
          setCreatedTokenInfo({
            token: data.initial_token.token_display_once,
            fingerprint: data.initial_token.fingerprint,
            tenantName: data.name
          })
          setShowSuccessModal(true)
        }
      } else {
        alert(data.message || 'Failed to create tenant')
      }
    } catch (error) {
      console.error('Failed to create tenant:', error)
      alert('Failed to create tenant')
    } finally {
      setIsCreating(false)
    }
  }

  const navigateToATIManagement = () => {
    router.push('/ati-management')
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      // Could add a toast notification here
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }

  const totalUsers = tenants.reduce((sum, tenant) => sum + tenant.user_count, 0)
  const totalTokens = tenants.reduce((sum, tenant) => sum + tenant.ati_token_count, 0)

  const checkExpiryNotifications = async () => {
    try {
      const response = await fetch('/api/v1/admin/expiry-notifications', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setNotificationStatus(data)
      } else {
        alert('Failed to check expiry notifications')
      }
    } catch (error) {
      console.error('Failed to check expiry notifications:', error)
      alert('Failed to check expiry notifications')
    }
  }

  const triggerExpiryNotifications = async () => {
    if (!confirm('This will send expiry notifications to all users with tokens expiring within 7 days. Continue?')) {
      return
    }

    setIsCheckingNotifications(true)
    try {
      const response = await fetch('/api/v1/admin/expiry-notifications', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        alert('Expiry notifications sent successfully!')
        await checkExpiryNotifications() // Refresh status
      } else {
        const error = await response.json()
        alert(error.message || 'Failed to send expiry notifications')
      }
    } catch (error) {
      console.error('Failed to trigger expiry notifications:', error)
      alert('Failed to trigger expiry notifications')
    } finally {
      setIsCheckingNotifications(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Super Admin Dashboard</h1>
              <p className="text-gray-600">Platform management and tenant oversight</p>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={navigateToATIManagement}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700"
              >
                ATI Management
              </button>
              <button
                onClick={() => router.push('/super-admin/analytics')}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                📊 Analytics
              </button>
              <button
                onClick={() => setShowCreateTenant(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
              >
                Create Tenant
              </button>
              <span className="text-sm text-gray-500">Welcome, {user?.email}</span>
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
        {/* Stats Overview */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">T</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Tenants</dt>
                    <dd className="text-lg font-medium text-gray-900">{tenants.length}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">U</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Users</dt>
                    <dd className="text-lg font-medium text-gray-900">{totalUsers}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">A</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">ATI Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">{totalTokens}</dd>
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
                    <span className="text-white text-sm font-bold">A</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Tenants</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tenants.filter(t => t.status === 'ACTIVE').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Tenant Modal */}
        {showCreateTenant && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-8 mx-auto p-6 border max-w-2xl w-full shadow-xl rounded-lg bg-white max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Create New Tenant</h2>
                  <p className="mt-1 text-sm text-gray-600">Set up a new tenant organization with optional initial ATI token</p>
                </div>
                <button
                  onClick={() => setShowCreateTenant(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors duration-200"
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleCreateTenant} className="space-y-8">
                {/* Basic Information Section */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h3>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label htmlFor="tenant_name" className="block text-sm font-medium text-gray-700 mb-2">
                          Tenant Name
                        </label>
                        <input
                          type="text"
                          id="tenant_name"
                          value={newTenant.name}
                          onChange={(e) => setNewTenant(prev => ({ ...prev, name: e.target.value }))}
                          className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                          placeholder="e.g., Acme Corporation"
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">The display name for this tenant organization</p>
                      </div>

                      <div className="sm:col-span-2">
                        <label htmlFor="ati_id" className="block text-sm font-medium text-gray-700 mb-2">
                          ATI ID
                        </label>
                        <input
                          type="text"
                          id="ati_id"
                          value={newTenant.atiId}
                          onChange={(e) => setNewTenant(prev => ({ ...prev, atiId: e.target.value.toUpperCase() }))}
                          className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm uppercase"
                          placeholder="e.g., ACME"
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          A unique uppercase identifier for this tenant (used for ATI tokens and routing)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ATI Token Configuration Section */}
                <div className="border-t border-gray-200 pt-6">
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Initial ATI Token</h3>
                      <div className="flex items-start">
                        <div className="flex items-center h-5">
                          <input
                            id="generate_initial_token"
                            type="checkbox"
                            checked={newTenant.generateInitialToken}
                            onChange={(e) => setNewTenant(prev => ({ ...prev, generateInitialToken: e.target.checked }))}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                          />
                        </div>
                        <div className="ml-3">
                          <label htmlFor="generate_initial_token" className="text-sm font-medium text-gray-900">
                            Generate Initial ATI Token
                          </label>
                          <p className="text-sm text-gray-600 mt-1">
                            Create an onboarding token that tenant administrators can use to add their first users
                          </p>
                        </div>
                      </div>
                    </div>

                    {newTenant.generateInitialToken && (
                      <div className="ml-7 pl-4 border-l-2 border-indigo-100 space-y-6">
                        <div>
                          <h4 className="text-base font-medium text-gray-900 mb-4">Token Configuration</h4>
                          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div>
                              <label htmlFor="token_expires_at" className="block text-sm font-medium text-gray-700 mb-2">
                                Expiration Date (Optional)
                              </label>
                              <input
                                type="datetime-local"
                                id="token_expires_at"
                                value={newTenant.expires_at}
                                onChange={(e) => setNewTenant(prev => ({ ...prev, expires_at: e.target.value }))}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                              />
                              <p className="mt-1 text-xs text-gray-500">When this token will expire</p>
                            </div>

                            <div>
                              <label htmlFor="token_max_uses" className="block text-sm font-medium text-gray-700 mb-2">
                                Max Uses (Optional)
                              </label>
                              <input
                                type="number"
                                id="token_max_uses"
                                value={newTenant.max_uses}
                                onChange={(e) => setNewTenant(prev => ({ ...prev, max_uses: e.target.value }))}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                placeholder="Unlimited if empty"
                                min="1"
                              />
                              <p className="mt-1 text-xs text-gray-500">Maximum number of uses for this token</p>
                            </div>

                            <div>
                              <label htmlFor="token_plan_tier" className="block text-sm font-medium text-gray-700 mb-2">
                                Plan Tier
                              </label>
                              <select
                                id="token_plan_tier"
                                value={newTenant.plan_tier}
                                onChange={(e) => setNewTenant(prev => ({ ...prev, plan_tier: e.target.value }))}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                              >
                                <option value="BASIC">Basic</option>
                                <option value="PRO">Pro</option>
                                <option value="ENTERPRISE">Enterprise</option>
                              </select>
                              <p className="mt-1 text-xs text-gray-500">The plan tier this token grants access to</p>
                            </div>

                            <div>
                              <label htmlFor="token_notes" className="block text-sm font-medium text-gray-700 mb-2">
                                Notes (Optional)
                              </label>
                              <input
                                type="text"
                                id="token_notes"
                                value={newTenant.notes}
                                onChange={(e) => setNewTenant(prev => ({ ...prev, notes: e.target.value }))}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                placeholder="Purpose or recipient"
                              />
                              <p className="mt-1 text-xs text-gray-500">Additional notes about this token</p>
                            </div>
                          </div>
                        </div>

                        {/* Security Warning */}
                        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                          <div className="flex">
                            <div className="flex-shrink-0">
                              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div className="ml-3">
                              <h4 className="text-sm font-medium text-yellow-800">
                                Security Notice
                              </h4>
                              <div className="mt-2 text-sm text-yellow-700">
                                <p>
                                  This token will be displayed only once after creation. Make sure to securely share it with the tenant administrators.
                                  It cannot be recovered if lost.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowCreateTenant(false)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                  >
                    {isCreating ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating...
                      </>
                    ) : (
                      <>
                        <svg className="-ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Create Tenant
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Success Modal for Token Display */}
        {showSuccessModal && createdTokenInfo && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-green-900">
                    ✅ Tenant Created Successfully
                  </h3>
                  <button
                    onClick={() => {
                      setShowSuccessModal(false)
                      setCreatedTokenInfo(null)
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <span className="sr-only">Close</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-green-800">
                          Tenant "{createdTokenInfo.tenantName}" created successfully!
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3 flex-1">
                        <h3 className="text-sm font-medium text-yellow-800">
                          Initial ATI Token Generated
                        </h3>
                        <div className="mt-2 text-sm text-yellow-700">
                          <p className="font-mono bg-yellow-100 p-2 rounded break-all mb-2">
                            {createdTokenInfo.token}
                          </p>
                          <p className="text-xs mb-2">
                            <strong>Fingerprint:</strong> <code className="bg-yellow-200 px-1 rounded">{createdTokenInfo.fingerprint}</code>
                          </p>
                          <p className="mb-3">
                            <strong>⚠️ Security Warning:</strong> Copy this token now and share it securely with your tenant administrators.
                            This token will never be shown again for security reasons.
                          </p>
                          <button
                            onClick={() => copyToClipboard(createdTokenInfo.token)}
                            className="inline-flex items-center px-3 py-1 border border-yellow-300 text-sm font-medium rounded-md text-yellow-800 bg-yellow-100 hover:bg-yellow-200"
                          >
                            📋 Copy Token to Clipboard
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        setShowSuccessModal(false)
                        setCreatedTokenInfo(null)
                      }}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Expiry Notifications */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md mb-8">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">Expiry Notifications</h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  Monitor and send notifications for tokens expiring within 7 days
                </p>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={checkExpiryNotifications}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Check Status
                </button>
                <button
                  onClick={triggerExpiryNotifications}
                  disabled={isCheckingNotifications}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  {isCheckingNotifications ? 'Sending...' : 'Send Notifications'}
                </button>
              </div>
            </div>
          </div>

          {notificationStatus && (
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">
                    Tokens Expiring Soon
                  </h4>
                  <p className="text-sm text-gray-500">
                    {notificationStatus.expiringTokensCount} token{notificationStatus.expiringTokensCount !== 1 ? 's' : ''} expiring within 7 days
                  </p>
                </div>
                {notificationStatus.expiringTokensCount > 0 && (
                  <div className="flex items-center text-sm text-orange-600">
                    <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Action Required
                  </div>
                )}
              </div>

              {notificationStatus.tokens.length > 0 && (
                <div className="mt-4">
                  <h5 className="text-sm font-medium text-gray-900 mb-3">Expiring Tokens:</h5>
                  <div className="space-y-2">
                    {notificationStatus.tokens.slice(0, 5).map((token: any) => (
                      <div key={token.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                        <div className="flex items-center space-x-3">
                          <div className="flex-shrink-0">
                            <div className={`w-3 h-3 rounded-full ${
                              token.daysUntilExpiry <= 3 ? 'bg-red-500' :
                              token.daysUntilExpiry <= 7 ? 'bg-yellow-500' : 'bg-gray-500'
                            }`} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {token.fingerprint}
                            </p>
                            <p className="text-sm text-gray-500">
                              {token.tenantName} • Expires in {token.daysUntilExpiry} days
                            </p>
                          </div>
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(token.expiresAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                    {notificationStatus.tokens.length > 5 && (
                      <p className="text-sm text-gray-500 text-center py-2">
                        ...and {notificationStatus.tokens.length - 5} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tenants List */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Tenant Management</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Overview of all tenants and their activity
            </p>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading tenants...</p>
            </div>
          ) : tenants.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-500">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No tenants yet</h3>
              <p className="mt-1 text-sm text-gray-500">Create your first tenant to get started.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {tenants.map((tenant) => (
                <li key={tenant.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-gray-900">{tenant.name}</h4>
                          <p className="text-sm text-gray-500">ATI ID: {tenant.ati_id}</p>
                        </div>
                        <div className="ml-4 flex flex-col items-end space-y-1">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            tenant.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {tenant.status}
                          </span>
                          <div className="text-xs text-gray-500">
                            {tenant.user_count} users • {tenant.ati_token_count} tokens
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        Created {new Date(tenant.created_at).toLocaleDateString()}
                      </div>
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