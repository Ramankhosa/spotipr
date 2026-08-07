/**
 * Filing tab data + filing details.
 *
 * GET  - everything the Filing tab renders: resolved settings with per-key provenance,
 *        the declaration matrix with per-clause provenance and conflicts, inventors,
 *        filing details, and the validation checklist.
 * PUT  - save filing details and the PATENT-layer settings patch.
 *
 * The patch saved here is sparse on purpose: keys the attorney did not touch stay absent so
 * they keep inheriting from the project and firm layers. Writing a full copy would freeze
 * inherited values and silently detach this filing from later firm-level changes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assembleFiling } from '@/lib/filing/filing-service'
import { isAccessDenied, requirePatentAccess } from '@/lib/filing/filing-access'
import { DECLARATION_CLAUSES, GROUP_LABELS } from '@/lib/filing/declarations'

export const dynamic = 'force-dynamic'

const declarationStateSchema = z.enum(['tick', 'cross', 'strike'])

const settingsPatchSchema = z.object({
  emptyFieldStyle: z.enum(['dash', 'na', 'blank']).optional(),
  notApplicableStyle: z.enum(['dash', 'na', 'blank', 'strike']).optional(),
  inapplicableClauseStyle: z.enum(['cross', 'strike']).optional(),
  dateStyle: z.enum(['blankDay', 'fullDate']).optional(),
  officeBranch: z.string().min(1).max(60).optional(),
  titleCase: z.enum(['preserve', 'title', 'upper']).optional(),
  nameCase: z.enum(['preserve', 'title', 'upper']).optional(),
  addressLineTerminalPeriod: z.boolean().optional(),
  declarations: z.record(z.string(), declarationStateSchema).optional(),
  includeDocs: z.object({
    form1: z.boolean().optional(),
    form5: z.boolean().optional(),
    drawings: z.boolean().optional(),
  }).optional(),
}).strict()

const filingDetailSchema = z.object({
  applicationType: z.enum(['ordinary', 'convention', 'pct_np']).optional(),
  specType: z.enum(['provisional', 'complete']).optional(),
  isDivisional: z.boolean().optional(),
  isPatentOfAddition: z.boolean().optional(),
  officeBranch: z.string().min(1).max(60).optional(),
  applicantRefNo: z.string().max(120).nullable().optional(),
  specPages: z.number().int().min(0).max(9999).optional(),
  claimsCount: z.number().int().min(0).max(9999).optional(),
  claimsPages: z.number().int().min(0).max(9999).optional(),
  abstractPages: z.number().int().min(0).max(9999).optional(),
  drawingsCount: z.number().int().min(0).max(9999).optional(),
  drawingsPages: z.number().int().min(0).max(9999).optional(),
  feeAmount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  feeMode: z.string().max(40).optional(),
  applicationNo: z.string().max(60).nullable().optional(),
  filingDate: z.coerce.date().nullable().optional(),
  parentApplicationNo: z.string().max(60).nullable().optional(),
  parentFilingDate: z.coerce.date().nullable().optional(),
  signatoryOverride: z.object({
    name: z.string().min(1).max(160),
    designation: z.string().min(1).max(160),
    mobile: z.string().max(30).nullable().optional(),
    email: z.string().email().nullable().optional(),
  }).nullable().optional(),
  filingSettings: settingsPatchSchema.nullable().optional(),
}).strict()

export async function GET(request: NextRequest, { params }: { params: { patentId: string } }) {
  try {
    const access = await requirePatentAccess(request, params.patentId)
    if (isAccessDenied(access)) return access.response

    const assembled = await assembleFiling(params.patentId)
    if (!assembled.ok) {
      return NextResponse.json({ error: assembled.error }, { status: assembled.status })
    }

    const { context, issues, provenance } = assembled.data
    return NextResponse.json({
      title: context.title,
      applicant: context.applicant,
      signatory: context.signatory,
      correspondence: context.correspondence,
      agent: context.agent,
      inventors: context.inventors,
      details: context.details,
      settings: provenance.settings,
      provenance: provenance.provenance,
      declarationProvenance: provenance.declarationProvenance,
      declarations: context.declarations,
      clauseLabels: DECLARATION_CLAUSES.map(c => ({ key: c.key, label: c.label, group: c.group ?? 'form1_12iii' })),
      groupLabels: GROUP_LABELS,
      issues,
      canGenerate: !issues.some(i => i.severity === 'blocking'),
    })
  } catch (error) {
    console.error('[Filing] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load filing details' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { patentId: string } }) {
  try {
    const access = await requirePatentAccess(request, params.patentId)
    if (isAccessDenied(access)) return access.response

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const parsed = filingDetailSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    // Only recognised clause keys reach the database — a typo'd key would otherwise sit in
    // the patch forever, invisible and inert.
    const data = { ...parsed.data }
    if (data.filingSettings?.declarations) {
      const valid = new Set(DECLARATION_CLAUSES.map(c => c.key))
      data.filingSettings = {
        ...data.filingSettings,
        declarations: Object.fromEntries(
          Object.entries(data.filingSettings.declarations).filter(([key]) => valid.has(key as never))
        ),
      }
    }

    await prisma.patentFilingDetail.upsert({
      where: { patentId: params.patentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { patentId: params.patentId, ...(data as any) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: data as any,
    })

    const assembled = await assembleFiling(params.patentId)
    if (!assembled.ok) {
      return NextResponse.json({ error: assembled.error }, { status: assembled.status })
    }

    return NextResponse.json({
      details: assembled.data.context.details,
      settings: assembled.data.provenance.settings,
      provenance: assembled.data.provenance.provenance,
      declarationProvenance: assembled.data.provenance.declarationProvenance,
      declarations: assembled.data.context.declarations,
      issues: assembled.data.issues,
      canGenerate: !assembled.data.issues.some(i => i.severity === 'blocking'),
    })
  } catch (error) {
    console.error('[Filing] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save filing details' }, { status: 500 })
  }
}
