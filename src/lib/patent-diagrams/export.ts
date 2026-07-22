import { semanticChecksum } from './pipeline'

export interface DiagramExportReadiness {
  ready: boolean
  errors: Array<{ figureNo: number; code: string; message: string }>
  selectedSources: Map<number, any>
}

export function validateDiagramExportReadiness(session: any, preferredLanguage = 'en'): DiagramExportReadiness {
  const errors: DiagramExportReadiness['errors'] = []
  const selectedSources = new Map<number, any>()
  const plans = Array.isArray(session?.figurePlans) ? session.figurePlans : []
  const sources = Array.isArray(session?.diagramSources) ? session.diagramSources : []
  const referenceMapChecksum = semanticChecksum(session?.referenceMap?.components || [])

  for (const plan of plans) {
    const report = plan?.validationReport && typeof plan.validationReport === 'object' ? plan.validationReport : null
    if (report?.filingReady === false) {
      errors.push({ figureNo: plan.figureNo, code: 'NOT_FILING_READY', message: 'The figure has unresolved filing-readiness errors' })
    }
    if ((plan.referenceMapChecksum && plan.referenceMapChecksum !== referenceMapChecksum)
      || (plan.semanticModel && plan.semanticChecksum !== semanticChecksum({ referenceMapChecksum, semantic: plan.semanticModel }))) {
      errors.push({ figureNo: plan.figureNo, code: 'STALE_REFERENCE_MAP', message: 'The Component Plan changed after this managed figure was generated' })
    }

    const english = sources.find((source: any) => source.figureNo === plan.figureNo && source.language === 'en')
    const preferred = sources.find((source: any) => source.figureNo === plan.figureNo && source.language === preferredLanguage)
    const translatedIsFresh = preferred?.language === 'en' || preferred?.translatedFromChecksum === english?.checksum
    const selected = preferred && translatedIsFresh ? preferred : english
    if (!selected) {
      errors.push({ figureNo: plan.figureNo, code: 'MISSING_SOURCE', message: 'No exportable diagram source exists' })
      continue
    }
    if (selected.sourceMode !== 'IMPORTED_IMAGE' && selected.renderStatus && selected.renderStatus !== 'SUCCESS') {
      errors.push({ figureNo: plan.figureNo, code: 'RENDER_STATUS', message: `Diagram render status is ${selected.renderStatus}` })
    }
    const artifacts = selected.renderArtifacts && typeof selected.renderArtifacts === 'object' ? selected.renderArtifacts : null
    // Only pipeline-authored figures are required to carry an SVG master.
    // Legacy rows migrated as IMPORTED_RAW have none until their first lazy
    // re-render; blocking them here would make pre-migration sessions
    // unexportable.
    const requiresSvgMaster = selected.sourceMode === 'MANAGED' || selected.sourceMode === 'RAW_OVERRIDE'
    if (requiresSvgMaster && !artifacts?.svg?.path && !artifacts?.svg?.filename) {
      errors.push({ figureNo: plan.figureNo, code: 'MISSING_SVG_MASTER', message: 'The filing SVG master artifact is missing' })
    }
    if (!selected.imagePath && !selected.imageFilename && !artifacts?.png?.path && !artifacts?.png?.filename) {
      errors.push({ figureNo: plan.figureNo, code: 'MISSING_PNG_ARTIFACT', message: 'The filing PNG artifact is missing' })
    }
    selectedSources.set(plan.figureNo, selected)
  }
  return { ready: errors.length === 0, errors, selectedSources }
}
