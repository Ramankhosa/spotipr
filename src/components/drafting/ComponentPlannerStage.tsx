'use client'

import { useState, useEffect } from 'react'

interface ComponentPlannerStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface Component {
  id: string
  name: string
  type: string
  description: string
  numeral?: number
  range?: string
}

const COMPONENT_TYPES = [
  { value: 'MAIN_CONTROLLER', label: 'Main Controller (100s)' },
  { value: 'SUBSYSTEM', label: 'Subsystem (200s)' },
  { value: 'MODULE', label: 'Module (300s)' },
  { value: 'INTERFACE', label: 'Interface (400s)' },
  { value: 'SENSOR', label: 'Sensor/Actuator (500s)' },
  { value: 'ACTUATOR', label: 'Actuator (500s)' },
  { value: 'PROCESSOR', label: 'Processor (600s)' },
  { value: 'MEMORY', label: 'Memory (700s)' },
  { value: 'DISPLAY', label: 'Display (800s)' },
  { value: 'COMMUNICATION', label: 'Communication (900s)' },
  { value: 'POWER_SUPPLY', label: 'Power Supply (900s)' },
  { value: 'OTHER', label: 'Other' }
]

export default function ComponentPlannerStage({ session, patent, onComplete, onRefresh }: ComponentPlannerStageProps) {
  // Initialize components from referenceMap if available, otherwise from idea record
  const getInitialComponents = () => {
    if (session?.referenceMap?.components) {
      return session.referenceMap.components
    }

    // Convert idea record components to component planner format
    if (session?.ideaRecord?.components) {
      return session.ideaRecord.components.map((comp: any, index: number) => ({
        id: comp.name?.toLowerCase().replace(/\s+/g, '_') || `component_${index}`,
        name: comp.name || `Component ${index + 1}`,
        type: comp.type || 'OTHER',
        description: comp.description || '',
        numeral: undefined,
        range: undefined
      }))
    }

    return []
  }

  const [components, setComponents] = useState<Component[]>(getInitialComponents())
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const addComponent = () => {
    const newComponent: Component = {
      id: crypto.randomUUID(),
      name: '',
      type: 'OTHER',
      description: ''
    }
    setComponents([...components, newComponent])
    setIsDirty(true)
  }

  const addSubmodule = (parentId: string) => {
    const newComponent: Component = {
      id: crypto.randomUUID(),
      name: '',
      type: 'MODULE',
      description: ''
    }
    // @ts-ignore store parent linkage for persistence
    ;(newComponent as any).parentId = parentId
    setComponents([...components, newComponent])
    setIsDirty(true)
  }

  const updateComponent = (id: string, updates: Partial<Component>) => {
    setComponents(components.map(comp =>
      comp.id === id ? { ...comp, ...updates } : comp
    ))
    setIsDirty(true)
  }

  const removeComponent = (id: string) => {
    // Cascade remove: delete the node and all descendants
    const idsToRemove = new Set<string>()
    const collect = (targetId: string) => {
      idsToRemove.add(targetId)
      components.forEach((c: any) => {
        if ((c as any).parentId === targetId) collect(c.id)
      })
    }
    collect(id)
    setComponents(components.filter((comp) => !idsToRemove.has(comp.id)))
    setIsDirty(true)
  }

  const handleAutoAssignNumerals = async () => {
    if (components.length === 0) {
      setError('Add at least one component first')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const result = await onComplete({
        action: 'update_component_map',
        sessionId: session?.id,
        components: components.map(comp => ({
          id: comp.id,
          name: comp.name.trim(),
          type: comp.type,
          description: comp.description.trim(),
          // @ts-ignore include optional parentId for submodules
          parentId: (comp as any).parentId
        }))
      })

      if (result.referenceMap) {
        setComponents(result.referenceMap.components)
        setValidationErrors([])
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to assign numerals'
      setError(errorMessage)

      // Try to extract validation errors
      if (errorMessage.includes('validation')) {
        try {
          const errorData = JSON.parse(errorMessage.split('validation errors: ')[1] || '[]')
          setValidationErrors(errorData)
        } catch {
          setValidationErrors([errorMessage])
        }
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const canProceed = components.length > 0 && components.every(comp =>
    comp.name.trim() && comp.numeral !== undefined
  )

  // Build a hierarchical tree from flat components using parentId
  type CompAny = Component & { parentId?: string }
  const buildTree = () => {
    const byId: Record<string, CompAny & { children: CompAny[] }> = {}
    ;(components as any as CompAny[]).forEach((c) => {
      byId[c.id] = { ...(c as any), children: [] }
    })
    const roots: (CompAny & { children: CompAny[] })[] = []
    ;(components as any as CompAny[]).forEach((c) => {
      const pid = (c as any).parentId
      if (pid && byId[pid]) {
        byId[pid].children.push(byId[c.id])
      } else {
        roots.push(byId[c.id])
      }
    })
    return roots
  }

  const tree = buildTree()

  const renderRow = (node: any, level: number) => (
    <tr key={node.id}>
      <td className="px-6 py-4 whitespace-nowrap">
        <div style={{ paddingLeft: `${level * 16}px` }}>
          <input
            type="text"
            value={node.name}
            onChange={(e) => updateComponent(node.id, { name: e.target.value })}
            placeholder="Component name"
            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {node.parentId && (
            <div className="mt-1 text-xs text-gray-500">Submodule</div>
          )}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <select
          value={node.type}
          onChange={(e) => updateComponent(node.id, { type: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {COMPONENT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-6 py-4">
        <input
          type="text"
          value={node.description}
          onChange={(e) => updateComponent(node.id, { description: e.target.value })}
          placeholder="Brief description"
          className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          node.numeral ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        }`}>
          {node.numeral || 'Unassigned'}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <button
          onClick={() => removeComponent(node.id)}
          className="text-red-600 hover:text-red-800 text-sm font-medium"
        >
          Remove
        </button>
        <button
          onClick={() => addSubmodule(node.id)}
          className="ml-3 text-indigo-600 hover:text-indigo-800 text-sm font-medium"
        >
          Add Submodule
        </button>
      </td>
    </tr>
  )

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 2: Component & Numeral Assignment</h2>
        <p className="text-gray-600">
          Define your invention components and assign reference numerals following patent drafting standards.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">Validation Errors</h3>
              <ul className="mt-2 text-sm text-yellow-700">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Numeral Ranges Info */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">Reference Numeral Ranges</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-blue-700">
          <div>100-199: Main Controllers</div>
          <div>200-299: Subsystems</div>
          <div>300-399: Modules</div>
          <div>400-499: Interfaces</div>
          <div>500-599: Sensors/Actuators</div>
          <div>600-699: Processors</div>
          <div>700-799: Memory</div>
          <div>800-899: Displays</div>
          <div>900-999: Other</div>
        </div>
      </div>

      {/* Components Table */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Components</h3>
          <button
            onClick={addComponent}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Component
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Numeral
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tree.map((node) => (
                <>
                  {renderRow(node, 0)}
                  {node.children?.map((c1: any) => (
                    <>
                      {renderRow(c1, 1)}
                      {c1.children?.map((c2: any) => (
                        <>
                          {renderRow(c2, 2)}
                          {c2.children?.map((c3: any) => renderRow(c3, 3))}
                        </>
                      ))}
                    </>
                  ))}
                </>
              ))}
              {components.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No components added yet. Click "Add Component" to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {components.length} components defined
          {components.filter(c => c.numeral).length > 0 &&
            ` • ${components.filter(c => c.numeral).length} with numerals assigned`
          }
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleAutoAssignNumerals}
            disabled={isProcessing || components.length === 0}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Processing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto Assign Numerals
              </>
            )}
          </button>
          <button
            onClick={async () => {
              await handleAutoAssignNumerals()
            }}
            disabled={isProcessing || components.length === 0}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Components
          </button>
          <button
            onClick={async () => { await handleAutoAssignNumerals(); setIsDirty(false) }}
            disabled={isProcessing || components.length === 0 || !isDirty}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Components
          </button>
          <button
            onClick={() => onRefresh()}
            disabled={!canProceed}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next: Figure Planner
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
