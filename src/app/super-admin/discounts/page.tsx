'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Tag, Plus, Trash2, Copy, Check, X, Loader2, 
  Percent, DollarSign, Users, Calendar, AlertCircle 
} from 'lucide-react'

interface Discount {
  id: string
  code: string | null
  name: string
  description: string | null
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT'
  discountValue: number
  currency: string | null
  applicablePlans: string[]
  maxUses: number | null
  maxUsesPerUser: number
  currentUses: number
  validFrom: string
  validUntil: string | null
  restrictedToUserIds: string[]
  restrictedToEmails: string[]
  isActive: boolean
  createdAt: string
  createdBy: {
    id: string
    email: string
    name: string | null
  }
  usageCount: number
}

export default function AdminDiscountsPage() {
  const router = useRouter()
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSpecialPricingModal, setShowSpecialPricingModal] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Fetch discounts
  const fetchDiscounts = useCallback(async () => {
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('jwt')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch('/api/admin/discounts?includeInactive=true', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        if (response.status === 403) {
          setError('Admin access required')
          return
        }
        throw new Error('Failed to fetch discounts')
      }

      const data = await response.json()
      setDiscounts(data.discounts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discounts')
    } finally {
      setIsLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchDiscounts()
  }, [fetchDiscounts])

  const handleDeactivate = async (discountId: string) => {
    if (!confirm('Are you sure you want to deactivate this discount?')) return

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('jwt')
      const response = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'deactivate', discountId }),
      })

      if (response.ok) {
        fetchDiscounts()
      }
    } catch (err) {
      console.error('Failed to deactivate discount:', err)
    }
  }

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ai-graphite-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-ai-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-ai-graphite-950 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ai-graphite-950 p-6">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Tag className="w-6 h-6 text-ai-blue-500" />
              Discount Management
            </h1>
            <p className="text-ai-graphite-400 mt-1">
              Create and manage discounts for special pricing offers
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowSpecialPricingModal(true)}
              className="px-4 py-2 bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors flex items-center gap-2"
            >
              <Users className="w-4 h-4" />
              Special User Pricing
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-ai-blue-500/20 border border-ai-blue-500/50 text-white rounded-lg hover:bg-ai-blue-500/30 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Discount
            </button>
          </div>
        </div>

        {/* Discounts Table */}
        <div className="bg-ai-graphite-900/50 border border-ai-graphite-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ai-graphite-800">
                <th className="px-6 py-4 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Discount
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Value
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Usage
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Plans
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium text-ai-graphite-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ai-graphite-800">
              {discounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-ai-graphite-400">
                    No discounts created yet
                  </td>
                </tr>
              ) : (
                discounts.map((discount) => (
                  <tr key={discount.id} className="hover:bg-ai-graphite-900/50">
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-white font-medium">{discount.name}</div>
                        {discount.code && (
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xs bg-ai-graphite-800 px-2 py-1 rounded text-ai-blue-300">
                              {discount.code}
                            </code>
                            <button
                              onClick={() => copyToClipboard(discount.code!)}
                              className="text-ai-graphite-400 hover:text-white"
                            >
                              {copiedCode === discount.code ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        )}
                        {discount.restrictedToEmails.length > 0 && (
                          <div className="text-xs text-ai-graphite-500 mt-1">
                            For: {discount.restrictedToEmails.join(', ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        discount.discountType === 'PERCENTAGE'
                          ? 'bg-lamp-500/20 text-lamp-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {discount.discountType === 'PERCENTAGE' ? (
                          <Percent className="w-3 h-3" />
                        ) : (
                          <DollarSign className="w-3 h-3" />
                        )}
                        {discount.discountType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white">
                      {discount.discountType === 'PERCENTAGE'
                        ? `${discount.discountValue}%`
                        : `${discount.currency === 'INR' ? '₹' : '$'}${discount.discountValue / 100}`
                      }
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-white">
                        {discount.currentUses}
                        {discount.maxUses && ` / ${discount.maxUses}`}
                      </div>
                      <div className="text-xs text-ai-graphite-500">
                        {discount.usageCount} payments
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {discount.applicablePlans.length === 0 ? (
                        <span className="text-ai-graphite-400">All plans</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {discount.applicablePlans.map((plan) => (
                            <span
                              key={plan}
                              className="px-2 py-0.5 bg-ai-graphite-800 rounded text-xs text-ai-graphite-300"
                            >
                              {plan}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${
                        discount.isActive
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {discount.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {discount.validUntil && (
                        <div className="text-xs text-ai-graphite-500 mt-1 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(discount.validUntil).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {discount.isActive && (
                        <button
                          onClick={() => handleDeactivate(discount.id)}
                          className="text-red-400 hover:text-red-300 p-2"
                          title="Deactivate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Discount Modal */}
      {showCreateModal && (
        <CreateDiscountModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            fetchDiscounts()
          }}
        />
      )}

      {/* Special Pricing Modal */}
      {showSpecialPricingModal && (
        <SpecialPricingModal
          onClose={() => setShowSpecialPricingModal(false)}
          onCreated={() => {
            setShowSpecialPricingModal(false)
            fetchDiscounts()
          }}
        />
      )}
    </div>
  )
}

// Create Discount Modal Component
function CreateDiscountModal({ 
  onClose, 
  onCreated 
}: { 
  onClose: () => void
  onCreated: () => void 
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED_AMOUNT',
    discountValue: '',
    currency: 'USD',
    code: '',
    applicablePlans: [] as string[],
    maxUses: '',
    maxUsesPerUser: '1',
    validUntil: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('jwt')
      const response = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || undefined,
          discountType: formData.discountType,
          discountValue: parseInt(formData.discountValue),
          currency: formData.discountType === 'FIXED_AMOUNT' ? formData.currency : undefined,
          code: formData.code || undefined,
          applicablePlans: formData.applicablePlans.length > 0 ? formData.applicablePlans : undefined,
          maxUses: formData.maxUses ? parseInt(formData.maxUses) : undefined,
          maxUsesPerUser: parseInt(formData.maxUsesPerUser),
          validUntil: formData.validUntil || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create discount')
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create discount')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-ai-graphite-900 border border-ai-graphite-800 rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Create Discount</h2>
          <button onClick={onClose} className="text-ai-graphite-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
              Discount Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
              placeholder="e.g., Launch Offer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
              Coupon Code (optional)
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
              placeholder="e.g., LAUNCH50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                Discount Type *
              </label>
              <select
                value={formData.discountType}
                onChange={(e) => setFormData({ ...formData, discountType: e.target.value as any })}
                className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
              >
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED_AMOUNT">Fixed Amount</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                Value *
              </label>
              <div className="flex">
                <input
                  type="number"
                  value={formData.discountValue}
                  onChange={(e) => setFormData({ ...formData, discountValue: e.target.value })}
                  required
                  className="flex-1 px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-l-lg text-white focus:outline-none focus:border-ai-blue-500"
                  placeholder={formData.discountType === 'PERCENTAGE' ? '10' : '1000'}
                />
                <span className="px-3 py-2 bg-ai-graphite-700 border border-ai-graphite-700 rounded-r-lg text-ai-graphite-400">
                  {formData.discountType === 'PERCENTAGE' ? '%' : 'cents'}
                </span>
              </div>
            </div>
          </div>

          {formData.discountType === 'FIXED_AMOUNT' && (
            <div>
              <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                Currency *
              </label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
              >
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
              Applicable Plans
            </label>
            <div className="flex gap-2">
              {['BASIC', 'PRO', 'ENTERPRISE'].map((plan) => (
                <label key={plan} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.applicablePlans.includes(plan)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, applicablePlans: [...formData.applicablePlans, plan] })
                      } else {
                        setFormData({ ...formData, applicablePlans: formData.applicablePlans.filter(p => p !== plan) })
                      }
                    }}
                    className="rounded border-ai-graphite-600"
                  />
                  <span className="text-sm text-ai-graphite-300">{plan}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-ai-graphite-500 mt-1">Leave unchecked for all plans</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                Max Total Uses
              </label>
              <input
                type="number"
                value={formData.maxUses}
                onChange={(e) => setFormData({ ...formData, maxUses: e.target.value })}
                className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
                placeholder="Unlimited"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                Max Uses Per User
              </label>
              <input
                type="number"
                value={formData.maxUsesPerUser}
                onChange={(e) => setFormData({ ...formData, maxUsesPerUser: e.target.value })}
                className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
              Valid Until (optional)
            </label>
            <input
              type="date"
              value={formData.validUntil}
              onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
              className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-ai-graphite-800 text-ai-graphite-300 rounded-lg hover:bg-ai-graphite-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-ai-blue-500/20 border border-ai-blue-500/50 text-white rounded-lg hover:bg-ai-blue-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Discount
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Special Pricing Modal Component (for specific users)
function SpecialPricingModal({ 
  onClose, 
  onCreated 
}: { 
  onClose: () => void
  onCreated: () => void 
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ code: string } | null>(null)
  const [formData, setFormData] = useState({
    targetEmail: '',
    planCode: 'PRO' as 'BASIC' | 'PRO' | 'ENTERPRISE',
    discountPercentage: '20',
    validDays: '30',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('jwt')
      const response = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'special_pricing',
          targetEmail: formData.targetEmail,
          planCode: formData.planCode,
          discountPercentage: parseInt(formData.discountPercentage),
          validDays: parseInt(formData.validDays),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create special pricing')
      }

      setResult({ code: data.discountCode })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create special pricing')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-ai-graphite-900 border border-ai-graphite-800 rounded-2xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Special User Pricing</h2>
          <button onClick={onClose} className="text-ai-graphite-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Special Pricing Created!</h3>
            <p className="text-ai-graphite-400 mb-4">
              Share this code with {formData.targetEmail}:
            </p>
            <div className="flex items-center justify-center gap-2 bg-ai-graphite-800 p-4 rounded-lg">
              <code className="text-xl font-mono text-ai-blue-400">{result.code}</code>
              <button
                onClick={() => navigator.clipboard.writeText(result.code)}
                className="p-2 hover:bg-ai-graphite-700 rounded"
              >
                <Copy className="w-4 h-4 text-ai-graphite-400" />
              </button>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-ai-graphite-800 text-ai-graphite-300 rounded-lg hover:bg-ai-graphite-700 transition-colors"
              >
                Close
              </button>
              <button
                onClick={onCreated}
                className="flex-1 px-4 py-2 bg-ai-blue-500/20 border border-ai-blue-500/50 text-white rounded-lg hover:bg-ai-blue-500/30 transition-colors"
              >
                View All Discounts
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                  User Email *
                </label>
                <input
                  type="email"
                  value={formData.targetEmail}
                  onChange={(e) => setFormData({ ...formData, targetEmail: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
                  placeholder="user@example.com"
                />
                <p className="text-xs text-ai-graphite-500 mt-1">
                  Only this email can use the generated code
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                  Plan *
                </label>
                <select
                  value={formData.planCode}
                  onChange={(e) => setFormData({ ...formData, planCode: e.target.value as any })}
                  className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
                >
                  <option value="BASIC">Basic ($59/mo)</option>
                  <option value="PRO">Pro ($199/mo)</option>
                  <option value="ENTERPRISE">Enterprise ($599/mo)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                    Discount %
                  </label>
                  <div className="flex">
                    <input
                      type="number"
                      value={formData.discountPercentage}
                      onChange={(e) => setFormData({ ...formData, discountPercentage: e.target.value })}
                      min="1"
                      max="90"
                      required
                      className="flex-1 px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-l-lg text-white focus:outline-none focus:border-ai-blue-500"
                    />
                    <span className="px-3 py-2 bg-ai-graphite-700 border border-ai-graphite-700 rounded-r-lg text-ai-graphite-400">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ai-graphite-300 mb-1">
                    Valid for (days)
                  </label>
                  <input
                    type="number"
                    value={formData.validDays}
                    onChange={(e) => setFormData({ ...formData, validDays: e.target.value })}
                    min="1"
                    required
                    className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-ai-graphite-800 text-ai-graphite-300 rounded-lg hover:bg-ai-graphite-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-green-500/20 border border-green-500/50 text-white rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Generate Code
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

