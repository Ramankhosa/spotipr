/**
 * useRazorpay Hook
 * 
 * Custom hook for handling Razorpay checkout flow
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
}

export interface UseRazorpayReturn {
  isLoading: boolean
  isScriptLoaded: boolean
  error: string | null
  initiateCheckout: (options: RazorpayCheckoutOptions) => Promise<void>
  clearError: () => void
}

export function useRazorpay(
  onSuccess?: (data: { paymentId: string; planCode: string }) => void,
  onFailure?: (error: string) => void
): UseRazorpayReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [isScriptLoaded, setIsScriptLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const clearError = useCallback(() => setError(null), [])

  const initiateCheckout = useCallback(async (options: RazorpayCheckoutOptions) => {
    if (!isScriptLoaded) {
      setError('Payment gateway not loaded. Please refresh the page.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Get auth token from cookie or localStorage
      const token = getAuthToken()
      if (!token) {
        throw new Error('Please login to continue')
      }

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

            // Success!
            onSuccess?.({
              paymentId: verifyData.paymentId,
              planCode: verifyData.planCode,
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
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to initiate payment'
      setError(errorMsg)
      onFailure?.(errorMsg)
      setIsLoading(false)
    }
  }, [isScriptLoaded, onSuccess, onFailure])

  return {
    isLoading,
    isScriptLoaded,
    error,
    initiateCheckout,
    clearError,
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

