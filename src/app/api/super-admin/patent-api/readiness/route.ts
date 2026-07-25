import { NextRequest, NextResponse } from 'next/server'
import { authenticatePatentApiAdmin } from '@/lib/patent-api-admin-auth'
import { getPatentApiReadiness } from '@/lib/patent-api-admin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await authenticatePatentApiAdmin(request)
  if ('error' in auth) return auth.error
  const forceRefresh = request.nextUrl.searchParams.get('forceRefresh') === '1'
  return NextResponse.json({ readiness: await getPatentApiReadiness({ forceRefresh }) })
}

