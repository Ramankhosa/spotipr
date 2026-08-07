/**
 * Patent inventors.
 *
 * GET  - this patent's inventors, plus the project's inventor directory (people already
 *        entered on sibling patents) so repeat inventors are picked, not retyped.
 * PUT  - replace the whole ordered list.
 *
 * Rows are written as independent SNAPSHOTS even when seeded from the directory: editing a
 * person's address next year must not retroactively change what an already-filed patent's
 * forms regenerate to.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessDenied, requirePatentAccess } from '@/lib/filing/filing-access'
import { INDIAN_PIN_RE, normalizeHonorific, renderPersonName, sanitizeField } from '@/lib/filing/formatting'

export const dynamic = 'force-dynamic'

const inventorSchema = z.object({
  honorific: z.string().max(20).nullable().optional(),
  nameBody: z.string().min(1, 'Inventor name is required').max(200),
  familyNameFirst: z.boolean().optional(),
  // Everything except the name is optional HERE on purpose. Saving is a work-in-progress
  // action: the extractor deliberately leaves fields blank rather than inventing them, and
  // an attorney must be able to save a partially-filled set and come back to it.
  // Completeness is enforced at GENERATION by validateFiling(), which blocks the bundle on
  // a missing city/state/PIN — that is the gate that protects the legal document.
  nationality: z.string().max(60).optional().default(''),
  countryOfResidence: z.string().max(60).optional().default(''),
  addressLine1: z.string().max(300).optional().default(''),
  street: z.string().max(200).nullable().optional(),
  city: z.string().max(120).optional().default(''),
  state: z.string().max(120).optional().default(''),
  country: z.string().max(60).optional().default(''),
  pinCode: z.string().max(20).optional().default(''),
  isAdditionalInventor: z.boolean().optional(),
}).superRefine((value, ctx) => {
  // A PIN that is present but malformed is still worth rejecting — a wrong six digits is
  // worse than none, because it looks correct on the form.
  const pin = (value.pinCode || '').trim()
  const country = (value.country || '').trim().toLowerCase()
  if (pin && country === 'india' && !INDIAN_PIN_RE.test(pin)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pinCode'],
      message: 'Indian PIN codes are six digits and cannot start with 0.',
    })
  }
})

const payloadSchema = z.object({
  inventors: z.array(inventorSchema).max(50),
})

export async function GET(request: NextRequest, { params }: { params: { patentId: string } }) {
  try {
    const access = await requirePatentAccess(request, params.patentId)
    if (isAccessDenied(access)) return access.response

    const patent = await prisma.patent.findUnique({
      where: { id: params.patentId },
      select: { projectId: true },
    })
    if (!patent) return NextResponse.json({ error: 'Patent not found' }, { status: 404 })

    const [inventors, directoryRows] = await Promise.all([
      prisma.patentInventor.findMany({
        where: { patentId: params.patentId },
        orderBy: { sortOrder: 'asc' },
      }),
      // Everyone previously entered on any patent in this project.
      prisma.patentInventor.findMany({
        where: { patent: { projectId: patent.projectId }, patentId: { not: params.patentId } },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
    ])

    // Collapse the directory to distinct people (name + address).
    const seen = new Set<string>()
    const directory = directoryRows.filter(row => {
      const key = `${renderPersonName({ honorific: row.honorific, nameBody: row.nameBody }).toLowerCase()}|${row.pinCode}|${row.city.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 50)

    return NextResponse.json({ inventors, directory })
  } catch (error) {
    console.error('[Filing] inventors GET failed:', error)
    return NextResponse.json({ error: 'Failed to load inventors' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { patentId: string } }) {
  try {
    const access = await requirePatentAccess(request, params.patentId)
    if (isAccessDenied(access)) return access.response

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      // Name the inventor and the field. "Validation failed" on its own leaves the attorney
      // hunting through the table for what the server objected to.
      const first = parsed.error.errors[0]
      const row = typeof first?.path?.[1] === 'number' ? Number(first.path[1]) + 1 : null
      const field = first?.path?.[2]
      const message = row
        ? `Inventor ${row}${field ? ` — ${String(field)}` : ''}: ${first.message}`
        : (first?.message || 'Validation failed')
      return NextResponse.json(
        { error: message, details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const rows = parsed.data.inventors.map((inv, index) => ({
      patentId: params.patentId,
      sortOrder: index,
      // Not sanitizeField — that strips the trailing period an honorific needs.
      honorific: normalizeHonorific(inv.honorific) || null,
      nameBody: sanitizeField(inv.nameBody),
      familyNameFirst: inv.familyNameFirst ?? false,
      nationality: sanitizeField(inv.nationality),
      countryOfResidence: sanitizeField(inv.countryOfResidence),
      addressLine1: sanitizeField(inv.addressLine1),
      street: sanitizeField(inv.street) || null,
      city: sanitizeField(inv.city),
      state: sanitizeField(inv.state),
      country: sanitizeField(inv.country),
      pinCode: sanitizeField(inv.pinCode),
      isAdditionalInventor: inv.isAdditionalInventor ?? false,
    }))

    // Replace atomically: a half-written inventor list would render a defective Form 5.
    await prisma.$transaction([
      prisma.patentInventor.deleteMany({ where: { patentId: params.patentId } }),
      ...(rows.length ? [prisma.patentInventor.createMany({ data: rows })] : []),
    ])

    const inventors = await prisma.patentInventor.findMany({
      where: { patentId: params.patentId },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({ inventors })
  } catch (error) {
    console.error('[Filing] inventors PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save inventors' }, { status: 500 })
  }
}
