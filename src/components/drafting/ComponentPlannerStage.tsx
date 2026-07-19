'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  componentPlannerSeedsFromStage0,
  isScopeRecommendations,
  scopeElementKey,
  scopeTitleFromElement,
  sourceComponentForScopeElement,
  type ClaimSupportMetadata,
} from '@/lib/scope-recommendations'
import { getAuthoritativeClaims } from '@/lib/claims-context'
import { useToast } from '@/components/ui/toast'
import Hint from '@/components/ui/hint'

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
  referenceLabel?: string
  range?: string
  sequence?: number
  inputs?: string
  outputs?: string
  dependencies?: string
  figureHint?: string
  parent?: string
  level?: number
  numberingHint?: string
  conditions?: string
  alternatives?: string
  parentId?: string
  sourceScopeId?: string
  sourceRefs?: string[]
  scopeLabel?: string
  sourceType?: string
  claimSupport?: ClaimSupportMetadata
}

type NumberingStyle = 'NUMERIC_BUCKET' | 'STEP_LABEL' | 'CONSTITUENT_LABEL'
type PatentTypePrimary = 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION'

const NUMBERING_STYLES: { value: NumberingStyle; label: string; description: string; example: string }[] = [
  {
    value: 'NUMERIC_BUCKET',
    label: 'Numeric (100, 200...)',
    description: 'For SYSTEM/PRODUCT patents - hierarchical component numbering',
    example: 'Controller (100), Processor (200), Memory (300)'
  },
  {
    value: 'STEP_LABEL',
    label: 'Step Labels (S100, S200...)',
    description: 'For PROCESS patents - sequential method step labels',
    example: 'Receive Input (S100), Process Data (S200), Output Result (S300)'
  },
  {
    value: 'CONSTITUENT_LABEL',
    label: 'Constituent ((a), (b)...)',
    description: 'For COMPOSITION patents - alphabetical formulation labels',
    example: 'Active Agent (a), Carrier (b), Stabilizer (c)'
  }
]

// Types are descriptive only — numerals are assigned by tree order, not type.
const COMPONENT_TYPES = [
  { value: 'MAIN_CONTROLLER', label: 'Main Controller' },
  { value: 'SUBSYSTEM', label: 'Subsystem' },
  { value: 'MODULE', label: 'Module' },
  { value: 'INTERFACE', label: 'Interface' },
  { value: 'SENSOR', label: 'Sensor' },
  { value: 'ACTUATOR', label: 'Actuator' },
  { value: 'PROCESSOR', label: 'Processor' },
  { value: 'MEMORY', label: 'Memory' },
  { value: 'DISPLAY', label: 'Display' },
  { value: 'COMMUNICATION', label: 'Communication' },
  { value: 'POWER_SUPPLY', label: 'Power Supply' },
  { value: 'OTHER', label: 'Other' }
]

const MAX_MANUAL_NUMERAL = 9999

export default function ComponentPlannerStage({ session, patent, onComplete, onRefresh }: ComponentPlannerStageProps) {
  const { toast } = useToast()

  // Helper to extract components array from referenceMap (handles both nested and direct array formats)
  const extractComponentsFromReferenceMap = (referenceMap: any): any[] => {
    if (!referenceMap?.components) return []
    // Handle nested structure: { components: { components: [...], numberingStyle: '...' } }
    if (referenceMap.components.components && Array.isArray(referenceMap.components.components)) {
      return referenceMap.components.components
    }
    // Handle direct array structure: { components: [...] }
    if (Array.isArray(referenceMap.components)) {
      return referenceMap.components
    }
    return []
  }

  const normalizeNameKey = (value: any): string => String(value || '').trim().toLowerCase()

  const isMeaningfulParent = (value: any): value is string => {
    const normalized = normalizeNameKey(value)
    return !!normalized && normalized !== 'not stated by source' && normalized !== 'none' && normalized !== 'n/a'
  }

  const getNormalizedIdeaData = () => session?.ideaRecord?.normalizedData || {}

  const getIdeaComponentsForScope = (): any[] => {
    const normalized = getNormalizedIdeaData()
    return Array.isArray(session?.ideaRecord?.components)
      ? session.ideaRecord.components
      : Array.isArray(normalized?.components)
        ? normalized.components
        : []
  }

  const hydrateComponentTitlesFromScope = (rawComponents: any[]): any[] => {
    const normalized = getNormalizedIdeaData()
    const scopeRecommendations = normalized?.scopeRecommendations
    const ideaComponents = getIdeaComponentsForScope()

    if (!isScopeRecommendations(scopeRecommendations) || ideaComponents.length === 0) {
      return rawComponents
    }

    const elementsById = new Map(scopeRecommendations.elements.map((element) => [element.id, element]))

    return rawComponents.map((component) => {
      const scopeId = String(component?.sourceScopeId || component?.scopeRecommendationId || component?.id || '')
      const element = elementsById.get(scopeId)
        || scopeRecommendations.elements.find((candidate) => {
          const componentLabel = component?.scopeLabel || component?.name
          return scopeElementKey(candidate.label) === scopeElementKey(componentLabel)
        })

      if (!element) return component

      const sourceComponent = sourceComponentForScopeElement(element, ideaComponents)
      const sourceName = String(
        sourceComponent?.name
        || sourceComponent?.title
        || sourceComponent?.label
        || scopeTitleFromElement(element)
        || ''
      ).trim()
      if (!sourceName) return component

      const currentNameKey = scopeElementKey(component?.name)
      const scopeLabelKey = scopeElementKey(element.label)
      const shouldUseSourceName = !currentNameKey || currentNameKey === scopeLabelKey

      const currentDescriptionKey = scopeElementKey(component?.description)
      const reasonKey = scopeElementKey(element.reason)
      const sourceDescription = typeof sourceComponent?.description === 'string'
        ? sourceComponent.description.trim()
        : ''

      return {
        ...component,
        name: shouldUseSourceName ? sourceName : component.name,
        description: (!currentDescriptionKey || currentDescriptionKey === reasonKey) && sourceDescription
          ? sourceDescription
          : component.description,
        sourceScopeId: element.id,
        sourceRefs: Array.isArray(component?.sourceRefs) && component.sourceRefs.length
          ? component.sourceRefs
          : element.sourceRefs,
        scopeLabel: component?.scopeLabel || element.label,
      }
    })
  }

  const makeUniqueId = (baseId: string, usedIds: Set<string>): string => {
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix}`
      suffix++
    }
    usedIds.add(id)
    return id
  }

  const buildComponentId = (value: any, index: number, usedIds: Set<string>): string => {
    const base = String(value || `component_${index + 1}`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `component_${index + 1}`

    return makeUniqueId(base, usedIds)
  }

  const normalizeComponentsForPlanner = (rawComponents: any[]): Component[] => {
    const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER']
    const usedIds = new Set<string>()

    const normalized = rawComponents.map((comp: any, index: number) => {
      const name = typeof comp?.name === 'string' && comp.name.trim()
        ? comp.name.trim()
        : `Component ${index + 1}`
      const rawId = typeof comp?.id === 'string' ? comp.id.trim() : ''
      const levelNumber = Number(comp?.level)

      return {
        ...comp,
        id: rawId ? makeUniqueId(rawId, usedIds) : buildComponentId(name, index, usedIds),
        name,
        type: validTypes.includes(comp?.type) ? comp.type : 'OTHER',
        description: typeof comp?.description === 'string' ? comp.description : '',
        numeral: comp?.numeral,
        referenceLabel: comp?.referenceLabel,
        range: comp?.range,
        sequence: typeof comp?.sequence === 'number' && comp.sequence > 0 ? comp.sequence : index + 1,
        level: Number.isFinite(levelNumber) && levelNumber >= 0 ? Math.floor(levelNumber) : 0,
        parentId: isMeaningfulParent(comp?.parentId) ? String(comp.parentId).trim() : undefined,
        claimSupport: comp?.claimSupport,
        sourceType: comp?.sourceType,
      }
    })

    const idSet = new Set(normalized.map((comp) => comp.id))
    const lookup = new Map<string, string>()
    normalized.forEach((comp) => {
      lookup.set(normalizeNameKey(comp.id), comp.id)
      lookup.set(normalizeNameKey(comp.name), comp.id)
    })

    const lastIdAtLevel = new Map<number, string>()
    return normalized.map((comp, index) => {
      let parentId = comp.parentId
      if (parentId && !idSet.has(parentId)) {
        parentId = lookup.get(normalizeNameKey(parentId))
      }

      const parentName = rawComponents[index]?.parent
      if (!parentId && isMeaningfulParent(parentName)) {
        parentId = lookup.get(normalizeNameKey(parentName))
      }

      if (!parentId && comp.level && comp.level > 0) {
        for (let level = comp.level - 1; level >= 0; level--) {
          const candidate = lastIdAtLevel.get(level)
          if (candidate) {
            parentId = candidate
            break
          }
        }
      }

      if (parentId === comp.id) parentId = undefined

      lastIdAtLevel.set(comp.level || 0, comp.id)
      Array.from(lastIdAtLevel.keys()).forEach((level) => {
        if (level > (comp.level || 0)) lastIdAtLevel.delete(level)
      })

      return {
        ...comp,
        parentId
      }
    })
  }

  // Initialize components from referenceMap if available, otherwise from idea record
  const getInitialComponents = () => {
    // Try referenceMap first
    const refMapComponents = extractComponentsFromReferenceMap(session?.referenceMap)
    if (session?.referenceMap?.isValid !== false && refMapComponents.length > 0) {
      return normalizeComponentsForPlanner(hydrateComponentTitlesFromScope(refMapComponents))
    }

    // Seed from all Stage 0 components, while preserving claim-backed metadata where available.
    const normalized = getNormalizedIdeaData()
    const ideaComponents = getIdeaComponentsForScope()
    const claimsSnapshot = getAuthoritativeClaims(normalized || {})
    const seededComponents = componentPlannerSeedsFromStage0({
      normalizedComponents: ideaComponents,
      scopeRecommendations: normalized?.scopeRecommendations,
      claims: claimsSnapshot.structured,
      claimsText: claimsSnapshot.html,
    })
    if (seededComponents.length > 0) {
      return normalizeComponentsForPlanner(seededComponents)
    }

    return []
  }

  const [components, setComponents] = useState<Component[]>(() => getInitialComponents())
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [showRanges, setShowRanges] = useState(false)
  const [isValidatingComponents, setIsValidatingComponents] = useState(false)
  const [componentReview, setComponentReview] = useState<any | null>(null)
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    confirmLabel: string
    tone: 'danger' | 'default'
    onConfirm: () => void
  } | null>(null)
  const undoSnapshotRef = useRef<Component[] | null>(null)

  // Patent type and numbering style state
  const patentTypePrimary = session?.patentTypePrimary as PatentTypePrimary | null
  const archetype = (() => {
    const types = session?.ideaRecord?.normalizedData?.inventionType
    if (Array.isArray(types)) return types.join('+')
    return types || 'GENERAL'
  })()

  // Derive default numbering style from patent type
  const deriveDefaultNumberingStyle = (): NumberingStyle => {
    if (!patentTypePrimary) return 'NUMERIC_BUCKET'
    switch (patentTypePrimary) {
      case 'PROCESS': return 'STEP_LABEL'
      case 'COMPOSITION': return 'CONSTITUENT_LABEL'
      default: return 'NUMERIC_BUCKET'
    }
  }

  // User can override numbering style
  const [numberingStyleOverride, setNumberingStyleOverride] = useState<NumberingStyle | null>(
    session?.referenceMap?.numberingStyle || session?.referenceMap?.components?.numberingStyle || null
  )
  const effectiveNumberingStyle = numberingStyleOverride || deriveDefaultNumberingStyle()

  // Warn before the tab closes with unsaved edits
  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // Expose dirty state so the stage navigation (draft page) can prompt before leaving
  useEffect(() => {
    ;(window as any).__componentPlannerDirty = isDirty
    return () => {
      ;(window as any).__componentPlannerDirty = false
    }
  }, [isDirty])

  // ============================================================================
  // Tree building + live numbering preview
  // ============================================================================
  type TreeNode = Component & { children: TreeNode[] }

  const tree = useMemo<TreeNode[]>(() => {
    const byId: Record<string, TreeNode> = {}
    components.forEach((c) => {
      byId[c.id] = { ...(c as any), children: [] }
    })
    const roots: TreeNode[] = []
    components.forEach((c) => {
      const pid = c.parentId
      if (pid && byId[pid]) {
        byId[pid].children.push(byId[c.id])
      } else {
        roots.push(byId[c.id])
      }
    })
    return roots
  }, [components])

  // Rows in render order, each with its depth and sibling position (for move buttons)
  const flatRows = useMemo(() => {
    const rows: { node: TreeNode; level: number; siblingIndex: number; siblingCount: number }[] = []
    const walk = (nodes: TreeNode[], level: number) => {
      nodes.forEach((node, index) => {
        rows.push({ node, level, siblingIndex: index, siblingCount: nodes.length })
        walk(node.children, level + 1)
      })
    }
    walk(tree, 0)
    return rows
  }, [tree])

  // Mirror of the server's assignment rules, so users see numbering before saving:
  // NUMERIC: first root subtree 100, 101, 102…; second root 200…  STEP: S100 by row
  // order.  CONSTITUENT: (a), (b)… by row order.
  const previewLabels = useMemo(() => {
    const map = new Map<string, string>()
    if (effectiveNumberingStyle === 'NUMERIC_BUCKET') {
      tree.forEach((root, rootIndex) => {
        let counter = (rootIndex + 1) * 100
        const walk = (node: TreeNode) => {
          map.set(node.id, String(counter))
          counter++
          node.children.forEach(walk)
        }
        walk(root)
      })
    } else if (effectiveNumberingStyle === 'STEP_LABEL') {
      flatRows.forEach(({ node }, index) => {
        map.set(node.id, `S${(index + 1) * 100}`)
      })
    } else {
      const letterLabel = (index: number) =>
        index < 26
          ? String.fromCharCode(97 + index)
          : `${String.fromCharCode(97 + Math.floor(index / 26) - 1)}${String.fromCharCode(97 + (index % 26))}`
      flatRows.forEach(({ node }, index) => {
        map.set(node.id, `(${letterLabel(index)})`)
      })
    }
    return map
  }, [tree, flatRows, effectiveNumberingStyle])

  // ============================================================================
  // Live row-level validation
  // ============================================================================
  const rowIssues = useMemo(() => {
    const issues = new Map<string, string[]>()
    const push = (id: string, message: string) => {
      issues.set(id, [...(issues.get(id) || []), message])
    }

    const nameOwners = new Map<string, { id: string; name: string }[]>()
    components.forEach((comp) => {
      if (!comp.name.trim()) {
        push(comp.id, 'Name is required')
        return
      }
      const key = normalizeNameKey(comp.name)
      nameOwners.set(key, [...(nameOwners.get(key) || []), { id: comp.id, name: comp.name }])
    })
    nameOwners.forEach((owners) => {
      if (owners.length > 1) {
        owners.forEach(({ id }) => push(id, `Duplicate name "${owners[0].name.trim()}"`))
      }
    })

    if (effectiveNumberingStyle === 'NUMERIC_BUCKET') {
      const numeralOwners = new Map<number, string[]>()
      components.forEach((comp) => {
        if (comp.numeral === undefined || comp.numeral === null) return
        if (!Number.isInteger(comp.numeral) || comp.numeral < 1 || comp.numeral > MAX_MANUAL_NUMERAL) {
          push(comp.id, `Numeral must be a whole number from 1 to ${MAX_MANUAL_NUMERAL}`)
          return
        }
        numeralOwners.set(comp.numeral, [...(numeralOwners.get(comp.numeral) || []), comp.id])
      })
      numeralOwners.forEach((ids, numeral) => {
        if (ids.length > 1) {
          ids.forEach((id) => push(id, `Duplicate numeral ${numeral}`))
        }
      })
    }

    return issues
  }, [components, effectiveNumberingStyle])

  const applyReferenceMapResult = (result: any, fallbackError: string): boolean => {
    if (!result) {
      setError(fallbackError)
      return false
    }

    if (result.error) {
      setError(typeof result.error === 'string' ? result.error : String(result.error))
      const details = Array.isArray(result.details)
        ? result.details.map((detail: any) => typeof detail === 'string' ? detail : JSON.stringify(detail))
        : result.details
          ? [String(result.details)]
          : []
      setValidationErrors(details)
      return false
    }

    if (result.referenceMap) {
      // Extract components array from response (handles nested structure)
      const comps = extractComponentsFromReferenceMap(result.referenceMap)
      setComponents(comps)
      setValidationErrors([])
    }

    setIsDirty(false)
    return true
  }

  // ============================================================================
  // Mutations — all functional updates so rapid actions can't overwrite each other
  // ============================================================================
  const addComponent = () => {
    const newComponent: Component = {
      id: crypto.randomUUID(),
      name: '',
      type: 'OTHER',
      description: '',
      numeral: undefined
    }
    setComponents(prev => [...prev, newComponent])
    setIsDirty(true)
  }

  const addSubmodule = (parentId: string) => {
    const newComponent: Component = {
      id: crypto.randomUUID(),
      name: '',
      type: 'MODULE',
      description: '',
      numeral: undefined,
      parentId
    }
    setComponents(prev => [...prev, newComponent])
    setIsDirty(true)
  }

  const updateComponent = (id: string, updates: Partial<Component>) => {
    setComponents(prev => prev.map(comp =>
      comp.id === id ? { ...comp, ...updates } : comp
    ))
    setIsDirty(true)
  }

  const collectDescendantIds = (list: Component[], targetId: string): Set<string> => {
    const ids = new Set<string>()
    const collect = (currentId: string) => {
      ids.add(currentId)
      list.forEach((c) => {
        if (c.parentId === currentId) collect(c.id)
      })
    }
    collect(targetId)
    return ids
  }

  const performRemoveComponent = (id: string) => {
    undoSnapshotRef.current = components
    let removedCount = 0
    setComponents(prev => {
      const idsToRemove = collectDescendantIds(prev, id)
      removedCount = idsToRemove.size
      return prev.filter((comp) => !idsToRemove.has(comp.id))
    })
    setIsDirty(true)
    toast({
      title: removedCount > 1 ? `Deleted ${removedCount} components` : 'Component deleted',
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (undoSnapshotRef.current) {
            setComponents(undoSnapshotRef.current)
            setIsDirty(true)
          }
        }
      }
    })
  }

  const removeComponent = (id: string) => {
    const idsToRemove = collectDescendantIds(components, id)
    const target = components.find((comp) => comp.id === id)
    const childCount = idsToRemove.size - 1

    const claimLinkedComponents = components.filter((comp) =>
      idsToRemove.has(comp.id) && comp.claimSupport?.source === 'frozen_claims'
    )

    if (claimLinkedComponents.length > 0) {
      const listedNames = claimLinkedComponents
        .slice(0, 3)
        .map((comp) => comp.name)
        .join(', ')
      const suffix = claimLinkedComponents.length > 3 ? ` and ${claimLinkedComponents.length - 3} more` : ''
      setConfirmState({
        title: 'Delete claim-linked components?',
        message: `This removes ${listedNames}${suffix}, which are matched to your frozen claims and may be needed for reference labels, drafting, or figures.`,
        confirmLabel: 'Delete anyway',
        tone: 'danger',
        onConfirm: () => performRemoveComponent(id)
      })
      return
    }

    if (childCount > 0) {
      setConfirmState({
        title: `Delete "${target?.name || 'component'}"?`,
        message: `This also deletes its ${childCount} sub-component${childCount > 1 ? 's' : ''}.`,
        confirmLabel: 'Delete',
        tone: 'danger',
        onConfirm: () => performRemoveComponent(id)
      })
      return
    }

    performRemoveComponent(id)
  }

  // Move a component up/down among its siblings (order determines numbering)
  const moveComponent = (id: string, direction: 'up' | 'down') => {
    setComponents(prev => {
      const me = prev.find((c) => c.id === id)
      if (!me) return prev
      const parentKey = me.parentId || null
      const siblingIds = prev.filter((c) => (c.parentId || null) === parentKey).map((c) => c.id)
      const position = siblingIds.indexOf(id)
      const targetPosition = direction === 'up' ? position - 1 : position + 1
      if (targetPosition < 0 || targetPosition >= siblingIds.length) return prev
      const otherId = siblingIds[targetPosition]
      const i = prev.findIndex((c) => c.id === id)
      const j = prev.findIndex((c) => c.id === otherId)
      const next = [...prev]
      next[i] = prev[j]
      next[j] = prev[i]
      return next
    })
    setIsDirty(true)
  }

  // Promote: move up one level (become a sibling of its parent)
  const promoteComponent = (id: string) => {
    setComponents(prev => {
      const me = prev.find((c) => c.id === id)
      if (!me?.parentId) return prev
      const parent = prev.find((c) => c.id === me.parentId)
      return prev.map((c) => c.id === id ? { ...c, parentId: parent?.parentId || undefined } : c)
    })
    setIsDirty(true)
  }

  // Demote: nest under the sibling directly above it
  const demoteComponent = (id: string) => {
    setComponents(prev => {
      const me = prev.find((c) => c.id === id)
      if (!me) return prev
      const parentKey = me.parentId || null
      const siblings = prev.filter((c) => (c.parentId || null) === parentKey)
      const position = siblings.findIndex((c) => c.id === id)
      if (position <= 0) return prev
      const newParent = siblings[position - 1]
      return prev.map((c) => c.id === id ? { ...c, parentId: newParent.id } : c)
    })
    setIsDirty(true)
  }

  const normalizeSuggestedComponent = (suggestion: any, sequence: number, existing: Component[]): Component => {
    const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER']
    const existingIds = new Set(existing.map(comp => comp.id))
    const suggestedId = typeof suggestion?.id === 'string' && suggestion.id.trim() && !existingIds.has(suggestion.id)
      ? suggestion.id.trim()
      : crypto.randomUUID()

    return {
      ...suggestion,
      id: suggestedId,
      name: typeof (suggestion?.name || suggestion?.title || suggestion?.label) === 'string' && (suggestion.name || suggestion.title || suggestion.label).trim()
        ? (suggestion.name || suggestion.title || suggestion.label).trim()
        : `Component ${existing.length + sequence}`,
      type: validTypes.includes(suggestion?.type) ? suggestion.type : 'OTHER',
      description: typeof suggestion?.description === 'string' ? suggestion.description : '',
      sequence: existing.length + sequence,
      numeral: undefined,
      referenceLabel: undefined,
    }
  }

  const addSuggestedComponents = (suggestions: any[]) => {
    let addedNames: string[] = []
    setComponents(prev => {
      const existingKeys = new Set(prev.map(comp => scopeElementKey(comp.name)).filter(Boolean))
      const nextComponents = suggestions
        .filter((suggestion) => {
          const key = scopeElementKey(suggestion?.name || suggestion?.title || suggestion?.label)
          if (!key || existingKeys.has(key)) return false
          existingKeys.add(key)
          return true
        })
        .map((suggestion, index) => normalizeSuggestedComponent(suggestion, index + 1, prev))

      if (nextComponents.length === 0) return prev
      addedNames = nextComponents.map(comp => comp.name)
      return [...prev, ...nextComponents]
    })

    if (addedNames.length === 0) return
    setComponentReview((review: any) => review ? {
      ...review,
      suggestedComponents: (review.suggestedComponents || []).filter((suggestion: any) => {
        const key = scopeElementKey(suggestion?.name || suggestion?.title || suggestion?.label)
        return !addedNames.some(name => scopeElementKey(name) === key)
      })
    } : review)
    setIsDirty(true)
  }

  const handleValidateComponentPlan = async () => {
    if (!session?.id) return
    setIsValidatingComponents(true)
    setError(null)
    try {
      const result = await onComplete({
        action: 'validate_component_plan_llm',
        sessionId: session.id,
        components: components
          .filter(comp => comp.name && comp.name.trim())
          .map(comp => ({
            ...comp,
            name: comp.name.trim(),
            description: (comp.description || '').trim(),
            parentId: comp.parentId || undefined
          }))
      })

      if (result?.error) {
        setError(String(result.error))
        return
      }

      setComponentReview(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI component validation failed')
    } finally {
      setIsValidatingComponents(false)
    }
  }

  const blockOnRowIssues = (): boolean => {
    if (rowIssues.size > 0) {
      setError(`Fix the ${rowIssues.size} highlighted row${rowIssues.size > 1 ? 's' : ''} first.`)
      return true
    }
    return false
  }

  const runAutoAssignNumerals = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      const validComponents = components
        .filter(comp => comp.name && comp.name.trim())
        .map(comp => {
          const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER'];
          const normalizedType = validTypes.includes(comp.type) ? comp.type : 'OTHER';

          return {
            ...comp,
            id: comp.id,
            name: comp.name.trim(),
            type: normalizedType,
            description: (comp.description || '').trim(),
            numeral: undefined,
            referenceLabel: undefined,
            parentId: comp.parentId || undefined
          };
        });

      if (validComponents.length === 0) {
        setError('No valid components found. Please ensure all components have names.');
        setIsProcessing(false);
        return;
      }

      const result = await onComplete({
        action: 'update_component_map',
        sessionId: session?.id,
        components: validComponents,
        autoAssign: true,
        numberingStyleOverride: numberingStyleOverride // Pass user override if set
      })

      if (applyReferenceMapResult(result, 'Failed to assign numerals. Please check the page error above and retry.')) {
        toast({ title: 'Reference labels assigned', variant: 'success' })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to assign numerals'
      setError(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAutoAssignNumerals = () => {
    if (components.length === 0) {
      setError('Add at least one component first')
      return
    }
    if (blockOnRowIssues()) return

    const labeledCount = components.filter(hasAssignedReference).length
    if (labeledCount > 0) {
      setConfirmState({
        title: `Renumber all ${components.length} components?`,
        message: `${labeledCount} existing reference label${labeledCount > 1 ? 's' : ''} will be replaced with fresh tree-order numbering.`,
        confirmLabel: 'Renumber',
        tone: 'default',
        onConfirm: () => { void runAutoAssignNumerals() }
      })
      return
    }
    void runAutoAssignNumerals()
  }

  const hasAssignedReference = (comp: Component) =>
    comp.referenceLabel || (comp.numeral !== undefined && comp.numeral !== null)

  const canProceed = components.length > 0 && rowIssues.size === 0 && !isProcessing

  const handleSaveComponents = async (): Promise<boolean> => {
    if (components.length === 0) {
      setError('Add at least one component first')
      return false
    }
    if (blockOnRowIssues()) return false
    setIsProcessing(true)
    setError(null)
    try {
      const validComponents = components
        .filter(comp => comp.name && comp.name.trim())
        .map(comp => ({
          ...comp,
          id: comp.id,
          name: comp.name.trim(),
          type: comp.type,
          description: (comp.description || '').trim(),
          numeral: comp.numeral,
          referenceLabel: comp.referenceLabel, // Include manual reference label
          sequence: comp.sequence, // Include sequence for ordering
          parentId: comp.parentId
        }));

      if (validComponents.length === 0) {
        setError('No valid components found. Please ensure all components have names.');
        setIsProcessing(false);
        return false;
      }

      const result = await onComplete({
        action: 'update_component_map',
        sessionId: session?.id,
        components: validComponents,
        numberingStyleOverride: numberingStyleOverride // Pass user override if set
      })
      const success = applyReferenceMapResult(result, 'Failed to save components. Please check the page error above and retry.')
      if (success) {
        toast({ title: 'Components saved', variant: 'success' })
      }
      return success
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save components'
      setError(errorMessage)
      return false
    } finally {
      setIsProcessing(false)
    }
  }

  const renderRow = (
    node: TreeNode,
    level: number,
    siblingIndex: number,
    siblingCount: number
  ) => {
    const issues = rowIssues.get(node.id) || []
    const previewLabel = previewLabels.get(node.id)
    const hasManualLabel = !!hasAssignedReference(node)

    return (
    <tr
      key={node.id}
      className={`group transition-colors border-b border-paper-200 last:border-0 ${
        issues.length > 0 ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-paper-100/80'
      }`}
    >
      <td className="px-4 py-3 align-top">
        <div style={{ paddingLeft: `${level * 16}px` }} className="flex min-w-0 items-start">
          {level > 0 && (
            <svg className="mt-2 w-3 h-3 shrink-0 text-gray-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-5h5" />
            </svg>
          )}
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={node.name}
              onChange={(e) => updateComponent(node.id, { name: e.target.value })}
              placeholder="Component name"
              aria-invalid={issues.length > 0 ? true : undefined}
              className={`block w-full min-w-0 truncate px-2 py-1.5 bg-transparent border rounded text-sm font-medium text-ai-graphite-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ai-blue-500/20 transition-all ${
                issues.length > 0
                  ? 'border-red-300 focus:bg-white focus:border-red-400'
                  : 'border-transparent hover:border-paper-300 focus:bg-white focus:border-ai-blue-300'
              }`}
            />
            {issues.length > 0 && (
              <div className="mt-1 px-2 space-y-0.5">
                {issues.map((issue, index) => (
                  <p key={index} className="text-xs text-red-600">{issue}</p>
                ))}
              </div>
            )}
            {(node.parentId || node.claimSupport?.source === 'frozen_claims') && (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 px-2">
                {node.parentId && (
                  <span className="text-[10px] text-ai-graphite-400 uppercase tracking-wider">Sub-part</span>
                )}
                {node.claimSupport?.source === 'frozen_claims' && (
                  <span
                    className="inline-flex max-w-full items-center rounded border border-ai-blue-100 bg-ai-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-ai-blue-700"
                    title={node.claimSupport.reason || 'Recited in your frozen claims — deleting or renaming it will put the claims out of sync.'}
                  >
                    Claim-linked
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <select
          value={node.type}
          onChange={(e) => updateComponent(node.id, { type: e.target.value })}
          className="w-full min-w-0 truncate px-2 py-1.5 bg-transparent border border-transparent hover:border-paper-300 focus:bg-white focus:border-ai-blue-300 rounded text-sm text-ai-graphite-600 focus:outline-none focus:ring-2 focus:ring-ai-blue-500/20 transition-all cursor-pointer"
        >
          {COMPONENT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={node.description}
          onChange={(e) => updateComponent(node.id, { description: e.target.value })}
          placeholder="Brief description"
          className="w-full min-w-0 truncate px-2 py-1.5 bg-transparent border border-transparent hover:border-paper-300 focus:bg-white focus:border-ai-blue-300 rounded text-sm text-ai-graphite-600 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ai-blue-500/20 transition-all"
        />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {effectiveNumberingStyle === 'NUMERIC_BUCKET' ? (
            <>
              <input
                type="number"
                min={1}
                max={MAX_MANUAL_NUMERAL}
                value={node.numeral ?? ''}
                onChange={(e) => {
                  const num = e.target.value === '' ? undefined : Number(e.target.value)
                  const numVal = num === undefined || Number.isNaN(num) ? undefined : num
                  updateComponent(node.id, {
                    numeral: numVal,
                    referenceLabel: numVal !== undefined && numVal >= 1 ? String(numVal) : undefined
                  })
                }}
                placeholder={previewLabel || 'e.g., 101'}
                className="w-20 px-2 py-1.5 bg-transparent border border-transparent hover:border-paper-300 focus:bg-white focus:border-ai-blue-300 rounded text-sm font-mono text-ai-graphite-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ai-blue-500/20 transition-all"
              />
              {hasManualLabel ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-100">
                  {node.referenceLabel || `#${node.numeral}`}
                </span>
              ) : previewLabel ? (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-ai-graphite-400 border border-dashed border-paper-300"
                  title="Assigned automatically on save, based on row order"
                >
                  → {previewLabel}
                </span>
              ) : null}
            </>
          ) : effectiveNumberingStyle === 'STEP_LABEL' ? (
            <>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-ai-blue-50 text-ai-blue-700 border border-ai-blue-100">
                {previewLabel}
              </span>
              <span className="text-[10px] text-ai-graphite-400" title="Step labels follow row order — use the arrows to reorder steps">
                auto
              </span>
            </>
          ) : (
            <>
              <input
                type="text"
                value={node.referenceLabel ?? ''}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  updateComponent(node.id, {
                    referenceLabel: val || undefined,
                    // For constituent labels like (a), (b), etc.
                    sequence: val.match(/[a-z]/i) ? val.toLowerCase().charCodeAt(val.match(/[a-z]/i)!.index || 0) - 96 : undefined
                  })
                }}
                placeholder={previewLabel || 'e.g., (a)'}
                className="w-20 px-2 py-1.5 bg-transparent border border-transparent hover:border-paper-300 focus:bg-white focus:border-ai-blue-300 rounded text-sm font-mono text-amber-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
              />
              {hasManualLabel ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
                  {node.referenceLabel}
                </span>
              ) : previewLabel ? (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-ai-graphite-400 border border-dashed border-paper-300"
                  title="Assigned automatically on save, based on row order"
                >
                  → {previewLabel}
                </span>
              ) : null}
            </>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={() => moveComponent(node.id, 'up')}
            disabled={siblingIndex === 0}
            className="p-1 text-ai-graphite-400 hover:text-ai-blue-600 hover:bg-ai-blue-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up (changes numbering order)"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => moveComponent(node.id, 'down')}
            disabled={siblingIndex >= siblingCount - 1}
            className="p-1 text-ai-graphite-400 hover:text-ai-blue-600 hover:bg-ai-blue-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down (changes numbering order)"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => promoteComponent(node.id)}
            disabled={level === 0}
            className="p-1 text-ai-graphite-400 hover:text-ai-blue-600 hover:bg-ai-blue-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Promote one level"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => demoteComponent(node.id)}
            disabled={siblingIndex === 0}
            className="p-1 text-ai-graphite-400 hover:text-ai-blue-600 hover:bg-ai-blue-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Nest under the row above"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => addSubmodule(node.id)}
            className="p-1 text-ai-blue-400 hover:text-ai-blue-600 hover:bg-ai-blue-50 rounded transition-colors"
            title="Add a sub-part under this component"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
          <button
            onClick={() => removeComponent(node.id)}
            className="p-1 text-ai-graphite-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
    )
  }

  return (
    <div className="px-6 py-8 max-w-[1800px] mx-auto">
      <div className="mb-8 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="text-xl font-semibold text-ai-graphite-900 flex items-center gap-2">
              Component Planning
              <Hint
                title="What happens here"
                text="List the parts (or steps) of your invention and how they nest. Each one gets a reference label that the figures, claims, and specification all reuse — so this list is the backbone of the whole draft."
              />
            </h2>
            <div className="flex items-center gap-2">
              <select
                aria-label="Reference label style"
                value={numberingStyleOverride || deriveDefaultNumberingStyle()}
                onChange={(e) => setNumberingStyleOverride(e.target.value as NumberingStyle)}
                className="w-full sm:w-auto px-3 py-1.5 border border-paper-400 rounded-md text-sm bg-white text-ai-graphite-900 focus:outline-none focus:ring-2 focus:ring-ai-blue-500/20 focus:border-ai-blue-300"
              >
                {NUMBERING_STYLES.map((style) => (
                  <option key={style.value} value={style.value}>
                    {style.label} {style.value === deriveDefaultNumberingStyle() && !numberingStyleOverride ? '(Auto)' : ''}
                  </option>
                ))}
              </select>
              <Hint
                title="Label style"
                text="Chosen from your patent type: systems and products use numerals (100, 200), methods use step labels (S100), compositions use letters ((a), (b)). Override only if your attorney prefers a different convention."
              />
            </div>
          </div>
          <p className="text-sm text-ai-graphite-500 mt-1">
            Define invention components and assign reference labels.
          </p>
          {/* Patent Type + Archetype Badges */}
          <div className="flex items-center gap-2 mt-2">
            {patentTypePrimary && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                patentTypePrimary === 'SYSTEM' ? 'bg-ai-blue-100 text-ai-blue-800' :
                patentTypePrimary === 'PRODUCT' ? 'bg-green-100 text-green-800' :
                patentTypePrimary === 'PROCESS' ? 'bg-ai-blue-100 text-ai-blue-800' :
                patentTypePrimary === 'COMPOSITION' ? 'bg-amber-100 text-amber-800' :
                'bg-paper-200 text-ai-graphite-800'
              }`}>
                Patent Type: {patentTypePrimary}
              </span>
            )}
            {(patentTypePrimary === 'SYSTEM' || patentTypePrimary === 'PRODUCT') && archetype !== 'GENERAL' && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-ai-blue-100 text-ai-blue-800">
                Archetype: {archetype}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowRanges(!showRanges)}
            className={`text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${showRanges ? 'bg-ai-blue-50 text-ai-blue-700 border-ai-blue-100' : 'bg-white text-ai-graphite-600 border-paper-300 hover:bg-paper-100'}`}
          >
            How numbering works
          </button>
        </div>
      </div>

      {/* Collapsible, style-aware numbering guide */}
      {showRanges && (
        <div className="mb-6 bg-white border border-paper-300 rounded-lg shadow-sm p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {effectiveNumberingStyle === 'NUMERIC_BUCKET' && (
            <>
              <h3 className="text-xs font-semibold text-ai-graphite-900 uppercase tracking-wider mb-2">Numeric labels</h3>
              <p className="text-sm text-ai-graphite-600 mb-3">
                Numerals follow the order of your tree: the first top-level part gets <span className="font-mono">100</span> and
                its sub-parts <span className="font-mono">101, 102…</span>; the second top-level part gets <span className="font-mono">200</span>,
                and so on. Reorder rows with the arrows to change numbering, or type a specific numeral — it is kept as long as it is unique.
              </p>
              <div className="rounded-md bg-paper-100 border border-paper-200 p-3 text-sm font-mono text-ai-graphite-600 space-y-0.5">
                <div>Motor assembly <span className="text-ai-blue-600">100</span></div>
                <div className="pl-4">Rotor <span className="text-ai-blue-600">101</span></div>
                <div className="pl-4">Stator <span className="text-ai-blue-600">102</span></div>
                <div>Flight controller <span className="text-ai-blue-600">200</span></div>
              </div>
            </>
          )}
          {effectiveNumberingStyle === 'STEP_LABEL' && (
            <>
              <h3 className="text-xs font-semibold text-ai-graphite-900 uppercase tracking-wider mb-2">Step labels</h3>
              <p className="text-sm text-ai-graphite-600 mb-3">
                Steps are labelled <span className="font-mono">S100, S200…</span> in row order. Use the ↑↓ arrows to reorder steps —
                labels update automatically and can&apos;t be typed manually.
              </p>
              <div className="rounded-md bg-paper-100 border border-paper-200 p-3 text-sm font-mono text-ai-graphite-600 space-y-0.5">
                <div>Receive input <span className="text-ai-blue-600">S100</span></div>
                <div>Process data <span className="text-ai-blue-600">S200</span></div>
                <div>Output result <span className="text-ai-blue-600">S300</span></div>
              </div>
            </>
          )}
          {effectiveNumberingStyle === 'CONSTITUENT_LABEL' && (
            <>
              <h3 className="text-xs font-semibold text-ai-graphite-900 uppercase tracking-wider mb-2">Constituent labels</h3>
              <p className="text-sm text-ai-graphite-600 mb-3">
                Constituents are labelled <span className="font-mono">(a), (b), (c)…</span> in row order. You can type a
                specific letter label — it is kept as long as it is unique.
              </p>
              <div className="rounded-md bg-paper-100 border border-paper-200 p-3 text-sm font-mono text-ai-graphite-600 space-y-0.5">
                <div>Active agent <span className="text-amber-600">(a)</span></div>
                <div>Carrier <span className="text-amber-600">(b)</span></div>
                <div>Stabilizer <span className="text-amber-600">(c)</span></div>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 rounded-lg p-4 flex items-start">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-100 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-800">Validation Needed</h3>
              <ul className="mt-1 text-sm text-amber-700 space-y-1">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {componentReview && (
        <div className="mb-6 bg-ai-blue-50 border border-ai-blue-100 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-ai-blue-900">AI Component Validation</h3>
              {componentReview.summary && (
                <p className="mt-1 text-sm text-ai-blue-800">{componentReview.summary}</p>
              )}
            </div>
            <button
              onClick={() => setComponentReview(null)}
              className="text-xs font-medium text-ai-blue-600 hover:text-ai-blue-800"
            >
              Dismiss
            </button>
          </div>

          {Array.isArray(componentReview.suggestedComponents) && componentReview.suggestedComponents.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-ai-blue-700">Suggested Stage 0 Components</p>
                <button
                  onClick={() => addSuggestedComponents(componentReview.suggestedComponents)}
                  className="text-xs font-medium text-ai-blue-700 hover:text-ai-blue-900"
                >
                  Add All
                </button>
              </div>
              {componentReview.suggestedComponents.map((suggestion: any, index: number) => (
                <div key={`${suggestion.name || suggestion.title || 'suggestion'}-${index}`} className="flex items-start justify-between gap-3 rounded-md border border-ai-blue-100 bg-white p-3">
                  <div>
                    <p className="text-sm font-medium text-ai-graphite-900">{suggestion.name || suggestion.title || suggestion.label}</p>
                    {suggestion.description && (
                      <p className="mt-0.5 text-xs text-ai-graphite-600">{suggestion.description}</p>
                    )}
                    {suggestion.claimSupport?.reason && (
                      <p className="mt-1 text-xs text-ai-blue-700">{suggestion.claimSupport.reason}</p>
                    )}
                  </div>
                  <button
                    onClick={() => addSuggestedComponents([suggestion])}
                    className="shrink-0 rounded-md border border-ai-blue-200 bg-ai-blue-50 px-2.5 py-1 text-xs font-medium text-ai-blue-700 hover:bg-ai-blue-100"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ai-blue-800">No missing Stage 0 components were suggested.</p>
          )}

          {Array.isArray(componentReview.missingClaimTerms) && componentReview.missingClaimTerms.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-amber-800">Manual Review Terms</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-800">
                {componentReview.missingClaimTerms.map((item: any, index: number) => (
                  <li key={`${item.term}-${index}`}>
                    <span className="font-medium">{item.term}</span>
                    {item.reason ? ` - ${item.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(componentReview.warnings) && componentReview.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-ai-blue-700">
              {componentReview.warnings.map((warning: string, index: number) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Components Table Card */}
      <div className="bg-white border border-paper-300 rounded-lg shadow-sm overflow-hidden mb-8">
        <div className="flex justify-between items-center px-6 py-4 border-b border-paper-200 bg-paper-100/50">
          <h3 className="text-sm font-medium text-ai-graphite-900">Component Structure</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidateComponentPlan}
              disabled={isValidatingComponents}
              title="Ask AI to compare frozen claims, Stage 0 components, and this planner list, then suggest missing components or claim terms needing manual review."
              className="inline-flex items-center px-3 py-1.5 border border-ai-blue-200 shadow-sm text-xs font-medium rounded-md text-ai-blue-700 bg-ai-blue-50 hover:bg-ai-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isValidatingComponents ? (
                <svg className="animate-spin w-3.5 h-3.5 mr-1.5 text-ai-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 mr-1.5 text-ai-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5 2a8 8 0 11-16 0 8 8 0 0116 0z" />
                </svg>
              )}
              AI Validate
            </button>
            <button
              onClick={addComponent}
              className="inline-flex items-center px-3 py-1.5 border border-paper-400 shadow-sm text-xs font-medium rounded-md text-ai-graphite-700 bg-white hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 transition-colors"
            >
              <svg className="w-3.5 h-3.5 mr-1.5 text-ai-graphite-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Component
            </button>
          </div>
        </div>

        <div className={`overflow-x-auto ${isProcessing ? 'pointer-events-none opacity-60' : ''}`} aria-busy={isProcessing || undefined}>
          <table className="min-w-full table-fixed divide-y divide-paper-200">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[16%]" />
              <col className="w-[30%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-paper-100/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Reference</span>
                    <Hint
                      title="Reference labels"
                      text="The dashed value shows what will be assigned on save, based on row order. Type your own to pin a specific label (numeric and constituent styles only) — it must be unique."
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">

                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-paper-200">
              {flatRows.map(({ node, level, siblingIndex, siblingCount }) =>
                renderRow(node, level, siblingIndex, siblingCount)
              )}
              {components.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                       <div className="h-10 w-10 rounded-full bg-paper-200 flex items-center justify-center mb-3">
                         <svg className="w-5 h-5 text-ai-graphite-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                         </svg>
                       </div>
                       <p className="text-sm text-ai-graphite-500 mb-1">No components defined yet</p>
                       <button onClick={addComponent} className="text-sm text-ai-blue-600 hover:text-ai-blue-700 font-medium">
                         Add your first component
                       </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-paper-300">
        <div className="flex items-center gap-3 text-sm text-ai-graphite-500">
          <span>
            <span className="font-medium text-ai-graphite-900">{components.length}</span> components defined
            {components.filter(hasAssignedReference).length > 0 && (
              <span className="ml-1 text-ai-graphite-400">
                ({components.filter(hasAssignedReference).length} with labels)
              </span>
            )}
          </span>
          {rowIssues.size > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              {rowIssues.size} row{rowIssues.size > 1 ? 's' : ''} need attention
            </span>
          )}
          {isDirty && rowIssues.size === 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
          <button
            onClick={handleAutoAssignNumerals}
            disabled={isProcessing || components.length === 0}
            className="inline-flex items-center px-4 py-2 border border-paper-400 shadow-sm text-sm font-medium rounded-lg text-ai-graphite-700 bg-white hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isProcessing ? (
              <span className="flex items-center">
                 <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-ai-graphite-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                 </svg>
                 Processing...
              </span>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2 text-ai-graphite-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
                Auto Assign
              </>
            )}
          </button>
          <button
            onClick={async () => {
              await handleSaveComponents()
            }}
            disabled={isProcessing || components.length === 0}
            className="inline-flex items-center px-4 py-2 border border-paper-400 shadow-sm text-sm font-medium rounded-lg text-ai-graphite-700 bg-white hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Save Draft
          </button>
          <button
            onClick={async () => {
              const saved = await handleSaveComponents()
              if (!saved) return
              await onComplete({ action: 'set_stage', sessionId: session?.id, stage: 'FIGURE_PLANNER' })
            }}
            disabled={!canProceed}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Continue
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Confirmation dialog (renumber / cascade delete) */}
      {confirmState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cp-confirm-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 id="cp-confirm-title" className="text-base font-semibold text-ai-graphite-900">{confirmState.title}</h3>
            <p className="mt-2 text-sm text-ai-graphite-600">{confirmState.message}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmState(null)}
                className="inline-flex items-center px-4 py-2 border border-paper-400 text-sm font-medium rounded-lg text-ai-graphite-700 bg-white hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const action = confirmState.onConfirm
                  setConfirmState(null)
                  action()
                }}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  confirmState.tone === 'danger'
                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                    : 'bg-ai-blue-600 hover:bg-ai-blue-700 focus:ring-ai-blue-500'
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
