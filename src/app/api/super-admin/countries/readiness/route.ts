/**
 * GET /api/super-admin/countries/readiness
 *   → { countries: CountryReadiness[] }             (all countries, batched)
 * GET /api/super-admin/countries/readiness?countryCode=DE
 *   → { readiness: CountryReadiness }               (single country, full detail)
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-auth'
import { computeCountryReadiness, computeAllCountriesReadiness } from '@/lib/country-readiness-service'

export async function GET(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const countryCode = searchParams.get('countryCode')

    if (countryCode) {
      const readiness = await computeCountryReadiness(countryCode)
      return NextResponse.json({ readiness })
    }

    const countries = await computeAllCountriesReadiness()
    return NextResponse.json({ countries })
  } catch (error) {
    console.error('[CountryReadiness] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
