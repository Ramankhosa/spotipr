'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { authHeaders } from '@/components/super-admin/country-profiles/import-types'

interface SupersetSectionRow {
  sectionKey: string
  label: string
  displayOrder: number
  isActive: boolean
  isRequired: boolean
  mappingCount: number
  requiresPriorArt: boolean
  requiresFigures: boolean
  requiresClaims: boolean
  requiresComponents: boolean
}

function SortableRow({ section }: { section: SupersetSectionRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.sectionKey
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  const flags = [
    section.requiresPriorArt && 'prior art',
    section.requiresFigures && 'figures',
    section.requiresClaims && 'claims',
    section.requiresComponents && 'components'
  ].filter(Boolean).join(', ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center p-3 bg-white border rounded-md ${isDragging ? 'shadow-lg opacity-90 z-10 relative' : ''} ${!section.isActive ? 'opacity-50' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mr-3 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 px-1"
        title="Drag to reorder"
      >
        ⠿
      </button>
      <span className="w-8 text-sm font-mono text-gray-500">{section.displayOrder}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">
          {section.label}
          {!section.isActive && <span className="ml-2 text-xs text-red-600">(inactive)</span>}
          {section.isRequired && <span className="ml-2 text-xs text-blue-600">required</span>}
        </div>
        <div className="text-xs text-gray-500 font-mono">
          {section.sectionKey}
          {flags && <span className="ml-2 text-gray-400">injects: {flags}</span>}
        </div>
      </div>
      <span className="text-xs text-gray-500 mr-2">{section.mappingCount} countries</span>
    </div>
  )
}

export function SupersetSectionsPanel() {
  const [sections, setSections] = useState<SupersetSectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchSections = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/super-admin/jurisdiction-config', { headers: authHeaders() })
      if (response.ok) {
        const data = await response.json()
        setSections(
          (data.supersetSections || [])
            .map((s: any) => ({
              sectionKey: s.sectionKey,
              label: s.label,
              displayOrder: s.displayOrder,
              isActive: s.isActive,
              isRequired: s.isRequired,
              mappingCount: s.mappingCount ?? 0,
              requiresPriorArt: s.requiresPriorArt ?? false,
              requiresFigures: s.requiresFigures ?? false,
              requiresClaims: s.requiresClaims ?? false,
              requiresComponents: s.requiresComponents ?? false
            }))
            .sort((a: SupersetSectionRow, b: SupersetSectionRow) => a.displayOrder - b.displayOrder)
        )
        setDirty(false)
      } else {
        setError('Failed to load superset sections')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSections()
  }, [fetchSections])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSections(prev => {
      const oldIndex = prev.findIndex(s => s.sectionKey === active.id)
      const newIndex = prev.findIndex(s => s.sectionKey === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      return reordered.map((s, i) => ({ ...s, displayOrder: i + 1 }))
    })
    setDirty(true)
    setSavedAt(null)
  }

  const saveOrder = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'reorderSupersetSections',
          order: sections.map(s => ({ sectionKey: s.sectionKey, displayOrder: s.displayOrder }))
        })
      })
      if (!response.ok) {
        const result = await response.json()
        setError(result.error || 'Failed to save order')
        return
      }
      // Clear server caches so the new order reaches drafting immediately
      await fetch('/api/super-admin/section-prompts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'clear-cache' })
      })
      setDirty(false)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save order')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Superset Sections</h2>
          <p className="text-sm text-gray-600">
            The canonical drafting sequence. Drag to reorder — countries without their own order inherit this.
            Edit prompts, aliases, and flags in{' '}
            <a href="/super-admin/superset-sections" className="text-blue-600 hover:text-blue-800">Superset Sections</a>.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {savedAt && !dirty && <span className="text-sm text-green-600">Order saved ✓</span>}
          <button
            onClick={saveOrder}
            disabled={!dirty || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{error}</div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.map(s => s.sectionKey)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sections.map(section => (
              <SortableRow key={section.sectionKey} section={section} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
