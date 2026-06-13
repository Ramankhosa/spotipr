import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import {
  DRAFT_IDEA_FILE_MAX_BYTES,
  DraftIdeaFileIngestionError,
  extractDraftIdeaTextFromBuffer,
} from '@/lib/draft-idea-file-ingestion'
import { MAX_DRAFTING_UPLOAD_MB } from '@/lib/drafting-constants'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > DRAFT_IDEA_FILE_MAX_BYTES) {
      return NextResponse.json({ error: `File size must be less than ${MAX_DRAFTING_UPLOAD_MB}MB` }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await extractDraftIdeaTextFromBuffer({
      fileName: file.name,
      mimeType: file.type,
      buffer,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof DraftIdeaFileIngestionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('Draft idea file ingestion error:', error)
    return NextResponse.json({ error: 'Failed to process file. Please check the file format and try again.' }, { status: 500 })
  }
}
