import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  await request.text().catch(() => '')
  return NextResponse.json(
    {
      accepted: false,
      errorCode: 'EMAIL_DRAFTING_DISABLED',
      message: 'Email-based patent drafting is disabled. Use patent batch drafting instead.',
    },
    { status: 410 }
  )
}
