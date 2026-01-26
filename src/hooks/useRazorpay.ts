/**
 * useRazorpay Hook
 * 
 * Custom hook for handling Razorpay checkout flow
 * Supports both one-time orders and recurring subscriptions (auto-renewal)
 * 
 * Auto-renewal behavior:
 * - If enableAutoRenewal is true AND no discount: Creates a Razorpay subscription
 * - If enableAutoRenewal is true AND has discount: Falls back to one-time order (discount preserved)
 * - If enableAutoRenewal is false: Creates a one-time order
 */

'use client'

import { useState, useCallback, useEffect } from 'react'

declare global {
  interface Window {
    Razorpay: any
  }
}

export interface RazorpayCheckoutOptions {
  planCode: 'BASIC' | 'PRO' | 'ENTERPRISE'
  billingCycle: 'monthly' | 'yearly'
  countryCode?: string
  discountCode?: string
  /** Enable auto-renewal (creates Razorpay subscription if no discount) */
  enableAutoRenewal?: boolean
}

export interface UseRazorpayReturn {
  isLoading: boolean
  isScriptLoaded: boolean
  error: string | null
  /** Initiate checkout - automatically chooses between subscription and one-time order */
  initiateCheckout: (options: RazorpayCheckoutOptions) => Promise<void>
  /** Initiate subscription-based checkout for auto-renewal */
  initiateSubscription: (options: Omit<RazorpayCheckoutOptions, 'discountCode' | 'enableAutoRenewal'>) => Promise<void>
  clearError: () => void
  /** Info about discount that caused fallback to one-time order */
  discountFallbackInfo: { name: string; message: string } | null
}

export function useRazorpay(
  onSuccess?: (data: { 
    paymentId: string; 
    planCode: string; 
    isSubscription?: boolean;
    /** True if payment is authorized but pending capture - subscription will activate shortly */
    isPendingCapture?: boolean;
  }) => void,
  onFailure?: (error: string) => void
): UseRazorpayReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [isScriptLoaded, setIsScriptLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discountFallbackInfo, setDiscountFallbackInfo] = useState<{ name: string; message: string } | null>(null)

  // Load Razorpay script on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    if (window.Razorpay) {
      setIsScriptLoaded(true)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => setIsScriptLoaded(true)
    script.onerror = () => setError('Failed to load payment gateway')
    document.body.appendChild(script)

    return () => {
      // Don't remove script on unmount as other components might need it
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setDiscountFallbackInfo(null)
  }, [])

  /**
   * Create a one-time order and open Razorpay checkout
   */
  const createOneTimeOrder = useCallback(async (
    options: RazorpayCheckoutOptions,
    token: string
  ) => {
    // Create order
    const orderResponse = await fetch('/api/payments/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        planCode: options.planCode,
        billingCycle: options.billingCycle,
        countryCode: options.countryCode,
        discountCode: options.discountCode,
      }),
    })

    const orderData = await orderResponse.json()

    if (!orderResponse.ok || !orderData.success) {
      throw new Error(orderData.error || 'Failed to create order')
    }

    // Open Razorpay checkout
    const razorpayOptions = {
      key: orderData.razorpay.keyId,
      amount: orderData.razorpay.amount,
      currency: orderData.razorpay.currency,
      name: orderData.razorpay.name,
      description: orderData.razorpay.description,
      order_id: orderData.razorpay.orderId,
      prefill: orderData.razorpay.prefill,
      theme: {
        color: '#0ea5e9', // ai-blue-500
      },
      handler: async function (response: {
        razorpay_order_id: string
        razorpay_payment_id: string
        razorpay_signature: string
      }) {
        // Verify payment
        try {
          const verifyResponse = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })

          const verifyData = await verifyResponse.json()

          if (!verifyResponse.ok || !verifyData.success) {
            throw new Error(verifyData.error || 'Payment verification failed')
          }

          // Check if subscription was actually activated
          // Payment can be successful but pending capture (AUTHORIZED status)
          if (verifyData.subscriptionActivated === false) {
            // Payment is authorized but not yet captured
            // This is a temporary state - subscription will activate when capture completes
            console.log('[useRazorpay] Payment authorized, pending capture. Subscription will activate shortly.')
            
            // Notify as pending, not full success
            onSuccess?.({
              paymentId: verifyData.paymentId,
              planCode: verifyData.planCode,
              isSubscription: false,
              isPendingCapture: true, // Flag to indicate pending state
            })
            return
          }

          // Full success - subscription is activated!
          onSuccess?.({
            paymentId: verifyData.paymentId,
            planCode: verifyData.planCode,
            isSubscription: false,
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Payment verification failed'
          setError(errorMsg)
          onFailure?.(errorMsg)
        } finally {
          setIsLoading(false)
        }
      },
      modal: {
        ondismiss: function () {
          setIsLoading(false)
        },
        escape: true,
        backdropclose: false,
      },
    }

    const razorpay = new window.Razorpay(razorpayOptions)
    
    razorpay.on('payment.failed', function (response: any) {
      const errorMsg = response.error?.description || 'Payment failed'
      setError(errorMsg)
      onFailure?.(errorMsg)
      setIsLoading(false)
    })

    razorpay.open()
  }, [onSuccess, onFailure])

  /**
   * Initiate checkout - automatically chooses between subscription and one-time order
   * based on enableAutoRenewal flag and discount availability
   */
  const initiateCheckout = useCallback(async (options: RazorpayCheckoutOptions) => {
    if (!isScriptLoaded) {
      setError('Payment gateway not loaded. Please refresh the page.')
      return
    }

    setIsLoading(true)
    setError(null)
    setDiscountFallbackInfo(null)

    try {
      // Get auth token from cookie or localStorage
      const token = getAuthToken()
      if (!token) {
        throw new Error('Please login to continue')
      }

      // If auto-renewal is enabled AND no discount code, try subscription first
      if (options.enableAutoRenewal && !options.discountCode) {
        const subscriptionResponse = await fetch('/api/payments/create-subscription', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            planCode: options.planCode,
            billingCycle: options.billingCycle,
            countryCode: options.countryCode,
          }),
        })

        const subscriptionData = await subscriptionResponse.json()

        if (subscriptionData.success) {
          // Subscription created - redirect to Razorpay payment link
          if (subscriptionData.paymentLink) {
            window.location.href = subscriptionData.paymentLink
            return
          }
        } else if (subscriptionData.useOneTimeOrder) {
          // Fall back to one-time order (e.g., user has active discount or plan not available)
          if (subscriptionData.discountInfo) {
            setDiscountFallbackInfo({
              name: subscriptionData.discountInfo.name,
              message: subscriptionData.message,
            })
          }
          console.log('[useRazorpay] Falling back to one-time order:', subscriptionData.message)
          // Continue with one-time order below
        } else {
          throw new Error(subscriptionData.error || 'Failed to create subscription')
        }
      }

      // Create one-time order (default path, or fallback from subscription)
      await createOneTimeOrder(options, token)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to initiate payment'
      setError(errorMsg)
      onFailure?.(errorMsg)
      setIsLoading(false)
    }
  }, [isScriptLoaded, createOneTimeOrder, onFailure])

  /**
   * Initiate subscription-based checkout for auto-renewal
   * Note: This does NOT apply discounts - use initiateCheckout with discountCode instead
   */
  const initiateSubscription = useCallback(async (
    options: Omit<RazorpayCheckoutOptions, 'discountCode' | 'enableAutoRenewal'>
  ) => {
    if (!isScriptLoaded) {
      setError('Payment gateway not loaded. Please refresh the page.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const token = getAuthToken()
      if (!token) {
        throw new Error('Please login to continue')
      }

      const subscriptionResponse = await fetch('/api/payments/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          planCode: options.planCode,
          billingCycle: options.billingCycle,
          countryCode: options.countryCode,
        }),
      })

      const subscriptionData = await subscriptionResponse.json()

      if (subscriptionData.success && subscriptionData.paymentLink) {
        // Redirect to Razorpay payment link for subscription
        window.location.href = subscriptionData.paymentLink
        return
      }

      if (subscriptionData.useOneTimeOrder) {
        // Auto-renewal not available, inform user
        throw new Error(subscriptionData.message || 'Auto-renewal is not available for this plan. Please use standard checkout.')
      }

      throw new Error(subscriptionData.error || 'Failed to create subscription')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to initiate subscription'
      setError(errorMsg)
      onFailure?.(errorMsg)
      setIsLoading(false)
    }
  }, [isScriptLoaded, onFailure])

  return {
    isLoading,
    isScriptLoaded,
    error,
    initiateCheckout,
    initiateSubscription,
    clearError,
    discountFallbackInfo,
  }
}

/**
 * Get auth token from storage
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  
  // Try localStorage first - check all possible keys used in the app
  const token = localStorage.getItem('auth_token') || 
                localStorage.getItem('token') || 
                localStorage.getItem('jwt')
  if (token) return token

  // Try to get from cookie
  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === 'auth_token' || name === 'token' || name === 'jwt' || name === 'auth-token') {
      return value
    }
  }

  return null
}

export default useRazorpay

