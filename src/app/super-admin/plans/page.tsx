'use client'

/**
 * Super Admin - Plans & Pricing
 *
 * Full control surface over the commercial ladder: which features each plan includes,
 * the completion and token quotas behind them, published prices in USD and INR, the LLM
 * model tiers the plan may use, and seat / jurisdiction limits.
 *
 * Everything here writes to the same rows the runtime enforces against, so a change is
 * live for every tenant on the plan as soon as it saves.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import {
  AlertTriangle,
  Check,
  Coins,
  Cpu,
  Info,
  Loader2,
  RotateCcw,
  Save,
  Users,
} from 'lucide-react'

// ============================================================================
// Types (mirror of /api/v1/admin/plans)
// ============================================================================

interface CatalogGrant {
  monthlyQuota: number
  dailyQuota: number
  monthlyTokenLimit?: number | null
  dailyTokenLimit?: number | null
}

interface PlanFeatureRow {
  featureCode: string
  name: string
  unit: string
  description: string
  enabled: boolean
  monthlyQuota: number | null
  dailyQuota: number | null
  monthlyTokenLimit: number | null
  dailyTokenLimit: number | null
  catalogDefault: CatalogGrant | null
}

interface PlanRow {
  id: string
  code: string
  publicCode: string
  name: string
  cycle: string
  status: string
  tier: number
  tagline: string
  isCatalogPlan: boolean
  isCustomPriced: boolean
  trialDays: number | null
  tenantCount: number
  userCount: number
  totalAssignments: number
  features: PlanFeatureRow[]
  pricing: {
    monthly: { priceUSD: number; priceINR: number }
    yearly: { priceUSD: number; priceINR: number }
    yearlyDiscountMonths: number
    isActive: boolean
  }
  modelClasses: {
    allowed: string[]
    default: string
    taskCount: number
    perTaskOverrides: boolean
  }
  policy: {
    maxSeats: number
    maxJurisdictionsPerPatent: number
  }
}

interface ApiResponse {
  plans: PlanRow[]
  catalog: {
    features: { code: string; name: string; unit: string; description: string }[]
    modelClasses: string[]
    planCodes: string[]
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Minor units (cents/paise) -> major units for display. */
const toMajor = (minor: number) => (minor / 100).toString()

/** Major units from an input -> minor units for the API. Blank means zero. */
const toMinor = (major: string) => {
  const n = Number(major)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

const MODEL_CLASS_LABELS: Record<string, string> = {
  BASE_S: 'Base S',
  BASE_M: 'Base M',
  PRO_M: 'Pro M',
  PRO_L: 'Pro L',
  ADVANCED: 'Advanced',
}

function formatTokens(value: number | null): string {
  if (value === null) return ''
  return String(value)
}

// ============================================================================
// Page
// ============================================================================

export default function PlansAdminPage() {
  noStore()

  const { user, logout } = useAuth()
  const { toast } = useToast()

  const [plans, setPlans] = useState<PlanRow[]>([])
  const [catalog, setCatalog] = useState<ApiResponse['catalog'] | null>(null)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
    }),
    []
  )

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/v1/admin/plans', { headers: authHeaders() })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load plans')
      }

      const data: ApiResponse = await response.json()
      setPlans(data.plans)
      setCatalog(data.catalog)
      setDirty(new Set())
      setSelectedCode((current) => current ?? data.plans[0]?.code ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some((role) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }
    void fetchPlans()
  }, [user, fetchPlans])

  const canEdit = user?.roles?.includes('SUPER_ADMIN') ?? false
  const selected = useMemo(
    () => plans.find((p) => p.code === selectedCode) ?? null,
    [plans, selectedCode]
  )

  // --------------------------------------------------------------------------
  // Mutation helpers - every edit marks the plan dirty so Save sends only changes
  // --------------------------------------------------------------------------

  const mutate = useCallback((code: string, update: (plan: PlanRow) => PlanRow) => {
    setPlans((current) => current.map((p) => (p.code === code ? update(p) : p)))
    setDirty((current) => new Set(current).add(code))
  }, [])

  const setFeatureField = (
    code: string,
    featureCode: string,
    field: keyof PlanFeatureRow,
    value: unknown
  ) => {
    mutate(code, (plan) => ({
      ...plan,
      features: plan.features.map((f) =>
        f.featureCode === featureCode ? { ...f, [field]: value } : f
      ),
    }))
  }

  const setQuota = (code: string, featureCode: string, field: keyof PlanFeatureRow, raw: string) => {
    const value = raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0))
    setFeatureField(code, featureCode, field, value)
  }

  const toggleFeature = (code: string, featureCode: string, enabled: boolean) => {
    mutate(code, (plan) => ({
      ...plan,
      features: plan.features.map((f) => {
        if (f.featureCode !== featureCode) return f
        // Enabling a feature that has never been configured seeds it from the catalog
        // default, so an admin never lands on an "enabled with no limits" row (which the
        // runtime denies).
        if (enabled && f.monthlyQuota === null && f.dailyQuota === null) {
          return {
            ...f,
            enabled,
            monthlyQuota: f.catalogDefault?.monthlyQuota ?? 10,
            dailyQuota: f.catalogDefault?.dailyQuota ?? 5,
            monthlyTokenLimit: f.catalogDefault?.monthlyTokenLimit ?? null,
            dailyTokenLimit: f.catalogDefault?.dailyTokenLimit ?? null,
          }
        }
        return { ...f, enabled }
      }),
    }))
  }

  const setPrice = (
    code: string,
    cycle: 'monthly' | 'yearly',
    currency: 'priceUSD' | 'priceINR',
    raw: string
  ) => {
    mutate(code, (plan) => ({
      ...plan,
      pricing: {
        ...plan.pricing,
        [cycle]: { ...plan.pricing[cycle], [currency]: toMinor(raw) },
      },
    }))
  }

  const toggleModelClass = (code: string, modelClass: string) => {
    mutate(code, (plan) => {
      const allowed = plan.modelClasses.allowed.includes(modelClass)
        ? plan.modelClasses.allowed.filter((c) => c !== modelClass)
        : [...plan.modelClasses.allowed, modelClass]

      const ordered = (catalog?.modelClasses ?? []).filter((c) => allowed.includes(c))
      const nextDefault = ordered.includes(plan.modelClasses.default)
        ? plan.modelClasses.default
        : ordered[ordered.length - 1] ?? plan.modelClasses.default

      return {
        ...plan,
        modelClasses: { ...plan.modelClasses, allowed: ordered, default: nextDefault },
      }
    })
  }

  const setPolicy = (code: string, field: 'maxSeats' | 'maxJurisdictionsPerPatent', raw: string) => {
    const value = Math.max(1, Math.floor(Number(raw) || 1))
    mutate(code, (plan) => ({ ...plan, policy: { ...plan.policy, [field]: value } }))
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  const handleSave = async () => {
    if (dirty.size === 0) return

    const payload = plans
      .filter((p) => dirty.has(p.code))
      .map((plan) => ({
        code: plan.code,
        name: plan.name,
        features: plan.features.map((f) => ({
          featureCode: f.featureCode,
          enabled: f.enabled,
          monthlyQuota: f.monthlyQuota,
          dailyQuota: f.dailyQuota,
          monthlyTokenLimit: f.monthlyTokenLimit,
          dailyTokenLimit: f.dailyTokenLimit,
        })),
        pricing: {
          monthly: plan.pricing.monthly,
          yearly: plan.pricing.yearly,
          yearlyDiscountMonths: plan.pricing.yearlyDiscountMonths,
          isActive: plan.pricing.isActive,
        },
        modelClasses: {
          allowed: plan.modelClasses.allowed,
          default: plan.modelClasses.default,
        },
        policy: plan.policy,
      }))

    try {
      setSaving(true)
      const response = await fetch('/api/v1/admin/plans', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ plans: payload }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to save plans')

      if (Array.isArray(body.warnings) && body.warnings.length > 0) {
        toast({
          title: 'Saved with warnings',
          description: body.warnings.join(' · '),
          variant: 'warning',
        })
      } else {
        toast({
          title: 'Plans updated',
          description: `${payload.length} plan${payload.length === 1 ? '' : 's'} saved and live for all tenants on them.`,
          variant: 'success',
        })
      }

      await fetchPlans()
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (code: string) => {
    try {
      setResetting(true)
      const response = await fetch('/api/v1/admin/plans', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'reset', planCode: code }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to reset plan')

      toast({
        title: 'Plan reset',
        description: `${code} restored to its catalog defaults.`,
        variant: 'success',
      })
      await fetchPlans()
    } catch (err) {
      toast({
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setResetting(false)
    }
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-lamp-600" />
      </div>
    )
  }

  if (!user.roles?.some((role) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Super admin privileges required.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white shadow">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex justify-between items-start gap-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Plans &amp; Pricing</h1>
            <p className="text-gray-600 mt-1 max-w-3xl">
              Controls what every plan includes, what it costs, and the limits enforced against it.
              Saving applies immediately to every tenant on that plan.
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="text-sm text-gray-500">{user.email}</span>
            <button
              onClick={() => logout()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        {!canEdit && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg">
            <Info className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">
              You are signed in as a viewer. Values are read-only.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-lamp-600" />
          </div>
        ) : (
          <>
            {/* Plan selector */}
            <div className="flex flex-wrap gap-3">
              {plans.map((plan) => {
                const isSelected = plan.code === selectedCode
                const isDirty = dirty.has(plan.code)
                return (
                  <button
                    key={plan.code}
                    onClick={() => setSelectedCode(plan.code)}
                    className={`text-left px-4 py-3 rounded-lg border transition-colors min-w-[190px] ${
                      isSelected
                        ? 'border-lamp-600 bg-lamp-50 ring-1 ring-lamp-600'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{plan.name}</span>
                      {isDirty && (
                        <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />
                      )}
                    </div>
                    <div className="text-xs font-mono text-gray-500 mt-0.5">{plan.code}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {plan.tenantCount} tenant{plan.tenantCount === 1 ? '' : 's'} ·{' '}
                      {plan.userCount} user{plan.userCount === 1 ? '' : 's'}
                    </div>
                  </button>
                )
              })}
            </div>

            {selected && (
              <div className="space-y-6">
                {/* Plan header */}
                <section className="bg-white rounded-lg shadow border p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-semibold text-gray-900">{selected.name}</h2>
                        {selected.isCustomPriced && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-lamp-100 text-lamp-700">
                            Sold one-to-one
                          </span>
                        )}
                        {selected.trialDays && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-lamp-100 text-lamp-700">
                            {selected.trialDays}-day trial
                          </span>
                        )}
                        {!selected.isCatalogPlan && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                            Custom plan
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{selected.tagline}</p>
                    </div>

                    {canEdit && selected.isCatalogPlan && (
                      <button
                        onClick={() => handleReset(selected.code)}
                        disabled={resetting}
                        className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset to defaults
                      </button>
                    )}
                  </div>
                </section>

                {/* Pricing */}
                <section className="bg-white rounded-lg shadow border p-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Coins className="h-5 w-5 text-gray-400" />
                    <h3 className="text-lg font-semibold text-gray-900">Pricing</h3>
                  </div>
                  <p className="text-sm text-gray-600 mb-5">
                    Entered in whole currency units. Reads through to the public pricing page and
                    Razorpay checkout on save.
                  </p>

                  {selected.isCustomPriced && (
                    <div className="flex items-start gap-3 bg-lamp-50 border border-lamp-200 text-lamp-800 px-4 py-3 rounded-lg mb-5">
                      <Info className="h-5 w-5 shrink-0 mt-0.5" />
                      <p className="text-sm">
                        This plan is negotiated per customer. The pricing page shows &ldquo;Contact
                        sales&rdquo; and self-serve checkout is rejected, whatever is entered here.
                        Values below are for reference on negotiated deals.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {(['monthly', 'yearly'] as const).map((cycle) => (
                      <div key={cycle} className="border rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 capitalize mb-3">{cycle}</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <label className="block">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              USD ($)
                            </span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              disabled={!canEdit}
                              value={toMajor(selected.pricing[cycle].priceUSD)}
                              onChange={(e) =>
                                setPrice(selected.code, cycle, 'priceUSD', e.target.value)
                              }
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              INR (₹)
                            </span>
                            <input
                              type="number"
                              min={0}
                              step="1"
                              disabled={!canEdit}
                              value={toMajor(selected.pricing[cycle].priceINR)}
                              onChange={(e) =>
                                setPrice(selected.code, cycle, 'priceINR', e.target.value)
                              }
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-6">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      Months free on annual
                      <input
                        type="number"
                        min={0}
                        max={11}
                        disabled={!canEdit}
                        value={selected.pricing.yearlyDiscountMonths}
                        onChange={(e) =>
                          mutate(selected.code, (plan) => ({
                            ...plan,
                            pricing: {
                              ...plan.pricing,
                              yearlyDiscountMonths: Math.max(
                                0,
                                Math.min(11, Math.floor(Number(e.target.value) || 0))
                              ),
                            },
                          }))
                        }
                        className="w-20 px-2 py-1 border border-gray-300 rounded-md disabled:bg-gray-50"
                      />
                    </label>

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={selected.pricing.isActive}
                        onChange={(e) =>
                          mutate(selected.code, (plan) => ({
                            ...plan,
                            pricing: { ...plan.pricing, isActive: e.target.checked },
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Publicly purchasable
                    </label>
                  </div>
                </section>

                {/* Features */}
                <section className="bg-white rounded-lg shadow border p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">Features &amp; quotas</h3>
                  <p className="text-sm text-gray-600 mb-5">
                    Switching a feature off removes it from the plan entirely, and the API denies it
                    for every tenant on this plan. Blank means no limit of that kind &mdash; but a
                    feature needs at least one limit, or it is denied at runtime.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50 text-gray-600">
                          <th className="px-4 py-2.5 text-left font-medium">Included</th>
                          <th className="px-4 py-2.5 text-left font-medium">Feature</th>
                          <th className="px-4 py-2.5 text-right font-medium">Monthly</th>
                          <th className="px-4 py-2.5 text-right font-medium">Daily</th>
                          <th className="px-4 py-2.5 text-right font-medium">Monthly tokens</th>
                          <th className="px-4 py-2.5 text-right font-medium">Daily tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.features.map((feature) => {
                          const noLimits =
                            feature.enabled &&
                            feature.monthlyQuota === null &&
                            feature.dailyQuota === null &&
                            feature.monthlyTokenLimit === null &&
                            feature.dailyTokenLimit === null

                          return (
                            <tr
                              key={feature.featureCode}
                              className={`border-b ${feature.enabled ? '' : 'bg-gray-50/60'}`}
                            >
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  disabled={!canEdit}
                                  checked={feature.enabled}
                                  onChange={(e) =>
                                    toggleFeature(
                                      selected.code,
                                      feature.featureCode,
                                      e.target.checked
                                    )
                                  }
                                  className="h-4 w-4 rounded border-gray-300"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div
                                  className={`font-medium ${
                                    feature.enabled ? 'text-gray-900' : 'text-gray-400'
                                  }`}
                                >
                                  {feature.name}
                                </div>
                                <div className="text-xs text-gray-500">{feature.description}</div>
                                {noLimits && (
                                  <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Enabled with no limits &mdash; denied at runtime. Set a quota.
                                  </div>
                                )}
                              </td>
                              {(
                                [
                                  'monthlyQuota',
                                  'dailyQuota',
                                  'monthlyTokenLimit',
                                  'dailyTokenLimit',
                                ] as const
                              ).map((field) => (
                                <td key={field} className="px-4 py-3 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    disabled={!canEdit || !feature.enabled}
                                    value={
                                      field.includes('Token')
                                        ? formatTokens(feature[field])
                                        : feature[field] ?? ''
                                    }
                                    placeholder={feature.enabled ? 'No limit' : '—'}
                                    onChange={(e) =>
                                      setQuota(
                                        selected.code,
                                        feature.featureCode,
                                        field,
                                        e.target.value
                                      )
                                    }
                                    className="w-32 px-2 py-1.5 border border-gray-300 rounded text-right disabled:bg-gray-100 disabled:text-gray-400"
                                  />
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Model tiers + limits */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <section className="bg-white rounded-lg shadow border p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Cpu className="h-5 w-5 text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-900">AI model tiers</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Which model classes this plan may use, applied across all
                      {' '}{selected.modelClasses.taskCount} granted task
                      {selected.modelClasses.taskCount === 1 ? '' : 's'}.
                    </p>

                    {selected.modelClasses.perTaskOverrides && (
                      <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          This plan currently has per-task overrides set in LLM Config. Saving here
                          replaces them with one uniform rule.
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 mb-4">
                      {(catalog?.modelClasses ?? []).map((modelClass) => {
                        const active = selected.modelClasses.allowed.includes(modelClass)
                        return (
                          <button
                            key={modelClass}
                            disabled={!canEdit}
                            onClick={() => toggleModelClass(selected.code, modelClass)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-60 ${
                              active
                                ? 'bg-lamp-600 border-lamp-600 text-white'
                                : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {active && <Check className="h-3.5 w-3.5" />}
                            {MODEL_CLASS_LABELS[modelClass] ?? modelClass}
                          </button>
                        )
                      })}
                    </div>

                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Default class
                      </span>
                      <select
                        disabled={!canEdit}
                        value={selected.modelClasses.default}
                        onChange={(e) =>
                          mutate(selected.code, (plan) => ({
                            ...plan,
                            modelClasses: { ...plan.modelClasses, default: e.target.value },
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50"
                      >
                        {selected.modelClasses.allowed.map((modelClass) => (
                          <option key={modelClass} value={modelClass}>
                            {MODEL_CLASS_LABELS[modelClass] ?? modelClass}
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <section className="bg-white rounded-lg shadow border p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="h-5 w-5 text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-900">Seats &amp; scope</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Stored as plan policy rules, readable by any feature that needs to cap scale.
                    </p>

                    <div className="space-y-4">
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">Seats included</span>
                        <input
                          type="number"
                          min={1}
                          disabled={!canEdit}
                          value={selected.policy.maxSeats}
                          onChange={(e) => setPolicy(selected.code, 'maxSeats', e.target.value)}
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">
                          Jurisdictions per patent
                        </span>
                        <input
                          type="number"
                          min={1}
                          disabled={!canEdit}
                          value={selected.policy.maxJurisdictionsPerPatent}
                          onChange={(e) =>
                            setPolicy(selected.code, 'maxJurisdictionsPerPatent', e.target.value)
                          }
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50"
                        />
                      </label>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Sticky save bar */}
      {canEdit && dirty.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t shadow-lg">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-700">
              <span className="font-medium">
                {dirty.size} plan{dirty.size === 1 ? '' : 's'}
              </span>{' '}
              changed &mdash; {Array.from(dirty).join(', ')}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void fetchPlans()}
                disabled={saving}
                className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-md text-white bg-lamp-600 hover:bg-lamp-700 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
