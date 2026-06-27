import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { renderPlantUml } from '@/lib/plantuml-renderer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  let logFigureNo: unknown
  try {
    const auth = await authenticateUser(request)
    if (auth.error || !auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const { patentId } = params
    const body = await request.json()
    const { code, format = 'svg', figureNo, sessionId } = body || {}
    logFigureNo = figureNo

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (code.length > 100_000) {
      return NextResponse.json({ error: 'code is too large' }, { status: 413 })
    }
    if (format !== 'svg' && format !== 'png') {
      return NextResponse.json({ error: 'format must be svg or png' }, { status: 400 })
    }

    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, patentId, userId: auth.user.id },
      select: { id: true }
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
    }

    const rendered = await renderPlantUml(code, format)
    return new NextResponse(new Uint8Array(rendered.buffer), {
      status: 200,
      headers: {
        'Content-Type': rendered.contentType,
        'Cache-Control': 'private, max-age=0',
        'X-Checksum': rendered.checksum
      }
    })
  } catch (error) {
    const err = error as Error & { upstreamStatus?: number; details?: string; cleaned?: string }
    if (err.upstreamStatus) {
      console.warn('[PlantUML render] Upstream render failed', {
        upstreamStatus: err.upstreamStatus,
        figureNo: typeof logFigureNo === 'undefined' ? undefined : logFigureNo,
        snippet: err.cleaned?.slice(0, 400)
      })
      return NextResponse.json(
        { error: 'Upstream render failed', upstreamStatus: err.upstreamStatus, details: err.details },
        { status: 502 }
      )
    }
    console.warn('[PlantUML render] Bad request', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
