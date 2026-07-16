'use client'

import { useState, useEffect, useCallback } from 'react'
import { CountryProfileList } from '@/components/super-admin/country-profiles/CountryProfileList'
import { ImportWizard } from '@/components/super-admin/country-profiles/ImportWizard'
import { CountryReadiness, authHeaders } from '@/components/super-admin/country-profiles/import-types'

interface ProfileSummary {
  countryCode: string
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT'
  updatedAt: string
}

interface CountriesPanelProps {
  /** Start on the import wizard instead of the list */
  initialView?: 'list' | 'import'
}

export function CountriesPanel({ initialView = 'list' }: CountriesPanelProps) {
  const [view, setView] = useState<'list' | 'import'>(initialView)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [readinessByCountry, setReadinessByCountry] = useState<Record<string, CountryReadiness>>({})

  const fetchStats = useCallback(async () => {
    try {
      const [profilesRes, readinessRes] = await Promise.all([
        fetch('/api/super-admin/countries', { headers: authHeaders() }),
        fetch('/api/super-admin/countries/readiness', { headers: authHeaders() })
      ])
      if (profilesRes.ok) {
        const data = await profilesRes.json()
        setProfiles((data.countryProfiles || []).map((p: any) => ({
          countryCode: p.countryCode,
          status: p.status,
          updatedAt: p.updatedAt
        })))
      }
      if (readinessRes.ok) {
        const data = await readinessRes.json()
        const byCountry: Record<string, CountryReadiness> = {}
        for (const r of data.countries || []) byCountry[r.countryCode] = r
        setReadinessByCountry(byCountry)
      }
    } catch {
      // stats are best-effort; the list component surfaces real errors
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats, refreshTrigger])

  const activeCount = profiles.filter(p => p.status === 'ACTIVE').length
  const draftCount = profiles.filter(p => p.status === 'DRAFT').length
  const readyCount = Object.values(readinessByCountry).filter(r => r.ready).length
  const lastUpdated = profiles.length > 0
    ? new Date(Math.max(...profiles.map(p => new Date(p.updatedAt).getTime())))
    : null

  return (
    <div>
      {/* Quick stats */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow border">
          <h3 className="text-xs font-medium text-gray-600 mb-1">Active Profiles</h3>
          <div className="text-2xl font-bold text-green-600">{activeCount}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border">
          <h3 className="text-xs font-medium text-gray-600 mb-1">Draft Profiles</h3>
          <div className="text-2xl font-bold text-yellow-600">{draftCount}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border">
          <h3 className="text-xs font-medium text-gray-600 mb-1">Ready for Drafting</h3>
          <div className="text-2xl font-bold text-blue-600">{readyCount}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border">
          <h3 className="text-xs font-medium text-gray-600 mb-1">Last Updated</h3>
          <div className="text-2xl font-bold text-gray-900">
            {lastUpdated ? lastUpdated.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
          </div>
        </div>
      </div>

      {/* View toggle */}
      <div className="mb-4 flex justify-end">
        {view === 'list' ? (
          <button
            onClick={() => setView('import')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            + Import Country
          </button>
        ) : (
          <button
            onClick={() => setView('list')}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            ← Back to list
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        {view === 'list' ? (
          <CountryProfileList
            refreshTrigger={refreshTrigger}
            onRefresh={() => setRefreshTrigger(prev => prev + 1)}
            readinessByCountry={readinessByCountry}
          />
        ) : (
          <ImportWizard
            onFinished={() => {
              setRefreshTrigger(prev => prev + 1)
              setView('list')
            }}
          />
        )}
      </div>
    </div>
  )
}
