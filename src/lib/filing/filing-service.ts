/**
 * India filing forms — server-side assembly.
 *
 * Loads the records, runs the firm -> project -> patent cascade, derives the declarations,
 * validates, and hands the renderers a fully-resolved FilingContext. The renderers do no
 * lookups, so what a form prints is entirely decided here.
 *
 * Every prisma call against the new filing models is wrapped so an environment whose Prisma
 * client has not been regenerated degrades to "not configured yet" instead of a 500 — this
 * repo's production deploy does not run `prisma generate`.
 */

import AdmZip from 'adm-zip'
import { readFile } from 'fs/promises'
import { prisma } from '../prisma'
import { buildForm1Docx, inventorsSameAsApplicant } from './form1-docx'
import { buildForm5Docx } from './form5-docx'
import { buildDrawingsDocx, type DrawingFigure } from './drawings-docx'
import { resolveDeclarations } from './declarations'
import {
  asPatch,
  buildCascade,
  resolveFilingSettings,
  suggestFee,
  type ResolvedSettingsWithProvenance,
} from './settings-resolver'
import { deriveNationality, renderAddressLine, sanitizeField } from './formatting'
import { measureImage } from './figure-images'
import { validateFiling } from './validation'
import type {
  FilingApplicant,
  FilingContext,
  FilingCorrespondence,
  FilingDetails,
  FilingInventor,
  FilingIssue,
  FilingSignatory,
  StructuredAddress,
} from './types'

export interface AssembledFiling {
  context: FilingContext
  issues: FilingIssue[]
  provenance: ResolvedSettingsWithProvenance
  patentTitle: string
  patentId: string
  projectId: string
  tenantId: string | null
}

/**
 * Assemble everything needed to render or preview a filing.
 * `filingDate` is injected rather than read from the clock inside a renderer so a preview
 * and its download produce byte-identical documents.
 */
export async function assembleFiling(
  patentId: string,
  opts: { filingDate?: Date } = {}
): Promise<{ ok: true; data: AssembledFiling } | { ok: false; error: string; status: number }> {
  const patent = await prisma.patent.findUnique({
    where: { id: patentId },
    select: {
      id: true,
      title: true,
      projectId: true,
      project: {
        select: {
          id: true,
          applicantProfile: true,
          user: { select: { tenantId: true } },
        },
      },
    },
  })

  if (!patent) return { ok: false, error: 'Patent not found', status: 404 }

  const profile = patent.project?.applicantProfile
  if (!profile) {
    return {
      ok: false,
      status: 400,
      error: 'This project has no applicant profile yet. Add the applicant and signatory details before generating filing forms.',
    }
  }

  const tenantId = patent.project?.user?.tenantId ?? null

  const [inventorRows, filingDetail, firmPreset] = await Promise.all([
    safe(() => prisma.patentInventor.findMany({ where: { patentId }, orderBy: { sortOrder: 'asc' } }), []),
    safe(() => prisma.patentFilingDetail.findUnique({ where: { patentId } }), null),
    tenantId
      ? safe(() => prisma.firmFilingPreset.findFirst({
          where: { tenantId, isDefault: true },
          orderBy: { updatedAt: 'desc' },
        }), null)
      : Promise.resolve(null),
  ])

  // --- Settings cascade: firm -> project -> patent ------------------------
  const provenance = resolveFilingSettings(buildCascade({
    firmPreset: (firmPreset as { settings?: unknown } | null)?.settings,
    projectPatch: profile.filingSettings,
    patentPatch: filingDetail?.filingSettings,
  }))
  const settings = provenance.settings

  const applicant = toApplicant(profile)
  const inventors = inventorRows.map(toInventor)
  const details = toDetails(filingDetail, applicant.category, settings.officeBranch)
  const signatory = resolveSignatory(profile, filingDetail?.signatoryOverride)
  const agent = profile.useAgent && profile.agentRegistrationNo && profile.agentName
    ? { registrationNo: profile.agentRegistrationNo, name: profile.agentName, mobile: profile.agentPhone }
    : null

  const context: FilingContext = {
    title: patent.title,
    applicant,
    inventors,
    signatory,
    correspondence: toCorrespondence(profile),
    agent,
    details,
    settings,
    declarations: [],
    filingDateForDocs: opts.filingDate ?? new Date(),
  }

  // Declarations need the assembled context to know whether the inventors are the applicant.
  context.declarations = resolveDeclarations(
    {
      details,
      inventorsSameAsApplicant: inventors.length > 0 && inventorsSameAsApplicant(context),
      hasAdditionalInventors: inventors.some(inv => inv.isAdditionalInventor),
    },
    [
      { source: 'firm', patch: asPatch((firmPreset as { settings?: unknown } | null)?.settings)?.declarations },
      { source: 'project', patch: asPatch(profile.filingSettings)?.declarations },
      { source: 'patent', patch: asPatch(filingDetail?.filingSettings)?.declarations },
    ]
  )

  const issues = validateFiling({
    title: context.title,
    applicant,
    inventors,
    signatory,
    correspondence: context.correspondence,
    details,
    declarations: context.declarations,
    hasAgent: Boolean(agent),
  })

  return {
    ok: true,
    data: { context, issues, provenance, patentTitle: patent.title, patentId: patent.id, projectId: patent.projectId, tenantId },
  }
}

export type FilingDocKey = 'form1' | 'form5' | 'drawings'

export interface BundleFile {
  filename: string
  buffer: Buffer
}

/**
 * Render the requested documents and zip them. Callers must have checked for blocking
 * issues first — we never emit a silently defective legal document.
 */
export async function renderFilingBundle(
  data: AssembledFiling,
  docs: FilingDocKey[],
  figures: DrawingFigure[] = []
): Promise<{ zip: Buffer; files: BundleFile[] }> {
  const { context } = data
  const ref = bundleRef(data)
  const files: BundleFile[] = []

  if (docs.includes('form1')) {
    files.push({ filename: `Form1_${ref}.docx`, buffer: await buildForm1Docx(context) })
  }
  if (docs.includes('form5')) {
    files.push({ filename: `Form5_${ref}.docx`, buffer: await buildForm5Docx(context) })
  }
  if (docs.includes('drawings') && figures.length) {
    files.push({
      filename: `Drawings_${ref}.docx`,
      buffer: await buildDrawingsDocx({
        applicantName: context.applicant.legalName,
        signatory: context.signatory,
        organisation: context.applicant.legalName,
        figures,
      }),
    })
  }

  const zip = new AdmZip()
  for (const file of files) zip.addFile(file.filename, file.buffer)
  return { zip: zip.toBuffer(), files }
}

/** Load figure images for the Drawings document from the patent's completed sketches. */
export async function loadPatentFigures(patentId: string): Promise<DrawingFigure[]> {
  type SketchRow = {
    figureNo: number | null
    title: string
    imagePath: string | null
    imageWidth: number | null
    imageHeight: number | null
  }

  const sketches = await safe<SketchRow[]>(() => prisma.sketchRecord.findMany({
    where: { patentId, status: 'SUCCESS', imagePath: { not: null } },
    orderBy: [{ figureNo: 'asc' }, { createdAt: 'asc' }],
    select: { figureNo: true, title: true, imagePath: true, imageWidth: true, imageHeight: true },
  }), [])

  const figures: DrawingFigure[] = []
  for (let index = 0; index < sketches.length; index++) {
    const sketch = sketches[index]
    if (!sketch.imagePath) continue
    try {
      const image = await readFile(sketch.imagePath)
      // Measure the bytes rather than trusting the stored columns, which can be null or
      // stale after a figure is regenerated. A wrong ratio here distorts the drawing.
      const measured = measureImage(image)
      figures.push({
        figureNo: sketch.figureNo ?? index + 1,
        image,
        imageType: sketch.imagePath.toLowerCase().endsWith('.jpg') || sketch.imagePath.toLowerCase().endsWith('.jpeg') ? 'jpg' : 'png',
        width: measured.width ?? sketch.imageWidth ?? undefined,
        height: measured.height ?? sketch.imageHeight ?? undefined,
      })
    } catch (error) {
      // A missing image file must not take down the whole bundle — the other documents are
      // still valid and the attorney is told which figures were skipped.
      console.warn(`[Filing] figure image unreadable, skipping: ${sketch.imagePath}`, error)
    }
  }
  return figures
}

/** Freeze the resolved settings so regenerating after a firm-level change is stable. */
export async function snapshotResolvedSettings(patentId: string, data: AssembledFiling): Promise<void> {
  await safe(() => prisma.patentFilingDetail.upsert({
    where: { patentId },
    create: {
      patentId,
      resolvedSnapshot: JSON.parse(JSON.stringify(data.provenance.settings)),
      lastGeneratedAt: new Date(),
    },
    update: {
      resolvedSnapshot: JSON.parse(JSON.stringify(data.provenance.settings)),
      lastGeneratedAt: new Date(),
    },
  }), null)
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toApplicant(profile: {
  applicantLegalName: string
  applicantCategory: string
  applicantNationality: string | null
  applicantAddressLine1: string
  applicantAddressLine2: string | null
  applicantCity: string
  applicantState: string
  applicantCountryCode: string
  applicantPostalCode: string
}): FilingApplicant {
  const country = countryName(profile.applicantCountryCode)
  return {
    legalName: profile.applicantLegalName,
    category: profile.applicantCategory as FilingApplicant['category'],
    nationality: profile.applicantNationality || deriveNationality(country),
    countryOfResidence: country,
    address: {
      addressLine1: profile.applicantAddressLine1,
      street: profile.applicantAddressLine2,
      city: profile.applicantCity,
      state: profile.applicantState,
      country,
      pinCode: profile.applicantPostalCode,
    },
  }
}

function toInventor(row: {
  id: string
  sortOrder: number
  honorific: string | null
  nameBody: string
  familyNameFirst: boolean
  nationality: string
  countryOfResidence: string
  addressLine1: string
  street: string | null
  city: string
  state: string
  country: string
  pinCode: string
  isAdditionalInventor: boolean
}): FilingInventor {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    name: { honorific: row.honorific, nameBody: row.nameBody, familyNameFirst: row.familyNameFirst },
    nationality: row.nationality,
    countryOfResidence: row.countryOfResidence,
    address: {
      addressLine1: row.addressLine1,
      street: row.street,
      city: row.city,
      state: row.state,
      country: row.country,
      pinCode: row.pinCode,
    },
    isAdditionalInventor: row.isAdditionalInventor,
  }
}

function toCorrespondence(profile: {
  correspondenceName: string
  correspondenceEmail: string
  correspondencePhone: string
  correspondenceAddressLine1: string
  correspondenceAddressLine2: string | null
  correspondenceCity: string
  correspondenceState: string
  correspondenceCountryCode: string
  correspondencePostalCode: string
  signatoryMobile?: string | null
}): FilingCorrespondence {
  const address: StructuredAddress = {
    addressLine1: profile.correspondenceAddressLine1,
    street: profile.correspondenceAddressLine2,
    city: profile.correspondenceCity,
    state: profile.correspondenceState,
    country: countryName(profile.correspondenceCountryCode),
    pinCode: profile.correspondencePostalCode,
  }
  return {
    name: profile.correspondenceName,
    postalAddress: renderAddressLine(address),
    email: profile.correspondenceEmail,
    phone: profile.correspondencePhone,
    mobile: profile.signatoryMobile ?? null,
    fax: null,
  }
}

function toDetails(
  row: {
    applicationType: string
    specType: string
    isDivisional: boolean
    isPatentOfAddition: boolean
    officeBranch: string
    applicantRefNo: string | null
    specPages: number
    claimsCount: number
    claimsPages: number
    abstractPages: number
    drawingsCount: number
    drawingsPages: number
    feeAmount: number | null
    feeMode: string
    applicationNo: string | null
    filingDate: Date | null
    parentApplicationNo: string | null
    parentFilingDate: Date | null
  } | null,
  category: string,
  officeBranchFromSettings: string
): FilingDetails {
  if (!row) {
    // No filing record yet — everything defaults, so the Filing tab opens pre-populated
    // rather than blank.
    return {
      applicationType: 'ordinary',
      specType: 'provisional',
      isDivisional: false,
      isPatentOfAddition: false,
      officeBranch: officeBranchFromSettings,
      applicantRefNo: null,
      specPages: 0,
      claimsCount: 0,
      claimsPages: 0,
      abstractPages: 0,
      drawingsCount: 0,
      drawingsPages: 0,
      feeAmount: suggestFee(category),
      feeMode: 'efiling',
      applicationNo: null,
      filingDate: null,
      parentApplicationNo: null,
      parentFilingDate: null,
    }
  }
  return {
    applicationType: row.applicationType as FilingDetails['applicationType'],
    specType: row.specType as FilingDetails['specType'],
    isDivisional: row.isDivisional,
    isPatentOfAddition: row.isPatentOfAddition,
    // The filing's own branch wins; the cascade value is the default it was seeded from.
    officeBranch: row.officeBranch || officeBranchFromSettings,
    applicantRefNo: row.applicantRefNo,
    specPages: row.specPages,
    claimsCount: row.claimsCount,
    claimsPages: row.claimsPages,
    abstractPages: row.abstractPages,
    drawingsCount: row.drawingsCount,
    drawingsPages: row.drawingsPages,
    feeAmount: row.feeAmount ?? suggestFee(category),
    feeMode: row.feeMode,
    applicationNo: row.applicationNo,
    filingDate: row.filingDate,
    parentApplicationNo: row.parentApplicationNo,
    parentFilingDate: row.parentFilingDate,
  }
}

/**
 * The signatory, with a per-filing override when someone other than the project's default
 * signs this one application.
 */
function resolveSignatory(
  profile: { signatoryName: string | null; signatoryDesignation: string | null; signatoryMobile: string | null; signatoryEmail: string | null },
  override: unknown
): FilingSignatory | null {
  const patch = override && typeof override === 'object' && !Array.isArray(override)
    ? override as Partial<FilingSignatory>
    : null

  const name = sanitizeField(patch?.name ?? profile.signatoryName)
  const designation = sanitizeField(patch?.designation ?? profile.signatoryDesignation)
  if (!name) return null

  return {
    name,
    designation,
    mobile: patch?.mobile ?? profile.signatoryMobile,
    email: patch?.email ?? profile.signatoryEmail,
  }
}

const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
  JP: 'Japan', CN: 'China', CA: 'Canada', AU: 'Australia', SG: 'Singapore', KR: 'South Korea',
  IL: 'Israel', IT: 'Italy', ES: 'Spain', NL: 'Netherlands', SE: 'Sweden', CH: 'Switzerland',
  BR: 'Brazil', RU: 'Russia', ZA: 'South Africa', NP: 'Nepal', LK: 'Sri Lanka', BD: 'Bangladesh',
}

function countryName(code: string | null | undefined): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] || code.toUpperCase()
}

/**
 * Filename stem: the attorney's own reference when set, else the application number, else a
 * short patent id. The ZIP and the documents inside it must share this — an archive named
 * after one id holding files named after another is confusing when several bundles land in
 * the same downloads folder.
 */
export function bundleRef(data: AssembledFiling): string {
  const ref = sanitizeField(data.context.details.applicantRefNo)
  const stem = ref || data.context.details.applicationNo || data.patentId.slice(-6)
  return stem.replace(/[^A-Za-z0-9._-]+/g, '_')
}

/**
 * Run a prisma call that touches a newly-added model, falling back if the client on this
 * environment predates the migration.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    console.warn('[Filing] prisma call failed; using fallback.', error)
    return fallback
  }
}
