'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'

interface DownloadPayload {
  request?: {
    id: string
    subject?: string | null
    status: string
    events?: Array<{ id: string; stage: string; state: string; message?: string | null; createdAt: string }>
  }
  documents?: Array<{ id: string; filename: string; mimeType?: string | null; sizeBytes?: number | null; downloadUrl: string }>
  error?: string
}

export default function EmailDraftDownloadPage({ params }: { params: { token: string } }) {
  const { token: authToken } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DownloadPayload | null>(null)

  useEffect(() => {
    if (!authToken) return
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/email-drafting/download/${params.token}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        })
        const body = await res.json()
        setData(body)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authToken, params.token])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold">Email Draft Download</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in with the same account that submitted the request to access the exported draft.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          {loading ? (
            <p className="text-slate-400">Loading draft artifacts...</p>
          ) : data?.error ? (
            <p className="text-rose-300">{data.error}</p>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="text-sm text-slate-400">Request</div>
                <div className="mt-1 text-lg font-medium text-white">{data?.request?.subject || data?.request?.id}</div>
                <div className="mt-2 inline-flex rounded-full bg-lamp-500/15 px-3 py-1 text-xs font-medium text-lamp-200">
                  {data?.request?.status || 'UNKNOWN'}
                </div>
              </div>

              <div>
                <div className="text-sm text-slate-400">Artifacts</div>
                <div className="mt-3 space-y-3">
                  {(data?.documents || []).map((document) => (
                    <a
                      key={document.id}
                      href={document.downloadUrl}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm hover:border-lamp-500/40 hover:bg-slate-950"
                    >
                      <div>
                        <div className="font-medium text-white">{document.filename}</div>
                        <div className="text-xs text-slate-500">{document.mimeType || 'Unknown type'}</div>
                      </div>
                      <span className="rounded-md bg-lamp-600 px-3 py-1.5 text-xs font-medium text-white">Download</span>
                    </a>
                  ))}
                </div>
              </div>

              {data?.request?.events?.length ? (
                <div>
                  <div className="text-sm text-slate-400">Pipeline History</div>
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
