/**
 * Whitespace Studio — client API helper.
 *
 * Auth is header-based JWT from localStorage, not cookies. Every whitespace
 * fetch goes through here so the Authorization header cannot be forgotten again
 * (the original "no login" bug was exactly that omission).
 */

export function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
}

export async function wsApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`) as Error & {
      status: number
      code?: string
    }
    error.status = response.status
    error.code = payload?.code
    throw error
  }
  return payload as T
}

/** Live narration a stage writes while it works. Null once the run finishes. */
export interface RunProgress {
  phase: string
  detail: string
  round?: number
}

export interface RunPayload {
  status: string
  results: unknown
  progress: RunProgress | null
  error: string | null
}

/** Polls a run until it leaves QUEUED/PROCESSING. Resolves with the final payload. */
export async function pollRun(
  studyId: string,
  runId: string,
  onTick?: (status: string, progress: RunProgress | null) => void
): Promise<RunPayload> {
  // 3s cadence, capped at 20 minutes — the server fails stale runs on read anyway.
  for (let attempt = 0; attempt < 400; attempt++) {
    const payload = await wsApi<RunPayload>(`/api/whitespace/studies/${studyId}/runs/${runId}`)
    if (payload.status !== 'QUEUED' && payload.status !== 'PROCESSING') return payload
    onTick?.(payload.status, payload.progress ?? null)
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  return {
    status: 'FAILED',
    results: null,
    progress: null,
    error: 'Lost track of the run — reload to check its status.',
  }
}
