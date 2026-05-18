import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const EXPORT_FIELDS = {
  id: true,
  publicationNumber: true,
  applicationNumberRaw: true,
  kind: true,
  country: true,
  filingDate: true,
  publicationDate: true,
  title: true,
  abstract: true,
  abstractOriginal: true,
  applicants: true,
  inventors: true,
  classifications: true,
  rawApplicantBlock: true,
  rawInventorBlock: true,
  rawClassificationBlock: true,
  rawText: true,
  numberOfPages: true,
  numberOfClaims: true,
  sourcePdfName: true,
  sourceFileHash: true,
  sourcePageNumber: true,
  ragText: true,
  embeddingText: true,
  extractionVersion: true,
  extractionConfidence: true,
  extractionWarnings: true,
  createdAt: true,
  updatedAt: true,
  embeddings: {
    select: {
      model: true,
      dimensions: true,
      textHash: true,
      status: true,
      errorMessage: true,
      embeddedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
}

async function verifySuperAdmin(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }

  const roles = auth.user.roles || []
  if (!roles.includes('SUPER_ADMIN') && !roles.includes('SUPER_ADMIN_VIEWER')) {
    return { error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }

  return { user: auth.user }
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

function toCsv(rows: any[]) {
  const columns = [
    'publicationNumber',
    'applicationNumberRaw',
    'kind',
    'country',
    'filingDate',
    'publicationDate',
    'title',
    'abstract',
    'applicants',
    'inventors',
    'classifications',
    'numberOfPages',
    'numberOfClaims',
    'sourcePdfName',
    'sourceFileHash',
    'sourcePageNumber',
    'extractionConfidence',
    'extractionWarnings',
    'embeddingStatuses',
  ]

  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(columns.map(column => {
      if (column === 'embeddingStatuses') {
        return csvCell((row.embeddings || []).map((embedding: any) => ({
          model: embedding.model,
          status: embedding.status,
          textHash: embedding.textHash,
          embeddedAt: embedding.embeddedAt,
        })))
      }
      return csvCell(row[column])
    }).join(','))
  }
  return lines.join('\n')
}

async function getBatchFileHashes(batchId: string) {
  const batch = await (prisma as any).patentImportBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      files: { select: { fileHash: true } },
    },
  })
  if (!batch) return null
  return Array.from(new Set((batch.files || []).map((file: any) => file.fileHash).filter(Boolean)))
}

export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const format = (searchParams.get('format') || 'jsonl').toLowerCase()
  const batchId = searchParams.get('batchId')

  if (!['jsonl', 'json', 'csv'].includes(format)) {
    return NextResponse.json({ error: 'Export format must be jsonl, json, or csv.' }, { status: 400 })
  }

  const where: any = {}
  if (batchId) {
    const fileHashes = await getBatchFileHashes(batchId)
    if (!fileHashes) {
      return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 })
    }
    where.sourceFileHash = { in: fileHashes.length ? fileHashes : ['__no_files__'] }
  }

  const patents = await (prisma as any).localPatent.findMany({
    where,
    orderBy: [
      { sourcePdfName: 'asc' },
      { sourcePageNumber: 'asc' },
      { publicationNumber: 'asc' },
    ],
    select: EXPORT_FIELDS,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  const scope = batchId ? `batch-${batchId}` : 'all'
  const baseName = `patent-corpus-${scope}-${stamp}`
  const headers = new Headers()

  if (format === 'csv') {
    headers.set('Content-Type', 'text/csv; charset=utf-8')
    headers.set('Content-Disposition', `attachment; filename="${baseName}.csv"`)
    return new NextResponse(toCsv(patents), { headers })
  }

  if (format === 'json') {
    headers.set('Content-Type', 'application/json; charset=utf-8')
    headers.set('Content-Disposition', `attachment; filename="${baseName}.json"`)
    return new NextResponse(JSON.stringify({
      exportedAt: new Date().toISOString(),
      batchId,
      count: patents.length,
      patents,
    }, null, 2), { headers })
  }

  headers.set('Content-Type', 'application/x-ndjson; charset=utf-8')
  headers.set('Content-Disposition', `attachment; filename="${baseName}.jsonl"`)
  return new NextResponse(patents.map((patent: any) => JSON.stringify(patent)).join('\n') + '\n', { headers })
}
