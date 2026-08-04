'use client'

import { useState, useMemo, useCallback } from 'react'
import { Node } from '@xyflow/react'
import {
  Box,
  X,
  Sparkles,
  Loader2,
  Target,
  Check,
  Info,
  Plus,
  Trash2,
  FolderPlus,
  GripVertical,
  Edit2,
  MessageSquare,
  Brain,
  EyeOff,
  ShieldCheck,
  MousePointerClick,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Hint } from '@/components/ui/hint'

// Bucket for grouping dimensions
interface IdeaBucket {
  id: string
  name: string
  dimensionIds: string[]
}

interface CombineTrayProps {
  selectedNodes: Set<string>
  nodes: Node[]
  // SRS: TRIZ operators removed - onGenerate no longer takes selectedOperators
  onGenerate: (count: number, intent: string, buckets?: IdeaBucket[], userGuidance?: string) => void
  onClear: () => void
  onRemoveNode?: (nodeId: string) => void
  loading: boolean
  // Single mechanism validation warning (SRS Section 3.6)
  mechanismWarning?: string | null
  onClose?: () => void
}

type RecipeIntent = 'DIVERGENT' | 'CONVERGENT' | 'RISK_REDUCTION' | 'COST_REDUCTION'

/**
 * The four generation styles. `description` and `bestFor` are rendered in the
 * UI, not hidden in a tooltip — a first-time user has to be able to tell these
 * apart without hovering anything.
 */
const intentOptions: {
  value: RecipeIntent
  label: string
  description: string
  bestFor: string
  icon: React.ReactNode
}[] = [
  {
    value: 'DIVERGENT',
    label: 'Explore widely',
    description: 'Unexpected ideas, often borrowed from other fields.',
    bestFor: 'Early brainstorming, when you want to be surprised.',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    value: 'CONVERGENT',
    label: 'Stay practical',
    description: 'Buildable with proven engineering, no exotic parts.',
    bestFor: 'Near-term product work you could prototype soon.',
    icon: <Target className="w-4 h-4" />,
  },
  {
    value: 'RISK_REDUCTION',
    label: 'Lower the risk',
    description: 'Fail-safe behaviour, redundancy, fewer ways to go wrong.',
    bestFor: 'Medical, automotive, or anything that gets certified.',
    icon: <ShieldCheck className="w-4 h-4" />,
  },
  {
    value: 'COST_REDUCTION',
    label: 'Lower the cost',
    description: 'Fewer parts, cheaper materials, simpler manufacturing.',
    bestFor: 'High-volume or price-sensitive products.',
    icon: <Box className="w-4 h-4" />,
  },
]

const STYLE_HELP =
  'All four styles use the directions you picked — they only change what the AI optimises for. ' +
  'Explore widely gives the most unusual ideas; Stay practical gives the most buildable ones. ' +
  'Not sure? Start with Explore widely, then re-run with another style to compare.'

const GROUP_HELP =
  'Groups let you split your selection and generate a separate set of ideas from each one — ' +
  'useful when you want to compare two directions instead of blending them. ' +
  'Without groups, every selected direction is combined into one set.'

const GUIDANCE_EXAMPLES = [
  'No electronics — mechanical only',
  'Keep unit cost under $0.10',
  'Look for biological analogies',
]

/** Recommended selection size — more than this dilutes each idea. */
const IDEAL_MIN = 2
const IDEAL_MAX = 4

const stepHeading = 'flex items-center gap-2 text-sm font-semibold text-slate-800'
const stepNumber =
  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600'
const cardShell = 'rounded-xl border border-slate-200 bg-white p-3'
const iconButton =
  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500'

export default function CombineTray({
  selectedNodes,
  nodes,
  onGenerate,
  onClear,
  onRemoveNode,
  loading,
  mechanismWarning,
  onClose,
}: CombineTrayProps) {
  const [ideaCount, setIdeaCount] = useState(3)
  const [intent, setIntent] = useState<RecipeIntent>('DIVERGENT')

  // User guidance for idea generation
  const [userGuidance, setUserGuidance] = useState('')
  const [showGuidanceInput, setShowGuidanceInput] = useState(false)

  // Multi-bucket system (labelled "groups" in the UI)
  const [buckets, setBuckets] = useState<IdeaBucket[]>([])
  const [useBuckets, setUseBuckets] = useState(false)
  const [bucketCounter, setBucketCounter] = useState(1)
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  // Drag and drop state
  const [draggedDimension, setDraggedDimension] = useState<string | null>(null)
  const [dragOverBucket, setDragOverBucket] = useState<string | null>(null)

  // Get dimension nodes from selection
  const dimensionNodes = useMemo(() => {
    const result: Node[] = []
    selectedNodes.forEach(nodeId => {
      const node = nodes.find(n => n.id === nodeId)
      if (node && node.type === 'dimension') {
        result.push(node)
      }
    })
    return result
  }, [selectedNodes, nodes])

  // Unassigned dimensions (not in any group)
  const unassignedDimensions = useMemo(() => {
    if (!useBuckets) return dimensionNodes
    const assignedIds = new Set(buckets.flatMap(b => b.dimensionIds))
    return dimensionNodes.filter(n => !assignedIds.has(n.id))
  }, [dimensionNodes, buckets, useBuckets])

  const titleOf = (node: Node) => ((node.data as any)?.title as string) || node.id

  // Auto-generate group name from first dimension or counter
  const generateBucketName = useCallback(
    (dimensionIds: string[] = []) => {
      if (dimensionIds.length > 0) {
        const firstDim = dimensionNodes.find(n => n.id === dimensionIds[0])
        if (firstDim) {
          return `${titleOf(firstDim).slice(0, 32)} group`
        }
      }
      return `Group ${bucketCounter}`
    },
    [dimensionNodes, bucketCounter]
  )

  // Add a new group with auto-generated name
  const addBucket = useCallback(
    (initialDimensionIds: string[] = []) => {
      const name = generateBucketName(initialDimensionIds)
      const newBucket: IdeaBucket = {
        id: `bucket-${Date.now()}`,
        name,
        dimensionIds: initialDimensionIds,
      }
      setBuckets(prev => [...prev, newBucket])
      setBucketCounter(prev => prev + 1)
      setUseBuckets(true)
      return newBucket
    },
    [generateBucketName]
  )

  const removeBucket = (bucketId: string) => {
    setBuckets(prev => prev.filter(b => b.id !== bucketId))
    if (buckets.length <= 1) {
      setUseBuckets(false)
    }
  }

  const updateBucketName = (bucketId: string, newName: string) => {
    setBuckets(prev =>
      prev.map(b =>
        b.id === bucketId ? { ...b, name: newName.trim() || generateBucketName(b.dimensionIds) } : b
      )
    )
    setEditingBucketId(null)
    setEditingName('')
  }

  const startEditingBucket = (bucket: IdeaBucket) => {
    setEditingBucketId(bucket.id)
    setEditingName(bucket.name)
  }

  const addToBucket = (bucketId: string, dimensionId: string) => {
    // First remove from any other group
    setBuckets(prev =>
      prev.map(b => ({
        ...b,
        dimensionIds:
          b.id === bucketId
            ? [...b.dimensionIds.filter(id => id !== dimensionId), dimensionId]
            : b.dimensionIds.filter(id => id !== dimensionId),
      }))
    )
  }

  const removeFromBucket = (bucketId: string, dimensionId: string) => {
    setBuckets(prev =>
      prev.map(b =>
        b.id === bucketId ? { ...b, dimensionIds: b.dimensionIds.filter(id => id !== dimensionId) } : b
      )
    )
  }

  // Drag handlers — the pointer path. Every drag action also has a keyboard
  // equivalent (the "Move to" select and the group buttons) so the panel is
  // usable without a mouse.
  const handleDragStart = (e: React.DragEvent, dimensionId: string) => {
    e.dataTransfer.setData('text/plain', dimensionId)
    setDraggedDimension(dimensionId)
  }

  const handleDragEnd = () => {
    setDraggedDimension(null)
    setDragOverBucket(null)
  }

  const handleDragOver = (e: React.DragEvent, bucketId: string) => {
    e.preventDefault()
    setDragOverBucket(bucketId)
  }

  const handleDragLeave = () => {
    setDragOverBucket(null)
  }

  const handleDrop = (e: React.DragEvent, bucketId: string) => {
    e.preventDefault()
    const dimensionId = e.dataTransfer.getData('text/plain')
    if (dimensionId) {
      addToBucket(bucketId, dimensionId)
    }
    setDragOverBucket(null)
    setDraggedDimension(null)
  }

  const handleDropNewBucket = (e: React.DragEvent) => {
    e.preventDefault()
    const dimensionId = e.dataTransfer.getData('text/plain')
    if (dimensionId) {
      addBucket([dimensionId])
    }
    setDragOverBucket(null)
    setDraggedDimension(null)
  }

  const totalDimensionsSelected = dimensionNodes.length
  const canGenerate = totalDimensionsSelected > 0
  const activeBuckets = useBuckets ? buckets.filter(b => b.dimensionIds.length > 0) : []
  const totalIdeas = activeBuckets.length > 0 ? ideaCount * activeBuckets.length : ideaCount
  const selectedIntent = intentOptions.find(o => o.value === intent)!

  const resetAll = () => {
    onClear()
    setBuckets([])
    setUseBuckets(false)
    setBucketCounter(1)
    setUserGuidance('')
    setShowGuidanceInput(false)
  }

  const handleGenerate = () => {
    const guidance = userGuidance.trim() || undefined
    if (useBuckets && buckets.length > 0) {
      onGenerate(ideaCount, intent, buckets, guidance)
    } else {
      onGenerate(ideaCount, intent, undefined, guidance)
    }
  }

  const appendGuidance = (example: string) => {
    setShowGuidanceInput(true)
    setUserGuidance(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')}. ${example}` : example))
  }

  /** One selected direction, as a row. Rows read better than chips in a 320px panel. */
  const DimensionRow = ({
    node,
    onRemove,
    tone = 'default',
    trailing,
  }: {
    node: Node
    onRemove?: () => void
    tone?: 'default' | 'muted'
    trailing?: React.ReactNode
  }) => (
    <div
      draggable
      onDragStart={(e: React.DragEvent) => handleDragStart(e, node.id)}
      onDragEnd={handleDragEnd}
      className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-opacity ${
        tone === 'muted' ? 'border-slate-200 bg-slate-50' : 'border-lamp-100 bg-lamp-50/60'
      } ${draggedDimension === node.id ? 'opacity-50' : ''}`}
    >
      <GripVertical
        className={`h-3.5 w-3.5 flex-shrink-0 cursor-grab active:cursor-grabbing ${
          tone === 'muted' ? 'text-slate-400' : 'text-lamp-400'
        }`}
        aria-hidden="true"
      />
      <span
        className={`min-w-0 flex-1 truncate text-xs ${
          tone === 'muted' ? 'text-slate-700' : 'text-lamp-900'
        }`}
        title={titleOf(node)}
      >
        {titleOf(node)}
      </span>
      {trailing}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={iconButton}
          aria-label={`Remove ${titleOf(node)}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Brain className="h-4 w-4 text-lamp-600" aria-hidden="true" />
            Idea builder
          </h3>
          <div className="flex items-center gap-3">
            {totalDimensionsSelected > 0 && (
              <button
                type="button"
                onClick={resetAll}
                className="text-xs text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500 rounded"
              >
                Clear all
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1 text-xs text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500 rounded"
                aria-label="Hide idea builder"
              >
                <EyeOff className="h-3 w-3" aria-hidden="true" />
                Hide
              </button>
            )}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Pick directions from the map, choose a style, and generate ideas you can take to novelty
          search.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {/* ---- Step 1: directions ---------------------------------------- */}
        <section className={cardShell}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className={stepHeading}>
              <span className={stepNumber} aria-hidden="true">
                1
              </span>
              Directions
            </h4>
            {!useBuckets && totalDimensionsSelected > 1 && (
              <button
                type="button"
                onClick={() => setUseBuckets(true)}
                className="flex items-center gap-1 rounded text-xs font-medium text-lamp-600 transition-colors hover:text-lamp-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
              >
                <FolderPlus className="h-3 w-3" aria-hidden="true" />
                Split into groups
              </button>
            )}
          </div>

          {totalDimensionsSelected === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center">
              <MousePointerClick className="mx-auto mb-2 h-5 w-5 text-slate-400" aria-hidden="true" />
              <p className="text-xs font-medium text-slate-700">No directions selected yet</p>
              <p className="mx-auto mt-1 max-w-[220px] text-xs leading-relaxed text-slate-500">
                Tick the checkbox on any card in the map. Two to four related directions give the
                best ideas.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{totalDimensionsSelected} selected</span>
                {totalDimensionsSelected < IDEAL_MIN && ' — add one more for a richer combination'}
                {totalDimensionsSelected > IDEAL_MAX && ' — fewer directions give sharper ideas'}
                {totalDimensionsSelected >= IDEAL_MIN && totalDimensionsSelected <= IDEAL_MAX && ' — a good number'}
              </p>

              {!useBuckets ? (
                <div className="space-y-1.5">
                  {dimensionNodes.map(node => (
                    <DimensionRow
                      key={node.id}
                      node={node}
                      onRemove={onRemoveNode ? () => onRemoveNode(node.id) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Groups
                    </span>
                    <Hint title="What are groups?" text={GROUP_HELP} />
                  </div>

                  {/* Unassigned */}
                  {unassignedDimensions.length > 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2">
                      <p className="mb-1.5 text-[11px] font-medium text-slate-500">
                        Not in a group ({unassignedDimensions.length})
                      </p>
                      <div className="space-y-1.5">
                        {unassignedDimensions.map(node => (
                          <DimensionRow
                            key={node.id}
                            node={node}
                            tone="muted"
                            onRemove={onRemoveNode ? () => onRemoveNode(node.id) : undefined}
                            trailing={
                              <label className="flex items-center">
                                <span className="sr-only">Move {titleOf(node)} to a group</span>
                                <select
                                  value=""
                                  onChange={e => {
                                    if (!e.target.value) return
                                    if (e.target.value === '__new') addBucket([node.id])
                                    else addToBucket(e.target.value, node.id)
                                  }}
                                  className="h-6 max-w-[92px] rounded-md border border-slate-300 bg-white px-1 text-[11px] text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                                >
                                  <option value="">Move to…</option>
                                  {buckets.map(b => (
                                    <option key={b.id} value={b.id}>
                                      {b.name}
                                    </option>
                                  ))}
                                  <option value="__new">+ New group</option>
                                </select>
                              </label>
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Groups */}
                  {buckets.map(bucket => (
                    <div
                      key={bucket.id}
                      className={`rounded-lg border p-2 transition-colors ${
                        dragOverBucket === bucket.id
                          ? 'border-dashed border-lamp-400 bg-lamp-100'
                          : 'border-lamp-200 bg-lamp-50/50'
                      }`}
                      onDragOver={e => handleDragOver(e, bucket.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, bucket.id)}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        {editingBucketId === bucket.id ? (
                          <Input
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            onBlur={() => updateBucketName(bucket.id, editingName)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') updateBucketName(bucket.id, editingName)
                              if (e.key === 'Escape') {
                                setEditingBucketId(null)
                                setEditingName('')
                              }
                            }}
                            className="h-7 w-40 text-xs"
                            aria-label="Group name"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditingBucket(bucket)}
                            className="flex min-w-0 items-center gap-1 rounded text-xs font-semibold text-lamp-800 transition-colors hover:text-lamp-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                            aria-label={`Rename group ${bucket.name}`}
                          >
                            <span className="truncate">{bucket.name}</span>
                            <Edit2 className="h-2.5 w-2.5 flex-shrink-0 opacity-50" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeBucket(bucket.id)}
                          className={iconButton}
                          aria-label={`Delete group ${bucket.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {bucket.dimensionIds.length > 0 ? (
                        <div className="space-y-1.5">
                          {bucket.dimensionIds.map(dimId => {
                            const node = dimensionNodes.find(n => n.id === dimId)
                            if (!node) return null
                            return (
                              <DimensionRow
                                key={dimId}
                                node={node}
                                onRemove={() => removeFromBucket(bucket.id, dimId)}
                              />
                            )
                          })}
                        </div>
                      ) : (
                        <p className="py-1.5 text-center text-[11px] text-lamp-500">
                          {dragOverBucket === bucket.id
                            ? 'Drop to add'
                            : 'Empty — drag a direction here or use “Move to…”'}
                        </p>
                      )}
                    </div>
                  ))}

                  <div
                    className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-2.5 transition-colors ${
                      draggedDimension && !dragOverBucket
                        ? 'border-lamp-400 bg-lamp-50 text-lamp-700'
                        : 'border-slate-300 bg-slate-50 text-slate-500'
                    }`}
                    onDragOver={e => {
                      e.preventDefault()
                      setDragOverBucket('new')
                    }}
                    onDragLeave={() => setDragOverBucket(null)}
                    onDrop={handleDropNewBucket}
                  >
                    <button
                      type="button"
                      onClick={() => addBucket()}
                      className="flex items-center gap-1.5 rounded text-xs font-medium transition-colors hover:text-lamp-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {draggedDimension ? 'Drop to create a group' : 'Add group'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setBuckets([])
                      setUseBuckets(false)
                      setBucketCounter(1)
                    }}
                    className="rounded text-xs text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                  >
                    ← Combine everything instead
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ---- Step 2: generation style ----------------------------------- */}
        {totalDimensionsSelected > 0 && (
          <section className={cardShell}>
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className={stepHeading} id="generation-style-heading">
                <span className={stepNumber} aria-hidden="true">
                  2
                </span>
                Generation style
              </h4>
              <Hint title="Which style should I pick?" text={STYLE_HELP} />
            </div>

            <fieldset className="space-y-1.5" aria-labelledby="generation-style-heading">
              {intentOptions.map(option => {
                const isActive = intent === option.value
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition-colors focus-within:ring-2 focus-within:ring-lamp-500 ${
                      isActive
                        ? 'border-lamp-300 bg-lamp-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="generation-style"
                      value={option.value}
                      checked={isActive}
                      onChange={() => setIntent(option.value)}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
                        isActive ? 'bg-lamp-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                      aria-hidden="true"
                    >
                      {option.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-semibold ${
                            isActive ? 'text-lamp-900' : 'text-slate-800'
                          }`}
                        >
                          {option.label}
                        </span>
                        {isActive && <Check className="h-3 w-3 text-lamp-600" aria-hidden="true" />}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                        {option.description}
                      </span>
                      {isActive && (
                        <span className="mt-1 block text-[11px] leading-relaxed text-lamp-700">
                          Best for: {option.bestFor}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </fieldset>
          </section>
        )}

        {/* ---- Step 3: how many ------------------------------------------- */}
        {totalDimensionsSelected > 0 && (
          <section className={cardShell}>
            <h4 className={`${stepHeading} mb-2`}>
              <span className={stepNumber} aria-hidden="true">
                3
              </span>
              How many ideas
            </h4>

            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs text-slate-500">
                {activeBuckets.length > 0 ? 'Per group' : 'Total'}
              </span>
              <span className="text-lg font-semibold tabular-nums text-lamp-700">{ideaCount}</span>
            </div>
            <Slider
              value={[ideaCount]}
              onValueChange={v => setIdeaCount(v[0])}
              min={1}
              max={10}
              step={1}
              className="w-full"
              aria-label="Number of ideas"
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>1 — focused</span>
              <span>10 — broad</span>
            </div>
            {activeBuckets.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                {ideaCount} × {activeBuckets.length} group{activeBuckets.length !== 1 ? 's' : ''} ={' '}
                <span className="font-medium text-slate-700">{totalIdeas} ideas</span>
              </p>
            )}
          </section>
        )}

        {/* ---- Optional: steer the AI -------------------------------------- */}
        {totalDimensionsSelected > 0 && (
          <section className={cardShell}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <MessageSquare className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Your direction
                <span className="text-xs font-normal text-slate-500">optional</span>
              </h4>
              {userGuidance && (
                <button
                  type="button"
                  onClick={() => {
                    setUserGuidance('')
                    setShowGuidanceInput(false)
                  }}
                  className="rounded text-xs text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                >
                  Clear
                </button>
              )}
            </div>

            {!showGuidanceInput && !userGuidance ? (
              <button
                type="button"
                onClick={() => setShowGuidanceInput(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 transition-colors hover:border-lamp-200 hover:bg-lamp-50/50 hover:text-lamp-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add a constraint or angle to follow
              </button>
            ) : (
              <div className="space-y-2">
                <label className="sr-only" htmlFor="idea-guidance">
                  Your direction for idea generation
                </label>
                <textarea
                  id="idea-guidance"
                  value={userGuidance}
                  onChange={e => setUserGuidance(e.target.value)}
                  placeholder="e.g., mechanical only, no electronics"
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-lamp-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                  rows={3}
                  autoFocus={showGuidanceInput && !userGuidance}
                />
                {userGuidance && (
                  <p className="flex items-center gap-1 text-[11px] text-lamp-700">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    This takes priority over the style above
                  </p>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1">
              {GUIDANCE_EXAMPLES.map(example => (
                <button
                  key={example}
                  type="button"
                  onClick={() => appendGuidance(example)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-lamp-200 hover:bg-lamp-50 hover:text-lamp-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                >
                  {example}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Too many directions selected (SRS Section 3.6) */}
      {mechanismWarning && (
        <div className="flex-shrink-0 border-t border-amber-200 bg-amber-50 p-3" role="status">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium text-amber-900">Too many directions at once</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{mechanismWarning}</p>
            </div>
          </div>
        </div>
      )}

      {/* Generate */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3">
        <Button onClick={handleGenerate} disabled={!canGenerate || loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              Generate {totalIdeas} idea{totalIdeas !== 1 ? 's' : ''}
            </>
          )}
        </Button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-500">
          {!canGenerate ? (
            'Select at least one direction in the map to start'
          ) : loading ? (
            'This usually takes under a minute'
          ) : (
            <>
              <span className="text-slate-600">{selectedIntent.label}</span>
              {userGuidance.trim() && ' · following your direction'}
              {' · one mechanism per idea'}
            </>
          )}
        </p>
      </div>
    </div>
  )
}
