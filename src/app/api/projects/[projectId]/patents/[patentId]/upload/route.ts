import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'
import mammoth from 'mammoth'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'

async function getUserFromRequest(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  // Verify JWT
  const payload = verifyJWT(token)
  if (!payload || !payload.email) {
    return null
  }

  return payload.email
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, patentId } = params

    // Check if user has access to the project (owner or collaborator)
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: userEmail } },
          { collaborators: { some: { user: { email: userEmail } } } }
        ]
      }
    })

    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Verify patent exists and belongs to the project
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        projectId
      }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size (25MB limit)
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 25MB limit' }, { status: 400 })
    }

    // Validate file type (extend to allow diagram images)
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/pdf', // .pdf
      'text/plain', // .txt
      'text/markdown', // .md,
      'image/png',
      'image/svg+xml'
    ]

    const allowedExtensions = ['.docx', '.pdf', '.txt', '.md', '.png', '.svg']
    const fileName = file.name.toLowerCase()
    const hasAllowedExtension = allowedExtensions.some(ext => fileName.endsWith(ext))

    if (!allowedTypes.includes(file.type) && !hasAllowedExtension) {
      return NextResponse.json({
        error: 'Unsupported file type. Please upload .docx, .pdf, .txt, or .md files'
      }, { status: 400 })
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    let html = ''
    let textContent = ''

    try {
      if (file.type === 'image/png' || fileName.endsWith('.png') || file.type === 'image/svg+xml' || fileName.endsWith('.svg')) {
        // Store diagram image to disk
        const baseDir = path.join(process.cwd(), 'uploads', 'projects', projectId, 'patents', patentId, 'figures')
        await fs.mkdir(baseDir, { recursive: true })
        const outPath = path.join(baseDir, file.name)
        await fs.writeFile(outPath, buffer)
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex')
        return NextResponse.json({
          message: 'Image uploaded',
          filename: file.name,
          path: outPath,
          checksum
        })
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
        // Convert DOCX to HTML
        const result = await mammoth.convertToHtml({ buffer })
        html = result.value
        textContent = result.value.replace(/<[^>]*>/g, '') // Strip HTML tags for plain text
      } else if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
        // PDF processing is not currently supported
        textContent = "PDF content extraction is currently not supported."
        html = `<div class="pdf-converted"><p class="warning">⚠️ PDF processing is currently not supported. Please paste text directly or upload other file formats.</p></div>`
      } else if (file.type === 'text/plain' || fileName.endsWith('.txt') || file.type === 'text/markdown' || fileName.endsWith('.md')) {
        // Handle plain text and markdown
        textContent = buffer.toString('utf-8')
        // Convert line breaks to HTML
        html = textContent
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
          .replace(/\n\n/g, '</p><p>')
        html = `<p>${html}</p>`
      } else {
        return NextResponse.json({ error: 'Unsupported file format' }, { status: 400 })
      }

      return NextResponse.json({
        html,
        textContent,
        fileName: file.name,
        fileSize: file.size,
        message: 'File converted successfully'
      })
    } catch (conversionError) {
      console.error('File conversion error:', conversionError)

      // Fallback: try to read as plain text
      try {
        textContent = buffer.toString('utf-8')
        html = `<div class="conversion-error"><p>⚠️ File conversion failed. Displaying as plain text:</p><pre>${textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>`

        return NextResponse.json({
          html,
          textContent,
          fileName: file.name,
          fileSize: file.size,
          warning: 'File conversion failed, showing as plain text',
          message: 'File processed with fallback conversion'
        })
      } catch (fallbackError) {
        console.error('Fallback conversion also failed:', fallbackError)
        return NextResponse.json({ error: 'Failed to process file' }, { status: 500 })
      }
    }
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, patentId } = params
    const url = new URL(request.url)
    const filename = url.searchParams.get('filename') || ''

    if (!filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    // basic traversal guard and allowed formats
    if (filename.includes('..')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }
    const lower = filename.toLowerCase()
    const isPng = lower.endsWith('.png')
    const isSvg = lower.endsWith('.svg')
    if (!isPng && !isSvg) {
      return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })
    }

    // access check
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: userEmail } },
          { collaborators: { some: { user: { email: userEmail } } } }
        ]
      }
    })
    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    const baseDir = path.join(process.cwd(), 'uploads', 'projects', projectId, 'patents', patentId, 'figures')
    const filePath = path.join(baseDir, filename)

    try {
      const buf = await fs.readFile(filePath)
      const contentType = isPng ? 'image/png' : 'image/svg+xml'
      return new Response(buf, { status: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=0' } })
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('GET image error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
