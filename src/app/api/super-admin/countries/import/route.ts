/**
 * POST /api/super-admin/countries/import
 *
 * One-shot country import from a country_profile.json.
 *   { action: 'preview', profileData, options? } → repair + validate + plan (no writes)
 *   { action: 'apply',   profileData, options? } → transactional import of everything
 *
 * options: { resetAdminState?, disableExtras?, activate? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-auth'
import { repairCountryProfile } from '@/lib/country-profile-repair'
import { validateCountryProfile } from '@/lib/country-profile-validation'
import { planCountryImport, applyCountryImport, ImportPlan } from '@/lib/country-import-service'
import { computeCountryReadiness } from '@/lib/country-readiness-service'

export async function POST(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, profileData, options } = body || {}

    if (!profileData || typeof profileData !== 'object') {
      return NextResponse.json({ error: 'profileData is required' }, { status: 400 })
    }
    if (action !== 'preview' && action !== 'apply') {
      return NextResponse.json({ error: `Unknown action "${action}" — use "preview" or "apply"` }, { status: 400 })
    }

    // Server-side repair + validation (never trust client-side results)
    const repair = await repairCountryProfile(profileData)
    const repairedProfile = repair.success && repair.repairedProfile ? repair.repairedProfile : profileData
    const validation = validateCountryProfile(repairedProfile)

    if (!validation.valid) {
      return NextResponse.json({
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
        repairs: repair.repairs
      }, { status: 400 })
    }

    if (action === 'preview') {
      const plan = await planCountryImport(repairedProfile, options)
      return NextResponse.json({
        valid: true,
        errors: [],
        warnings: validation.warnings,
        repairs: repair.repairs,
        plan
      })
    }

    // apply
    try {
      const result = await applyCountryImport(
        repairedProfile,
        { userId: admin.userId, email: admin.email },
        options
      )
      const readiness = await computeCountryReadiness(result.plan.countryCode)
      return NextResponse.json({
        success: true,
        plan: result.plan,
        summary: result.summary,
        readiness
      })
    } catch (error) {
      const plan = (error as Error & { plan?: ImportPlan }).plan
      if (plan) {
        return NextResponse.json({
          error: (error as Error).message,
          plan
        }, { status: 409 })
      }
      throw error
    }
  } catch (error) {
    console.error('[CountryImport] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
