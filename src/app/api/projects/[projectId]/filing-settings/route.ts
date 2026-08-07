/**
 * Project-layer filing settings — the middle of the firm -> project -> patent cascade,
 * and the signatory who signs for the applicant on every patent in this project.
 *
 * PUT stores a SPARSE patch. "Save as project default" from the Filing tab diffs the
 * attorney's current settings against what the firm layer already resolves to and sends only
 * the genuine deviations, so a project keeps inheriting later firm-level changes for
 * everything it did not deliberately override.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'
import { DECLARATION_CLAUSES } from '@/lib/filing/declarations'
import { asPatch, buildCascade, diffToPatch } from '@/lib/filing/settings-resolver'
import { sanitizeField } from '@/lib/filing/formatting'
import type { ResolvedFilingSettings } from '@/lib/filing/types'

export const dynamic = 'force-dynamic'

const CLAUSE_KEYS = DECLARATION_CLAUSES.map(c => c.key) as [string, ...string[]]

const resolvedSettingsSchema = z.object({
  emptyFieldStyle: z.enum(['dash', 'na', 'blank']),
  notApplicableStyle: z.enum(['dash', 'na', 'blank', 'strike']),
  inapplicableClauseStyle: z.enum(['cross', 'strike']),
  dateStyle: z.enum(['blankDay', 'fullDate']),
  officeBranch: z.string().min(1).max(60),
  titleCase: z.enum(['preserve', 'title', 'upper']),
  nameCase: z.enum(['preserve', 'title', 'upper']),
  addressLineTerminalPeriod: z.boolean(),
  declarations: z.record(z.enum(CLAUSE_KEYS), z.enum(['tick', 'cross', 'strike'])).default({}),
  includeDocs: z.object({ form1: z.boolean(), form5: z.boolean(), drawings: z.boolean() }),
})

const payloadSchema = z.object({
  /** Full resolved settings; the server diffs them down to a sparse patch. */
  settings: resolvedSettingsSchema.optional(),
  signatory: z.object({
    name: z.string().max(160).nullable().optional(),
    designation: z.string().max(160).nullable().optional(),
    mobile: z.string().max(30).nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal('')),
  }).optional(),
  applicantNationality: z.string().max(60).nullable().optional(),
})

async function requireProject(request: NextRequest, projectId: string) {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return {
      response: NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      ),
    }
  }
  const userId = authResult.user.id
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [{ userId }, { collaborators: { some: { userId } } }],
    },
    select: { id: true, user: { select: { tenantId: true } } },
  })
  if (!project) {
    return { response: NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 }) }
  }
  return { project, userId }
}

export async function PUT(request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const access = await requireProject(request, params.projectId)
    if ('response' in access) return access.response

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const profile = await prisma.applicantProfile.findUnique({ where: { projectId: params.projectId } })
    if (!profile) {
      return NextResponse.json(
        { error: 'Add the applicant profile for this project before saving filing settings.' },
        { status: 400 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {}

    if (parsed.data.settings) {
      const tenantId = access.project.user?.tenantId ?? null
      const firmPreset = tenantId
        ? await prisma.firmFilingPreset.findFirst({ where: { tenantId, isDefault: true } }).catch(() => null)
        : null

      // Diff against the firm layer only — storing a full copy here would freeze inherited
      // values and detach this project from later firm-level changes.
      const patch = diffToPatch(
        parsed.data.settings as ResolvedFilingSettings,
        buildCascade({ firmPreset: (firmPreset as { settings?: unknown } | null)?.settings })
      )
      update.filingSettings = Object.keys(patch).length ? patch : null
    }

    if (parsed.data.signatory) {
      const s = parsed.data.signatory
      update.signatoryName = sanitizeField(s.name) || null
      update.signatoryDesignation = sanitizeField(s.designation) || null
      update.signatoryMobile = sanitizeField(s.mobile) || null
      update.signatoryEmail = sanitizeField(s.email) || null
    }

    if (parsed.data.applicantNationality !== undefined) {
      update.applicantNationality = sanitizeField(parsed.data.applicantNationality) || null
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const saved = await prisma.applicantProfile.update({
      where: { projectId: params.projectId },
      data: update,
      select: {
        filingSettings: true,
        signatoryName: true,
        signatoryDesignation: true,
        signatoryMobile: true,
        signatoryEmail: true,
        applicantNationality: true,
      },
    })

    return NextResponse.json({ profile: saved, patch: asPatch(saved.filingSettings) })
  } catch (error) {
    console.error('[Filing] project settings PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save project filing settings' }, { status: 500 })
  }
}
