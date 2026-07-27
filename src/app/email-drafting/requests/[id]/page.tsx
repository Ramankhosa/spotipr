'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'

interface RequestPayload {
  request?: {
    id: string
    subject?: string | null
    status: string
    progressPct: number
    errorMessage?: string | null
    warnings?: string[] | null
    events?: Array<{ id: string; stage: string; state: string; message?: string | null; createdAt: string }>
  }
  error?: string
}

export default function EmailDraftRequestPage({ params }: { params: { id: string } }) {
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RequestPayload | null>(null)

  useEffect(() => {
    if (!token) return
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/email-drafting/requests/${params.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const body = await res.json()
        setData(body)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [params.id, token])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold">Email Drafting Request</h1>
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          {loading ? (
            <p className="text-slate-400">Loading request...</p>
          ) : data?.error ? (
            <p className="text-rose-300">{data.error}</p>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="text-lg font-medium text-white">{data?.request?.subject || data?.request?.id}</div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-lamp-500" style={{ width: `${data?.request?.progressPct || 0}%` }} />
                </div>
                <div className="mt-2 text-sm text-slate-400">
                  {data?.request?.status} · {data?.request?.progressPct || 0}% complete
                </div>
                {data?.request?.errorMessage ? (
                  <div className="mt-4 rounded-lg border border-rose-800 bg-rose-950/60 px-4 py-3 text-sm text-rose-200">
                    {data.request.errorMessage}
                  </div>
                ) : null}
              </div>

              {data?.request?.events?.length ? (
                <div>
                  <div className="text-sm text-slate-400">Pipeline Events</div>
                  <div className="mt-3 space-y-2">
                    {data.request.events.map((event) => (
                      <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
                        <div className="font-medium text-white">{event.stage}</div>
                        <div className="text-xs text-slate-500">{event.message || event.state}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
