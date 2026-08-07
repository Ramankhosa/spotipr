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
  nationality: z.string().min(1, 'Nationality is required').max(60),
  countryOfResidence: z.string().min(1, 'Country of residence is required').max(60),
  addressLine1: z.string().min(1, 'Address is required').max(300),
  street: z.string().max(200).nullable().optional(),
  city: z.string().min(1, 'City is required').max(120),
  state: z.string().min(1, 'State is required').max(120),
  country: z.string().min(1, 'Country is required').max(60),
  pinCode: z.string().min(1, 'PIN code is required').max(20),
  isAdditionalInventor: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.country.trim().toLowerCase() === 'india' && !INDIAN_PIN_RE.test(value.pinCode.trim())) {
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
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
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
