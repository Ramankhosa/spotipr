import { NextRequest, NextResponse } from 'next/server'
import { authenticatePatentApiAdmin } from '@/lib/patent-api-admin-auth'
import { issuePatentApiKey } from '@/lib/patent-api-admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticatePatentApiAdmin(request, true)
  if ('error' in auth) return auth.error
  try {
    const result = await issuePatentApiKey(params.id, await request.json(), auth.user.id)
    return result
      ? NextResponse.json({ ...result, warning: 'Copy this secret now. It cannot be retrieved again.' }, { status: 201 })
      : NextResponse.json({ error: 'API client not found.' }, { status: 404 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not issue API key.' }, { status: 400 })
  }
}

