import { NextRequest, NextResponse } from 'next/server'
import { authenticatePatentApiAdmin } from '@/lib/patent-api-admin-auth'
import { createPatentApiClient, listPatentApiClients } from '@/lib/patent-api-admin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await authenticatePatentApiAdmin(request)
  if ('error' in auth) return auth.error
  return NextResponse.json({ clients: await listPatentApiClients(), readOnly: auth.readOnly })
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePatentApiAdmin(request, true)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ client: await createPatentApiClient(await request.json(), auth.user.id) }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create API client.' }, { status: 400 })
  }
}

