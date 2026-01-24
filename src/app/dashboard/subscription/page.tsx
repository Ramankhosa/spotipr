'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  CreditCard,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Clock,
  Receipt,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react'

interface Payment {
  id: string
  amount: number
  amountFormatted: string
  status: 'CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED'
  method: string | null
  paidAt: string | null
}

interface Subscription {
  id: string
  planCode: string
  planName: string
  billingCycle: string
  status: string
  amount: number
  amountFormatted: string
  currency: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  nextBillingDate: string | null
  cancelledAt: string | null
  cancelReason: string | null
  discountApplied: {
    amount: number
    amountFormatted: string
  } | null
  recentPayments: Payment[]
}

interface SubscriptionData {
  hasSubscription: boolean
  isTrialUser: boolean
  message?: string
  subscription?: Subscription
  currentPlan?: {
    code: string
    name: string
    effectiveFrom: string
    expiresAt: string | null
    status: string
  }
}

export default function SubscriptionManagementPage() {
  const router = useRouter()
  const [data, setData] = useState<SubscriptionData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showPayments, setShowPayments] = useState(false)

  const fetchSubscription = useCallback(async () => {
    try {
      const token = localStorage.getItem('auth_token') || 
                    localStorage.getItem('token') || 
                    localStorage.getItem('jwt')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch('/api/subscriptions/current', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch subscription')
      }

      const subscriptionData = await response.json()
      setData(subscriptionData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription')
    } finally {
      setIsLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  const handleCancelSubscription = async () => {
    setIsCancelling(true)
    try {
      const token = localStorage.getItem('auth_token') || 
                    localStorage.getItem('token') || 
                    localStorage.getItem('jwt')
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: cancelReason }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to cancel subscription')
      }

      setShowCancelModal(false)
      fetchSubscription()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription')
    } finally {
      setIsCancelling(false)
    }
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
      <div className="min-h-screen bg-ai-graphite-950 p-6">
        <div className="max-w-3xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-400">{error}</p>
            <button
              onClick={() => {
                setError(null)
                fetchSubscription()
              }}
              className="mt-4 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ai-graphite-950 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-ai-blue-500" />
            Subscription & Billing
          </h1>
          <p className="text-ai-graphite-400 mt-1">
            Manage your subscription and view billing history
          </p>
        </div>

        {/* Trial User Banner */}
        {data?.isTrialUser && !data?.hasSubscription && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl"
          >
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-amber-400 font-medium">You're on a Trial Plan</h3>
                <p className="text-amber-400/80 text-sm mt-1">
                  Upgrade to a paid plan to unlock more features and higher limits.
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 mt-3 text-sm text-amber-400 hover:text-amber-300"
                >
                  View pricing plans <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {/* No Subscription */}
        {!data?.hasSubscription && !data?.isTrialUser && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-ai-graphite-900/50 border border-ai-graphite-800 rounded-xl p-8 text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-ai-graphite-800 flex items-center justify-center">
              <CreditCard className="w-8 h-8 text-ai-graphite-500" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">No Active Subscription</h2>
            <p className="text-ai-graphite-400 mb-6">
              Subscribe to a plan to unlock PatentNest's premium features.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-6 py-3 bg-ai-blue-500/20 border border-ai-blue-500/50 text-white rounded-lg hover:bg-ai-blue-500/30 transition-colors"
            >
              View Plans <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        )}

        {/* Active Subscription */}
        {data?.subscription && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Subscription Card */}
            <div className="bg-ai-graphite-900/50 border border-ai-graphite-800 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="p-6 border-b border-ai-graphite-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      data.subscription.status === 'ACTIVE' 
                        ? 'bg-green-500' 
                        : data.subscription.status === 'CANCELLED'
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    }`} />
                    <div>
                      <h2 className="text-xl font-semibold text-white">
                        {data.subscription.planName} Plan
                      </h2>
                      <p className="text-sm text-ai-graphite-400">
                        {data.subscription.billingCycle === 'yearly' ? 'Annual' : 'Monthly'} billing
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">
                      {data.subscription.amountFormatted}
                    </div>
                    <div className="text-xs text-ai-graphite-400">
                      /{data.subscription.billingCycle === 'yearly' ? 'year' : 'month'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="p-6 space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between py-2">
                  <span className="text-ai-graphite-400">Status</span>
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                    data.subscription.status === 'ACTIVE'
                      ? 'bg-green-500/20 text-green-400'
                      : data.subscription.status === 'CANCELLED'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {data.subscription.status === 'ACTIVE' && <CheckCircle className="w-4 h-4" />}
                    {data.subscription.status === 'CANCELLED' && <Clock className="w-4 h-4" />}
                    {data.subscription.status}
                  </span>
                </div>

                {/* Current Period */}
                {data.subscription.currentPeriodStart && data.subscription.currentPeriodEnd && (
                  <div className="flex items-center justify-between py-2 border-t border-ai-graphite-800">
                    <span className="text-ai-graphite-400 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Current Period
                    </span>
                    <span className="text-white">
                      {new Date(data.subscription.currentPeriodStart).toLocaleDateString()} - {' '}
                      {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
                    </span>
                  </div>
                )}

                {/* Next Billing */}
                {data.subscription.status === 'ACTIVE' && data.subscription.nextBillingDate && (
                  <div className="flex items-center justify-between py-2 border-t border-ai-graphite-800">
                    <span className="text-ai-graphite-400 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Next Billing Date
                    </span>
                    <span className="text-white">
                      {new Date(data.subscription.nextBillingDate).toLocaleDateString()}
                    </span>
                  </div>
                )}

                {/* Cancelled Info */}
                {data.subscription.status === 'CANCELLED' && (
                  <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <p className="text-amber-400 text-sm">
                      <strong>Subscription cancelled.</strong> You'll continue to have access until{' '}
                      {data.subscription.currentPeriodEnd && 
                        new Date(data.subscription.currentPeriodEnd).toLocaleDateString()
                      }.
                    </p>
                    {data.subscription.cancelReason && (
                      <p className="text-amber-400/70 text-sm mt-2">
                        Reason: {data.subscription.cancelReason}
                      </p>
                    )}
                  </div>
                )}

                {/* Discount Applied */}
                {data.subscription.discountApplied && (
                  <div className="flex items-center justify-between py-2 border-t border-ai-graphite-800">
                    <span className="text-ai-graphite-400">Discount Applied</span>
                    <span className="text-green-400">
                      -{data.subscription.discountApplied.amountFormatted}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="p-6 border-t border-ai-graphite-800 flex flex-wrap gap-3">
                {data.subscription.status === 'ACTIVE' && (
                  <>
                    <Link
                      href="/pricing"
                      className="px-4 py-2 bg-ai-blue-500/20 border border-ai-blue-500/50 text-white rounded-lg hover:bg-ai-blue-500/30 transition-colors"
                    >
                      Change Plan
                    </Link>
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors"
                    >
                      Cancel Subscription
                    </button>
                  </>
                )}
                {data.subscription.status === 'CANCELLED' && (
                  <Link
                    href="/pricing"
                    className="px-4 py-2 bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                  >
                    Resubscribe
                  </Link>
                )}
              </div>
            </div>

            {/* Payment History */}
            {data.subscription.recentPayments && data.subscription.recentPayments.length > 0 && (
              <div className="bg-ai-graphite-900/50 border border-ai-graphite-800 rounded-xl">
                <button
                  onClick={() => setShowPayments(!showPayments)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Receipt className="w-5 h-5 text-ai-graphite-400" />
                    Recent Payments
                  </span>
                  {showPayments ? (
                    <ChevronUp className="w-5 h-5 text-ai-graphite-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-ai-graphite-400" />
                  )}
                </button>

                {showPayments && (
                  <div className="border-t border-ai-graphite-800">
                    {data.subscription.recentPayments.map((payment) => (
                      <div
                        key={payment.id}
                        className="p-4 border-b border-ai-graphite-800 last:border-b-0 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-2 h-2 rounded-full ${
                            payment.status === 'CAPTURED' ? 'bg-green-500' :
                            payment.status === 'FAILED' ? 'bg-red-500' :
                            'bg-amber-500'
                          }`} />
                          <div>
                            <div className="text-white text-sm">
                              {payment.amountFormatted}
                              {payment.method && (
                                <span className="text-ai-graphite-500 ml-2">
                                  via {payment.method}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-ai-graphite-500">
                              {payment.paidAt 
                                ? new Date(payment.paidAt).toLocaleDateString()
                                : 'Pending'
                              }
                            </div>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          payment.status === 'CAPTURED' ? 'bg-green-500/20 text-green-400' :
                          payment.status === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {payment.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Current Plan (non-subscription) */}
        {data?.currentPlan && !data?.subscription && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-ai-graphite-900/50 border border-ai-graphite-800 rounded-xl p-6"
          >
            <h2 className="text-lg font-medium text-white mb-4">Current Plan</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-ai-graphite-400">Plan</span>
                <span className="text-white">{data.currentPlan.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ai-graphite-400">Status</span>
                <span className="text-green-400">{data.currentPlan.status}</span>
              </div>
              {data.currentPlan.expiresAt && (
                <div className="flex justify-between">
                  <span className="text-ai-graphite-400">Expires</span>
                  <span className="text-white">
                    {new Date(data.currentPlan.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Help Section */}
        <div className="mt-8 text-center">
          <p className="text-sm text-ai-graphite-400">
            Need help with billing?{' '}
            <Link href="/contact" className="text-ai-blue-400 hover:text-ai-blue-300">
              Contact support
            </Link>
          </p>
        </div>
      </div>

      {/* Cancel Subscription Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-ai-graphite-900 border border-ai-graphite-800 rounded-2xl p-6 max-w-md w-full mx-4"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-white">Cancel Subscription?</h2>
              <p className="text-ai-graphite-400 mt-2">
                You'll continue to have access until the end of your current billing period.
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-ai-graphite-300 mb-2">
                Why are you cancelling? (optional)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-ai-graphite-800 border border-ai-graphite-700 rounded-lg text-white focus:outline-none focus:border-ai-blue-500 resize-none"
                placeholder="Help us improve by sharing your feedback..."
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 px-4 py-2 bg-ai-graphite-800 text-ai-graphite-300 rounded-lg hover:bg-ai-graphite-700 transition-colors"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={isCancelling}
                className="flex-1 px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                Cancel Subscription
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

