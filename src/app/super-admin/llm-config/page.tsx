'use client'

/**
 * Super Admin LLM Configuration Page
 * 
 * Allows super admin to:
 * - View/manage all LLM models
 * - View/manage workflow stages
 * - Configure which model to use for each stage per plan
 * - Set fallback models and token limits
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

interface LLMModel {
  id: string
  code: string
  displayName: string
  provider: string
  contextWindow: number
  supportsVision: boolean
  supportsStreaming: boolean
  inputCostPer1M: number
  outputCostPer1M: number
  isActive: boolean
  isDefault: boolean
}

interface WorkflowStage {
  id: string
  code: string
  displayName: string
  featureCode: string
  description: string | null
  sortOrder: number
  isActive: boolean
}

interface Plan {
  id: string
  code: string
  name: string
}

interface StageConfig {
  id: string
  plan: { id: string; code: string; name: string }
  stage: { id: string; code: string; displayName: string; featureCode: string }
  model: { id: string; code: string; displayName: string; provider: string }
  fallbackModelIds: string | null
  maxTokensIn: number | null
  maxTokensOut: number | null
  temperature: number | null
}

interface ProviderInfo {
  name: string
  modelCount: number
  hasApiKey: boolean
}

const PROVIDER_COLORS: Record<string, string> = {
  google: 'bg-blue-100 text-blue-800 border-blue-200',
  openai: 'bg-green-100 text-green-800 border-green-200',
  anthropic: 'bg-orange-100 text-orange-800 border-orange-200',
  deepseek: 'bg-purple-100 text-purple-800 border-purple-200',
  groq: 'bg-pink-100 text-pink-800 border-pink-200'
}

const FEATURE_LABELS: Record<string, string> = {
  PATENT_DRAFTING: 'Patent Drafting',
  PRIOR_ART_SEARCH: 'Prior Art Search',
  NOVELTY_SEARCH: 'Novelty Search',
  DIAGRAM_GENERATION: 'Diagram Generation',
  IDEA_BANK: 'Idea Bank',
  IDEATION: 'Ideation Engine'
  // Note: Content Generation was removed - all superset section stages
  // (DRAFT_ANNEXURE_*) are now under PATENT_DRAFTING feature
}

// Stages that DO NOT use LLMs (excluded from LLM control)
const NON_LLM_STAGES = [
  'DRAFT_COMPONENT_PLANNER',  // Manual UI - no LLM
  'DRAFT_EXPORT'              // Document generation - no LLM
]

// Ideation stage metadata - helps Super Admin choose appropriate models
// Stages marked as 'lightweight' can use faster, cheaper models (Flash, Mini, Haiku)
// Stages marked as 'advanced' benefit from more capable models (Pro, Sonnet, GPT-4o)
// NEW PIPELINE: SEED_INPUT → SEMANTIC_GROUNDING → INVENTIVE_FRAMING → 
//   DIMENSION_DISCOVERY → DIMENSION_EXPANSION → IDEA_GENERATION → PRELIMINARY_NOVELTY_ASSESSMENT
const IDEATION_STAGE_INFO: Record<string, { complexity: 'lightweight' | 'advanced' | 'deprecated'; tip: string }> = {
  'IDEATION_NORMALIZE': {
    complexity: 'lightweight',
    tip: '🔍 Semantic Grounding - understands idea without inventing/reframing - Flash/Mini models work well'
  },
  'IDEATION_CLASSIFY': {
    complexity: 'lightweight',
    tip: '🎯 Inventive Framing - identifies genuine tensions (not forced TRIZ) - Flash/Mini sufficient'
  },
  'IDEATION_CONTRADICTION_MAPPING': {
    complexity: 'deprecated',
    tip: '⚠️ LEGACY - No longer used in new pipeline. Replaced by INVENTIVE_FRAMING stage.'
  },
  'IDEATION_EXPAND': {
    complexity: 'lightweight',
    tip: '🌳 Dimension Discovery & Expansion - generates invention-specific dimensions - Flash/Mini models handle this well'
  },
  'IDEATION_OBVIOUSNESS_FILTER': {
    complexity: 'deprecated',
    tip: '⚠️ LEGACY - No longer used in new pipeline. Obviousness gating removed per SRS.'
  },
  'IDEATION_GENERATE': {
    complexity: 'advanced',
    tip: '💡 Mechanism-Pure Idea Generation - EXACTLY ONE causal mechanism per idea - Recommend Pro/Sonnet/GPT-4o for quality'
  },
  'IDEATION_NOVELTY': {
    complexity: 'advanced',
    tip: '🔬 Preliminary Novelty Assessment (LLM-only, no prior art) - conceptual originality check - Recommend Pro/Sonnet/GPT-4o'
  }
}

// Superset sections that use LLMs for content generation
// These correspond to the superset sections defined in MasterSeed.js
// All section stages are under PATENT_DRAFTING feature (DRAFT_ANNEXURE_* stages)
// The admin can configure which LLM model to use for each section per plan
// Jurisdiction-specific sections map to these via CountrySectionMapping
const SUPERSET_SECTION_STAGES = [
  'title',                      // Title of the Invention
  'preamble',                   // Legal Preamble
  'fieldOfInvention',           // Field of the Invention
  'background',                 // Background of the Invention
  'objectsOfInvention',         // Objects of the Invention
  'summary',                    // Summary of the Invention
  'technicalProblem',           // Technical Problem (EP/JP)
  'technicalSolution',          // Technical Solution (EP/JP)
  'advantageousEffects',        // Advantageous Effects (JP)
  'briefDescriptionOfDrawings', // Brief Description of Drawings
  'detailedDescription',        // Detailed Description
  'bestMethod',                 // Best Mode (AU)
  'industrialApplicability',    // Industrial Applicability (PCT/JP)
  'claims',                     // Claims
  'abstract',                   // Abstract
  'listOfNumerals',             // List of Reference Numerals
  'crossReference'              // Cross-Reference to Related Applications
]

// Mapping from superset section keys to workflow stage codes
// Used to look up the correct model configuration for a section
const SECTION_TO_STAGE_MAP: Record<string, string> = {
  'title': 'DRAFT_ANNEXURE_TITLE',
  'preamble': 'DRAFT_ANNEXURE_PREAMBLE',
  'fieldOfInvention': 'DRAFT_ANNEXURE_FIELD',
  'background': 'DRAFT_ANNEXURE_BACKGROUND',
  'objectsOfInvention': 'DRAFT_ANNEXURE_OBJECTS',
  'summary': 'DRAFT_ANNEXURE_SUMMARY',
  'technicalProblem': 'DRAFT_ANNEXURE_TECHNICAL_PROBLEM',
  'technicalSolution': 'DRAFT_ANNEXURE_TECHNICAL_SOLUTION',
  'advantageousEffects': 'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS',
  'briefDescriptionOfDrawings': 'DRAFT_ANNEXURE_DRAWINGS',
  'detailedDescription': 'DRAFT_ANNEXURE_DESCRIPTION',
  'bestMethod': 'DRAFT_ANNEXURE_BEST_MODE',
  'industrialApplicability': 'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY',
  'claims': 'DRAFT_ANNEXURE_CLAIMS',
  'abstract': 'DRAFT_ANNEXURE_ABSTRACT',
  'listOfNumerals': 'DRAFT_ANNEXURE_NUMERALS',
  'crossReference': 'DRAFT_ANNEXURE_CROSS_REFERENCE'
}

export default function LLMConfigPage() {
  noStore()

  const { user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'stages' | 'configs'>('overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Data states
  const [models, setModels] = useState<LLMModel[]>([])
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [stageConfigs, setStageConfigs] = useState<StageConfig[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  // Selection states
  const [selectedPlan, setSelectedPlan] = useState<string>('')
  const [selectedFeature, setSelectedFeature] = useState<string>('PATENT_DRAFTING')

  // Edit states
  const [editingConfig, setEditingConfig] = useState<{
    stageId: string
    modelId: string
    fallbacks: string[]
    maxTokensIn?: number
    maxTokensOut?: number
  } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/super-admin/llm-config?section=all', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch LLM configuration')
      }

      const data = await response.json()
      setModels(data.models || [])
      setStages(data.stages || [])
      setPlans(data.plans || [])
      setStageConfigs(data.stageConfigs || [])
      setProviders(data.providers || [])

      if (data.plans?.length > 0 && !selectedPlan) {
        setSelectedPlan(data.plans[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [selectedPlan])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.includes('SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }

    fetchData()
  }, [user, fetchData])

  const handleSetStageModel = async (stageId: string, modelId: string, fallbacks: string[] = [], maxTokensIn?: number, maxTokensOut?: number) => {
    if (!selectedPlan) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'set_stage_model',
          planId: selectedPlan,
          stageId,
          modelId,
          fallbackModelIds: fallbacks.length > 0 ? fallbacks : undefined,
          maxTokensIn,
          maxTokensOut
        })
      })

      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || 'Failed to update configuration')
      }

      setSuccess('Configuration updated successfully')
      setEditingConfig(null)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleModel = async (modelId: string, isActive: boolean) => {
    try {
      setSaving(true)
      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'toggle_model',
          id: modelId,
          isActive
        })
      })

      if (!response.ok) throw new Error('Failed to toggle model')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle')
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (modelId: string) => {
    try {
      setSaving(true)
      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'set_default_model',
          id: modelId
        })
      })

      if (!response.ok) throw new Error('Failed to set default')
      setSuccess('Default model updated')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default')
    } finally {
      setSaving(false)
    }
  }

  const handleCopyConfig = async (sourcePlanId: string, targetPlanId: string) => {
    try {
      setSaving(true)
      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'copy_plan_config',
          sourcePlanId,
          targetPlanId
        })
      })

      if (!response.ok) throw new Error('Failed to copy configuration')
      setSuccess('Configuration copied successfully')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy')
    } finally {
      setSaving(false)
    }
  }

  const formatCost = (costPer1M: number) => {
    return `$${(costPer1M / 100).toFixed(2)}`
  }

  const getConfigForStage = (stageId: string): StageConfig | undefined => {
    return stageConfigs.find(c => c.stage.id === stageId && c.plan.id === selectedPlan)
  }

  // Filter stages by feature and exclude stages that don't use LLMs
  const filteredStages = stages.filter(s => 
    s.featureCode === selectedFeature && !NON_LLM_STAGES.includes(s.code)
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-white">LLM Model Configuration</h1>
              <p className="text-slate-400 text-sm mt-1">
                Configure which AI models to use for each stage and plan
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">Super Admin: {user?.email}</span>
              <button
                onClick={() => logout()}
                className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'models', label: 'Models Registry' },
              { id: 'stages', label: 'Workflow Stages' },
              { id: 'configs', label: 'Plan Configurations' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.id
                    ? 'border-cyan-400 text-cyan-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="float-right">&times;</button>
          </div>
        </div>
      )}
      {success && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-lg">
            {success}
            <button onClick={() => setSuccess(null)} className="float-right">&times;</button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Provider Status */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4">Provider Status</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {providers.map(p => (
                  <div
                    key={p.name}
                    className={`p-4 rounded-lg border ${
                      p.hasApiKey ? 'bg-slate-700 border-slate-600' : 'bg-slate-800 border-slate-700 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${p.hasApiKey ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="font-medium capitalize">{p.name}</span>
                    </div>
                    <div className="text-sm text-slate-400">
                      {p.modelCount} models
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {p.hasApiKey ? 'API Key configured' : 'No API Key'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-cyan-400">{models.length}</div>
                <div className="text-slate-400">Total Models</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-green-400">{models.filter(m => m.isActive).length}</div>
                <div className="text-slate-400">Active Models</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-purple-400">{stages.length}</div>
                <div className="text-slate-400">Workflow Stages</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-orange-400">{stageConfigs.length}</div>
                <div className="text-slate-400">Stage Configurations</div>
              </div>
            </div>

            {/* System Default */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4">System Default Model</h2>
              <p className="text-sm text-slate-400 mb-4">
                This model is used when no specific configuration is found for a plan/stage combination.
              </p>
              {models.find(m => m.isDefault) ? (
                <div className="flex items-center gap-4 p-4 bg-slate-700 rounded-lg">
                  <div className={`px-3 py-1 rounded-full text-xs font-medium border ${PROVIDER_COLORS[models.find(m => m.isDefault)!.provider] || 'bg-slate-600'}`}>
                    {models.find(m => m.isDefault)!.provider}
                  </div>
                  <div>
                    <div className="font-medium">{models.find(m => m.isDefault)!.displayName}</div>
                    <div className="text-sm text-slate-400">{models.find(m => m.isDefault)!.code}</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">No default model set</div>
              )}
            </div>
          </div>
        )}

        {/* Models Tab */}
        {activeTab === 'models' && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">LLM Models Registry</h2>
              <p className="text-sm text-slate-400">All available models that can be assigned to stages</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Model</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Provider</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Context</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Features</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Cost/1M</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {models.map(model => (
                    <tr key={model.id} className={`hover:bg-slate-700/30 ${!model.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{model.displayName}</div>
                        <div className="text-xs text-slate-500">{model.code}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${PROVIDER_COLORS[model.provider] || 'bg-slate-600'}`}>
                          {model.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {(model.contextWindow / 1000).toFixed(0)}K
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {model.supportsVision && (
                            <span className="px-2 py-0.5 bg-blue-900/50 text-blue-300 text-xs rounded">Vision</span>
                          )}
                          {model.supportsStreaming && (
                            <span className="px-2 py-0.5 bg-green-900/50 text-green-300 text-xs rounded">Stream</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div>In: {formatCost(model.inputCostPer1M)}</div>
                        <div className="text-slate-400">Out: {formatCost(model.outputCostPer1M)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${model.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
                          <span className="text-sm">{model.isActive ? 'Active' : 'Inactive'}</span>
                          {model.isDefault && (
                            <span className="px-2 py-0.5 bg-cyan-900/50 text-cyan-300 text-xs rounded">Default</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleToggleModel(model.id, !model.isActive)}
                            disabled={saving}
                            className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded transition"
                          >
                            {model.isActive ? 'Disable' : 'Enable'}
                          </button>
                          {!model.isDefault && model.isActive && (
                            <button
                              onClick={() => handleSetDefault(model.id)}
                              disabled={saving}
                              className="px-2 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 rounded transition"
                            >
                              Set Default
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stages Tab */}
        {activeTab === 'stages' && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">Workflow Stages</h2>
              <p className="text-sm text-slate-400">All stages that can have model configurations</p>
            </div>
            <div className="p-4">
              {Object.entries(FEATURE_LABELS).map(([featureCode, featureLabel]) => {
                const featureStages = stages.filter(s => s.featureCode === featureCode)
                if (featureStages.length === 0) return null

                return (
                  <div key={featureCode} className="mb-6">
                    <h3 className="text-md font-medium text-slate-300 mb-3">{featureLabel}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {featureStages.map(stage => (
                        <div
                          key={stage.id}
                          className={`p-4 rounded-lg border ${
                            stage.isActive ? 'bg-slate-700 border-slate-600' : 'bg-slate-800 border-slate-700 opacity-50'
                          }`}
                        >
                          <div className="font-medium">{stage.displayName}</div>
                          <div className="text-xs text-slate-500 mt-1">{stage.code}</div>
                          {stage.description && (
                            <div className="text-sm text-slate-400 mt-2">{stage.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Configurations Tab */}
        {activeTab === 'configs' && (
          <div className="space-y-6">
            {/* Plan & Feature Selection */}
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Select Plan</label>
                <select
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
                >
                  {plans.map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name} ({plan.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Feature</label>
                <select
                  value={selectedFeature}
                  onChange={(e) => setSelectedFeature(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
                >
                  {Object.entries(FEATURE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="ml-auto">
                <label className="block text-sm text-slate-400 mb-1">Copy Config From</label>
                <select
                  onChange={(e) => {
                    if (e.target.value && selectedPlan) {
                      handleCopyConfig(e.target.value, selectedPlan)
                      e.target.value = ''
                    }
                  }}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
                >
                  <option value="">Select plan to copy from...</option>
                  {plans.filter(p => p.id !== selectedPlan).map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Stage Configurations */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="p-4 border-b border-slate-700">
                <h2 className="text-lg font-semibold">
                  {FEATURE_LABELS[selectedFeature]} - {plans.find(p => p.id === selectedPlan)?.name || 'Select Plan'}
                </h2>
                <p className="text-sm text-slate-400">Configure which model to use for each stage</p>
              </div>
              <div className="divide-y divide-slate-700">
                {filteredStages.map(stage => {
                  const config = getConfigForStage(stage.id)
                  const isEditing = editingConfig?.stageId === stage.id

                  return (
                    <div key={stage.id} className="p-4 hover:bg-slate-700/30">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{stage.displayName}</div>
                          <div className="text-xs text-slate-500">{stage.code}</div>
                          {stage.description && (
                            <div className="text-sm text-slate-400 mt-1">{stage.description}</div>
                          )}
                          {/* Show model recommendation for ideation stages */}
                          {IDEATION_STAGE_INFO[stage.code] && (
                            <div className={`text-xs mt-2 px-2 py-1 rounded inline-flex items-center gap-1 ${
                              IDEATION_STAGE_INFO[stage.code].complexity === 'lightweight' 
                                ? 'bg-green-900/30 text-green-400 border border-green-700/50' 
                                : 'bg-amber-900/30 text-amber-400 border border-amber-700/50'
                            }`}>
                              <span>{IDEATION_STAGE_INFO[stage.code].complexity === 'lightweight' ? '⚡' : '🧠'}</span>
                              <span>{IDEATION_STAGE_INFO[stage.code].tip}</span>
                            </div>
                          )}
                        </div>

                        {isEditing ? (
                            <div className="flex flex-col gap-3">
                                            <div className="flex items-center gap-4">
                                              <div className="flex-1">
                                                <label className="block text-xs text-slate-400 mb-1">Primary Model</label>
                                                <select
                                                  value={editingConfig.modelId}
                                                  onChange={(e) => setEditingConfig({ ...editingConfig, modelId: e.target.value })}
                                                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
                                                >
                                                  <option value="">Select model...</option>
                                                  {models.filter(m => m.isActive).map(model => (
                                                    <option key={model.id} value={model.id}>
                                                      {model.displayName} ({model.provider})
                                                    </option>
                                                  ))}
                                                </select>
                                              </div>
                                              <div className="w-36">
                                                <label className="block text-xs text-slate-400 mb-1">Max Input Tokens</label>
                                                <input
                                                  type="number"
                                                  placeholder="e.g. 4000"
                                                  value={editingConfig.maxTokensIn || ''}
                                                  onChange={(e) => setEditingConfig({ 
                                                    ...editingConfig, 
                                                    maxTokensIn: e.target.value ? parseInt(e.target.value) : undefined 
                                                  })}
                                                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
                                                />
                                              </div>
                                              <div className="w-36">
                                                <label className="block text-xs text-slate-400 mb-1">Max Output Tokens</label>
                                                <input
                                                  type="number"
                                                  placeholder="e.g. 4096"
                                                  value={editingConfig.maxTokensOut || ''}
                                                  onChange={(e) => setEditingConfig({ 
                                                    ...editingConfig, 
                                                    maxTokensOut: e.target.value ? parseInt(e.target.value) : undefined 
                                                  })}
                                                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
                                                />
                                              </div>
                                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Fallback Models (up to 3)</label>
                              <div className="flex flex-wrap gap-2">
                                {models.filter(m => m.isActive && m.id !== editingConfig.modelId).slice(0, 10).map(model => {
                                  const isSelected = editingConfig.fallbacks.includes(model.id)
                                  const canSelect = editingConfig.fallbacks.length < 3 || isSelected
                                  return (
                                    <button
                                      key={model.id}
                                      type="button"
                                      disabled={!canSelect && !isSelected}
                                      onClick={() => {
                                        if (isSelected) {
                                          setEditingConfig({
                                            ...editingConfig,
                                            fallbacks: editingConfig.fallbacks.filter(id => id !== model.id)
                                          })
                                        } else if (canSelect) {
                                          setEditingConfig({
                                            ...editingConfig,
                                            fallbacks: [...editingConfig.fallbacks, model.id]
                                          })
                                        }
                                      }}
                                      className={`px-2 py-1 text-xs rounded border transition ${
                                        isSelected 
                                          ? 'bg-cyan-600 border-cyan-500 text-white' 
                                          : canSelect
                                            ? 'bg-slate-700 border-slate-600 hover:border-slate-500'
                                            : 'bg-slate-800 border-slate-700 opacity-50 cursor-not-allowed'
                                      }`}
                                    >
                                      {model.displayName}
                                    </button>
                                  )
                                })}
                              </div>
                              {editingConfig.fallbacks.length > 0 && (
                                <div className="text-xs text-slate-400 mt-1">
                                  Fallback order: {editingConfig.fallbacks.map(id => 
                                    models.find(m => m.id === id)?.displayName
                                  ).join(' → ')}
                                </div>
                              )}
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditingConfig(null)}
                                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                              >
                                Cancel
                              </button>
                              <button
                                                onClick={() => handleSetStageModel(
                                                  stage.id,
                                                  editingConfig.modelId,
                                                  editingConfig.fallbacks,
                                                  editingConfig.maxTokensIn,
                                                  editingConfig.maxTokensOut
                                                )}
                                                disabled={saving || !editingConfig.modelId}
                                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-medium disabled:opacity-50"
                                              >
                                                {saving ? 'Saving...' : 'Save'}
                                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4">
                            {config ? (
                                              <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-3">
                                                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${PROVIDER_COLORS[config.model.provider] || 'bg-slate-600'}`}>
                                                    {config.model.provider}
                                                  </span>
                                                  <span className="font-medium">{config.model.displayName}</span>
                                                  {(config.maxTokensIn || config.maxTokensOut) && (
                                                    <span className="text-xs text-slate-400">
                                                      {config.maxTokensIn && `in: ${config.maxTokensIn.toLocaleString()}`}
                                                      {config.maxTokensIn && config.maxTokensOut && ' / '}
                                                      {config.maxTokensOut && `out: ${config.maxTokensOut.toLocaleString()}`}
                                                    </span>
                                                  )}
                                                </div>
                                {config.fallbackModelIds && (() => {
                                  try {
                                    const fallbackIds = JSON.parse(config.fallbackModelIds)
                                    if (Array.isArray(fallbackIds) && fallbackIds.length > 0) {
                                      const fallbackNames = fallbackIds
                                        .map((id: string) => models.find(m => m.id === id)?.displayName)
                                        .filter(Boolean)
                                      if (fallbackNames.length > 0) {
                                        return (
                                          <div className="text-xs text-slate-500">
                                            Fallbacks: {fallbackNames.join(' → ')}
                                          </div>
                                        )
                                      }
                                    }
                                    return null
                                  } catch { return null }
                                })()}
                              </div>
                            ) : (
                              <span className="text-slate-500 italic">Not configured</span>
                            )}
                            <button
                                              onClick={() => setEditingConfig({
                                                stageId: stage.id,
                                                modelId: config?.model.id || '',
                                                fallbacks: config?.fallbackModelIds ? JSON.parse(config.fallbackModelIds) : [],
                                                maxTokensIn: config?.maxTokensIn || undefined,
                                                maxTokensOut: config?.maxTokensOut || undefined
                                              })}
                                              className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm transition"
                                            >
                                              {config ? 'Edit' : 'Configure'}
                                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
