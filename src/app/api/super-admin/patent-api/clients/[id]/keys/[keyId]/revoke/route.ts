import { NextRequest, NextResponse } from 'next/server'
import { authenticatePatentApiAdmin } from '@/lib/patent-api-admin-auth'
import { revokePatentApiKey } from '@/lib/patent-api-admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string; keyId: string } }) {
  const auth = await authenticatePatentApiAdmin(request, true)
  if ('error' in auth) return auth.error
  const key = await revokePatentApiKey(params.id, params.keyId, auth.user.id)
  return key
    ? NextResponse.json({ key })
    : NextResponse.json({ error: 'API key not found.' }, { status: 404 })
}

