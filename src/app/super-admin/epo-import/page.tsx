'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Database, HardDrive, RefreshCw, Terminal } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type LedgerRow = { lane: string; status: string; files: number; records: number; bytes: string }
type CoverageRow = { publicationYear: number; status: string; loadedDocs: number; expectedDocs: number | null; textPolicy: string | null }
type FileRow = { fileName: string; lane: string; status: string; recordsLoaded: number; completedAt: string | null }
type FailureRow = { fileName: string; attemptCount: number; errorMessage: string | null }
type ProvenanceRow = { source: string; rows: number }

type Payload = {
  ledger: LedgerRow[]
  coverage: CoverageRow[]
  recentFiles: FileRow[]
  failures: FailureRow[]
  textProvenance: ProvenanceRow[]
  epFullText: { rows: number; withClaims: number; withDescription: number; created: number } | null
  disk: { freeBytes: number; totalBytes: number; minFreeBytes: number; headroomBytes: number; summary: string } | null
  migrationApplied: boolean
}

const GB = 1024 ** 3
const fmtBytes = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`)
const fmtNum = (n: number) => n.toLocaleString()

const STATUS_TONE: Record<string, string> = {
  LOADED: 'bg-green-100 text-green-800',
  IMPORTED: 'bg-green-100 text-green-800',
  VERIFIED: 'bg-lamp-100 text-lamp-800',
  DOWNLOADED: 'bg-lamp-100 text-lamp-800',
  QUEUED: 'bg-gray-100 text-gray-700',
  PARTIAL: 'bg-amber-100 text-amber-800',
  SKIPPED: 'bg-gray-100 text-gray-500',
  FAILED: 'bg-red-100 text-red-800',
  NOT_IMPORTED: 'bg-gray-100 text-gray-500',
}

function Badge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_TONE[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">{icon}{title}</h2>
      {children}
    </div>
  )
}

export default function EpoImportPage() {
  const { token } = useAuth()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/super-admin/epo-import', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const disk = data?.disk
  const diskBreached = disk ? disk.headroomBytes <= 0 : false

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">EPO bulk import</h1>
          <p className="text-sm text-gray-500">EP full-text and DOCDB ingestion status. Read-only.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">{error}</div>
      )}

      {data && !data.migrationApplied && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-sm">
          The EPO tables are not present yet. Run <code className="font-mono">npx prisma migrate deploy</code> on the
          server, then start an import from the CLI.
        </div>
      )}

      {/* Disk headroom — the guard that stops a run, so it leads. */}
      {disk && (
        <div className={`rounded-lg border p-4 ${diskBreached ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
            <HardDrive className="w-4 h-4" /> Disk headroom
            {diskBreached && <span className="text-red-700 font-normal">— below floor, imports will refuse to start</span>}
          </div>
          <div className="h-2 bg-gray-200 rounded overflow-hidden">
            <div
              className={diskBreached ? 'h-full bg-red-500' : 'h-full bg-green-500'}
              style={{ width: `${Math.max(0, Math.min(100, (1 - disk.freeBytes / disk.totalBytes) * 100))}%` }}
            />
          </div>
          <p className="text-xs text-gray-600 mt-2 font-mono">{disk.summary}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="EP full-text stored" icon={<Database className="w-4 h-4" />}>
          {data?.epFullText ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between"><dt className="text-gray-600">Publications</dt><dd className="font-medium">{fmtNum(data.epFullText.rows)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600">With complete claims</dt><dd className="font-medium">{fmtNum(data.epFullText.withClaims)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600">With description</dt><dd className="font-medium">{fmtNum(data.epFullText.withDescription)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600">New rows created</dt><dd className="font-medium">{fmtNum(data.epFullText.created)}</dd></div>
            </dl>
          ) : <p className="text-sm text-gray-500">No data yet.</p>}
        </Card>

        <Card title="Claims coverage across the corpus">
          {data?.textProvenance?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {data.textProvenance.map(row => (
                  <tr key={row.source} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 text-gray-600">{row.source}</td>
                    <td className="py-1 text-right font-medium">{fmtNum(row.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No rows with claims yet.</p>}
        </Card>
      </div>

      <Card title="Coverage by publication year">
        {data?.coverage?.length ? (
          <div className="flex flex-wrap gap-2">
            {data.coverage.map(row => (
              <div key={row.publicationYear} className="border border-gray-200 rounded px-2 py-1 text-xs">
                <div className="font-medium text-gray-900">{row.publicationYear}</div>
                <Badge status={row.status} />
                <div className="text-gray-500 mt-0.5">{fmtNum(row.loadedDocs)} docs</div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500">No years imported yet.</p>}
      </Card>

      <Card title="Ledger">
        {data?.ledger?.length ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 border-b border-gray-200">
              <tr><th className="text-left py-1">Lane</th><th className="text-left">Status</th><th className="text-right">Files</th><th className="text-right">Records</th><th className="text-right">Downloaded</th></tr>
            </thead>
            <tbody>
              {data.ledger.map(row => (
                <tr key={`${row.lane}-${row.status}`} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 font-mono text-xs">{row.lane}</td>
                  <td><Badge status={row.status} /></td>
                  <td className="text-right">{fmtNum(row.files)}</td>
                  <td className="text-right">{fmtNum(row.records)}</td>
                  <td className="text-right text-gray-600">{fmtBytes(Number(row.bytes))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-gray-500">Nothing processed yet.</p>}
      </Card>

      {data?.failures?.length ? (
        <Card title="Failures" icon={<AlertTriangle className="w-4 h-4 text-red-600" />}>
          <ul className="text-sm space-y-2">
            {data.failures.map(f => (
              <li key={f.fileName} className="border-l-2 border-red-300 pl-2">
                <div className="font-mono text-xs text-gray-900">{f.fileName}</div>
                <div className="text-xs text-gray-600">attempt {f.attemptCount} — {f.errorMessage || 'no message'}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data?.recentFiles?.length ? (
        <Card title="Recently processed">
          <table className="w-full text-sm">
            <tbody>
              {data.recentFiles.map(f => (
                <tr key={f.fileName} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 font-mono text-xs truncate max-w-md">{f.fileName}</td>
                  <td><Badge status={f.status} /></td>
                  <td className="text-right">{fmtNum(f.recordsLoaded)}</td>
                  <td className="text-right text-xs text-gray-500">
                    {f.completedAt ? new Date(f.completedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {/* Runs are long and large; they belong on the CLI, not behind a button. */}
      <Card title="Starting a run" icon={<Terminal className="w-4 h-4" />}>
        <p className="text-sm text-gray-600 mb-2">
          Imports move hundreds of GB over hours or days, so they run from the CLI under tmux rather than from this page.
        </p>
        <pre className="bg-gray-900 text-gray-100 rounded p-3 text-xs overflow-x-auto">{`cd /var/www/patentnest/spotipr
npx tsx scripts/epo-bdds-import/cli.ts preflight
npx tsx scripts/epo-bdds-import/cli.ts backfill --lane ep-fulltext --year 2025 --only-dated --limit 1`}</pre>
      </Card>
    </div>
  )
}
