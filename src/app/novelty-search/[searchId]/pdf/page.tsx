'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

const REPORT_TIMEOUT_MS = 120000

export default function ProtectedNoveltyPdfPage() {
  const params = useParams()
  const router = useRouter()
  const searchId = params?.searchId as string
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const [pdfUrl, setPdfUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading || !searchId) return
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent(`/novelty-search/${searchId}/pdf`)}`)
      return
    }
    let objectUrl = ''
    let published = false
    let cancelled = false
    // A request that never settles used to leave this page on its spinner forever with no
    // way to tell why. Always land on either a PDF or a visible error.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS)
    authFetch(`/api/novelty-search/${searchId}/attorney-report/pdf?disposition=inline`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to open the final PDF report.')
        }
        objectUrl = URL.createObjectURL(await response.blob())
        if (cancelled) { URL.revokeObjectURL(objectUrl); return }
        published = true
        setPdfUrl(objectUrl)
      })
      .catch(cause => {
        if (cancelled) return
        const timedOut = cause instanceof DOMException && cause.name === 'AbortError'
        setError(timedOut
          ? 'The final PDF report took too long to build. Please try again, and report this if it keeps happening.'
          : cause instanceof Error ? cause.message : 'Failed to open the final PDF report.')
      })
      .finally(() => { clearTimeout(timer); if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
      // Only revoke a URL this run never handed to the iframe — revoking the live one
      // blanks the viewer that is already showing it.
      if (objectUrl && !published) URL.revokeObjectURL(objectUrl)
    }
  }, [authFetch, authLoading, router, searchId, user])

  const download = () => {
    if (!pdfUrl) return
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = `patentnest-novelty-report-${searchId.slice(0, 8)}.pdf`
    link.click()
  }

  if (authLoading || loading) return <div className="flex min-h-screen items-center justify-center gap-2 text-slate-600"><Loader2 className="h-6 w-6 animate-spin" /> Loading final PDF report…</div>
  if (!user) return null

  return <div className="flex min-h-screen flex-col bg-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <button onClick={() => router.push('/novelty-search/history')} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Search History</button>
      <button onClick={download} disabled={!pdfUrl} className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Download className="h-4 w-4" /> Download PDF</button>
    </header>
    {error ? <div className="m-auto max-w-lg rounded-lg border border-red-200 bg-white p-6 text-center text-red-700">{error}</div> : <iframe title="Final novelty search PDF" src={pdfUrl} className="min-h-0 flex-1 border-0" />}
  </div>
}
