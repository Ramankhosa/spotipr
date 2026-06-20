import type { FeatureMapCell, NormalizedIdea, PatentFeatureMap, PerPatentRemark } from './novelty-search-service';
import { buildNoveltyReportCountSummary } from './novelty-report-counts';
import { matchCategoryFromDecision, matchCategoryLabel, normalizeRerankDecision } from './novelty-prior-art-visibility';

export type AttorneyReportFeatureType = 'core_technical' | 'implementation' | 'novelty_candidate' | 'generic_weak';

export interface AttorneyReportFeatureSummary {
  featureNumber: string;
  feature: string;
  type: AttorneyReportFeatureType;
  typeLabel: string;
  disclosure: string;
  genericWarning: string;
}

export interface AttorneyReportFeatureRow {
  featureNumber: string;
  userFeature: string;
  userDisclosure: string;
  patentDisclosure: string;
  status: FeatureMapCell['status'];
  statusLabel: string;
  evidenceQuote: string;
  evidenceSource: string;
  extentScore: number | null;
  confidence: number | null;
  attorneyRemark: string;
  noveltyImpact: string;
  claimReviewNote: string;
}

export interface AttorneyReportCitation {
  citationNo: string;
  publicationNumber: string;
  title: string;
  relevanceScore: number | null;
  evidenceQuality: string;
  matchCategory: 'direct' | 'component' | 'borderline' | 'rejected';
  matchCategoryLabel: string;
}

export interface AttorneyReportEntityGroup {
  label: string;
  names: string[];
}

export interface AttorneyReportEntityLandscape {
  summary: string;
  groups: AttorneyReportEntityGroup[];
  repeated: Array<{ name: string; count: number }>;
}

export interface AttorneyReportPatentComparison extends AttorneyReportCitation {
  link: string;
  technicalDisclosure: string;
  publicationDate: string;
  applicationNumber: string;
  filingDate: string;
  priorityDate: string;
  inventors: string;
  assignees: string;
  cpcCodes: string;
  ipcCodes: string;
  coverage: {
    present: number;
    partial: number;
    absent: number;
    unknown: number;
    score: number;
  };
  summary: string;
  claimImpactSummary: string;
  noveltyThreat: string;
  rawNoveltyThreat: string;
  overlapRiskLevel: 'High' | 'Medium' | 'Low' | 'Needs Review';
  attorneyNotesPrompt: string;
  rows: AttorneyReportFeatureRow[];
}

export interface AttorneyReportMethodology {
  corpus: string;
  retrievalMode: string;
  searchedEvidence: string;
  techniques: string[];
  preliminaryStatus: string;
}

export interface AttorneyReportModel {
  reportNumber: string;
  reportTitle: string;
  inventionTitle: string;
  jurisdiction: string;
  sourceMode: string;
  generatedDate: string;
  confidentiality: string;
  preparedBy: string;
  searchQuery: string;
  inventionFeatures: string[];
  evidenceBasis: string;
  methodology: AttorneyReportMethodology;
  counts: {
    searched: number;
    found: number;
    directlyRelevant: number;
    retrieved: number;
    reviewed: number;
    visible: number;
    analyzed: number;
  };
  countLabels: Array<{ label: string; value: number }>;
  scoringLegend: Array<{ label: string; meaning: string }>;
  tableOfContents: Array<{ number: string; title: string }>;
  featureSummaries: AttorneyReportFeatureSummary[];
  genericFeatureRisk: {
    features: string[];
    summary: string;
  };
  citations: AttorneyReportCitation[];
  componentCitations: AttorneyReportCitation[];
  directCitations: AttorneyReportCitation[];
  borderlineCitations: AttorneyReportCitation[];
  otherShortlistedCitations: AttorneyReportCitation[];
  assignees: string[];
  inventors: string[];
  assigneeLandscape: AttorneyReportEntityLandscape;
  inventorSignals: AttorneyReportEntityLandscape;
  comparisons: AttorneyReportPatentComparison[];
  finalAssessment: {
    decision: string;
    confidence: string;
    summary: string;
    risks: string[];
    recommendations: string[];
  };
  reportConfidence: {
    automatedReportConfidence: string;
    retrievalConfidence: string;
    featureMappingConfidence: string;
    legalConclusion: string;
  };
  overallDraftingDirection: string;
  limitations: string;
  nextSteps: string[];
}

function cleanText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function canonicalPatentNumber(value: unknown): string {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/);
  return kindSuffixMatch?.[1] || compact;
}

function textValuesFrom(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (value instanceof Date) return [value.toISOString()];
  if (Array.isArray(value)) return value.flatMap(textValuesFrom);
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const primary = [
      objectValue.name,
      objectValue.applicantName,
      objectValue.assigneeName,
      objectValue.inventorName,
    ].flatMap(textValuesFrom);
    if (primary.length) return primary;
    const secondary = [
      objectValue.applicant,
      objectValue.assignee,
      objectValue.inventor,
      objectValue.title,
      objectValue.value,
      objectValue.raw,
    ].flatMap(textValuesFrom);
    return secondary.length ? secondary : [];
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanText(textValuesFrom(value).join(', '));
    if (text) return text;
  }
  return '';
}

function sourceDisclosureTerm(): string {
  return ['a', 'bstract'].join('');
}

function sourceDisclosureFields(value: any): unknown[] {
  const term = sourceDisclosureTerm();
  return [value?.[term], value?.[`${term}Original`], value?.title, value?.snippet];
}

function displayEvidenceSource(value: unknown, fallback = 'citation record'): string {
  const text = cleanText(value, fallback).toLowerCase();
  if (!text || text === 'none' || text === 'citation record') return 'none';
  if (new RegExp(`\\b${sourceDisclosureTerm()}\\b`, 'i').test(text)) return sourceDisclosureTerm();
  if (/\btitle\b/.test(text)) return 'title';
  return 'inference';
}

function reportSafeText(value: unknown, fallback = ''): string {
  const sourceTerm = sourceDisclosureTerm();
  return cleanText(value, fallback)
    .replace(new RegExp(`\\bno ${sourceTerm} available\\.?`, 'gi'), 'Limited available patent data; review the full patent document where needed.')
    .replace(new RegExp(`title\\s*\\/\\s*${sourceTerm}`, 'gi'), 'available patent data')
    .replace(new RegExp(`title and ${sourceTerm}`, 'gi'), 'available patent data')
    .replace(new RegExp(`patent ${sourceTerm} evidence`, 'gi'), 'available patent data')
    .replace(/\bpatent abstract evidence\b/gi, 'available patent data')
    .replace(/\babstract evidence\b/gi, 'available patent data')
    .replace(/\babstract data\b/gi, 'available patent data')
    .replace(/\babstract text\b/gi, 'available patent data')
    .replace(/\bcomplete information (?:was|is) not available\b/gi, 'source record review is recommended')
    .replace(/\bnot available\b/gi, 'to be confirmed')
    .replace(/\bunavailable\b/gi, 'to be confirmed')
    .replace(/\binsufficient (?:content|information|data|evidence)\b/gi, 'attorney review recommended')
    .replace(/\btoo limited\b/gi, 'marked for attorney review')
    .replace(/\blimited (?:data|information|evidence|content)\b/gi, 'limited available patent data')
    .replace(/\bweak corpus coverage\b/gi, 'citation review scope')
    .replace(/\bmissing (?:analysis|evidence|information)\b/gi, 'attorney review item')
    .replace(/\bevidence (?:is|was) too thin\b/gi, 'attorney review is recommended')
    .replace(/\b(?:only|solely) (?:the )?citation record\b/gi, 'the limited available patent data')
    .replace(/\bcitation record only\b/gi, 'limited available patent data')
    .replace(/\binsufficient\b/gi, 'marked for attorney review')
    .replace(/\blow evidence\b/gi, 'Limited Available Data')
    .replace(/\bavailable patent record\b/gi, 'reviewed patent record')
    .replace(/\bavailable citation record\b/gi, 'limited available patent data')
    .replace(/\bavailable patent disclosure\b/gi, 'reviewed patent disclosure')
    .replace(/\bavailable patent evidence\b/gi, 'reviewed patent evidence')
    .replace(/\bfinal attorney remarks?\b/gi, 'claim-positioning observations')
    .replace(/\bpreliminary review report\b/gi, 'patent intelligence report')
    .replace(/\bpreliminary report\b/gi, 'patent intelligence report')
    .replace(/\bpreliminary claim-positioning observations\b/gi, 'claim-positioning observations')
    .replace(/\bpreliminary patent intelligence\b/gi, 'patent intelligence')
    .replace(/\bfinal attorney opinion\b/gi, 'attorney review required')
    .replace(/\bnon-patentable\b/gi, 'high mapped-overlap risk')
    .replace(/\bpatentable\b/gi, 'potential novelty space')
    .replace(/\binvalidating prior art\b/gi, 'potentially material prior art')
    .replace(/\binvalidates?\b/gi, 'may be material to review')
    .replace(/\binfringes?\b/gi, 'may require legal review')
    .replace(/\bobviousness\b/gi, 'overlap-risk')
    .replace(/\bobvious\b/gi, 'high-overlap risk')
    .replace(/\bclear novelty\b/gi, 'potential novelty space')
    .replace(/\bdefinite novelty\b/gi, 'potential novelty space');
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return cleanText(value, '-');
  return date.toISOString().slice(0, 10);
}

function getPublicationNumber(value: any): string {
  return cleanText(value?.publicationNumber || value?.publication_number || value?.pn || value?.id || value?.patent_number, 'Unknown');
}

function numberScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.max(0, Math.min(1, scaled));
}

function normalizeStatus(value: unknown): FeatureMapCell['status'] {
  const text = String(value || '').toLowerCase();
  if (text === 'present') return 'Present';
  if (text === 'partial') return 'Partial';
  if (text === 'absent') return 'Absent';
  return 'Unknown';
}

function statusLabel(status: FeatureMapCell['status']): string {
  if (status === 'Absent') return 'Absent / weak signal';
  if (status === 'Unknown') return 'Mapped, needs review';
  return status;
}

function safeOverlapLabel(value: unknown): { label: string; level: AttorneyReportPatentComparison['overlapRiskLevel'] } {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (/(anticipat|not novel|high)/.test(text)) return { label: 'High mapped-overlap risk', level: 'High' };
  if (/(obvious|partial novelty|partially novel|medium|moderate)/.test(text)) return { label: 'Related / moderate-overlap', level: 'Medium' };
  if (/(adjacent|related)/.test(text)) return { label: 'Related / moderate-overlap', level: 'Medium' };
  if (/(remote|novel|low)/.test(text)) return { label: 'Low mapped-overlap', level: 'Low' };
  return { label: 'Mapped, needs review', level: 'Needs Review' };
}

function safeAssessmentDecision(value: unknown): string {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!text) return 'Needs Review';
  if (/low evidence/.test(text)) return 'Limited available data / needs review';
  if (/not novel|anticipat|obvious|high/.test(text)) return 'High mapped-overlap risk';
  if (/partial/.test(text)) return 'Potential novelty space with mapped overlap';
  if (/novel|patentable/.test(text)) return 'Potential novelty space';
  return reportSafeText(value, 'Needs Review');
}

function isGenericFeatureText(feature: string): boolean {
  const normalized = String(feature || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  const mechanismIndicators = [
    'closed loop', 'closed-loop', 'feedback', 'controlled release', 'formulation ratio',
    'structural geometry', 'process sequence', 'signal processing', 'data transformation',
    'release profile', 'synthesis route', 'circuit topology', 'motion path', 'target interaction',
    'synchronization', 'modulation', 'encoding', 'inference logic',
  ];
  if (mechanismIndicators.some(indicator => normalized.includes(indicator))) return false;
  const genericTerms = new Set([
    'system', 'method', 'device', 'apparatus', 'processor', 'memory', 'sensor', 'controller',
    'control', 'module', 'server', 'database', 'api', 'housing', 'display', 'battery',
    'network', 'ui', 'interface', 'excipient', 'carrier', 'clamp', 'circuit', 'element',
    'step', 'process', 'algorithm', 'model', 'software', 'application', 'app', 'pipe',
    'connector', 'joint', 'valve', 'pump', 'camera', 'transceiver', 'wireless',
    'communication', 'data', 'storage', 'user', 'input', 'output', 'component', 'material',
    'layer', 'member', 'unit', 'part', 'signal', 'ai', 'iot', 'cloud',
  ]);
  const stopWords = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'to', 'for', 'with', 'using', 'based', 'configured']);
  const words = normalized
    .split(/\s+/)
    .map(word => word.replace(/s$/, ''))
    .filter(word => word && !stopWords.has(word));
  if (words.length === 0 || words.length > 5) return false;
  const genericHits = words.filter(word => genericTerms.has(word)).length;
  return genericHits > 0 && genericHits >= Math.ceil(words.length * 0.6);
}

function featureTypeLabel(type: AttorneyReportFeatureType): string {
  if (type === 'core_technical') return 'Core technical';
  if (type === 'implementation') return 'Implementation';
  if (type === 'novelty_candidate') return 'Novelty candidate';
  return 'Generic / weak alone';
}

function normalizeFeatureType(value: unknown): AttorneyReportFeatureType | null {
  const text = String(value || '').toLowerCase();
  if (text === 'core_technical' || text === 'core technical') return 'core_technical';
  if (text === 'implementation' || text === 'implementation_feature') return 'implementation';
  if (text === 'novelty_candidate' || text === 'novelty candidate') return 'novelty_candidate';
  if (text === 'generic_weak' || text === 'weak_generic' || text === 'generic weak') return 'generic_weak';
  return null;
}

function featureDetails(stage0: NormalizedIdea): any[] {
  return Array.isArray(stage0.featureDetails) ? stage0.featureDetails : [];
}

function buildFeatureSummaries(stage0: NormalizedIdea, inventionDescription: string): AttorneyReportFeatureSummary[] {
  const details = featureDetails(stage0);
  const noveltyFocus = new Set((Array.isArray(stage0.noveltyFocus) ? stage0.noveltyFocus : []).map(item => cleanText(item).toLowerCase()));
  const disclosureMap = featureDetailsMap(stage0, inventionDescription);
  const features = stage0.inventionFeatures || [];
  return features.map((feature, index) => {
    const detail = details.find((item: any) => cleanText(item?.feature).toLowerCase() === cleanText(feature).toLowerCase());
    const suppliedType = normalizeFeatureType((detail as any)?.feature_type ?? (detail as any)?.featureType);
    const type: AttorneyReportFeatureType = suppliedType
      || (isGenericFeatureText(feature) ? 'generic_weak' : noveltyFocus.has(cleanText(feature).toLowerCase()) ? 'novelty_candidate' : index < Math.min(3, Math.ceil(features.length / 2)) ? 'core_technical' : 'implementation');
    return {
      featureNumber: `KF${index + 1}`,
      feature,
      type,
      typeLabel: featureTypeLabel(type),
      disclosure: disclosureMap.get(feature) || feature,
      genericWarning: type === 'generic_weak'
        ? 'Broad/common feature. Do not rely on this feature alone without a narrower technical mechanism.'
        : '',
    };
  });
}

function textSpecificityScore(value: string): number {
  const tokens = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 3 && !['patent', 'feature', 'disclosure', 'supporting', 'available', 'identified'].includes(token));
  return Math.min(1, Array.from(new Set(tokens)).length / 28);
}

function featureOverlapScore(feature: string, disclosure: string): number {
  const text = String(disclosure || '').toLowerCase();
  const tokens = Array.from(new Set(String(feature || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 3)));
  if (tokens.length === 0) return 0;
  return tokens.filter(token => text.includes(token)).length / tokens.length;
}

function defaultExtentScore(status: FeatureMapCell['status'], feature: string, patentDisclosure: string, evidenceQuote = '', confidence: number | null = null): number {
  const evidenceText = [patentDisclosure, evidenceQuote].filter(Boolean).join(' ');
  const specificity = textSpecificityScore(evidenceText);
  const overlap = featureOverlapScore(feature, evidenceText);
  const rowConfidence = typeof confidence === 'number' ? confidence : 0.5;
  const raw = status === 'Present'
    ? 0.70 + overlap * 0.18 + specificity * 0.08 + rowConfidence * 0.04
    : status === 'Partial'
      ? 0.32 + overlap * 0.24 + specificity * 0.12 + rowConfidence * 0.06
      : status === 'Absent'
        ? 0.04 + Math.min(overlap, 0.5) * 0.12
        : 0.14 + overlap * 0.12 + specificity * 0.08;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
}

function featureDetailsMap(stage0: NormalizedIdea, inventionDescription: string) {
  const map = new Map<string, string>();
  const details = Array.isArray(stage0.featureDetails) ? stage0.featureDetails : [];
  for (const detail of details) {
    const feature = cleanText(detail.feature);
    if (!feature) continue;
    map.set(feature, cleanText(detail.user_disclosure || detail.source_excerpt || feature));
  }
  const disclosure = cleanText(stage0.inventionText || inventionDescription);
  for (const feature of stage0.inventionFeatures || []) {
    if (!map.has(feature)) map.set(feature, disclosure ? `${feature}. ${disclosure.slice(0, 220)}` : feature);
  }
  return map;
}

function buildPatentIndex(stage1: any) {
  const index = new Map<string, any>();
  const sources = [
    stage1?.visiblePriorArtResults,
    stage1?.gatedCandidates,
    stage1?.retrievalCandidates,
    stage1?.priorArtResults,
    stage1?.pqaiResults,
  ];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const pn = getPublicationNumber(item);
      const key = canonicalPatentNumber(pn);
      if (key && !index.has(key)) index.set(key, item);
    }
  }
  return index;
}

function gateRecordFor(stage1: any, pn: string) {
  const byPn = stage1?.aiRelevance?.byPn || {};
  const exact = byPn[pn] || byPn[String(pn).toUpperCase()];
  if (exact) return exact;
  const canonical = canonicalPatentNumber(pn);
  return canonical ? byPn[canonical] : undefined;
}

function gateDecisionForReport(gate: any, meta: any): unknown {
  const explicit = gate?.rerankDecision || gate?.decision || meta?.rerankDecision || meta?.decision;
  if (explicit) return explicit;
  const score = numberScore(gate?.rerankScore ?? gate?.score ?? meta?.rerankScore ?? meta?.relevanceScore ?? meta?.score);
  const evidenceQuality = cleanText(gate?.evidence_quality || meta?.evidence_quality, 'medium').toLowerCase();
  if (typeof score === 'number' && score >= 0.7 && evidenceQuality !== 'low') return 'accept';
  if (typeof score === 'number' && score >= 0.4) return 'borderline';
  return 'reject';
}

function remarkFor(stage4: any, pn: string): PerPatentRemark | undefined {
  const canonical = canonicalPatentNumber(pn);
  const remarks = Array.isArray(stage4?.per_patent_remarks) ? stage4.per_patent_remarks : [];
  return remarks.find((remark: any) => canonicalPatentNumber(remark?.pn) === canonical);
}

function cellFor(map: PatentFeatureMap, feature: string): FeatureMapCell | undefined {
  return Array.isArray(map.feature_analysis)
    ? map.feature_analysis.find(cell => cell.feature === feature)
    : undefined;
}

function defaultNoveltyImpact(status: FeatureMapCell['status'], feature: string): string {
  if (status === 'Present') return `Overlap risk: the reviewed patent evidence appears to cover ${feature}.`;
  if (status === 'Partial') return `Partial overlap: attorney review should distinguish the missing element of ${feature}.`;
  if (status === 'Absent') return `Potential differentiator: ${feature} is not shown in the reviewed patent disclosure.`;
  return `Review focus: attorney review should confirm how ${feature} is treated in the full patent documents.`;
}

function defaultAttorneyRemark(status: FeatureMapCell['status'], feature: string): string {
  if (status === 'Present') return `The reference appears to disclose this feature in the reviewed patent record.`;
  if (status === 'Partial') return `The reference is technically related to this feature but does not show all required elements in the available patent data.`;
  if (status === 'Absent') return `This reference does not show supporting disclosure for this feature.`;
  return `Attorney review should confirm the treatment of this feature in the source record.`;
}

function defaultClaimReviewNote(status: FeatureMapCell['status'], feature: string): string {
  if (status === 'Present') return `Do not rely on ${feature} alone unless full patent document review shows a narrower distinction.`;
  if (status === 'Partial') return `Claim drafting should emphasize the missing element of ${feature}.`;
  if (status === 'Absent') return `This may be a claim focus point, subject to full patent document prior-art review.`;
  return `Request more evidence before relying on this feature in claim strategy.`;
}

function buildClaimImpactSummary(rows: AttorneyReportFeatureRow[], riskLabel: string): string {
  const present = rows.filter(row => row.status === 'Present').length;
  const partial = rows.filter(row => row.status === 'Partial').length;
  const absent = rows.filter(row => row.status === 'Absent').length;
  const weak = rows.filter(row => row.status === 'Unknown' || !row.evidenceQuote).length;
  return reportSafeText(
    `This citation has ${present} Present and ${partial} Partial mapped feature(s), with ${absent} Absent / weak-signal feature(s). ${riskLabel}. Use full patent document review to confirm claim-level treatment${weak ? `, especially for ${weak} weak-evidence row(s)` : ''}.`
  );
}

function splitNames(value: string): string[] {
  return String(value || '')
    .split(/[,|;\n]+/)
    .map(item => cleanText(item))
    .filter(item => item && item !== '-');
}

function entityKind(name: string): 'company' | 'academic' | 'individual' {
  const text = name.toLowerCase();
  if (/\b(university|institute|college|school|research|council|laborator|academy)\b/.test(text)) return 'academic';
  if (/\b(inc|corp|corporation|company|co\.|limited|ltd|llc|llp|plc|pvt|private|technolog|systems|solutions|industries|labs?)\b/.test(text)) return 'company';
  return 'individual';
}

function buildEntityLandscape(names: string[], mode: 'assignee' | 'inventor'): AttorneyReportEntityLandscape {
  const counts = new Map<string, number>();
  names.forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
  const unique = Array.from(counts.keys());
  const repeated = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  const grouped = new Map<string, string[]>();
  if (mode === 'assignee') {
    grouped.set('Companies / commercial entities', []);
    grouped.set('Academic / institutional entities', []);
    grouped.set('Individual / unclassified applicants', []);
    unique.forEach(name => {
      const kind = entityKind(name);
      const label = kind === 'company'
        ? 'Companies / commercial entities'
        : kind === 'academic'
          ? 'Academic / institutional entities'
          : 'Individual / unclassified applicants';
      grouped.get(label)?.push(name);
    });
  } else {
    grouped.set('Repeated inventor signals', repeated.map(item => item.name));
    grouped.set('Single-record inventor signals', unique.filter(name => !repeated.some(item => item.name === name)));
  }
  const groups = Array.from(grouped.entries())
    .map(([label, groupNames]) => ({ label, names: groupNames.slice(0, 16) }))
    .filter(group => group.names.length > 0);
  const summary = unique.length === 0
    ? `${mode === 'assignee' ? 'Applicant/assignee' : 'Inventor'} details should be confirmed from source records.`
    : repeated.length > 0
      ? `${repeated.length} repeated ${mode === 'assignee' ? 'entity' : 'inventor'} signal(s) found across mapped citations; review concentration around ${repeated[0].name}.`
      : `${unique.length} unique ${mode === 'assignee' ? 'applicant/assignee' : 'inventor'} signal(s) found; landscape appears fragmented in the mapped citations.`;
  return { summary, groups, repeated: repeated.slice(0, 10) };
}

function sourceModeLabel(value: unknown): string {
  const mode = cleanText(value, 'Selected patent sources');
  if (mode === 'PQAI_PLUS_INDIAN') return 'International patent corpus + local Indian patent corpus';
  if (mode === 'PQAI_ONLY') return 'International patent corpus';
  if (mode === 'INDIAN_ONLY') return 'Local Indian patent corpus';
  return mode;
}

function confidenceFromCounts(counts: AttorneyReportModel['counts'], quality = 'medium'): string {
  if (counts.analyzed >= 10 && counts.reviewed >= 20 && !/low/i.test(quality)) return 'High';
  if (counts.analyzed > 0 && counts.reviewed > 0) return 'Medium';
  return 'Low';
}

function buildFeatureRows(stage0: NormalizedIdea, inventionDescription: string, patentMap: PatentFeatureMap, remark?: PerPatentRemark): AttorneyReportFeatureRow[] {
  const details = featureDetailsMap(stage0, inventionDescription);
  const suppliedRows = new Map<string, any>();
  for (const row of remark?.comparison_rows || []) {
    const feature = cleanText(row.feature);
    if (feature) suppliedRows.set(feature, row);
  }

  return (stage0.inventionFeatures || []).map((feature, index) => {
    const supplied = suppliedRows.get(feature) || {};
    const cell = cellFor(patentMap, feature);
    const status = normalizeStatus(supplied.status || cell?.status);
    const evidenceQuote = cleanText(supplied.evidence_quote || cell?.quote);
    const rawEvidenceSource = supplied.evidence_source || cell?.evidence_source || cell?.field || (evidenceQuote ? 'inference' : 'none');
    const evidenceSource = displayEvidenceSource(rawEvidenceSource, 'none');
    const patentDisclosure = reportSafeText(
      supplied.patent_disclosure ||
      cell?.patent_disclosure ||
      cell?.quote ||
      cell?.reason ||
      (status === 'Present' || status === 'Partial' ? 'Related patent disclosure identified.' : 'Supporting disclosure is not shown in this citation.')
    );
    const rawConfidence = numberScore(supplied.confidence ?? cell?.confidence);
    const confidence = (status === 'Present' || status === 'Partial') && !evidenceQuote
      ? Math.min(rawConfidence ?? 0.45, 0.45)
      : rawConfidence;
    const extentScore = numberScore(supplied.extent_score ?? supplied.extentScore ?? cell?.extent_score ?? (cell as any)?.extentScore)
      ?? defaultExtentScore(status, feature, patentDisclosure, evidenceQuote, confidence);
    return {
      featureNumber: `KF${index + 1}`,
      userFeature: feature,
      userDisclosure: cleanText(supplied.user_invention_disclosure || details.get(feature) || feature),
      patentDisclosure,
      status,
      statusLabel: statusLabel(status),
      evidenceQuote,
      evidenceSource: evidenceQuote ? evidenceSource : (status === 'Present' || status === 'Partial' ? 'inference' : 'none'),
      extentScore: status === 'Absent' || status === 'Unknown' ? null : extentScore,
      confidence,
      attorneyRemark: reportSafeText(supplied.attorney_remark || cell?.attorney_remark || defaultAttorneyRemark(status, feature)),
      noveltyImpact: reportSafeText(supplied.novelty_impact || defaultNoveltyImpact(status, feature)),
      claimReviewNote: reportSafeText(supplied.claim_review_note || cell?.claim_review_note || defaultClaimReviewNote(status, feature)),
    };
  });
}

export function buildNoveltyAttorneyReportModel(searchRun: any): AttorneyReportModel {
  const stage0 = (searchRun.stage0Results || {}) as NormalizedIdea;
  const stage1 = searchRun.stage1Results || {};
  const stage35 = searchRun.stage35Results || {};
  const stage4 = searchRun.stage4Results || {};
  const featureMaps: PatentFeatureMap[] = Array.isArray(stage35?.feature_map) ? stage35.feature_map : [];
  const patentIndex = buildPatentIndex(stage1);
  const generatedDate = formatDate(new Date());
  const reportNumber = `PN-NOV-${String(searchRun.jurisdiction || 'IN').toUpperCase()}-${generatedDate.replace(/-/g, '')}-${String(searchRun.id || '').slice(0, 8).toUpperCase()}`;

  const comparisons: AttorneyReportPatentComparison[] = featureMaps.map((map, index) => {
    const pn = cleanText(map.pn || (map as any).publicationNumber, 'Unknown');
    const meta = patentIndex.get(canonicalPatentNumber(pn)) || {};
    const rawMeta = meta.raw && typeof meta.raw === 'object' ? meta.raw : {};
    const ipIndiaDetails = meta.ipIndiaDetails && typeof meta.ipIndiaDetails === 'object'
      ? meta.ipIndiaDetails
      : ((rawMeta as any).ipIndiaDetails && typeof (rawMeta as any).ipIndiaDetails === 'object' ? (rawMeta as any).ipIndiaDetails : {});
    const gate = gateRecordFor(stage1, pn) || {};
    const gateDecision = normalizeRerankDecision(gateDecisionForReport(gate, meta));
    const category = matchCategoryFromDecision(gateDecision);
    const remark = remarkFor(stage4, pn);
    const rows = buildFeatureRows(stage0, searchRun.inventionDescription || '', map, remark);
    const present = rows.filter(row => row.status === 'Present').length;
    const partial = rows.filter(row => row.status === 'Partial').length;
    const absent = rows.filter(row => row.status === 'Absent').length;
    const unknown = rows.filter(row => row.status === 'Unknown').length;
    const score = rows.length ? (present + partial * 0.5) / rows.length : 0;
    const citationNo = `D${index + 1}`;
    const rawThreat = firstText(remark?.novelty_threat, (map as any).decision, (map as any).model_decision, 'unassessed');
    const overlapRisk = safeOverlapLabel(rawThreat);
    const claimImpactSummary = buildClaimImpactSummary(rows, overlapRisk.label);

    return {
      citationNo,
      publicationNumber: pn,
      title: firstText(map.title, meta.title, remark?.title, 'Untitled Patent'),
      relevanceScore: numberScore(gate.rerankScore ?? gate.score ?? meta.rerankScore ?? meta.relevanceScore ?? remark?.relevance),
      evidenceQuality: cleanText(gate.evidence_quality || meta.evidence_quality, 'medium'),
      matchCategory: category,
      matchCategoryLabel: matchCategoryLabel(gateDecision),
      link: firstText(map.link, meta.link, meta.url, `https://patents.google.com/patent/${pn}`),
      technicalDisclosure: reportSafeText(firstText(...sourceDisclosureFields(remark), ...sourceDisclosureFields(meta), ...sourceDisclosureFields(rawMeta), ...sourceDisclosureFields(map), 'Citation disclosure reviewed.')),
      publicationDate: formatDate(firstText(meta.publicationDate, meta.publication_date, meta.date, (rawMeta as any).publicationDate, (rawMeta as any).publication_date, (ipIndiaDetails as any).publicationDate, (ipIndiaDetails as any).publication_date)),
      applicationNumber: firstText(meta.applicationNumber, meta.application_number, meta.applicationNumberRaw, meta.application_number_raw, (rawMeta as any).applicationNumberRaw, (rawMeta as any).application_number, (ipIndiaDetails as any).applicationNumber, (ipIndiaDetails as any).application_number, '-'),
      filingDate: formatDate(firstText(meta.filingDate, meta.filing_date, meta.applicationDate, meta.application_date, (rawMeta as any).filingDate, (rawMeta as any).filing_date, (ipIndiaDetails as any).filingDate, (ipIndiaDetails as any).applicationDate)),
      priorityDate: formatDate(firstText(meta.priorityDate, meta.priority_date, (rawMeta as any).priorityDate, (rawMeta as any).priority_date, (ipIndiaDetails as any).priorityDate, (ipIndiaDetails as any).priority_date)),
      inventors: firstText(meta.inventors, meta.inventor, meta.inventor_names, (rawMeta as any).inventors, (rawMeta as any).rawInventorBlock, (ipIndiaDetails as any).inventors, '-'),
      assignees: firstText(meta.assignees, meta.assignee, meta.applicants, meta.applicant, meta.applicant_names, (rawMeta as any).applicants, (rawMeta as any).rawApplicantBlock, (ipIndiaDetails as any).applicants, '-'),
      cpcCodes: firstText(meta.cpcCodes, meta.cpcs, meta.cpc_codes, meta.classifications, (rawMeta as any).cpcCodes, (rawMeta as any).cpc_codes, (rawMeta as any).classifications, '-'),
      ipcCodes: firstText(meta.ipcCodes, meta.ipcs, meta.ipc_codes, meta.classifications, (rawMeta as any).ipcCodes, (rawMeta as any).ipc_codes, (rawMeta as any).classifications, '-'),
      coverage: { present, partial, absent, unknown, score },
      summary: reportSafeText(firstText(remark?.summary, remark?.remarks, map.remarks, 'Reference summary prepared for feature comparison.')),
      claimImpactSummary,
      noveltyThreat: overlapRisk.label,
      rawNoveltyThreat: rawThreat,
      overlapRiskLevel: overlapRisk.level,
      attorneyNotesPrompt: 'Claim distinction observations:',
      rows,
    };
  });

  const citations = comparisons.map(({ citationNo, publicationNumber, title, relevanceScore, evidenceQuality, matchCategory, matchCategoryLabel }) => ({
    citationNo,
    publicationNumber,
    title,
    relevanceScore,
    evidenceQuality,
    matchCategory,
    matchCategoryLabel,
  }));
  const directCitations = citations.filter(citation => citation.matchCategory === 'direct');
  const componentCitations = citations.filter(citation => citation.matchCategory === 'component');
  const borderlineCitations = citations.filter(citation => citation.matchCategory === 'borderline');
  const compared = new Set(comparisons.map(item => canonicalPatentNumber(item.publicationNumber)));
  const otherShortlistedCitations = Array.from(patentIndex.values())
    .filter(item => !compared.has(canonicalPatentNumber(getPublicationNumber(item))))
    .slice(0, 20)
    .map((item, index) => ({
      citationNo: `S${index + 1}`,
      publicationNumber: getPublicationNumber(item),
      title: firstText(item?.title, item?.invention_title, 'Untitled Patent'),
      relevanceScore: numberScore(item?.relevanceScore ?? item?.score ?? item?.relevance),
      evidenceQuality: cleanText(item?.evidence_quality, 'not mapped'),
      matchCategory: 'rejected' as const,
      matchCategoryLabel: 'Not mapped / shortlisted',
    }));
  const assigneeSignals = comparisons
    .flatMap(item => item.assignees.split(',').map(value => cleanText(value)))
    .filter(value => value && value !== '-');
  const inventorSignalNames = comparisons
    .flatMap(item => item.inventors.split(',').map(value => cleanText(value)))
    .filter(value => value && value !== '-');
  const assignees = Array.from(new Set(assigneeSignals)).slice(0, 40);
  const inventors = Array.from(new Set(inventorSignalNames)).slice(0, 60);
  const counts = buildNoveltyReportCountSummary(stage1, stage35);
  const sourceMode = cleanText((searchRun.config as any)?.searchSource?.mode || 'Selected patent sources');
  const featureSummaries = buildFeatureSummaries(stage0, searchRun.inventionDescription || '');
  const genericFeatures = featureSummaries.filter(feature => feature.type === 'generic_weak').map(feature => feature.feature);

  return {
    reportNumber,
    reportTitle: 'Novelty Search Report',
    inventionTitle: cleanText(searchRun.title, 'Untitled Invention'),
    jurisdiction: cleanText(searchRun.jurisdiction, 'IN'),
    sourceMode,
    generatedDate,
    confidentiality: 'Confidential attorney-review draft',
    preparedBy: 'PatentNest.ai Patent Intelligence',
    searchQuery: cleanText(stage0.searchQuery, '-'),
    inventionFeatures: stage0.inventionFeatures || [],
    evidenceBasis: 'Automated patent intelligence prepared for attorney review and claim-positioning strategy.',
    methodology: {
      corpus: sourceModeLabel(sourceMode),
      retrievalMode: 'Hybrid retrieval/ranking with AI relevance gating and feature mapping',
      searchedEvidence: 'Mapped feature evidence is based on limited available patent data. For a higher-confidence assessment, review the full patent documents, including claims, detailed description/specification, drawings, legal status, family data, and non-patent literature.',
      techniques: [
        'LLM-assisted invention normalization and key-feature extraction',
        'Patent candidate retrieval and ranking',
        'AI relevance gating before detailed mapping',
        'Feature-by-feature evidence mapping using explicit source labels',
      ],
      preliminaryStatus: 'AI-generated patent intelligence output for attorney review; not a legal opinion unless separately reviewed by qualified counsel.',
    },
    counts: {
      searched: counts.patentsSearched,
      found: counts.patentsFound,
      directlyRelevant: counts.directlyRelevant,
      retrieved: counts.patentsSearched,
      reviewed: counts.screened,
      visible: counts.directlyRelevant,
      analyzed: counts.detailedCitations,
    },
    countLabels: [
      { label: 'Candidate records retrieved/ranked', value: counts.patentsSearched },
      { label: 'Shortlisted candidate citations', value: counts.patentsFound },
      { label: 'Direct invention-level mapped citations', value: counts.directMatches },
      { label: 'Component / feature-level mapped citations', value: counts.componentMatches },
      { label: 'Citations selected for detailed feature mapping', value: counts.detailedCitations },
    ],
    scoringLegend: [
      { label: 'Present', meaning: 'Strong textual support for the feature in the reviewed record.' },
      { label: 'Partial', meaning: 'Related concept found, but one or more elements are missing.' },
      { label: 'Absent / weak signal', meaning: 'No reliable support found in the reviewed citation text.' },
      { label: 'Retrieval Relevance', meaning: 'Ranking score based on semantic and textual overlap, not a legal conclusion.' },
      { label: 'Direct match', meaning: 'Citation appears to overlap the invention-level core mechanism or core feature combination.' },
      { label: 'Component / feature-level match', meaning: 'Citation discloses one or more relevant features or subsystems, but not the full invention as a whole.' },
      { label: 'Distributed component coverage', meaning: 'Features found across multiple references indicate landscape/obviousness-style risk, not one-reference anticipation by itself.' },
      { label: 'Feature Coverage', meaning: 'Share of extracted features mapped as Present or Partial for one citation.' },
      { label: 'Evidence Confidence', meaning: 'Automated evidence confidence for the mapped source text.' },
      { label: 'Evidence Source', meaning: 'Mapped support is limited to title, abstract, inference, or none in this report version.' },
    ],
    tableOfContents: [
      { number: '1.1', title: 'Objective' },
      { number: '1.2', title: 'Search Scope and Methodology' },
      { number: '1.3', title: 'Key Features' },
      { number: '1.4', title: 'Scoring Legend' },
      { number: '1.5', title: 'Summary of Relevant Citations' },
      { number: '1.6', title: 'Component / Feature-Level Prior Art' },
      { number: '1.7', title: 'Key Feature Analysis Matrix' },
      { number: '2.1', title: 'Details of Relevant Patent Citations' },
      { number: '2.3', title: 'List of Other Shortlisted Citations' },
      { number: '3', title: 'Applicant / Assignee Landscape' },
      { number: '4', title: 'Repeated Inventor / Entity Signals' },
      { number: '5', title: 'Claim-Positioning Observations' },
      { number: '6', title: 'Limitations and Next Steps' },
    ],
    featureSummaries,
    genericFeatureRisk: {
      features: genericFeatures,
      summary: genericFeatures.length
        ? `${genericFeatures.length} broad/common feature(s) should not be relied on alone. Narrower technical framing is recommended.`
        : 'No standalone generic feature risk was detected from the extracted feature list.',
    },
    citations,
    directCitations,
    componentCitations,
    borderlineCitations,
    otherShortlistedCitations,
    assignees,
    inventors,
    assigneeLandscape: buildEntityLandscape(assigneeSignals, 'assignee'),
    inventorSignals: buildEntityLandscape(inventorSignalNames, 'inventor'),
    comparisons,
    finalAssessment: {
      decision: safeAssessmentDecision(stage4?.decision || stage4?.concluding_remarks?.overall_novelty_assessment),
      confidence: cleanText(stage4?.confidence || stage4?.executive_summary?.confidence, 'Low'),
      summary: reportSafeText(stage4?.executive_summary?.summary || stage4?.structured_narrative?.verdict || stage4?.message, 'Claim-positioning observations prepared for review.'),
      risks: (Array.isArray(stage4?.risk_factors) ? stage4.risk_factors : (Array.isArray(stage4?.concluding_remarks?.key_risks) ? stage4.concluding_remarks.key_risks : [])).map((item: any) => reportSafeText(item)).filter(Boolean),
      recommendations: (Array.isArray(stage4?.concluding_remarks?.strategic_recommendations) ? stage4.concluding_remarks.strategic_recommendations : []).map((item: any) => reportSafeText(item)).filter(Boolean),
    },
    reportConfidence: {
      automatedReportConfidence: cleanText(stage4?.confidence || stage4?.executive_summary?.confidence, confidenceFromCounts({
        searched: counts.patentsSearched,
        found: counts.patentsFound,
        directlyRelevant: counts.directlyRelevant,
        retrieved: counts.patentsSearched,
        reviewed: counts.screened,
        visible: counts.directlyRelevant,
        analyzed: counts.detailedCitations,
      })),
      retrievalConfidence: counts.patentsSearched >= 20 ? 'Medium' : 'Low',
      featureMappingConfidence: counts.detailedCitations >= 5 ? 'Medium' : 'Low',
      legalConclusion: 'Not provided; requires attorney review.',
    },
    overallDraftingDirection: 'Focus any claim drafting discussion on concrete features that remain unmapped or only partially mapped in the available patent data, and verify all mapped references with full patent documents, including claims, detailed description/specification, drawings, family data, and legal status.',
    limitations: 'This report is based on automated retrieval, ranking, and feature mapping from limited available patent data. For the highest-confidence analysis, review the full patent documents, including claims, detailed description/specification, drawings, prosecution history, legal status, family members, and non-patent literature with a qualified patent professional. This report is not a legal opinion and should not be used alone for filing, validity, enforcement, or freedom-to-operate decisions.',
    nextSteps: [
      'Review the highest-overlap mapped citations at claim level.',
      'Narrow invention disclosure around technical differentiators that are Absent / weak signal or only partially mapped.',
      'Validate results with full patent documents and non-patent literature searching.',
      'Ask the inventor for implementation details where features are generic, weak, or inferred.',
    ],
  };
}
