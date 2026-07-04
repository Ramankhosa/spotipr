import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'
import {
  canonicalIndianPublicationFromApplicationNumber,
  normalizeIpIndiaApplicationNumber,
} from '@/lib/ipindia-assistant'
import { prisma } from '@/lib/prisma'
import { kickPatentCorpusRunner } from '@/lib/patent-corpus-runner'
import { queueEmbeddingForPatent } from '@/lib/patent-corpus-service'
import { normalizePatentNumberKey } from '@/lib/patent-number'

export const runtime = 'nodejs'

const WRITE_ROLES = new Set(['SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'ANALYST'])
const MAX_TEXT_LENGTH = 250_000

function canCaptureIpIndiaDetails(roles: unknown) {
  return Array.isArray(roles) && roles.some(role => WRITE_ROLES.has(String(role)))
}

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned
}

function firstCleanText(...values: unknown[]) {
  for (const value of values) {
    const cleaned = cleanText(value, 25_000)
    if (cleaned) return cleaned
  }
  return null
}

function countClaims(claimsText: string | null) {
  if (!claimsText) return null
  const matches = claimsText.match(/(?:^|\n)\s*\d+\s*[.)]/g)
  return matches?.length ? matches.length : null
}

function buildEnrichedPatentText(input: {
  title: string
  applicationNumber: string
  abstractText: string | null
  claimsText: string | null
  descriptionText: string | null
  completeSpecificationText: string | null
  classifications: string[]
}) {
  return [
    `Title: ${input.title}`,
    `Application Number: ${input.applicationNumber}`,
    input.abstractText ? `Abstract: ${input.abstractText}` : '',
    input.classifications.length ? `Classifications: ${input.classifications.join(', ')}` : '',
    input.claimsText ? `Claims: ${input.claimsText}` : '',
    input.descriptionText ? `Description: ${input.descriptionText}` : '',
    !input.claimsText && !input.descriptionText && input.completeSpecificationText
      ? `Complete Specification: ${input.completeSpecificationText}`
      : '',
  ].filter(Boolean).join('\n\n')
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => cleanText(item, 1000)).filter((item): item is string => Boolean(item))
  }
  const single = cleanText(value, 1000)
  return single ? [single] : []
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }
    if (!canCaptureIpIndiaDetails(auth.user.roles)) {
      return NextResponse.json({ error: 'You do not have permission to save IP India patent details.' }, { status: 403 })
    }

    const body = await request.json()
    const applicationNumber = normalizeIpIndiaApplicationNumber(body?.applicationNumber || body?.publicationNumber)
    if (!applicationNumber) {
      return NextResponse.json({ error: 'A valid Indian application number is required.' }, { status: 400 })
    }

    const publicationNumber = canonicalIndianPublicationFromApplicationNumber(applicationNumber)
    if (!publicationNumber) {
      return NextResponse.json({ error: 'Could not derive the local publication key from the application number.' }, { status: 400 })
    }

    const title = firstCleanText(body?.title, body?.inventionTitle) || publicationNumber
    const abstractText = firstCleanText(body?.abstract, body?.abstractText)
    const claimsText = firstCleanText(body?.claimsText, body?.claims)
    const descriptionText = firstCleanText(body?.descriptionText, body?.description)
    const completeSpecificationText = firstCleanText(body?.completeSpecificationText, body?.completeSpecification)
    const classifications = asStringArray(body?.classifications || body?.ipc || body?.classification)
    const numberOfClaims = countClaims(claimsText)

    const enrichedText = buildEnrichedPatentText({
      title,
      applicationNumber,
      abstractText,
      claimsText,
      descriptionText,
      completeSpecificationText,
      classifications,
    })

    const capturedAt = new Date()
    const ipIndiaDetails = {
      source: 'IP India Public Search',
      sourceUrl: cleanText(body?.sourceUrl || body?.url, 2000),
      capturedAt: capturedAt.toISOString(),
      publicationNumber: cleanText(body?.publicationNumber, 2000),
      publicationDate: cleanText(body?.publicationDate, 2000),
      publicationType: cleanText(body?.publicationType, 2000),
      applicationFilingDate: cleanText(body?.applicationFilingDate || body?.filingDate, 2000),
      fieldOfInvention: cleanText(body?.fieldOfInvention, 5000),
      applicants: body?.applicants || null,
      inventors: body?.inventors || null,
    } satisfies Prisma.JsonObject

    const updateData: Prisma.LocalPatentUpdateInput = {
      publicationNumberKey: normalizePatentNumberKey(publicationNumber),
      applicationNumberRaw: applicationNumber,
      country: 'IN',
      kind: 'A',
      title,
      ...(abstractText ? { abstract: abstractText, abstractOriginal: abstractText } : {}),
      ...(claimsText ? { claimsText } : {}),
      ...(descriptionText ? { descriptionText } : {}),
      ...(completeSpecificationText ? { rawText: completeSpecificationText } : {}),
      ...(classifications.length ? { classifications } : {}),
      ...(numberOfClaims !== null ? { numberOfClaims } : {}),
      ragText: enrichedText,
      embeddingText: enrichedText,
      ipIndiaDetails,
      ipIndiaCapturedAt: capturedAt,
    }

    const patent = await prisma.localPatent.upsert({
      where: { publicationNumber },
      create: {
        publicationNumber,
        publicationNumberKey: normalizePatentNumberKey(publicationNumber),
        applicationNumberRaw: applicationNumber,
        country: 'IN',
        kind: 'A',
        title,
        abstract: abstractText,
        abstractOriginal: abstractText,
        claimsText,
        descriptionText,
        rawText: completeSpecificationText,
        classifications,
        numberOfClaims,
        ragText: enrichedText,
        embeddingText: enrichedText,
        ipIndiaDetails,
        ipIndiaCapturedAt: capturedAt,
      },
      update: updateData,
      select: {
        id: true,
        publicationNumber: true,
        applicationNumberRaw: true,
        title: true,
      },
    })

    await queueEmbeddingForPatent(patent.id, enrichedText)
    const runner = kickPatentCorpusRunner()

    return NextResponse.json({
      success: true,
      patent,
      queuedEmbedding: true,
      runner,
    })
  } catch (error) {
    console.error('[IPIndiaCapture] Failed to save patent details:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save IP India patent details.' },
      { status: 500 }
    )
  }
}
