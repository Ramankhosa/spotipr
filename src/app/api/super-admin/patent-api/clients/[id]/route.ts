import { NextRequest, NextResponse } from 'next/server'
import { authenticatePatentApiAdmin } from '@/lib/patent-api-admin-auth'
import { getPatentApiClient, updatePatentApiClient } from '@/lib/patent-api-admin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticatePatentApiAdmin(request)
  if ('error' in auth) return auth.error
  const client = await getPatentApiClient(params.id)
  return client
    ? NextResponse.json({ client, readOnly: auth.readOnly })
    : NextResponse.json({ error: 'API client not found.' }, { status: 404 })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticatePatentApiAdmin(request, true)
  if ('error' in auth) return auth.error
  try {
    const client = await updatePatentApiClient(params.id, await request.json(), auth.user.id)
    return client
      ? NextResponse.json({ client })
      : NextResponse.json({ error: 'API client not found.' }, { status: 404 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update API client.' }, { status: 400 })
  }
}

