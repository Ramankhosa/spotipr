import fs from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

function attachmentName(value: string) {
  return value.replace(/[^\x20-\x7e]+/g, '_').replace(/[\\"]/g, '_')
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await verifySuperAdmin(request)
    if ('error' in auth) return auth.error

    const journalFile = await (prisma as any).ipIndiaJournalFile.findUnique({
      where: { id: params.id },
      select: {
        fileName: true,
        storedPath: true,
        outputFile: true,
        fileSizeBytes: true,
        patentImportFile: {
          select: {
            originalName: true,
            storedPath: true,
            mimeType: true,
            fileSizeBytes: true,
          },
        },
      },
    })
    if (!journalFile) return NextResponse.json({ error: 'IP India journal PDF record not found.' }, { status: 404 })

    const storedPath = journalFile.storedPath || journalFile.outputFile || journalFile.patentImportFile?.storedPath
    if (!storedPath) return NextResponse.json({ error: 'PDF has not been downloaded yet.' }, { status: 404 })

    let buffer: Buffer
    try {
      buffer = await fs.readFile(storedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({ error: 'Downloaded PDF file is no longer available on disk.' }, { status: 404 })
      }
      throw error
    }

    const body = new ArrayBuffer(buffer.length)
    new Uint8Array(body).set(buffer)
    return new NextResponse(body, {
      headers: {
        'Content-Type': journalFile.patentImportFile?.mimeType || 'application/pdf',
        'Content-Length': String(buffer.length || journalFile.fileSizeBytes || journalFile.patentImportFile?.fileSizeBytes || 0),
        'Content-Disposition': `attachment; filename="${attachmentName(journalFile.fileName || journalFile.patentImportFile?.originalName || 'ipindia-journal.pdf')}"`,
      },
    })
  } catch (error) {
    console.error('[PatentCorpus] Download IP India archive PDF failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to download IP India archive PDF.' },
      { status: 500 }
    )
  }
}
