'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ReadinessChecklist } from '@/components/super-admin/country-profiles/ReadinessChecklist'
import { CountryReadiness, authHeaders } from '@/components/super-admin/country-profiles/import-types'

interface CountrySection {
  sectionKey: string
  supersetCode: string
  heading: string
  isRequired: boolean
  isEnabled: boolean
  displayOrder: number
  requiresPriorArtOverride: boolean | null
  requiresFiguresOverride: boolean | null
  requiresClaimsOverride: boolean | null
  requiresComponentsOverride: boolean | null
  superset: {
    label: string
    isActive: boolean
    requiresPriorArt: boolean
    requiresFigures: boolean
    requiresClaims: boolean
    requiresComponents: boolean
  } | null
  prompt: { id: string; version: number } | null
}

interface CountryProfileInfo {
  countryCode: string
  name: string
  version: number
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT'
  updatedAt: string
  continent: string
  office: string | null
  languages: string[]
}

const OVERRIDE_FIELDS = [
  { key: 'requiresPriorArtOverride', base: 'requiresPriorArt', label: 'Prior art' },
  { key: 'requiresFiguresOverride', base: 'requiresFigures', label: 'Figures' },
  { key: 'requiresClaimsOverride', base: 'requiresClaims', label: 'Claims' },
  { key: 'requiresComponentsOverride', base: 'requiresComponents', label: 'Components' }
] as const

function SectionRow({
  section,
  countryCode,
  onToggleEnabled,
  onEdit
}: {
  section: CountrySection
  countryCode: string
  onToggleEnabled: (section: CountrySection) => void
  onEdit: (section: CountrySection) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.sectionKey
  })

  const style = { transform: CSS.Transform.toString(transform), transition }

  const overrides = OVERRIDE_FIELDS.filter(f => section[f.key] !== null)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center p-3 bg-white border rounded-md ${isDragging ? 'shadow-lg opacity-90 z-10 relative' : ''} ${!section.isEnabled ? 'opacity-50 bg-gray-50' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mr-3 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 px-1"
        title="Drag to change the drafting sequence"
      >
        ⠿
      </button>
      <span className="w-8 text-sm font-mono text-gray-500">{section.displayOrder}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 flex items-center flex-wrap gap-2">
          {section.heading}
          {section.isRequired && (
            <span className="inline-flex px-1.5 py-0.5 text-xs rounded bg-lamp-100 text-lamp-700">required</span>
          )}
          {section.prompt ? (
            <a
              href={`/super-admin/section-prompts?country=${countryCode}&section=${section.sectionKey}`}
              className="inline-flex px-1.5 py-0.5 text-xs rounded bg-lamp-100 text-lamp-700 hover:bg-lamp-200"
              title={`Top-up prompt v${section.prompt.version}`}
            >
              prompt v{section.prompt.version}
            </a>
          ) : (
            <span className="inline-flex px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500" title="Uses superset base prompt only">
              base prompt
            </span>
          )}
          {overrides.length > 0 && (
            <span
              className="inline-flex px-1.5 py-0.5 text-xs rounded bg-amber-100 text-amber-700"
              title={overrides.map(f => `${f.label}: ${section[f.key] ? 'on' : 'off'}`).join(', ')}
            >
              {overrides.length} override{overrides.length === 1 ? '' : 's'}
            </span>
          )}
          {section.superset && !section.superset.isActive && (
            <span className="inline-flex px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-700">superset inactive</span>
          )}
        </div>
        <div className="text-xs text-gray-500 font-mono">
          {section.sectionKey}
          {section.superset && section.superset.label !== section.heading && (
            <span className="ml-2 text-gray-400">superset: {section.superset.label}</span>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-3">
        <button
          onClick={() => onEdit(section)}
          className="text-sm text-lamp-600 hover:text-lamp-800"
        >
          Edit
        </button>
        <label className="inline-flex items-center cursor-pointer" title={section.isEnabled ? 'Enabled — included in drafting' : 'Disabled — excluded from drafting'}>
          <input
            type="checkbox"
            checked={section.isEnabled}
            onChange={() => onToggleEnabled(section)}
            className="sr-only peer"
          />
          <div className="relative w-9 h-5 bg-gray-200 peer-checked:bg-green-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
        </label>
      </div>
    </div>
  )
}

function EditMappingModal({
  section,
  countryCode,
  onClose,
  onSaved
}: {
  section: CountrySection
  countryCode: string
  onClose: () => void
  onSaved: () => void
}) {
  const [heading, setHeading] = useState(section.heading)
  const [isRequired, setIsRequired] = useState(section.isRequired)
  const [overrides, setOverrides] = useState<Record<string, boolean | null>>({
    requiresPriorArtOverride: section.requiresPriorArtOverride,
    requiresFiguresOverride: section.requiresFiguresOverride,
    requiresClaimsOverride: section.requiresClaimsOverride,
    requiresComponentsOverride: section.requiresComponentsOverride
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'updateMapping',
          countryCode,
          sectionKey: section.sectionKey,
          heading,
          isRequired,
          ...overrides
        })
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Failed to save')
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <h3 className="text-lg font-semibold mb-1">
          Edit section — <span className="font-mono text-base">{section.sectionKey}</span>
        </h3>
        <p className="text-sm text-gray-500 mb-4">{countryCode} · {section.supersetCode}</p>

        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country heading</label>
            <input
              value={heading}
              onChange={e => setHeading(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Shown as the section title for this country. Use &quot;(N/A)&quot; to mark not applicable.
            </p>
          </div>

          <label className="flex items-center space-x-2 text-sm">
            <input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)} />
            <span>Required section for this country</span>
          </label>

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Context injection overrides</div>
            <div className="space-y-2">
              {OVERRIDE_FIELDS.map(field => {
                const baseValue = section.superset?.[field.base] ?? false
                const value = overrides[field.key]
                return (
                  <div key={field.key} className="flex items-center justify-between text-sm">
                    <span>
                      {field.label}
                      <span className="ml-2 text-xs text-gray-400">superset default: {baseValue ? 'on' : 'off'}</span>
                    </span>
                    <select
                      value={value === null ? 'inherit' : value ? 'on' : 'off'}
                      onChange={e => {
                        const v = e.target.value
                        setOverrides(prev => ({
                          ...prev,
                          [field.key]: v === 'inherit' ? null : v === 'on'
                        }))
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-xs"
                    >
                      <option value="inherit">Inherit ({baseValue ? 'on' : 'off'})</option>
                      <option value="on">Override: on</option>
                      <option value="off">Override: off</option>
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-lamp-600 text-white rounded-md text-sm hover:bg-lamp-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CountryDetailPage() {
  noStore()

  const { user } = useAuth()
  const params = useParams<{ countryCode: string }>()
  const countryCode = String(params?.countryCode || '').toUpperCase()

  const [profile, setProfile] = useState<CountryProfileInfo | null>(null)
  const [sections, setSections] = useState<CountrySection[]>([])
  const [readiness, setReadiness] = useState<CountryReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orderDirty, setOrderDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CountrySection | null>(null)
  const [activating, setActivating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchAll = useCallback(async () => {
    if (!countryCode) return
    setLoading(true)
    setError(null)
    try {
      const [sectionsRes, readinessRes] = await Promise.all([
        fetch(`/api/super-admin/countries/${countryCode}/sections`, { headers: authHeaders() }),
        fetch(`/api/super-admin/countries/readiness?countryCode=${countryCode}`, { headers: authHeaders() })
      ])
      if (!sectionsRes.ok) {
        const result = await sectionsRes.json()
        setError(result.error || `Failed to load ${countryCode}`)
        return
      }
      const data = await sectionsRes.json()
      setProfile(data.profile)
      setSections(data.sections)
      setOrderDirty(false)
      if (readinessRes.ok) {
        const r = await readinessRes.json()
        setReadiness(r.readiness)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [countryCode])

  useEffect(() => {
    if (user?.roles?.some(role => role === 'SUPER_ADMIN')) {
      fetchAll()
    }
  }, [user, fetchAll])

  useEffect(() => {
    if (user === null) window.location.href = '/login'
  }, [user])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSections(prev => {
      const oldIndex = prev.findIndex(s => s.sectionKey === active.id)
      const newIndex = prev.findIndex(s => s.sectionKey === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      return reordered.map((s, i) => ({ ...s, displayOrder: i + 1 }))
    })
    setOrderDirty(true)
  }

  const saveOrder = async () => {
    setSaving(true)
    setError(null)
    try {
      const updates: Record<string, { displayOrder: number }> = {}
      sections.forEach(s => {
        updates[s.sectionKey] = { displayOrder: s.displayOrder }
      })
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'bulkUpdateMappings', countryCode, updates })
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Failed to save order')
        return
      }
      setOrderDirty(false)
      setNotice('Section sequence saved')
      setTimeout(() => setNotice(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save order')
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (section: CountrySection) => {
    const newEnabled = !section.isEnabled
    setSections(prev => prev.map(s => (s.sectionKey === section.sectionKey ? { ...s, isEnabled: newEnabled } : s)))
    try {
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'updateMapping',
          countryCode,
          sectionKey: section.sectionKey,
          isEnabled: newEnabled
        })
      })
      if (!response.ok) {
        // revert on failure
        setSections(prev => prev.map(s => (s.sectionKey === section.sectionKey ? { ...s, isEnabled: !newEnabled } : s)))
        const result = await response.json()
        setError(result.error || 'Failed to toggle section')
      }
    } catch (err) {
      setSections(prev => prev.map(s => (s.sectionKey === section.sectionKey ? { ...s, isEnabled: !newEnabled } : s)))
      setError(err instanceof Error ? err.message : 'Failed to toggle section')
    }
  }

  const changeStatus = async (newStatus: 'ACTIVE' | 'INACTIVE' | 'DRAFT', force = false) => {
    setActivating(true)
    setError(null)
    try {
      const response = await fetch('/api/super-admin/countries', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ countryCode, status: newStatus, ...(force ? { force: true } : {}) })
      })
      const result = await response.json()
      if (response.status === 409 && result.readiness) {
        setReadiness(result.readiness)
        setError('Activation blocked by readiness failures (see checklist). Fix the blockers, or force-activate from the checklist state.')
        return
      }
      if (!response.ok) {
        setError(result.error || 'Failed to change status')
        return
      }
      await fetchAll()
      setNotice(`Status changed to ${newStatus}`)
      setTimeout(() => setNotice(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change status')
    } finally {
      setActivating(false)
    }
  }

  if (!user || loading) {
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

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-2">
        <a href="/super-admin/jurisdictions" className="text-sm text-lamp-600 hover:text-lamp-800">← Jurisdictions</a>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{error}</div>}
      {notice && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">{notice}</div>}

      {profile && (
        <div className="mb-6 bg-white border rounded-lg p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                {profile.name} <span className="text-gray-400 font-mono text-lg">({profile.countryCode})</span>
              </h1>
              <div className="mt-1 text-sm text-gray-600">
                {profile.continent}
                {profile.office && <> · {profile.office}</>}
                {profile.languages.length > 0 && <> · {profile.languages.join(', ')}</>}
                <> · profile v{profile.version}</>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${
                profile.status === 'ACTIVE' ? 'bg-green-100 text-green-800'
                : profile.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-800'
                : 'bg-red-100 text-red-800'
              }`}>
                {profile.status}
              </span>
              {profile.status !== 'ACTIVE' ? (
                <button
                  onClick={() => changeStatus('ACTIVE')}
                  disabled={activating}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {activating ? 'Activating…' : 'Activate'}
                </button>
              ) : (
                <button
                  onClick={() => changeStatus('INACTIVE')}
                  disabled={activating}
                  className="px-4 py-2 border border-red-300 text-red-700 rounded-md text-sm hover:bg-red-50 disabled:opacity-50"
                >
                  Deactivate
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Section sequence editor */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Drafting sections</h2>
            <button
              onClick={saveOrder}
              disabled={!orderDirty || saving}
              className="px-4 py-2 bg-lamp-600 text-white rounded-md text-sm hover:bg-lamp-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save sequence'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Drag to set the drafting/export sequence. Toggle to include or exclude a section for {countryCode}.
          </p>
          {sections.length === 0 ? (
            <div className="p-8 bg-white border rounded-md text-center text-gray-500 text-sm">
              No section mappings yet. Import a country profile JSON or add mappings in the Section Matrix.
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sections.map(s => s.sectionKey)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {sections.map(section => (
                    <SectionRow
                      key={section.sectionKey}
                      section={section}
                      countryCode={countryCode}
                      onToggleEnabled={toggleEnabled}
                      onEdit={setEditing}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Readiness sidebar */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Readiness</h2>
            <button onClick={fetchAll} className="text-sm text-lamp-600 hover:text-lamp-800">Re-check</button>
          </div>
          {readiness ? (
            <ReadinessChecklist readiness={readiness} />
          ) : (
            <div className="p-4 bg-white border rounded-md text-sm text-gray-500">No readiness data.</div>
          )}
        </div>
      </div>

      {editing && (
        <EditMappingModal
          section={editing}
          countryCode={countryCode}
          onClose={() => setEditing(null)}
          onSaved={fetchAll}
        />
      )}
    </div>
  )
}
