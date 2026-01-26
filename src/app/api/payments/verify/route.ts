/**
 * Verify Razorpay Payment API
 * POST /api/payments/verify
 * 
 * Verifies payment signature and activates subscription
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { verifyPayment } from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

interface VerifyPaymentRequest {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export async function POST(request: NextRequest) {
  try {
    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Get request body
    const body: VerifyPaymentRequest = await request.json()
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: 'Missing required payment details' },
        { status: 400 }
      )
    }

    // Verify payment (pass userId for ownership check)
    const result = await verifyPayment({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      userId: payload.sub,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Payment verification failed' },
        { status: 400 }
      )
    }

    // Provide appropriate message based on activation status
    const message = result.subscriptionActivated 
      ? 'Payment verified and subscription activated successfully'
      : 'Payment authorized and processing. Your subscription will activate shortly.'

    return NextResponse.json({
      success: true,
      message,
      paymentId: result.paymentId,
      subscriptionActivated: result.subscriptionActivated,
      planCode: result.planCode,
    })
  } catch (error) {
    console.error('[VerifyPayment API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
