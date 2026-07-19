import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const CLAIMS_LIMIT = 24000
const DESCRIPTION_LIMIT = 6000

/** Full stored record for the Reader panel — what the corpus actually holds. */
export async function GET(request: NextRequest, { params }: { params: { publicationNumber: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }

  const raw = decodeURIComponent(params.publicationNumber || '').trim()
  if (!raw) return NextResponse.json({ error: 'Publication number required.' }, { status: 400 })

  const normalized = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const patent = await prisma.localPatent.findFirst({
    where: { OR: [{ publicationNumber: raw }, { publicationNumberKey: normalized }, { publicationNumber: normalized }] },
    select: {
      publicationNumber: true,
      applicationNumberRaw: true,
      title: true,
      abstract: true,
      abstractOriginal: true,
      claimsText: true,
      descriptionText: true,
      applicants: true,
      inventors: true,
      classifications: true,
      filingDate: true,
      publicationDate: true,
      country: true,
      kind: true,
      familyId: true,
      numberOfClaims: true,
      numberOfPages: true,
      corpusSources: true,
    },
  })

  if (!patent) {
    // Not every displayed hit is in the local corpus (some providers are live).
    return NextResponse.json({ patent: null, reason: 'not-in-corpus' })
  }

  const claims = patent.claimsText || ''
  const description = patent.descriptionText || ''

  return NextResponse.json({
    patent: {
      ...patent,
      claimsText: claims.slice(0, CLAIMS_LIMIT),
      claimsTruncated: claims.length > CLAIMS_LIMIT,
      descriptionText: description.slice(0, DESCRIPTION_LIMIT),
      descriptionTruncated: description.length > DESCRIPTION_LIMIT,
      /** What text tier the corpus holds for this document — shown honestly in the UI. */
      textTier: claims ? 'claims' : description ? 'description-snippet' : 'abstract',
    },
  })
}
