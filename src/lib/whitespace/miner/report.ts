import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

export interface MinerReportModel {
  title: string
  office: string
  leadId: string
  snapshotId: string
  proposalRevisionId: string
  assessmentRunId: string
  briefRunId: string
  generatedAt: string
  sections: Array<{ heading: string; body: string[] }>
}

const strings = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : value ? [String(value)] : []
export function buildMinerReportModel(input: { lead: any; proposal: any; assessment: any; brief: any; office: string; assessmentRunId: string; briefRunId: string }): MinerReportModel {
  const p = (input.proposal.content ?? {}) as Record<string, unknown>
  const b = (input.brief.brief ?? {}) as Record<string, unknown>
  const a = input.assessment as Record<string, unknown>
  return {
    title: String(b.title || p.title || input.lead.title), office: input.office, leadId: input.lead.id,
    snapshotId: input.proposal.snapshotId, proposalRevisionId: input.proposal.id,
    assessmentRunId: input.assessmentRunId, briefRunId: input.briefRunId, generatedAt: String(input.brief.generatedAt || new Date().toISOString()),
    sections: [
      { heading: 'Problem and reviewed solution', body: strings([p.problem, p.mechanism, ...strings(p.relationships)]) },
      { heading: 'Differences from prior art', body: strings(b.differencesFromPriorArt) },
      { heading: `${input.office} preliminary assessment`, body: strings([`Outcome: ${a.outcome || 'UNASSESSED'}`, b.officeAssessment]) },
      { heading: 'Preliminary claims — Standard scope', body: strings(b.preliminaryClaims) },
      { heading: 'Assumptions and missing experiments', body: [...strings(b.assumptions), ...strings(b.missingExperiments)] },
      { heading: 'Coverage limitations', body: [...strings(a.limitations), ...strings(b.coverageLimitations)] },
    ],
  }
}

export async function buildMinerReportDocx(model: MinerReportModel) {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(model.title)] }),
    new Paragraph({ children: [new TextRun({ text: `Office ${model.office} · proposal ${model.proposalRevisionId} · assessment ${model.assessmentRunId}`, color: '64748B' })] }),
  ]
  for (const section of model.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.heading)] }))
    if (!section.body.length) children.push(new Paragraph({ children: [new TextRun({ text: 'Not established in the reviewed material.', italics: true })] }))
    for (const body of section.body) children.push(new Paragraph({ text: body, spacing: { after: 120 } }))
  }
  children.push(new Paragraph({ children: [new TextRun({ text: 'Preliminary research work product. This bounded assessment is not a grant prediction or freedom-to-operate opinion.', italics: true, color: '64748B' })] }))
  return Packer.toBuffer(new Document({ sections: [{ children }] }))
}
