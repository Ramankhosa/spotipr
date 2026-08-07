/**
 * POST /api/patents/[patentId]/filing/inventors/parse
 *
 * Turn a pasted block of text into prefilled inventor rows.
 *
 * Deliberately does NOT write anything. It returns candidates for the attorney to review in
 * the editable table; saving is a separate, explicit action. A model must never put a name
 * or an address onto a filing form without a human having looked at it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseInventorsFromText } from '@/lib/filing/inventor-parse'
import { isAccessDenied, requirePatentAccess } from '@/lib/filing/filing-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const payloadSchema = z.object({
  text: z.string().min(5, 'Paste the inventor details first.').max(20000),
  defaultCountry: z.string().max(60).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { patentId: string } }) {
  try {
    const access = await requirePatentAccess(request, params.patentId)
    if (isAccessDenied(access)) return access.response

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || 'Validation failed' },
        { status: 400 }
      )
    }

    // The gateway meters against the caller's plan, so it needs the original auth headers.
    const result = await parseInventorsFromText(
      { headers: Object.fromEntries(request.headers.entries()) },
      parsed.data.text,
      { defaultCountry: parsed.data.defaultCountry }
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Filing] inventor parse failed:', error)
    return NextResponse.json({ error: 'Could not read the inventor details' }, { status: 500 })
  }
}
