'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'
import { CountriesPanel } from '@/components/super-admin/jurisdictions/CountriesPanel'
import { SupersetSectionsPanel } from '@/components/super-admin/jurisdictions/SupersetSectionsPanel'
import { JurisdictionConfigView } from '@/components/super-admin/jurisdictions/JurisdictionConfigView'

type HubTab = 'countries' | 'matrix' | 'superset'

function JurisdictionsHub() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get('tab')
  const initialTab: HubTab =
    tabParam === 'matrix' ? 'matrix'
    : tabParam === 'superset' ? 'superset'
    : 'countries'
  const initialView = tabParam === 'import' ? 'import' : 'list'
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab)

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }
  }, [user])

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lamp-600"></div>
      </div>
    )
  }

  if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Super admin privileges required.</div>
      </div>
    )
  }

  const TABS: Array<{ id: HubTab; label: string }> = [
    { id: 'countries', label: '🌍 Countries' },
    { id: 'matrix', label: '📊 Section Matrix' },
    { id: 'superset', label: '🧱 Superset Sections' }
  ]

  return (
    <div className={activeTab === 'matrix' ? '' : 'container mx-auto px-4 py-8'}>
      <div className={activeTab === 'matrix' ? 'container mx-auto px-4 pt-8' : ''}>
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Jurisdictions</h1>
          <p className="text-gray-600">
            Manage drafting countries end-to-end: import profiles, map superset sections, tune sequence
            and overrides, and activate countries for drafting.
          </p>
        </div>

        {/* Tab navigation */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-lamp-500 text-lamp-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {activeTab === 'countries' && <CountriesPanel initialView={initialView} />}
      {activeTab === 'superset' && <SupersetSectionsPanel />}
      {activeTab === 'matrix' && <JurisdictionConfigView />}
    </div>
  )
}

export default function JurisdictionsHubPage() {
  noStore()
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lamp-600"></div>
      </div>
    }>
      <JurisdictionsHub />
    </Suspense>
  )
}
