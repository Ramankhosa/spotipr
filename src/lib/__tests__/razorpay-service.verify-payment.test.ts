import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import crypto from 'crypto'

vi.hoisted(() => {
  process.env.Razorpay_Live_Key = 'rzp_test_key'
  process.env.Razorpay_Live_Secret_Key = 'rzp_test_secret'
  process.env.Razorpay_Webhook_Secret = 'rzp_test_webhook'
})

const prisma = vi.hoisted(() => ({
  payment: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  subscription: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenantPlan: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  tenant: {
    updateMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  aTIToken: {
    updateMany: vi.fn(),
  },
  adminDiscount: {
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/payment-notification-service', () => ({
  sendPaymentSuccessEmail: vi.fn(),
  sendSubscriptionCancelledEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
}))

import { verifyPayment } from '@/lib/razorpay-service'
import { sendPaymentSuccessEmail } from '@/lib/payment-notification-service'

const basePayment = {
  id: 'payment_db_1',
  userId: 'user_1',
  tenantId: 'tenant_1',
  planId: 'plan_1',
  planCode: 'PRO_PLAN',
  billingCycle: 'monthly',
  currency: 'USD',
  amount: 1000,
  status: 'CREATED',
  discountId: null,
  discountAmount: null,
  metadata: null,
  paidAt: new Date('2024-01-01T00:00:00.000Z'),
  plan: { name: 'Pro' },
  user: { email: 'user@example.com', name: 'User', firstName: 'User' },
  tenant: { id: 'tenant_1' },
}

const orderId = 'order_test_123'
const razorpayPaymentId = 'pay_test_456'

function buildSignature() {
  return crypto
    .createHmac('sha256', process.env.Razorpay_Live_Secret_Key || '')
    .update(`${orderId}|${razorpayPaymentId}`)
    .digest('hex')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  prisma.aTIToken.updateMany.mockResolvedValue({ count: 0 })
  prisma.tenantPlan.update.mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyPayment', () => {
  test('returns pending activation for authorized payments', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...basePayment })
    prisma.payment.updateMany.mockResolvedValue({ count: 1 })

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: razorpayPaymentId,
        status: 'authorized',
        amount: basePayment.amount,
        currency: basePayment.currency,
        order_id: orderId,
        method: 'card',
      }),
    } as Response)

    const result = await verifyPayment({
      razorpayOrderId: orderId,
      razorpayPaymentId,
      razorpaySignature: buildSignature(),
      userId: basePayment.userId,
    })

    expect(result.success).toBe(true)
    expect(result.subscriptionActivated).toBe(false)
    expect(prisma.subscription.create).not.toHaveBeenCalled()
  })

  test('rechecks Razorpay when the payment was previously authorized', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...basePayment, status: 'AUTHORIZED' })
    prisma.payment.updateMany.mockResolvedValue({ count: 1 })
    prisma.subscription.findFirst.mockResolvedValue(null)
    prisma.subscription.create.mockResolvedValue({ id: 'sub_2' })
    prisma.tenantPlan.findFirst.mockResolvedValue(null)

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: razorpayPaymentId,
        status: 'captured',
        amount: basePayment.amount,
        currency: basePayment.currency,
        order_id: orderId,
        method: 'card',
      }),
    } as Response)

    const result = await verifyPayment({
      razorpayOrderId: orderId,
      razorpayPaymentId,
      razorpaySignature: buildSignature(),
      userId: basePayment.userId,
    })

    expect(result.success).toBe(true)
    expect(result.subscriptionActivated).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  test('activates subscription on captured payments', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...basePayment })
    prisma.payment.updateMany.mockResolvedValue({ count: 1 })
    prisma.subscription.findFirst.mockResolvedValue(null)
    prisma.subscription.create.mockResolvedValue({ id: 'sub_1' })
    prisma.tenantPlan.findFirst.mockResolvedValue(null)

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: razorpayPaymentId,
        status: 'captured',
        amount: basePayment.amount,
        currency: basePayment.currency,
        order_id: orderId,
        method: 'card',
      }),
    } as Response)

    const result = await verifyPayment({
      razorpayOrderId: orderId,
      razorpayPaymentId,
      razorpaySignature: buildSignature(),
      userId: basePayment.userId,
    })

    expect(result.success).toBe(true)
    expect(result.subscriptionActivated).toBe(true)
    expect(prisma.subscription.create).toHaveBeenCalled()
  })

  test('recovery path re-activates captured payments with expired period', async () => {
    const expiredSubscription = {
      id: 'sub_old',
      tenantId: basePayment.tenantId,
      planId: basePayment.planId,
      status: 'ACTIVE',
      currentPeriodEnd: new Date('2020-01-01T00:00:00.000Z'),
    }
    const expiredTenantPlan = {
      id: 'tp_old',
      tenantId: basePayment.tenantId,
      planId: basePayment.planId,
      status: 'ACTIVE',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    }

    prisma.payment.findUnique.mockResolvedValue({ ...basePayment, status: 'CAPTURED' })
    prisma.subscription.findFirst
      .mockResolvedValueOnce(expiredSubscription)
      .mockResolvedValueOnce(null)
    prisma.tenantPlan.findFirst.mockResolvedValue(expiredTenantPlan)
    prisma.subscription.create.mockResolvedValue({ id: 'sub_new' })
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      name: 'User',
      firstName: 'User',
    })

    const result = await verifyPayment({
      razorpayOrderId: orderId,
      razorpayPaymentId,
      razorpaySignature: buildSignature(),
      userId: basePayment.userId,
    })

    expect(result.success).toBe(true)
    expect(result.subscriptionActivated).toBe(true)
    expect(prisma.subscription.create).toHaveBeenCalled()
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: basePayment.id },
      data: { subscriptionId: 'sub_new' },
    })
    expect(sendPaymentSuccessEmail).toHaveBeenCalled()
  })
})
