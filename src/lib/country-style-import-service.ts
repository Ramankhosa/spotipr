/**
 * Country Style Import Service
 *
 * Ports the jurisdiction-style seeding logic from Countries/MasterSeed.js
 * (seedJurisdictionStyles) into a reusable TS module so the one-shot country
 * import and the seed pipeline share a single implementation.
 *
 * Writes the four style table groups from a country_profile.json:
 *  - CountryDiagramConfig + CountryDiagramHint   (from diagrams + rules.drawings)
 *  - CountryExportConfig + CountryExportHeading  (from export.documentTypes + export.sectionHeadings)
 *  - CountrySectionValidation                    (from validation.sectionChecks)
 *  - CountryCrossValidation                      (from validation.crossSectionChecks)
 *
 * Unlike MasterSeed, CountrySectionValidation keys are normalized to canonical
 * camelCase sectionKeys so runtime lookups (unified-validation-service) match.
 */

import { Prisma, PrismaClient } from '@prisma/client'

// Works with either the global client or a transaction client
export type PrismaClientLike = PrismaClient | Prisma.TransactionClient

export interface StyleImportCounts {
  diagramConfig: number
  diagramHints: number
  exportConfigs: number
  exportHeadings: number
  sectionValidations: number
  crossValidations: number
}

export interface StyleImportContext {
  countryCode: string
  profileData: any
  actorUserId: string
  /** Resolve a raw section identifier (structure id / snake_case) to a canonical sectionKey, or null */
  resolveSectionKey: (rawKey: string) => string | null
}

const LIMIT_TYPES = ['maxWords', 'minWords', 'maxChars', 'minChars', 'maxCount'] as const

/**
 * Upsert all style tables for a country from its profile JSON.
 * Import wins over existing rows (re-upload = update with version bump).
 */
export async function importCountryStyles(
  db: PrismaClientLike,
  ctx: StyleImportContext
): Promise<StyleImportCounts> {
  const { countryCode, profileData, actorUserId } = ctx
  const counts: StyleImportCounts = {
    diagramConfig: 0,
    diagramHints: 0,
    exportConfigs: 0,
    exportHeadings: 0,
    sectionValidations: 0,
    crossValidations: 0
  }

  // --- Diagram config + hints ---
  if (profileData.diagrams) {
    const drawingRules = profileData.rules?.drawings || {}
    const existing = await db.countryDiagramConfig.findUnique({ where: { countryCode } })

    const configData = {
      countryCode,
      requiredWhenApplicable: profileData.diagrams.requiredWhenApplicable ?? true,
      supportedDiagramTypes: profileData.diagrams.supportedDiagramTypes || ['block', 'flowchart', 'schematic'],
      figureLabelFormat: profileData.diagrams.figureLabelFormat || 'Fig. {number}',
      autoGenerateReferenceTable: profileData.diagrams.autoGenerateReferenceTable ?? true,
      paperSize: drawingRules.paperSize || 'A4',
      colorAllowed: drawingRules.colorAllowed ?? false,
      colorUsageNote: drawingRules.colorUsageNote || null,
      lineStyle: drawingRules.lineStyle || 'black_and_white_solid',
      referenceNumeralsMandatory: drawingRules.referenceNumeralsMandatoryWhenDrawings ?? true,
      minReferenceTextSizePt: drawingRules.minReferenceTextSizePt || 8,
      drawingMarginTopCm: drawingRules.marginTopCm || 2.5,
      drawingMarginBottomCm: drawingRules.marginBottomCm || 1.0,
      drawingMarginLeftCm: drawingRules.marginLeftCm || 2.5,
      drawingMarginRightCm: drawingRules.marginRightCm || 1.5,
      version: existing ? existing.version + 1 : 1,
      updatedBy: actorUserId
    }

    const result = await db.countryDiagramConfig.upsert({
      where: { countryCode },
      create: { ...configData, createdBy: actorUserId },
      update: configData
    })
    counts.diagramConfig = 1

    if (profileData.diagrams.diagramGenerationHints) {
      for (const [diagramType, hint] of Object.entries(profileData.diagrams.diagramGenerationHints)) {
        if (typeof hint !== 'string' || !hint.trim()) continue
        await db.countryDiagramHint.upsert({
          where: { configId_diagramType: { configId: result.id, diagramType } },
          create: { configId: result.id, diagramType, hint, preferredSyntax: 'plantuml', requireLabels: true },
          update: { hint }
        })
        counts.diagramHints++
      }
    }
  }

  // --- Export configs + headings ---
  if (Array.isArray(profileData.export?.documentTypes)) {
    for (const docType of profileData.export.documentTypes) {
      const documentTypeId = docType.id || 'spec_pdf'
      const existing = await db.countryExportConfig.findUnique({
        where: { countryCode_documentTypeId: { countryCode, documentTypeId } }
      })

      const configData = {
        countryCode,
        documentTypeId,
        label: docType.label || `${countryCode} Specification`,
        description: docType.description || null,
        pageSize: docType.pageSize || 'A4',
        marginTopCm: docType.marginTopCm || 2.5,
        marginBottomCm: docType.marginBottomCm || 2.0,
        marginLeftCm: docType.marginLeftCm || 2.5,
        marginRightCm: docType.marginRightCm || 2.0,
        fontFamily: docType.fontFamily || 'Times New Roman',
        fontSizePt: docType.fontSizePt || 12,
        lineSpacing: docType.lineSpacing || 1.5,
        addPageNumbers: docType.addPageNumbers ?? true,
        addParagraphNumbers: docType.addParagraphNumbers ?? false,
        includesSections: docType.includesSections || [],
        version: existing ? existing.version + 1 : 1,
        updatedBy: actorUserId
      }

      const result = await db.countryExportConfig.upsert({
        where: { countryCode_documentTypeId: { countryCode, documentTypeId } },
        create: { ...configData, createdBy: actorUserId },
        update: configData
      })
      counts.exportConfigs++

      if (profileData.export.sectionHeadings) {
        for (const [sectionKey, heading] of Object.entries(profileData.export.sectionHeadings)) {
          if (typeof heading !== 'string' || !heading.trim()) continue
          const style = heading === heading.toUpperCase() ? 'uppercase' : 'titlecase'
          await db.countryExportHeading.upsert({
            where: { exportConfigId_sectionKey: { exportConfigId: result.id, sectionKey } },
            create: { exportConfigId: result.id, sectionKey, heading, style },
            update: { heading, style }
          })
          counts.exportHeadings++
        }
      }
    }
  }

  // --- Section validations (keys normalized to canonical camelCase) ---
  if (profileData.validation?.sectionChecks) {
    for (const [rawKey, checks] of Object.entries(profileData.validation.sectionChecks)) {
      if (!Array.isArray(checks) || checks.length === 0) continue

      const sectionKey = ctx.resolveSectionKey(rawKey)
      if (!sectionKey) continue // unresolvable keys are surfaced as issues by the import planner

      const existing = await db.countrySectionValidation.findUnique({
        where: { countryCode_sectionKey: { countryCode, sectionKey } }
      })

      const validationData: Record<string, unknown> = {
        countryCode,
        sectionKey,
        additionalRules: {},
        version: existing ? existing.version + 1 : 1,
        updatedBy: actorUserId
      }

      for (const check of checks as any[]) {
        if (!LIMIT_TYPES.includes(check.type) || typeof check.limit !== 'number') continue
        switch (check.type) {
          case 'maxWords':
            validationData.maxWords = check.limit
            validationData.wordLimitSeverity = check.severity || 'warning'
            validationData.wordLimitMessage = check.message || null
            break
          case 'minWords':
            validationData.minWords = check.limit
            break
          case 'maxChars':
            validationData.maxChars = check.limit
            validationData.charLimitSeverity = check.severity || 'warning'
            validationData.charLimitMessage = check.message || null
            break
          case 'minChars':
            validationData.minChars = check.limit
            break
          case 'maxCount':
            validationData.maxCount = check.limit
            validationData.countLimitSeverity = check.severity || 'warning'
            validationData.countLimitMessage = check.message || null
            break
        }
      }

      // Skip rows that would carry no limits at all (e.g. only required/format checks)
      const hasLimit = LIMIT_TYPES.some(t => validationData[t] !== undefined)
      if (!hasLimit) continue

      await db.countrySectionValidation.upsert({
        where: { countryCode_sectionKey: { countryCode, sectionKey } },
        create: { ...validationData, createdBy: actorUserId } as any,
        update: validationData as any
      })
      counts.sectionValidations++
    }
  }

  // --- Cross validations ---
  if (Array.isArray(profileData.validation?.crossSectionChecks)) {
    for (const check of profileData.validation.crossSectionChecks) {
      if (!check?.from || !check?.type) continue
      const checkId = check.id || `${check.type}_${check.from}`
      const existing = await db.countryCrossValidation.findUnique({
        where: { countryCode_checkId: { countryCode, checkId } }
      })

      const toSections = check.mustBeSupportedBy || check.mustBeConsistentWith || check.mustReference || check.mustBeShownIn || []
      const validationData = {
        countryCode,
        checkId,
        checkType: check.type,
        fromSection: check.from,
        toSections,
        severity: check.severity || 'warning',
        message: check.message || `Review ${check.from} for compliance`,
        reviewPrompt: `Review ${check.from} for compliance`,
        checkParams: {},
        isEnabled: true,
        version: existing ? existing.version + 1 : 1
      }

      await db.countryCrossValidation.upsert({
        where: { countryCode_checkId: { countryCode, checkId } },
        create: validationData,
        update: validationData
      })
      counts.crossValidations++
    }
  }

  return counts
}
