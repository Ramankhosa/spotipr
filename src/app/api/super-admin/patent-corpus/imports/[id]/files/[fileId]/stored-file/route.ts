import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { deletePatentImportFileStoredPdf } from '@/lib/patent-corpus-service'
import { prisma } from '@/lib/prisma'
import fs from 'fs/promises'

export const runtime = 'nodejs'

async function verifySuperAdmin(request: NextRequest, write = false) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }

  const roles = auth.user.roles || []
  const isSuperAdmin = roles.includes('SUPER_ADMIN')
  const isViewer = roles.includes('SUPER_ADMIN_VIEWER')
  if (!isSuperAdmin && !isViewer) {
    return { error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }
  if (write && !isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Write access required' }, { status: 403 }) }
  }

  return { user: auth.user }
}

function attachmentName(value: string) {
  return value.replace(/[^\x20-\x7e]+/g, '_').replace(/[\\"]/g, '_')
}

export async function GET(request: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    const auth = await verifySuperAdmin(request)
    if ('error' in auth) return auth.error

    const file = await (prisma as any).patentImportFile.findFirst({
      where: { id: params.fileId, batchId: params.id },
      select: {
        originalName: true,
        storedPath: true,
        mimeType: true,
        fileSizeBytes: true,
      },
    })
    if (!file) return NextResponse.json({ error: 'Import file not found.' }, { status: 404 })

    let buffer: Buffer
    try {
      buffer = await fs.readFile(file.storedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({ error: 'Stored PDF file is no longer available.' }, { status: 404 })
      }
      throw error
    }

    const body = new ArrayBuffer(buffer.length)
    new Uint8Array(body).set(buffer)
    return new NextResponse(body, {
      headers: {
        'Content-Type': file.mimeType || 'application/pdf',
        'Content-Length': String(buffer.length || file.fileSizeBytes || 0),
        'Content-Disposition': `attachment; filename="${attachmentName(file.originalName || 'patent-journal.pdf')}"`,
      },
    })
  } catch (error) {
    console.error('[PatentCorpus] Download stored PDF failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to download uploaded PDF file.' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    const auth = await verifySuperAdmin(request, true)
    if ('error' in auth) return auth.error

    const result = await deletePatentImportFileStoredPdf(params.id, params.fileId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[PatentCorpus] Delete stored PDF failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete uploaded PDF file.' },
      { status: 500 }
    )
  }
}
