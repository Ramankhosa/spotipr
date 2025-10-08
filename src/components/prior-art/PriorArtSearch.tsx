'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

interface PriorArtBundle {
  id: string
  mode: 'LLM' | 'MANUAL'
  status: 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED' | 'ARCHIVED'
  briefRaw?: string
  inventionBrief: string
  bundleData: any
  createdBy: string
  approvedBy?: string
  approvedAt?: string
  version: string
  createdAt: string
  creator: {
    id: string
    name?: string
    email: string
  }
  approver?: {
    id: string
    name?: string
    email: string
  }
  queryVariants: Array<{
    id: string
    label: 'BROAD' | 'BASELINE' | 'NARROW'
    query: string
    num: number
    page: number
    notes: string
  }>
}

interface ValidationResult {
  isValid: boolean
  errors?: string[]
}

interface GuardrailResult {
  isValid: boolean
  warnings: string[]
}

type Mode = 'select' | 'create' | 'edit' | 'review'

interface AnnexureData {
  id: string
  html: string
  textPlain: string
  rev: number
  createdAt: string
}

// Helper function for consistent word counting
const countWords = (text: string): number => {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length
}

export default function PriorArtSearch({ patentId, projectId }: { patentId: string; projectId: string }) {
  const { user } = useAuth()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('create')
  const [bundles, setBundles] = useState<PriorArtBundle[]>([])
  const [currentBundle, setCurrentBundle] = useState<PriorArtBundle | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [annexureData, setAnnexureData] = useState<AnnexureData | null>(null)
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [newlyCreatedBundle, setNewlyCreatedBundle] = useState<PriorArtBundle | null>(null)
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set())

  // Form state
  const [selectedMode, setSelectedMode] = useState<'LLM' | 'MANUAL'>('LLM')
  const [inventionBrief, setInventionBrief] = useState('')
  const [bundleData, setBundleData] = useState<any>(null)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [guardrails, setGuardrails] = useState<GuardrailResult | null>(null)

  useEffect(() => {
    loadBundles()
    loadAnnexureData()
  }, [patentId, projectId])

  const loadBundles = async () => {
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch(`/api/patents/${patentId}/prior-art`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        setBundles(data.bundles)
      }
    } catch (error) {
      console.error('Failed to load bundles:', error)
    }
  }

  const loadAnnexureData = async () => {
    // Only run on client side
    if (typeof window === 'undefined') return

    const authToken = localStorage.getItem('auth_token')
    if (!authToken) {
      console.log('No auth token available for annexure fetch')
      return
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/patents/${patentId}/annexure`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        if (data.annexure) {
          setAnnexureData(data.annexure)
          // Extract text content and limit to 200 words
          const textContent = data.annexure.textPlain || ''
          const words = textContent.split(/\s+/).filter((word: string) => word.length > 0)
          const limitedText = words.slice(0, 200).join(' ')
          setInventionBrief(limitedText)
        }
      }
    } catch (error) {
      console.error('Failed to load annexure data:', error)
    }
  }

  const handleCreateBundle = async () => {
    if (selectedMode === 'LLM') {
      if (!inventionBrief.trim()) {
        alert('Please enter an invention brief')
        return
      }

      const wordCount = countWords(inventionBrief)

      if (wordCount > 200) {
        alert(`Invention brief has ${wordCount} words, which exceeds the 200 word limit. Please reduce the word count before proceeding.`)
        return
      }
    }

    setIsLoading(true)
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch(`/api/patents/${patentId}/prior-art`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          mode: selectedMode,
          inventionBrief: selectedMode === 'LLM' ? inventionBrief : undefined,
          bundleData: selectedMode === 'MANUAL' ? bundleData : undefined
        })
      })

      if (response.ok) {
        const data = await response.json()
        // Successfully created bundle - refresh list and show success dialog
        await loadBundles()
        setNewlyCreatedBundle(data.bundle)
        setShowSuccessDialog(true)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to create bundle')
      }
    } catch (error) {
      console.error('Failed to create bundle:', error)
      alert('Failed to create bundle')
    } finally {
      setIsLoading(false)
    }
  }

  const handleViewBundle = () => {
    if (newlyCreatedBundle) {
      setCurrentBundle(newlyCreatedBundle)
      setBundleData(newlyCreatedBundle.bundleData)
      setMode('edit')
      setShowSuccessDialog(false)
      setNewlyCreatedBundle(null)
    }
  }

  const handleStayOnList = () => {
    setShowSuccessDialog(false)
    setNewlyCreatedBundle(null)
  }

  const handleGoToSearch = () => {
    setShowSuccessDialog(false)
    setNewlyCreatedBundle(null)
    // Navigate to the prior art search page
    router.push('/prior-art')
  }

  const handleDeleteBundle = async (bundleId: string) => {
    if (!confirm('Are you sure you want to delete this bundle? This action cannot be undone.')) {
      return
    }

    setIsLoading(true)
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch(`/api/patents/${patentId}/prior-art/${bundleId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      })

      if (response.ok) {
        alert('Bundle deleted successfully!')
        await loadBundles()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to delete bundle')
      }
    } catch (error) {
      console.error('Failed to delete bundle:', error)
      alert('Failed to delete bundle')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleBundleExpansion = (bundleId: string) => {
    const newExpanded = new Set(expandedBundles)
    if (newExpanded.has(bundleId)) {
      newExpanded.delete(bundleId)
    } else {
      newExpanded.add(bundleId)
    }
    setExpandedBundles(newExpanded)
  }

  const handleValidateBundle = async () => {
    if (!bundleData) return

    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch(`/api/patents/${patentId}/prior-art/${currentBundle?.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          bundleData,
          action: 'validate'
        })
      })

      if (response.ok) {
        const data = await response.json()
        setValidation(data.validation)
        setGuardrails(data.guardrails)
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const handleApproveBundle = async () => {
    if (!bundleData || !currentBundle) return

    setIsLoading(true)
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch(`/api/patents/${patentId}/prior-art/${currentBundle.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          bundleData,
          action: 'approve'
        })
      })

      if (response.ok) {
        alert('Bundle approved successfully!')
        await loadBundles()
        setMode('select')
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to approve bundle')
      }
    } catch (error) {
      console.error('Failed to approve bundle:', error)
      alert('Failed to approve bundle')
    } finally {
      setIsLoading(false)
    }
  }

  const renderModeSelection = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">Prior Art Search</h3>
        <p className="mt-1 text-sm text-gray-500">
          Choose how you want to create your patent search queries.
        </p>
      </div>

      {annexureData && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-blue-800">Annexure Content Imported</h4>
              <p className="text-sm text-blue-700 mt-1">
                Content from your patent annexure (version {annexureData.rev}) has been imported and limited to 200 words.
                You can edit this before creating your search bundle.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div
          className={`relative rounded-lg border p-4 cursor-pointer ${
            selectedMode === 'LLM' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
          }`}
          onClick={() => setSelectedMode('LLM')}
        >
          <div className="flex items-center">
            <input
              type="radio"
              checked={selectedMode === 'LLM'}
              onChange={() => setSelectedMode('LLM')}
              className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <div className="ml-3">
              <h4 className="text-sm font-medium text-gray-900">AI-Assisted Search</h4>
              <p className="text-sm text-gray-500">
                Let AI analyze your invention brief and generate optimized search queries.
              </p>
            </div>
          </div>
        </div>

        <div
          className={`relative rounded-lg border p-4 cursor-pointer ${
            selectedMode === 'MANUAL' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
          }`}
          onClick={() => setSelectedMode('MANUAL')}
        >
          <div className="flex items-center">
            <input
              type="radio"
              checked={selectedMode === 'MANUAL'}
              onChange={() => setSelectedMode('MANUAL')}
              className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <div className="ml-3">
              <h4 className="text-sm font-medium text-gray-900">Manual Entry</h4>
              <p className="text-sm text-gray-500">
                Build your search queries manually with full control.
              </p>
            </div>
          </div>
        </div>
      </div>

      {selectedMode === 'LLM' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Invention Brief for AI Analysis
            </label>
            <div className="relative">
              <textarea
                value={inventionBrief}
                onChange={(e) => {
                  const text = e.target.value
                  setInventionBrief(text)
                }}
                placeholder="Describe your invention in detail..."
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 pr-24"
                rows={8}
              />
              <div className="absolute bottom-2 right-2 text-xs bg-white px-2 py-1 rounded border">
                {(() => {
                  const wordCount = countWords(inventionBrief)
                  const isNearLimit = wordCount > 180
                  const isOverLimit = wordCount > 200
                  return (
                    <span className={`${isOverLimit ? 'text-red-600 font-semibold' : isNearLimit ? 'text-orange-600 font-medium' : 'text-gray-600'}`}>
                      {wordCount}/200 words
                    </span>
                  )
                })()}
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              This content is imported from your patent annexure but can be modified for search purposes.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end space-x-3">
        <button
          onClick={() => setMode('select')}
          className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
        >
          View Bundles
        </button>
        <button
          onClick={handleCreateBundle}
          disabled={isLoading || (selectedMode === 'LLM' && !inventionBrief.trim())}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Creating...' : 'Create Search Bundle'}
        </button>
      </div>
    </div>
  )

  const renderBundleList = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">Your Search Bundles</h3>
        <button
          onClick={() => setMode('create')}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          New Bundle
        </button>
      </div>

      {bundles.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No search bundles yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Create your first prior art search bundle to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {bundles.map((bundle) => {
            const isExpanded = expandedBundles.has(bundle.id)
            const bundleData = bundle.bundleData || {}

            return (
              <div key={bundle.id} className="bg-white border rounded-lg shadow-sm">
                <div className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-gray-900">
                        {bundleData.source_summary?.title || 'Untitled Bundle'}
                      </h4>
                      <p className="text-sm text-gray-500">
                        Mode: {bundle.mode} | Status: {bundle.status} | Version: {bundle.version}
                      </p>
                      <p className="text-xs text-gray-400">
                        Created {new Date(bundle.createdAt).toLocaleDateString()} by {bundle.creator.name || bundle.creator.email}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => toggleBundleExpansion(bundle.id)}
                        className="text-sm text-gray-600 hover:text-gray-500"
                      >
                        {isExpanded ? 'Hide Details' : 'Show Details'}
                      </button>
                      <button
                        onClick={() => {
                          setCurrentBundle(bundle)
                          setBundleData(bundle.bundleData)
                          setMode('edit')
                        }}
                        className="text-sm text-blue-600 hover:text-blue-500"
                      >
                        Edit
                      </button>
                      {bundle.status !== 'APPROVED' && (
                        <button
                          onClick={() => {
                            setCurrentBundle(bundle)
                            setBundleData(bundle.bundleData)
                            setMode('review')
                          }}
                          className="text-sm text-green-600 hover:text-green-500"
                        >
                          Review
                        </button>
                      )}
                      {bundle.status === 'APPROVED' && (
                        <button
                          onClick={() => router.push('/prior-art')}
                          className="text-sm text-blue-600 hover:text-blue-500 font-medium"
                        >
                          🚀 Start Search
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBundle(bundle.id)}
                        disabled={isLoading}
                        className="text-sm text-red-600 hover:text-red-500 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expandable Details Section */}
                {isExpanded && (
                  <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
                    <div className="grid grid-cols-1 gap-4">
                      {/* Source Summary Details */}
                      {bundleData.source_summary && (
                        <div className="bg-white p-3 rounded border">
                          <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">Invention Summary</h5>
                          <div className="space-y-2 text-xs">
                            {bundleData.source_summary.problem_statement && (
                              <div>
                                <span className="font-medium text-red-700">Problem:</span>
                                <span className="ml-1 text-gray-600">{bundleData.source_summary.problem_statement}</span>
                              </div>
                            )}
                            {bundleData.source_summary.solution_summary && (
                              <div>
                                <span className="font-medium text-green-700">Solution:</span>
                                <span className="ml-1 text-gray-600">{bundleData.source_summary.solution_summary}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Core Concepts */}
                        {bundleData.core_concepts && bundleData.core_concepts.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Core Concepts</h5>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {bundleData.core_concepts.map((concept: string, i: number) => (
                              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                {concept}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Technical Features */}
                      {bundleData.technical_features && bundleData.technical_features.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Technical Features</h5>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {bundleData.technical_features.map((feature: string, i: number) => (
                              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                {feature}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Synonyms */}
                      {bundleData.synonym_groups && bundleData.synonym_groups.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Synonyms</h5>
                          <div className="mt-1 space-y-1">
                            {bundleData.synonym_groups.slice(0, 3).map((group: string[], i: number) => (
                              <div key={i} className="text-xs text-gray-600">
                                {group.join(', ')}
                              </div>
                            ))}
                            {bundleData.synonym_groups.length > 3 && (
                              <div className="text-xs text-gray-500">
                                +{bundleData.synonym_groups.length - 3} more groups
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* CPC/IPC Candidates */}
                      <div>
                        <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Classification</h5>
                        <div className="mt-1 space-y-1">
                          {bundleData.cpc_candidates && bundleData.cpc_candidates.length > 0 && (
                            <div className="text-xs">
                              <span className="font-medium text-purple-700">CPC:</span>
                              <span className="ml-1 text-gray-600">{bundleData.cpc_candidates.slice(0, 3).join(', ')}</span>
                              {bundleData.cpc_candidates.length > 3 && (
                                <span className="text-gray-500"> +{bundleData.cpc_candidates.length - 3}</span>
                              )}
                            </div>
                          )}
                          {bundleData.ipc_candidates && bundleData.ipc_candidates.length > 0 && (
                            <div className="text-xs">
                              <span className="font-medium text-purple-700">IPC:</span>
                              <span className="ml-1 text-gray-600">{bundleData.ipc_candidates.slice(0, 3).join(', ')}</span>
                              {bundleData.ipc_candidates.length > 3 && (
                                <span className="text-gray-500"> +{bundleData.ipc_candidates.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                        {/* Query Variants Preview */}
                        {bundleData.query_variants && bundleData.query_variants.length > 0 && (
                          <div className="md:col-span-2">
                            <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Search Queries</h5>
                            <div className="mt-1 space-y-1">
                              {bundleData.query_variants.map((variant: any, i: number) => (
                                <div key={i} className="text-xs bg-white p-2 rounded border">
                                  <div className="flex justify-between items-start">
                                    <span className="font-medium text-gray-700 capitalize">{variant.label}:</span>
                                    <span className="text-gray-500 ml-2 flex-1 truncate" title={variant.q}>
                                      {variant.q.length > 100 ? `${variant.q.substring(0, 100)}...` : variant.q}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderBundleEditor = () => {
    if (!bundleData) return null

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Edit Search Bundle</h3>
          <button
            onClick={() => setMode('select')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to bundles
          </button>
        </div>

        {/* Source Summary */}
        <div className="bg-white border rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Source Summary</h4>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm text-gray-700">Title</label>
              <input
                type="text"
                value={bundleData.source_summary?.title || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  source_summary: {
                    ...bundleData.source_summary,
                    title: e.target.value
                  }
                })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            {/* Editable problem and solution */}
            <div>
              <label className="block text-sm text-gray-700">Problem Statement</label>
              <textarea
                value={bundleData.source_summary?.problem_statement || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  source_summary: {
                    ...bundleData.source_summary,
                    problem_statement: e.target.value
                  }
                })}
                placeholder="Describe the problem this invention solves..."
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700">Solution Summary</label>
              <textarea
                value={bundleData.source_summary?.solution_summary || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  source_summary: {
                    ...bundleData.source_summary,
                    solution_summary: e.target.value
                  }
                })}
                placeholder="Describe how this invention solves the problem..."
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-sm"
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* LLM-Generated Content Editor */}
        <div className="bg-white border rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">LLM Analysis Results</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Core Concepts */}
            <div>
              <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">Core Concepts</label>
              <textarea
                value={(bundleData.core_concepts || []).join('\n')}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  core_concepts: e.target.value.split('\n').filter(c => c.trim()).map(c => c.trim())
                })}
                placeholder="One concept per line"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Key technical concepts (one per line)</p>
            </div>

            {/* Technical Features */}
            <div>
              <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">Technical Features</label>
              <textarea
                value={(bundleData.technical_features || []).join('\n')}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  technical_features: e.target.value.split('\n').filter(f => f.trim()).map(f => f.trim())
                })}
                placeholder="One feature per line"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Technical features and capabilities</p>
            </div>

            {/* Synonyms */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">Synonym Groups</label>
              <textarea
                value={(bundleData.synonym_groups || []).map((group: string[]) => group.join(', ')).join('\n')}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  synonym_groups: e.target.value.split('\n').filter((line: string) => line.trim()).map((line: string) =>
                    line.split(',').map((s: string) => s.trim()).filter((s: string) => s)
                  )
                })}
                placeholder="sensor, detector, transducer&#10;package, parcel, container"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">Synonym groups (comma-separated, one group per line)</p>
            </div>

            {/* Classification Codes */}
            <div>
              <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">CPC Codes</label>
              <input
                type="text"
                value={(bundleData.cpc_candidates || []).join(', ')}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  cpc_candidates: e.target.value.split(',').map(c => c.trim()).filter(c => c)
                })}
                placeholder="B65D, G01S, G08B"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Cooperative Patent Classification codes</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">IPC Codes</label>
              <input
                type="text"
                value={(bundleData.ipc_candidates || []).join(', ')}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  ipc_candidates: e.target.value.split(',').map(c => c.trim()).filter(c => c)
                })}
                placeholder="B65D1/00, G01S1/00, G08B1/08"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">International Patent Classification codes</p>
            </div>

            {/* Domain Tags */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">Technology Domains</label>
              <input
                type="text"
                value={(bundleData.domain_tags || []).join(', ')}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  domain_tags: e.target.value.split(',').map(d => d.trim()).filter(d => d)
                })}
                placeholder="logistics, transportation, sensors"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Technology domains (comma-separated)</p>
            </div>

          </div>
        </div>

        {/* Query Variants */}
        <div className="bg-white border rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Query Variants</h4>
          {bundleData.query_variants?.map((variant: any, index: number) => (
            <div key={index} className="mb-4 p-3 bg-gray-50 rounded">
              <h5 className="text-sm font-medium text-gray-700 capitalize">{variant.label} Search</h5>
              <div className="mt-2">
                <label className="block text-xs text-gray-600">Query</label>
                <textarea
                  value={variant.q}
                  onChange={(e) => {
                    const newVariants = [...bundleData.query_variants]
                    newVariants[index] = { ...newVariants[index], q: e.target.value }
                    setBundleData({ ...bundleData, query_variants: newVariants })
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  rows={2}
                  maxLength={300}
                />
                <p className="text-xs text-gray-500">{variant.q.length}/300 characters</p>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-600">Notes</label>
                <input
                  type="text"
                  value={variant.notes}
                  onChange={(e) => {
                    const newVariants = [...bundleData.query_variants]
                    newVariants[index] = { ...newVariants[index], notes: e.target.value }
                    setBundleData({ ...bundleData, query_variants: newVariants })
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Advanced Settings */}
        <div className="bg-white border rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Advanced Settings</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Phrases */}
            <div>
              <label className="block text-sm text-gray-700">Exact Phrases</label>
              <textarea
                value={bundleData.phrases?.join('\n') || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  phrases: e.target.value.split('\n').filter(p => p.trim())
                })}
                placeholder="One phrase per line"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Add exact phrases to search for</p>
            </div>

            {/* Exclude Terms */}
            <div>
              <label className="block text-sm text-gray-700">Exclude Terms</label>
              <textarea
                value={bundleData.exclude_terms?.join('\n') || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  exclude_terms: e.target.value.split('\n').filter(p => p.trim())
                })}
                placeholder="One term per line"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Terms to exclude from search</p>
            </div>

            {/* Domain Tags */}
            <div>
              <label className="block text-sm text-gray-700">Domain Tags</label>
              <input
                type="text"
                value={bundleData.domain_tags?.join(', ') || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  domain_tags: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                })}
                placeholder="logistics, transportation"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Technology domains (comma-separated)</p>
            </div>

            {/* Sensitive Tokens */}
            <div>
              <label className="block text-sm text-gray-700">Sensitive Tokens</label>
              <textarea
                value={bundleData.sensitive_tokens?.join('\n') || ''}
                onChange={(e) => setBundleData({
                  ...bundleData,
                  sensitive_tokens: e.target.value.split('\n').filter(p => p.trim())
                })}
                placeholder="Client names, internal terms"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                rows={2}
              />
              <p className="text-xs text-gray-500 mt-1">Terms that shouldn't appear in approved bundles</p>
            </div>
          </div>
        </div>

        {/* Validation & Actions */}
        <div className="bg-white border rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <button
                onClick={handleValidateBundle}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Validate Bundle
              </button>

              {validation && (
                <span className={`ml-2 text-sm ${validation.isValid ? 'text-green-600' : 'text-red-600'}`}>
                  {validation.isValid ? '✓ Valid' : '✗ Invalid'}
                </span>
              )}
            </div>

            <button
              onClick={handleApproveBundle}
              disabled={isLoading || !validation?.isValid}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
            >
              {isLoading ? 'Approving...' : 'Approve for Search'}
            </button>
          </div>

          {validation?.errors && validation.errors.length > 0 && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
              <h5 className="text-sm font-medium text-red-800">Validation Errors:</h5>
              <ul className="mt-1 text-sm text-red-700 list-disc list-inside">
                {validation.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {guardrails?.warnings && guardrails.warnings.length > 0 && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <h5 className="text-sm font-medium text-yellow-800">Guardrail Warnings:</h5>
              <ul className="mt-1 text-sm text-yellow-700 list-disc list-inside">
                {guardrails.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    )
  }


// Success Dialog
const renderSuccessDialog = () => {
  if (!showSuccessDialog || !newlyCreatedBundle) return null

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <div className="flex items-center justify-center mb-4">
            <div className="flex-shrink-0">
              <svg className="h-8 w-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="ml-3 text-lg font-medium text-gray-900">Bundle Created Successfully!</h3>
          </div>
          <div className="mt-2 px-7 py-3">
            <p className="text-sm text-gray-500">
              Your prior art search bundle has been generated and saved. What would you like to do next?
            </p>
          </div>
          <div className="flex flex-col space-y-3 px-7 py-4">
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleStayOnList}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
              >
                Stay on List
              </button>
              <button
                onClick={handleViewBundle}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                View & Edit Bundle
              </button>
            </div>
            {newlyCreatedBundle?.status === 'APPROVED' && (
              <div className="border-t pt-3">
                <button
                  onClick={handleGoToSearch}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
                >
                  🚀 Start Prior Art Search
                </button>
                <p className="text-xs text-gray-500 mt-1 text-center">
                  Execute the search with your approved bundle
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Main render with success dialog overlay
return (
  <div className="relative">
    {(() => {
      // Show bundle list if we have bundles and are not in create/edit mode
      if (mode === 'select' || (bundles.length > 0 && mode !== 'create' && mode !== 'edit' && mode !== 'review')) {
        return renderBundleList()
      }

      if (mode === 'create') {
        return renderModeSelection()
      }

      if (mode === 'edit' || mode === 'review') {
        return renderBundleEditor()
      }

      // Default: show bundle list if we have bundles, otherwise show create mode
      if (bundles.length > 0) {
        return renderBundleList()
      }

      return renderModeSelection()
    })()}
    {renderSuccessDialog()}
  </div>
)
}
