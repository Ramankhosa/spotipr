import type { NextRequest } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getOwnedStudy } from '../service'
import { studyKindOf } from '../types'
import { MinerError } from './contracts'

export async function minerApiContext(request: NextRequest, studyId: string) {
  const auth = await authenticateUser(request)
  if (!auth.user) throw new MinerError(auth.error?.message || 'Unauthorized', auth.error?.status || 401)
  const study = await getOwnedStudy(studyId, auth.user.id, auth.user.tenantId)
  if (!study) throw new MinerError('Study not found.', 404)
  if (studyKindOf(study.kind) !== 'MINER') throw new MinerError('This action is only available in an Invention Miner study.', 400)
  return { auth: auth.user, study }
}

export function minerApiError(error: unknown) {
  const value = error instanceof MinerError ? error : new MinerError(error instanceof Error ? error.message : 'Miner action failed.', 500)
  return Response.json({ error: value.message, code: value.status === 409 ? 'STALE_INPUT' : value.status === 422 ? 'PREREQUISITE_REQUIRED' : 'MINER_ERROR' }, { status: value.status })
}
