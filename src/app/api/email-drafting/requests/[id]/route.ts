import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getEmailDraftRequestForUser } from '@/lib/email-drafting-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const record = await getEmailDraftRequestForUser(params.id, auth.user.id)
    if (!record) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    return NextResponse.json({ request: record })
  } catch (error) {
    console.error('[EmailDraftingRequest] Failed to fetch request:', error)
    return NextResponse.json({ error: 'Failed to fetch email drafting request.' }, { status: 500 })
  }
}
