import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { buildPatentDiagram } from './builders'
import { renderAndWriteDiagramArtifacts, resolveDiagramPagePolicy } from './artifacts'
import { executeStructured, extractReferenceMapComponents, PatentDiagramPipelineError, semanticChecksum } from './pipeline'
import { escapePlantUmlLabel } from './style'
import { patentDiagramSchema, type PatentDiagram, type PatentDiagramComponent } from './types'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'

interface TranslationToken {
  key: string
  text: string
  apply: (text: string) => void
}

function managedTranslationTokens(diagram: PatentDiagram, components: PatentDiagramComponent[]): { translated: any; tokens: TranslationToken[] } {
  const translated: any = JSON.parse(JSON.stringify(diagram))
  const byId = new Map(components.map(component => [component.id, component]))
  const tokens: TranslationToken[] = []
  const add = (key: string, text: unknown, apply: (value: string) => void) => {
    const normalized = String(text || '').trim()
    if (normalized) tokens.push({ key, text: normalized, apply })
  }
  add('title', translated.title, value => { translated.title = value })
  add('purpose', translated.purpose, value => { translated.purpose = value })

  if (translated.kind === 'COMPONENT') {
    add('systemBoundaryLabel', translated.systemBoundaryLabel, value => { translated.systemBoundaryLabel = value })
    translated.groups.forEach((group: any, index: number) => add(`groups.${index}.label`, group.label, value => { group.label = value }))
    translated.components.forEach((node: any, index: number) => {
      const label = node.displayLabel || byId.get(node.componentId)?.name
      add(`components.${index}.displayLabel`, label, value => { node.displayLabel = value })
    })
    translated.relationships.forEach((link: any, index: number) => add(`relationships.${index}.label`, link.label, value => { link.label = value }))
  } else if (translated.kind === 'SEQUENCE') {
    translated.participants.forEach((node: any, index: number) => {
      const label = node.displayLabel || byId.get(node.componentId)?.name
      add(`participants.${index}.displayLabel`, label, value => { node.displayLabel = value })
    })
    translated.interactions.forEach((item: any, index: number) => {
      add(`interactions.${index}.label`, item.label, value => { item.label = value })
      add(`interactions.${index}.phase`, item.phase, value => { item.phase = value })
      add(`interactions.${index}.condition`, item.alternative?.condition, value => { item.alternative.condition = value })
    })
  } else if (translated.kind === 'PROCESS') {
    translated.nodes.forEach((node: any, index: number) => {
      add(`nodes.${index}.label`, node.label, value => { node.label = value })
      add(`nodes.${index}.phase`, node.phase, value => { node.phase = value })
    })
    translated.transitions.forEach((item: any, index: number) => add(`transitions.${index}.label`, item.label, value => { item.label = value }))
  } else {
    add('boundaryLabel', translated.boundaryLabel, value => { translated.boundaryLabel = value })
    translated.constituents.forEach((node: any, index: number) => {
      const label = node.displayLabel || byId.get(node.componentId)?.name
      add(`constituents.${index}.displayLabel`, label, value => { node.displayLabel = value })
      add(`constituents.${index}.technicalRole`, node.technicalRole, value => { node.technicalRole = value })
    })
    translated.relationships.forEach((link: any, index: number) => add(`relationships.${index}.label`, link.label, value => { link.label = value }))
  }
  return { translated, tokens }
}

function rawTranslationTokens(source: string): { template: string; tokens: TranslationToken[]; values: Map<string, string> } {
  const tokens: TranslationToken[] = []
  const values = new Map<string, string>()
  let tokenIndex = 0
  const makeToken = (text: string, quoted: boolean, referenceSuffix = '') => {
    const key = `t${++tokenIndex}`
    const placeholder = `__PN_TRANSLATION_${tokenIndex}__`
    tokens.push({ key, text, apply: value => values.set(placeholder, `${quoted ? escapePlantUmlLabel(value) : value}${referenceSuffix}`) })
    return placeholder
  }

  const lines = source.split(/\r?\n/).map(line => {
    let next = line.replace(/"((?:\\.|[^"])*)"/g, (_match, raw: string) => {
      const decoded = String(raw).replace(/\\n/g, '\n').replace(/\\"/g, '"')
      const parts = decoded.split('\n')
      const last = parts.at(-1)?.trim() || ''
      const hasReference = /^\([^)]+\)$/.test(last) || /^[SD]\d+$/i.test(last)
      const translatable = (hasReference ? parts.slice(0, -1) : parts).join(' ').trim()
      if (!translatable) return `"${raw}"`
      const referenceSuffix = hasReference ? `\\n${escapePlantUmlLabel(last)}` : ''
      return `"${makeToken(translatable, true, referenceSuffix)}"`
    })
    if (!/\[hidden\]/i.test(next) && /^\s*[A-Za-z_][\w.]*\s+(?:--|-[^\s]*->|\.\.?[^\s]*>|->|-->|<--|<-)\s+[A-Za-z_][\w.]*/.test(next)) {
      const separator = next.indexOf(' : ')
      if (separator >= 0) {
        const label = next.slice(separator + 3).trim()
        if (label) next = `${next.slice(0, separator + 3)}${makeToken(label, false)}`
      }
    }
    const alternative = next.match(/^(\s*(?:alt|else)\s+)(.+)$/i)
    if (alternative) next = `${alternative[1]}${makeToken(alternative[2].trim(), false)}`
    return next
  })
  return { template: lines.join('\n'), tokens, values }
}

async function translateTokens(input: {
  tokens: TranslationToken[]
  targetLanguage: string
  sourceLanguage: string
  requestHeaders: Record<string, string>
  patentId: string
  sessionId: string
  figureNo: number
}) {
  const expected = new Set(input.tokens.map(token => token.key))
  const schema = z.object({
    translations: z.array(z.object({ key: z.string(), text: z.string().trim().min(1).max(600) })),
  }).superRefine((value, ctx) => {
    const actual = value.translations.map(item => item.key)
    if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(key => !expected.has(key))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Return each supplied translation key exactly once and no additional keys' })
    }
  })
  const prompt = `Translate the supplied patent-diagram text from ${input.sourceLanguage} to ${input.targetLanguage}.
Return JSON only: {"translations":[{"key":"...","text":"..."}]}.
Keep each key exactly unchanged and return every key once. Use concise patent terminology. Do not add reference numerals, PlantUML, styling, IDs, or commentary. Connector labels must remain no more than ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words.

TEXT TOKENS:
${JSON.stringify(input.tokens.map(token => ({ key: token.key, text: token.text })))}`
  const output = await executeStructured({
    userHeaders: input.requestHeaders,
    stageCode: 'DRAFT_DIAGRAM_GENERATION',
    prompt,
    schema,
    metadata: { patentId: input.patentId, sessionId: input.sessionId, figureNo: input.figureNo, purpose: 'translate_diagram_tokens', targetLanguage: input.targetLanguage },
  })
  const translatedByKey = new Map(output.translations.map(item => [item.key, item.text]))
  input.tokens.forEach(token => token.apply(translatedByKey.get(token.key)!))
  return Object.fromEntries(translatedByKey)
}

export async function translatePatentDiagram(input: {
  userId: string
  patentId: string
  sessionId: string
  figureNo: number
  targetLanguage: string
  sourceLanguage?: string
  requestHeaders: Record<string, string>
}) {
  const sourceLanguage = input.sourceLanguage || 'en'
  if (input.targetLanguage === sourceLanguage) throw new PatentDiagramPipelineError('Target language must differ from the source language')
  const session = await prisma.draftingSession.findFirst({
    where: { id: input.sessionId, patentId: input.patentId, userId: input.userId },
    include: { referenceMap: true, figurePlans: true, diagramSources: true },
  })
  if (!session) throw new PatentDiagramPipelineError('Session not found or access denied', 404)
  const source = session.diagramSources.find(item => item.figureNo === input.figureNo && item.language === sourceLanguage)
  if (!source?.plantumlCode) throw new PatentDiagramPipelineError(`Source diagram ${input.figureNo} (${sourceLanguage}) was not found`, 404)
  const plan = session.figurePlans.find(item => item.figureNo === input.figureNo)
  const components = extractReferenceMapComponents(session.referenceMap)
  let plantumlCode: string
  let labelMap: Record<string, unknown>

  const parsed = source.sourceMode === 'MANAGED' && plan?.semanticModel
    ? patentDiagramSchema.safeParse(plan.semanticModel)
    : null
  if (parsed?.success) {
    const managed = managedTranslationTokens(parsed.data, components)
    const translations = await translateTokens({ ...input, sourceLanguage, tokens: managed.tokens })
    // Translated labels are frequently longer than the source; surface that as
    // a 422 the caller can act on rather than a raw schema crash.
    const reparsed = patentDiagramSchema.safeParse(managed.translated)
    if (!reparsed.success) {
      throw new PatentDiagramPipelineError(
        'Translated labels no longer satisfy the filing diagram constraints',
        422,
        reparsed.error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`),
      )
    }
    const translatedDiagram = reparsed.data
    const built = buildPatentDiagram(translatedDiagram, components)
    if (!built.validation.filingReady) throw new PatentDiagramPipelineError('Translated semantic diagram is not filing-ready', 422, built.validation.issues)
    plantumlCode = built.plantumlCode
    labelMap = { componentAliases: built.labelMap, translations, semanticChecksum: semanticChecksum(translatedDiagram) }
  } else {
    const raw = rawTranslationTokens(source.plantumlCode)
    if (!raw.tokens.length) throw new PatentDiagramPipelineError('Raw source cannot be tokenized safely; return the figure to managed mode before translating', 422)
    const translations = await translateTokens({ ...input, sourceLanguage, tokens: raw.tokens })
    plantumlCode = raw.template
    for (const [placeholder, value] of Array.from(raw.values)) plantumlCode = plantumlCode.split(placeholder).join(value)
    if (/__PN_TRANSLATION_\d+__/.test(plantumlCode)) throw new PatentDiagramPipelineError('Raw translation token replacement was incomplete', 422)
    labelMap = { componentAliases: source.labelMap || {}, translations }
  }

  const countryCode = session.activeJurisdiction || session.draftingJurisdictions[0] || 'US'
  const pagePolicy = await resolveDiagramPagePolicy(countryCode)
  const rendered = await renderAndWriteDiagramArtifacts({
    patentId: input.patentId, figureNo: input.figureNo, language: input.targetLanguage, plantumlCode, pagePolicy,
    enforceFilingSvg: source.sourceMode === 'MANAGED' || source.sourceMode === 'RAW_OVERRIDE',
  })
  if (rendered.effectiveFontSizePt != null && rendered.effectiveFontSizePt < pagePolicy.minimumTextSizePt) {
    // Translated labels are often longer than the source language; a page-fit
    // shortfall is a review item, not a reason to withhold the translation.
    console.warn(`[DiagramTranslation] FIG. ${input.figureNo} (${input.targetLanguage}) renders below the ${pagePolicy.minimumTextSizePt} pt filing minimum`)
  }
  const checksum = crypto.createHash('sha256').update(plantumlCode).digest('hex')
  const artifacts = rendered.artifacts
  const translatedDiagram = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo_language: { sessionId: input.sessionId, figureNo: input.figureNo, language: input.targetLanguage } },
    create: {
      sessionId: input.sessionId, figureNo: input.figureNo, language: input.targetLanguage, plantumlCode, checksum,
      sourceMode: source.sourceMode, labelMap: labelMap as any, renderArtifacts: artifacts as any, renderStatus: 'SUCCESS',
      renderError: null, semanticChecksum: source.semanticChecksum, translatedFromChecksum: source.checksum,
      referenceMapChecksum: source.referenceMapChecksum,
      translatedFromDiagramId: source.id, imageFilename: artifacts.png.filename, imagePath: artifacts.png.path,
      imageChecksum: artifacts.png.checksum, imageUploadedAt: new Date(),
    },
    update: {
      plantumlCode, checksum, sourceMode: source.sourceMode, labelMap: labelMap as any, renderArtifacts: artifacts as any,
      renderStatus: 'SUCCESS', renderError: null, semanticChecksum: source.semanticChecksum,
      referenceMapChecksum: source.referenceMapChecksum,
      translatedFromChecksum: source.checksum, translatedFromDiagramId: source.id,
      imageFilename: artifacts.png.filename, imagePath: artifacts.png.path, imageChecksum: artifacts.png.checksum, imageUploadedAt: new Date(),
    },
  })
  return { translatedDiagram, plantumlCode, renderArtifacts: artifacts, isUpdate: session.diagramSources.some(item => item.figureNo === input.figureNo && item.language === input.targetLanguage) }
}

export async function translateAllPatentDiagrams(input: Omit<Parameters<typeof translatePatentDiagram>[0], 'figureNo'>) {
  const sources = await prisma.diagramSource.findMany({
    where: { sessionId: input.sessionId, language: input.sourceLanguage || 'en', plantumlCode: { not: '' } },
    orderBy: { figureNo: 'asc' },
  })
  if (!sources.length) throw new PatentDiagramPipelineError('No source diagrams were found', 404)
  const results: Array<{ figureNo: number; success: boolean; translatedDiagramId?: string; error?: string }> = []
  for (const source of sources) {
    try {
      const translated = await translatePatentDiagram({ ...input, figureNo: source.figureNo })
      results.push({ figureNo: source.figureNo, success: true, translatedDiagramId: translated.translatedDiagram.id })
    } catch (error) {
      results.push({ figureNo: source.figureNo, success: false, error: error instanceof Error ? error.message : 'Translation failed' })
    }
  }
  return { results, translated: results.filter(item => item.success).length, failed: results.filter(item => !item.success).length }
}
