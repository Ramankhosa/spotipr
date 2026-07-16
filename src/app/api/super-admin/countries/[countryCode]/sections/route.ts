/**
 * GET /api/super-admin/countries/[countryCode]/sections
 *
 * Everything the per-country detail page needs in one call:
 * profile summary, section mappings joined with superset info, and prompt versions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySuperAdmin } from '@/lib/super-admin-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { countryCode: string } }
) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const countryCode = params.countryCode.toUpperCase()

    const [profile, mappings, supersetSections, prompts] = await Promise.all([
      prisma.countryProfile.findUnique({
        where: { countryCode },
        select: { countryCode: true, name: true, version: true, status: true, profileData: true, updatedAt: true }
      }),
      prisma.countrySectionMapping.findMany({
        where: { countryCode },
        orderBy: { displayOrder: 'asc' }
      }),
      prisma.supersetSection.findMany({
        select: {
          sectionKey: true, label: true, displayOrder: true, isActive: true,
          requiresPriorArt: true, requiresFigures: true, requiresClaims: true, requiresComponents: true
        }
      }),
      prisma.countrySectionPrompt.findMany({
        where: { countryCode, status: 'ACTIVE' },
        select: { id: true, sectionKey: true, version: true }
      })
    ])

    if (!profile) {
      return NextResponse.json({ error: `No country profile for ${countryCode}` }, { status: 404 })
    }

    const supersetByKey = new Map(supersetSections.map(s => [s.sectionKey, s]))
    const promptByKey = new Map(prompts.map(p => [p.sectionKey, p]))

    const meta = (profile.profileData as any)?.meta || {}

    return NextResponse.json({
      profile: {
        countryCode: profile.countryCode,
        name: profile.name,
        version: profile.version,
        status: profile.status,
        updatedAt: profile.updatedAt,
        continent: meta.continent || 'Unknown',
        office: meta.office || null,
        languages: meta.languages || []
      },
      sections: mappings.map(m => {
        const superset = supersetByKey.get(m.sectionKey)
        const prompt = promptByKey.get(m.sectionKey)
        return {
          sectionKey: m.sectionKey,
          supersetCode: m.supersetCode,
          heading: m.heading,
          isRequired: m.isRequired,
          isEnabled: m.isEnabled,
          displayOrder: m.displayOrder ?? superset?.displayOrder ?? 999,
          requiresPriorArtOverride: m.requiresPriorArtOverride,
          requiresFiguresOverride: m.requiresFiguresOverride,
          requiresClaimsOverride: m.requiresClaimsOverride,
          requiresComponentsOverride: m.requiresComponentsOverride,
          superset: superset
            ? {
                label: superset.label,
                isActive: superset.isActive,
                requiresPriorArt: superset.requiresPriorArt,
                requiresFigures: superset.requiresFigures,
                requiresClaims: superset.requiresClaims,
                requiresComponents: superset.requiresComponents
              }
            : null,
          prompt: prompt ? { id: prompt.id, version: prompt.version } : null
        }
      })
    })
  } catch (error) {
    console.error('[CountrySections] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
