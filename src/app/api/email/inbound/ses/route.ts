import { NextRequest, NextResponse } from 'next/server'
import { receiveInboundEmail } from '@/lib/email-drafting-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await receiveInboundEmail(body)
    return NextResponse.json(
      {
        accepted: result.accepted,
        requestId: result.requestId,
        duplicate: result.duplicate,
        errorCode: result.errorCode,
        message: result.message,
      },
      { status: result.status }
    )
  } catch (error) {
    console.error('[EmailInboundSES] Error receiving inbound email:', error)
    return NextResponse.json(
      { accepted: false, errorCode: 'INTERNAL_ERROR', message: 'Failed to receive inbound email.' },
      { status: 500 }
    )
  }
}
