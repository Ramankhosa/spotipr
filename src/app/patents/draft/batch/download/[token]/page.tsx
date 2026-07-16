'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Download, FileArchive, Loader2 } from 'lucide-react'

interface DownloadPayload {
  request?: {
    id: string
    subject?: string | null
    status: string
  } | null
  documents?: Array<{ id: string; filename: string; mimeType?: string | null; sizeBytes?: number | null; downloadUrl: string }>
  error?: string
}

function formatSize(value?: number | null) {
  if (!value) return 'Unknown size'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export default function PatentBatchDownloadPage({ params }: { params: { token: string } }) {
  const { token: authToken } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DownloadPayload | null>(null)

  useEffect(() => {
    if (!authToken) return
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/auto-patent-drafting/download/${params.token}`, {
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
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-8">
          <Link href="/patents/draft/batch" className="text-sm font-medium text-ai-blue-700 hover:underline">
            Back to batch drafting
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Patent Batch Download</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with the same account that created the batch to download the completed patent draft ZIP.
          </p>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {loading ? (
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading batch artifacts...
            </div>
          ) : data?.error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {data.error}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-ai-blue-50 p-3 text-ai-blue-700">
                  <FileArchive className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-950">
                    {data?.request?.subject || 'Completed patent drafting batch'}
                  </div>
                  <div className="text-sm text-slate-500">
                    {(data?.documents || []).length} downloadable artifact{(data?.documents || []).length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {(data?.documents || []).map((document) => (
                  <a
                    key={document.id}
                    href={document.downloadUrl}
                    className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm hover:border-ai-blue-300 hover:bg-ai-blue-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-950">{document.filename}</div>
                      <div className="text-xs text-slate-500">{document.mimeType || 'Archive'} - {formatSize(document.sizeBytes)}</div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-ai-blue-600 px-3 py-2 text-xs font-semibold text-white">
                      <Download className="h-4 w-4" />
                      Download
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
