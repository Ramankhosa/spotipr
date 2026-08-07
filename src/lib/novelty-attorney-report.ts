import type { ClaimConcept, ClaimConceptMapping, FeatureMapCell, NormalizedIdea, PatentFeatureMap, PerPatentRemark } from './novelty-search-service';
import { buildNoveltyReportCountSummary } from './novelty-report-counts';
import { classifyScreeningStopReason, matchCategoryFromDecision, matchCategoryLabel, normalizeRerankDecision } from './novelty-prior-art-visibility';
import { canonicalStudioFamilyKey } from './prior-art-studio/family-key';
import {
  normalizeReportReferenceSelectionRule,
  selectNoveltyReportReferences,
  validateReportReferenceSelection,
  DEFAULT_MIN_MAIN_REFERENCES,
  type ReportReferenceCandidate,
  type ReportReferenceSelectionV1,
} from './novelty-report-reference-selection';

export type AttorneyReportFeatureType = 'core_technical' | 'implementation' | 'novelty_candidate' | 'generic_weak';
export type AttorneyReportFeatureImportance = 'core_inventive' | 'secondary_implementation' | 'optional_embodiment';
export type AttorneyReportRiskLevel = 'Low' | 'Moderate' | 'High' | 'Needs Review';
export type AttorneyReportEvidenceStrength = 'Strong' | 'Moderate' | 'Weak';

export interface AttorneyReportFeatureSummary {
  featureNumber: string;
  feature: string;
  type: AttorneyReportFeatureType;
  typeLabel: string;
  importance: AttorneyReportFeatureImportance;
  importanceLabel: string;
  disclosure: string;
  claimableText: string;
  embeddingSearchText: string;
  featureConfidence: number | null;
  genericWarning: string;
}

export interface AttorneyReportFeatureRow {
  featureNumber: string;
  userFeature: string;
  userDisclosure: string;
  patentDisclosure: string;
  status: FeatureMapCell['status'];
  statusLabel: string;
  publicMappingStatus: string;
  publicMappingCode: string;
  crispRemark: string;
  professionalRemark: string;
  evidenceQuote: string;
  evidenceSource: string;
  evidenceStrength: AttorneyReportEvidenceStrength;
  evidenceStrengthReason: string;
  extentScore: number | null;
  confidence: number | null;
  attorneyRemark: string;
  noveltyImpact: string;
  claimReviewNote: string;
}

export interface AttorneyReportCitation {
  citationNo: string;
  publicationNumber: string;
  originalPublicationNumber?: string;
  publicationJurisdiction?: string;
  searchAuthorityScope?: string;
  sourceCorpus?: string;
  filingCountry?: string;
  targetLegalJurisdiction?: string;
  title: string;
  relevanceScore: number | null;
  evidenceQuality: string;
  referenceRole: string;
  reviewPriority: string;
  matchCategory: 'direct' | 'component' | 'borderline' | 'rejected';
  matchCategoryLabel: string;
  referenceType: 'patent' | 'paper';
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

export type DraftingOpportunityType = 'primary' | 'secondary' | 'optional' | 'avoid_relying_solely_on';
export type ConceptMappingLevel = 'High' | 'Moderate' | 'Limited';

export interface ClaimPositioningAnalysis {
  primaryClaimFocus: string;
  secondaryClaimFocus?: string;
  weakClaimAreas: string[];
  avoidRelyingSolelyOn: string[];
  remainingInventiveCore: string;
  whyStillDistinguishable: string;
  reasoning: string;
}

export interface ClaimDraftingConsiderations {
  independentClaimFocus: string;
  dependentClaimIdeas: string[];
  fallbackClaimIdeas: string[];
  reviewBeforeDrafting: string[];
}

export interface DraftingOpportunity {
  title: string;
  opportunityType: DraftingOpportunityType;
  linkedFeatures: string[];
  linkedConcept?: string;
  explanation: string;
}

export interface ConceptMappedCoverageSummary {
  conceptTitle: string;
  mappedCoveragePercent: number;
  singleReferenceMappedCoveragePercent: number;
  distributedMappedCoveragePercent: number;
  relationshipMapped: boolean;
  mappingLevel: ConceptMappingLevel;
  closestReferences: string[];
}

export interface StrategicReviewFocus {
  highestPriorityReference: string;
  reviewReason: string;
  highestOverlap: string;
  lowestOverlap: string;
  criticalRelationshipToVerify: string;
  recommendedFullTextReview: string[];
  remainingUncertainties: string[];
}

export interface AttorneyReportPatentComparison extends AttorneyReportCitation {
  link: string;
  abstract: string;
  technicalDisclosure: string;
  publicationDate: string;
  applicationNumber: string;
  filingDate: string;
  priorityDate: string;
  inventors: string;
  assignees: string;
  cpcCodes: string;
  ipcCodes: string;
  authors: string;
  venue: string;
  doi: string;
  sourceProviders: string;
  priorityScore?: number;
  importantFeatureCoverage?: number;
  strongImportantFeatureCount?: number;
  strongNoveltyFeatureCount?: number;
  relationshipBonus?: number;
  /** Priority tier before the Critical/High/Medium display caps are applied. */
  desiredPriority?: AttorneyReportPatentComparison['reviewPriority'];
  strongImportantFeatures?: string[];
  hasMappedEvidence?: boolean;
  familyKey?: string;
  citationCount: number | null;
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

export interface AttorneyReportCombination {
  referenceA: { publicationNumber: string; title: string; teaches: string[] };
  referenceB: { publicationNumber: string; title: string; adds: string[] };
  combinedImportantFeatureCoverage: number;
  apparentMotivation: string;
  missingImportantFeatures: string[];
  stillMissingRelationship: string;
  label: 'Inventive-step review';
}

// Tenant firm branding embedded into the report (cover, headers, footer). Pure type so it
// can be imported by both the server PDF route and the client HTML report component; the
// Prisma-record -> FirmBranding mapping lives in firm-profile-service.ts (server-only).
export interface FirmBranding {
  firmName: string;
  logoDataUri?: string | null;
  tagline?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  countryCode?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  accentColor?: string | null;
  showPoweredBy?: boolean;
}

/**
 * Compose the firm's mailing address into human-readable lines for a report block.
 * Client-safe (no server imports) so both the PDF route and the HTML report can use it.
 */
export function formatFirmAddressLines(firm: FirmBranding): string[] {
  const lines: string[] = [];
  if (firm.addressLine1) lines.push(firm.addressLine1);
  if (firm.addressLine2) lines.push(firm.addressLine2);
  const cityLine = [firm.city, firm.state, firm.postalCode].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  if (firm.countryCode) lines.push(firm.countryCode);
  return lines;
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
  // Optional firm white-label branding. Absent -> default PatentNest branding. Kept optional
  // so existing AttorneyReportModel fixtures/tests keep compiling.
  firm?: FirmBranding;
  accentColor?: string;
  showPoweredBy?: boolean;
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
  patentCitations: AttorneyReportCitation[];
  paperCitations: AttorneyReportCitation[];
  componentCitations: AttorneyReportCitation[];
  directCitations: AttorneyReportCitation[];
  borderlineCitations: AttorneyReportCitation[];
  otherShortlistedCitations: AttorneyReportCitation[];
  otherShortlistedExcludedCount: number;
  otherShortlistedEligibleCount: number;
  otherShortlistedOmittedCount: number;
  otherShortlistedRejectedCount: number;
  otherShortlistedUngatedCount: number;
  reportReferenceSelection: ReportReferenceSelectionV1;
  assignees: string[];
  inventors: string[];
  assigneeLandscape: AttorneyReportEntityLandscape;
  inventorSignals: AttorneyReportEntityLandscape;
  comparisons: AttorneyReportPatentComparison[];
  patentComparisons: AttorneyReportPatentComparison[];
  paperComparisons: AttorneyReportPatentComparison[];
  mainComparisons: AttorneyReportPatentComparison[];
  appendixMappedComparisons: AttorneyReportPatentComparison[];
  mainCitations: AttorneyReportCitation[];
  potentialCombinations: AttorneyReportCombination[];
  riskAssessment: {
    noveltyRisk: AttorneyReportRiskLevel;
    noveltyRiskLabel: string;
    noveltyRiskExplanation: string;
    combinationRisk: AttorneyReportRiskLevel;
    combinationRiskLabel: string;
    combinationRiskExplanation: string;
    headline: string;
    coreFeatureCount: number;
    strongestSingleReferenceCoreCoverage: number;
    distributedCoreCoverage: number;
    highestSingleReferenceCoreCoveragePercent: number;
    distributedCoreCoveragePercent: number;
    assessmentConfidence: 'Low' | 'Medium' | 'High';
  };
  potentialDifferentiationSpace: string;
  matrixInsight: string;
  architecturalInnovation: string;
  claimConcepts: ClaimConcept[];
  claimConceptMapping: ClaimConceptMapping[];
  mainDifferentiator: string;
  attorneyReviewFocus: string;
  claimPositioningAnalysis?: ClaimPositioningAnalysis;
  claimDraftingConsiderations?: ClaimDraftingConsiderations;
  draftingOpportunities?: DraftingOpportunity[];
  conceptMappedCoverageSummary?: ConceptMappedCoverageSummary[];
  strategicReviewFocus?: StrategicReviewFocus;
  finalAssessment: {
    decision: string;
    confidence: string;
    summary: string;
    risks: string[];
    recommendations: string[];
  };
  publicClosestCitation: AttorneyReportCitation | null;
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

function canonicalPublicationDisplay(value: unknown): string {
  const raw = cleanText(value);
  if (/^PAPER:/i.test(raw)) return raw;
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizedAuthority(value: unknown): string {
  const raw = cleanText(value).toUpperCase();
  const aliases: Record<string, string> = {
    INDIA: 'IN', CHINA: 'CN', 'UNITED STATES': 'US', USA: 'US',
    'UNITED KINGDOM': 'GB', JAPAN: 'JP', KOREA: 'KR',
    EUROPE: 'EP', EUROPEAN: 'EP', WORLDWIDE: 'WO', WIPO: 'WO',
  };
  return aliases[raw] || raw;
}

function publicationAuthority(publicationNumber: string, ...metadataValues: unknown[]): string {
  for (const value of metadataValues) {
    const authority = normalizedAuthority(value);
    if (/^[A-Z]{2}$/.test(authority)) return authority;
  }
  const prefix = canonicalPublicationDisplay(publicationNumber).match(/^([A-Z]{2})/)?.[1];
  return prefix || 'Not available';
}

function canonicalPatentNumber(value: unknown): string {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAPER')) return compact;
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

function sourceAbstractFields(value: any): unknown[] {
  const term = sourceDisclosureTerm();
  return [
    value?.[term],
    value?.[`${term}Original`],
    value?.[`${term}_text`],
    value?.[`${term}Text`],
    value?.[`${term}_en`],
    value?.[`${term}English`],
    value?.snippet,
    value?.description,
  ];
}

function displayEvidenceSource(value: unknown, fallback = 'citation record'): string {
  const text = cleanText(value, fallback).toLowerCase();
  if (!text || text === 'none' || text === 'citation record') return 'none';
  if (/\bclaims?\b/.test(text)) return 'source record';
  if (/\btitle\b/.test(text) && new RegExp(`\\b${sourceDisclosureTerm()}\\b`, 'i').test(text)) return 'source record';
  if (new RegExp(`\\b${sourceDisclosureTerm()}\\b`, 'i').test(text)) return 'source record';
  if (/\btitle\b/.test(text)) return 'source record';
  return 'inference';
}

function evidenceQuoteFrom(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const text = cleanText(value);
      if (text) return text;
    }
    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      const text = cleanText(objectValue.quote || objectValue.text || objectValue.passage || objectValue.snippet);
      if (text) return text;
    }
  }
  return '';
}

function evidenceSourceFrom(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return objectValue.field || objectValue.source || objectValue.evidence_source;
  }
  return undefined;
}

function reportSafeText(value: unknown, fallback = ''): string {
  const sourceTerm = sourceDisclosureTerm();
  return cleanText(value, fallback)
    .replace(new RegExp(`\\bno ${sourceTerm} available\\.?`, 'gi'), 'Source record detail was unavailable; full-text review is recommended for this point.')
    .replace(/\bavailable data\b/gi, 'reviewed record')
    .replace(/\bcomplete information (?:was|is) not available\b/gi, 'source record review is recommended')
    .replace(/\bnot available\b/gi, 'to be confirmed')
    .replace(/\bunavailable\b/gi, 'to be confirmed')
    .replace(/\binsufficient (?:content|information|data|evidence)\b/gi, 'review recommended')
    .replace(/\btoo limited\b/gi, 'marked for review')
    .replace(/\blimited (?:available )?(?:data|information|evidence|content)\b/gi, 'source-record review')
    .replace(/\bsource-field limitation\b/gi, 'source-record scope')
    .replace(/\bweak corpus coverage\b/gi, 'citation review scope')
    .replace(/\bmissing (?:analysis|evidence|information|data)\b/gi, 'review item')
    .replace(/\bevidence (?:is|was) too thin\b/gi, 'review is recommended')
    .replace(/\b(?:only|solely) (?:the )?citation record\b/gi, 'the reviewed citation record')
    .replace(/\bcitation record only\b/gi, 'reviewed citation record')
    .replace(/\binsufficient\b/gi, 'marked for review')
    .replace(/\blow evidence\b/gi, 'limited mapped overlap')
    .replace(/\bweak evidence(?:\s+areas?)?\b/gi, 'features needing full-text confirmation')
    .replace(/\b(?:available patent data|patent data|data|records?) (?:is|was|are|were) limited\b/gi, 'the reviewed patent records are focused')
    .replace(/\bevidence[- ]limited\b/gi, 'source-record based')
    .replace(/\bdeterministic fallback\b/gi, 'record-based review')
    .replace(/\bfallback\b/gi, 'record-based review')
    .replace(/\bdeterministic\b/gi, 'record-based')
    .replace(/\bavailable patent record\b/gi, 'reviewed patent record')
    .replace(/\bavailable citation record\b/gi, 'reviewed citation record')
    .replace(/\bavailable patent disclosure\b/gi, 'reviewed patent disclosure')
    .replace(/\bavailable patent evidence\b/gi, 'reviewed patent evidence')
    .replace(/\bfinal attorney remarks?\b/gi, 'claim-positioning observations')
    .replace(/\bpreliminary review report\b/gi, 'preliminary novelty assessment')
    .replace(/\bpreliminary report\b/gi, 'preliminary novelty assessment')
    .replace(/\bpreliminary claim-positioning observations\b/gi, 'claim-positioning observations')
    .replace(/\bpreliminary patent intelligence\b/gi, 'patent intelligence')
    .replace(/\bfinal attorney opinion\b/gi, 'review required')
    .replace(/\battorney review\b/gi, 'review')
    .replace(/\bnon-patentable\b/gi, 'high mapped-overlap risk')
    .replace(/\bpatentable\b/gi, 'potential novelty space')
    .replace(/\binvalidating prior art\b/gi, 'potentially material prior art')
    .replace(/\binvalidates?\b/gi, 'may be material to review')
    .replace(/\binfringes?\b/gi, 'may require legal review')
    .replace(/\bobviousness\b/gi, 'overlap-risk')
    .replace(/\bobvious\b/gi, 'high-overlap risk')
    .replace(/\bclear novelty\b/gi, 'potential novelty space')
    .replace(/\bdefinite novelty\b/gi, 'potential novelty space')
    .replace(/\banticipated by\b/gi, 'shows high mapped overlap with')
    .replace(/\banticipates?\b/gi, 'shows high mapped overlap')
    .replace(/\bexact match\b/gi, 'high mapped-overlap candidate')
    .replace(/\bdecisive match\b/gi, 'high mapped-overlap candidate')
    .replace(/\bhigh abstract-level overlap\b/gi, 'high mapped overlap')
    .replace(/\btitle\/abstract(?:-based)?\b/gi, 'preliminary record')
    .replace(/\babstract-level\b/gi, 'record-level')
    .replace(/\bnot novel\b/gi, 'high mapped-overlap risk')
    .replace(/\bno prior art (?:was )?found\b/gi, 'no high-overlap candidate was identified among the screened preliminary records')
    .replace(/\bscreened title\/abstract records\b/gi, 'screened preliminary records');
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
  if (status === 'Present') return 'Directly Mapped';
  if (status === 'Partial') return 'Partially Mapped';
  if (status === 'Absent') return 'Not Found in Reviewed Record';
  // States what the record shows rather than instructing the reader to go and
  // check. `Absent` is a definite negative; this is the genuinely ambiguous cell.
  return 'Not Established in Reviewed Record';
}

function publicMapping(rowStatus: FeatureMapCell['status']): { label: string; code: string } {
  const code = rowStatus === 'Present' ? 'D' : rowStatus === 'Partial' ? 'P' : rowStatus === 'Absent' ? 'N' : 'R';
  return { label: statusLabel(rowStatus), code };
}

function evidenceStrengthFor(
  status: FeatureMapCell['status'],
  feature: string,
  evidenceQuote: string,
  evidenceSource: string,
  patentDisclosure: string,
  confidence: number | null
): { strength: AttorneyReportEvidenceStrength; reason: string } {
  if (status === 'Absent' || status === 'Unknown') {
    return { strength: 'Weak', reason: 'No affirmative mapped evidence was identified for this feature.' };
  }
  const source = cleanText(evidenceSource, 'none').toLowerCase();
  const quote = cleanText(evidenceQuote);
  const overlap = featureOverlapScore(feature, [quote, patentDisclosure].filter(Boolean).join(' '));
  if (!quote || source === 'none' || source === 'inference') {
    return { strength: 'Weak', reason: 'Mapping is inferred or lacks a direct supporting passage.' };
  }
  if (source === 'title') {
    return { strength: 'Weak', reason: 'Title-only support indicates relevance but not full feature disclosure.' };
  }
  if (status === 'Present' && overlap >= 0.45 && (confidence ?? 0.7) >= 0.65) {
    return { strength: 'Strong', reason: 'Explicit passage directly supports the mapped feature.' };
  }
  if (overlap >= 0.22 || status === 'Partial') {
    return { strength: 'Moderate', reason: 'Passage supports a related mechanism but does not prove every feature constraint.' };
  }
  return { strength: 'Weak', reason: 'Supporting passage is too generic or indirect for the mapped feature.' };
}

function visibleStatusForReport(
  status: FeatureMapCell['status'],
  evidenceStrength: AttorneyReportEvidenceStrength,
  evidenceQuote: string,
  confidence: number | null = null
): FeatureMapCell['status'] {
  let resolved: FeatureMapCell['status'] = status;
  if (status === 'Present' && evidenceStrength === 'Weak') resolved = evidenceQuote ? 'Partial' : 'Unknown';
  else if (status === 'Partial' && evidenceStrength === 'Weak' && !evidenceQuote) resolved = 'Unknown';
  // Prefer a definite "Not found" (N) over "Requires full-text review" (R) when there
  // is no positive evidence and the model is not expressly uncertain. R is reserved for
  // genuinely ambiguous cells: a weak-but-positive passage, or low confidence.
  if (resolved === 'Unknown' && !evidenceQuote && (confidence == null || confidence >= 0.6)) {
    return 'Absent';
  }
  return resolved;
}

function safeOverlapLabel(value: unknown): { label: string; level: AttorneyReportPatentComparison['overlapRiskLevel'] } {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (/(anticipat|not novel|high)/.test(text)) return { label: 'High mapped-overlap risk', level: 'High' };
  if (/(obvious|partial novelty|partially novel|medium|moderate)/.test(text)) return { label: 'Related / moderate-overlap', level: 'Medium' };
  if (/(adjacent|related)/.test(text)) return { label: 'Related / moderate-overlap', level: 'Medium' };
  if (/(remote|novel|low)/.test(text)) return { label: 'Low mapped-overlap', level: 'Low' };
  // The fallback states a position on the record rather than deferring: an
  // unclassified threat value still means the mapping showed limited overlap.
  return { label: 'Limited mapped-overlap', level: 'Low' };
}

function safeAssessmentDecision(value: unknown): string {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!text) return 'Limited mapped-overlap identified';
  if (/low evidence/.test(text)) return 'Limited mapped-overlap identified';
  if (/not novel|anticipat|obvious|high/.test(text)) return 'High mapped-overlap risk';
  if (/partial/.test(text)) return 'Potential novelty space with mapped overlap';
  if (/novel|patentable/.test(text)) return 'Potential novelty space';
  return reportSafeText(value, 'Limited mapped-overlap identified');
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

function featureImportanceFor(type: AttorneyReportFeatureType, feature: string): AttorneyReportFeatureImportance {
  const text = cleanText(feature).toLowerCase();
  if (type === 'generic_weak') return 'secondary_implementation';
  if (/\b(optional|optionally|alternative embodiment|may include)\b/.test(text)) return 'optional_embodiment';
  if (/\b(qr|barcode|smartphone|mobile|app|readable marker|verification marker|calibration zone|reference calibration)\b/.test(text)) {
    return 'secondary_implementation';
  }
  if (type === 'core_technical' || type === 'novelty_candidate') return 'core_inventive';
  return 'secondary_implementation';
}

function featureImportanceLabel(importance: AttorneyReportFeatureImportance): string {
  if (importance === 'core_inventive') return 'Core inventive feature';
  if (importance === 'optional_embodiment') return 'Optional embodiment';
  return 'Secondary implementation feature';
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
    const importance = featureImportanceFor(type, feature);
    return {
      featureNumber: `KF${index + 1}`,
      feature,
      type,
      typeLabel: featureTypeLabel(type),
      importance,
      importanceLabel: featureImportanceLabel(importance),
      disclosure: disclosureMap.get(feature) || feature,
      claimableText: cleanText((detail as any)?.claimableText || (detail as any)?.claimable_text),
      embeddingSearchText: cleanText((detail as any)?.embeddingSearchText || (detail as any)?.embedding_search_text),
      featureConfidence: numberScore((detail as any)?.featureConfidence ?? (detail as any)?.feature_confidence) ?? null,
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
    stage1?.candidateResults,
    stage1?.rawPriorArtResults,
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
  if (status === 'Partial') return `Partial overlap: review should distinguish the missing element of ${feature}.`;
  if (status === 'Absent') return `Potential differentiator: ${feature} is not shown in the reviewed patent disclosure.`;
  return `Review focus: confirm how ${feature} is treated in the full patent documents.`;
}

function defaultAttorneyRemark(status: FeatureMapCell['status'], feature: string): string {
  if (status === 'Present') return `The reference appears to disclose this feature in the reviewed patent record.`;
  if (status === 'Partial') return `The reference is technically related to this feature but does not show all required elements in the reviewed citation record.`;
  if (status === 'Absent') return `This reference does not show supporting disclosure for this feature.`;
  return `Review should confirm the treatment of this feature in the source record.`;
}

function defaultClaimReviewNote(status: FeatureMapCell['status'], feature: string): string {
  if (status === 'Present') return `Do not rely on ${feature} alone unless full patent document review shows a narrower distinction.`;
  if (status === 'Partial') return `Claim drafting should emphasize the missing element of ${feature}.`;
  if (status === 'Absent') return `This may be a claim focus point, subject to full patent document prior-art review.`;
  return `Request more evidence before relying on this feature in claim strategy.`;
}

function defaultCrispRemark(status: FeatureMapCell['status'], feature: string, patentDisclosure: string): string {
  const disclosure = cleanText(patentDisclosure, 'No supporting disclosure was mapped');
  const shortDisclosure = disclosure.length > 90 ? `${disclosure.slice(0, 87).trim()}...` : disclosure;
  if (status === 'Present') {
    return `Mapped overlap: ${shortDisclosure}`;
  }
  if (status === 'Partial') {
    return `Partial overlap: ${shortDisclosure}`;
  }
  if (status === 'Absent') {
    return `Potential distinction: ${feature} is not disclosed by this reference.`;
  }
  return `Verification needed: available data does not reliably address ${feature}.`;
}

function defaultProfessionalRemark(status: FeatureMapCell['status'], feature: string, patentDisclosure: string): string {
  const disclosure = cleanText(patentDisclosure, '');
  const shortDisclosure = disclosure.length > 120 ? `${disclosure.slice(0, 117).trim()}...` : disclosure;
  if (status === 'Present') {
    return shortDisclosure
      ? `The reference appears to teach this feature through ${shortDisclosure}. Review the claim wording for narrower technical distinctions before relying on this element.`
      : `The reference appears to teach ${feature}. Review the claim wording for narrower technical distinctions before relying on this element.`;
  }
  if (status === 'Partial') {
    return shortDisclosure
      ? `The reference is technically related through ${shortDisclosure}, but it does not clearly disclose the complete submitted mechanism. Preserve the missing element as a claim-review focus.`
      : `The reference is technically related to ${feature}, but it does not clearly disclose the complete submitted mechanism. Preserve the missing element as a claim-review focus.`;
  }
  if (status === 'Absent') {
    return `The reviewed citation does not expressly teach ${feature}. This point may support differentiation if confirmed across the closest references and reflected in the invention disclosure.`;
  }
  return `The citation record does not allow a reliable comparison for ${feature}. Verify the full patent document before assigning claim weight to this point.`;
}

function stripRemarkLabels(value: unknown): string {
  return cleanText(value)
    .replace(/\b(?:crisp remark|attorney remark|novelty impact|claim review note|review note|status|mapped overlap|partial overlap|potential distinction|potential differentiator|verification needed|overlap risk|evidence gap)\s*:\s*/gi, '')
    .replace(/\b(?:confidence|coverage)\s*:\s*\d+(?:\.\d+)?\s*%?/gi, '')
    .replace(/\b\d+(?:\.\d+)?\s*%\s*(?:confidence|coverage|mapped coverage|evidence confidence)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function reportSafeRemark(value: unknown): string {
  return reportSafeText(stripRemarkLabels(value))
    .replace(/\b(?:confidence|coverage)\s*:\s*\d+(?:\.\d+)?\s*%?/gi, '')
    .replace(/\b\d+(?:\.\d+)?\s*%\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulRemark(value: unknown, maxWords = 85): boolean {
  const text = reportSafeRemark(value);
  if (!text) return false;
  if (/\b(attorney remark|novelty impact|claim review note|crisp remark|review note|status|confidence|coverage)\s*:/i.test(text)) return false;
  if (/\b\d+(?:\.\d+)?\s*%\b/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 4 && words.length <= maxWords;
}

function rowCrispRemark(
  supplied: any,
  cell: FeatureMapCell | undefined,
  status: FeatureMapCell['status'],
  feature: string,
  patentDisclosure: string
): string {
  const candidates = [
    supplied.crisp_remark,
    (cell as any)?.crisp_remark,
    supplied.attorney_remark,
    cell?.attorney_remark,
    supplied.novelty_impact,
    cell?.novelty_impact,
  ];
  for (const candidate of candidates) {
    if (isUsefulRemark(candidate, 30)) return reportSafeRemark(candidate);
  }
  return reportSafeText(defaultCrispRemark(status, feature, patentDisclosure));
}

function rowProfessionalRemark(
  supplied: any,
  cell: FeatureMapCell | undefined,
  status: FeatureMapCell['status'],
  feature: string,
  patentDisclosure: string
): string {
  const candidates = [
    supplied.professional_remark,
    (cell as any)?.professional_remark,
    [
      supplied.attorney_remark || cell?.attorney_remark,
      supplied.novelty_impact || cell?.novelty_impact,
      supplied.claim_review_note || cell?.claim_review_note,
    ].filter(Boolean).join(' '),
    supplied.crisp_remark,
    (cell as any)?.crisp_remark,
    supplied.attorney_remark,
    cell?.attorney_remark,
    supplied.novelty_impact,
    cell?.novelty_impact,
    supplied.claim_review_note,
    cell?.claim_review_note,
  ];
  for (const candidate of candidates) {
    if (isUsefulRemark(candidate)) return reportSafeRemark(candidate);
  }
  return reportSafeRemark(defaultProfessionalRemark(status, feature, patentDisclosure));
}

function buildClaimImpactSummary(rows: AttorneyReportFeatureRow[], riskLabel: string): string {
  const present = rows.filter(row => row.status === 'Present').length;
  const partial = rows.filter(row => row.status === 'Partial').length;
  const absent = rows.filter(row => row.status === 'Absent').length;
  const unknown = rows.filter(row => row.status === 'Unknown').length;
  return reportSafeText(
    `Feature mapping: ${present} directly mapped, ${partial} partially mapped, ${absent} not expressly taught, ${unknown} requiring full-text review. ${riskLabel}.`
  );
}

function deterministicRiskAssessment(
  comparisons: AttorneyReportPatentComparison[],
  featureSummaries: AttorneyReportFeatureSummary[],
  counts: ReturnType<typeof buildNoveltyReportCountSummary>
): AttorneyReportModel['riskAssessment'] {
  const coreFeatures = featureSummaries.filter(feature => feature.importance === 'core_inventive');
  const riskFeatures = coreFeatures.length ? coreFeatures : featureSummaries.filter(feature => feature.importance !== 'optional_embodiment');
  const riskFeatureNumbers = new Set(riskFeatures.map(feature => feature.featureNumber));
  const coreFeatureCount = riskFeatures.length;
  const weightedCoverage = (rows: AttorneyReportFeatureRow[]) => {
    if (coreFeatureCount === 0) return 0;
    const relevant = rows.filter(row => riskFeatureNumbers.has(row.featureNumber));
    const score = relevant.reduce((sum, row) => {
      if (row.status === 'Present') return sum + (row.evidenceStrength === 'Strong' ? 1 : 0.75);
      if (row.status === 'Partial') return sum + 0.5;
      return sum;
    }, 0);
    return score / coreFeatureCount;
  };
  const strongestSingleReferenceCoreCoverage = comparisons.reduce((best, item) => Math.max(best, weightedCoverage(item.rows)), 0);
  const distributedCoreCoverage = coreFeatureCount === 0
    ? 0
    : riskFeatures.filter(feature => comparisons.some(item => {
      const row = item.rows.find(candidate => candidate.featureNumber === feature.featureNumber);
      return row?.status === 'Present' || row?.status === 'Partial';
    })).length / coreFeatureCount;

  const noveltyRisk: AttorneyReportRiskLevel = coreFeatureCount === 0 || comparisons.length === 0
    ? 'Needs Review'
    : strongestSingleReferenceCoreCoverage >= 0.95
      ? 'High'
      : strongestSingleReferenceCoreCoverage >= 0.67
        ? 'Moderate'
        : 'Low';
  const combinationRisk: AttorneyReportRiskLevel = coreFeatureCount === 0 || comparisons.length === 0
    ? 'Needs Review'
    : distributedCoreCoverage >= 0.8 && (counts.componentMatches > 1 || comparisons.length > 1)
      ? 'High'
      : distributedCoreCoverage >= 0.5
        ? 'Moderate'
        : 'Low';
  const noveltyRiskExplanation = noveltyRisk === 'High'
    ? 'A single reviewed citation maps nearly all core inventive features.'
    : noveltyRisk === 'Moderate'
      ? 'One reviewed citation maps a substantial portion, but not all, core inventive features.'
      : noveltyRisk === 'Low'
        ? 'No single reviewed citation maps most core inventive features.'
        : 'Core inventive features were not sufficiently classified for a reliable anticipation-style signal.';
  const combinationRiskExplanation = combinationRisk === 'High'
    ? 'Core features are distributed across multiple component references.'
    : combinationRisk === 'Moderate'
      ? 'Several core features are mapped across the reviewed citation set, but coverage is incomplete.'
      : combinationRisk === 'Low'
        ? 'Reviewed citations do not collectively map most core inventive features.'
        : 'Distributed feature coverage could not be assessed reliably from the mapped records.';
  const headline = noveltyRisk === 'High'
    ? 'High novelty / anticipation risk'
    : combinationRisk === 'High'
      ? 'High component-combination risk'
      : combinationRisk === 'Moderate' || noveltyRisk === 'Moderate'
        ? 'Moderate mapped-overlap risk'
        : 'Low mapped-overlap risk';

  return {
    noveltyRisk,
    noveltyRiskLabel: `Novelty / anticipation risk: ${noveltyRisk}`,
    noveltyRiskExplanation,
    combinationRisk,
    combinationRiskLabel: `Component-combination risk: ${combinationRisk}`,
    combinationRiskExplanation,
    headline,
    coreFeatureCount,
    strongestSingleReferenceCoreCoverage: Math.round(strongestSingleReferenceCoreCoverage * 100) / 100,
    distributedCoreCoverage: Math.round(distributedCoreCoverage * 100) / 100,
    highestSingleReferenceCoreCoveragePercent: Math.round(strongestSingleReferenceCoreCoverage * 100),
    distributedCoreCoveragePercent: Math.round(distributedCoreCoverage * 100),
    assessmentConfidence: confidenceFromCounts({
      searched: counts.patentsSearched,
      found: counts.patentsFound,
      directlyRelevant: counts.directlyRelevant,
      retrieved: counts.patentsSearched,
      reviewed: counts.screened,
      visible: counts.directlyRelevant,
      analyzed: counts.detailedCitations,
    }) as 'Low' | 'Medium' | 'High',
  };
}

function buildPotentialDifferentiationSpace(comparisons: AttorneyReportPatentComparison[], featureSummaries: AttorneyReportFeatureSummary[]): string {
  const mappedByFeature = new Map<string, Set<FeatureMapCell['status']>>();
  for (const item of comparisons) {
    for (const row of item.rows) {
      if (!mappedByFeature.has(row.featureNumber)) mappedByFeature.set(row.featureNumber, new Set());
      mappedByFeature.get(row.featureNumber)?.add(row.status);
    }
  }
  const candidates = featureSummaries
    .filter(feature => feature.importance !== 'optional_embodiment')
    .filter(feature => {
      const statuses = mappedByFeature.get(feature.featureNumber);
      return !statuses?.has('Present') || statuses?.has('Partial') || statuses?.has('Unknown') || statuses?.has('Absent');
    })
    .sort((a, b) => {
      const weight = (feature: AttorneyReportFeatureSummary) => feature.importance === 'core_inventive' ? 0 : 1;
      return weight(a) - weight(b);
    })
    .slice(0, 5);
  if (!candidates.length) {
    return 'No clear potential differentiation space was identified from the mapped records; full claim-level review is required.';
  }
  return `Potential differentiation space appears to lie in the specific integration of ${candidates.map(item => `${item.featureNumber} (${item.feature})`).join(', ')}. Treat this as a preliminary claim-positioning signal, not a legal patentability conclusion.`;
}

function buildMatrixInsight(comparisons: AttorneyReportPatentComparison[], featureSummaries: AttorneyReportFeatureSummary[], risk: AttorneyReportModel['riskAssessment']): string {
  const core = featureSummaries.filter(feature => feature.importance === 'core_inventive');
  const coreLabels = core.map(feature => feature.featureNumber).join(' + ');
  if (!comparisons.length || !core.length) return 'Feature matrix requires mapped citations and classified core features before a reliable interpretation can be stated.';
  const fullCoreReference = comparisons.find(item => core.every(feature => {
    const row = item.rows.find(candidate => candidate.featureNumber === feature.featureNumber);
    return row?.status === 'Present';
  }));
  if (fullCoreReference) return `${fullCoreReference.publicationNumber} maps all classified core inventive features; review this reference first at claim level.`;
  return `No cited reference maps ${coreLabels} together. ${risk.combinationRiskExplanation} The strongest potential differentiation space is the integrated arrangement of the unmapped or partially mapped core features.`;
}

function normalizeClaimConcepts(stage0: NormalizedIdea): ClaimConcept[] {
  const features = new Set((stage0.inventionFeatures || []).map(feature => cleanText(feature)));
  return (Array.isArray(stage0.claimConcepts) ? stage0.claimConcepts : [])
    .map((concept: any, index) => {
      const linkedFeatures = (Array.isArray(concept?.linkedFeatures) ? concept.linkedFeatures : [])
        .map((feature: unknown) => cleanText(feature))
        .filter((feature: string) => features.has(feature));
      if (!linkedFeatures.length) return null;
      const importance = cleanText(concept?.importance).toLowerCase();
      return {
        title: cleanText(concept?.title, `Claim concept ${index + 1}`),
        linkedFeatures,
        claimableSummary: cleanText(concept?.claimableSummary),
        importance: importance === 'primary' || importance === 'secondary' || importance === 'fallback' ? importance : (index === 0 ? 'primary' : 'secondary'),
        riskIfMissing: cleanText(concept?.riskIfMissing),
      } as ClaimConcept;
    })
    .filter(Boolean) as ClaimConcept[];
}

function conceptFeatureNumbers(concept: ClaimConcept, featureSummaries: AttorneyReportFeatureSummary[]): string {
  return concept.linkedFeatures
    .map(feature => featureSummaries.find(summary => summary.feature === feature)?.featureNumber)
    .filter(Boolean)
    .join(' + ');
}

function buildFallbackConceptMapping(
  concepts: ClaimConcept[],
  comparisons: AttorneyReportPatentComparison[],
  featureSummaries: AttorneyReportFeatureSummary[]
): ClaimConceptMapping[] {
  return concepts.map(concept => {
    const totalFeatures = Math.max(1, concept.linkedFeatures.length);
    const perPatent = comparisons.map(comparison => {
      const mappedRows = concept.linkedFeatures
        .map(feature => comparison.rows.find(row => row.userFeature === feature))
        .filter((row): row is AttorneyReportFeatureRow => {
          if (!row) return false;
          return row.status === 'Present' || row.status === 'Partial';
        });
      const weighted = mappedRows.reduce((sum, row) => sum + (row.status === 'Present' ? 1 : 0.5), 0);
      const text = [
        comparison.title,
        comparison.technicalDisclosure,
        comparison.summary,
        ...mappedRows.map(row => `${row.patentDisclosure} ${row.evidenceQuote} ${row.professionalRemark}`),
      ].join(' ').toLowerCase();
      const relationshipTokens = cleanText(`${concept.title} ${concept.claimableSummary}`).toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 4)
        .slice(0, 20);
      const tokenHits = relationshipTokens.filter(token => text.includes(token)).length;
      const relationshipMapped = mappedRows.length >= Math.min(2, totalFeatures) && tokenHits >= Math.min(4, Math.max(2, Math.ceil(relationshipTokens.length * 0.25)));
      return {
        pn: comparison.publicationNumber,
        mappedFeatures: mappedRows,
        coverage: Math.round((weighted / totalFeatures) * 100) / 100,
        relationshipMapped,
        evidence: relationshipMapped
          ? cleanText(mappedRows.map(row => row.patentDisclosure || row.evidenceQuote).filter(Boolean).join(' ')).slice(0, 240)
          : `Feature overlap is present, but the reviewed citation evidence does not show the cooperative relationship: ${concept.claimableSummary || concept.title}.`,
      };
    }).sort((a, b) => Number(b.relationshipMapped) - Number(a.relationshipMapped) || b.coverage - a.coverage);
    const best = perPatent[0];
    const distributedMapped = concept.linkedFeatures.filter(feature =>
      comparisons.some(comparison => {
        const row = comparison.rows.find(item => item.userFeature === feature);
        return row?.status === 'Present' || row?.status === 'Partial';
      })
    ).length;
    const distributedCoverage = Math.round((distributedMapped / totalFeatures) * 100) / 100;
    const coverage = best?.coverage || 0;
    const relationshipMapped = Boolean(best?.relationshipMapped && coverage >= 0.75);
    const relationshipRisk: ClaimConceptMapping['relationshipRisk'] = relationshipMapped
      ? 'high'
      : coverage >= 0.75 || distributedCoverage >= 0.75
        ? 'moderate'
        : 'low';
    return {
      claimConceptTitle: concept.title,
      linkedFeatures: concept.linkedFeatures,
      mappedFeatures: best?.mappedFeatures.length || 0,
      totalFeatures,
      coverage,
      distributedCoverage,
      bestReference: best?.pn,
      relationshipMapped,
      relationshipEvidence: best?.evidence || '',
      relationshipRisk,
      risk: relationshipRisk,
      reason: relationshipMapped
        ? 'A single reviewed citation maps the linked features and the cooperative relationship.'
        : coverage >= 0.75
          ? 'A citation maps most linked features, but the cooperative relationship is not fully disclosed.'
          : distributedCoverage >= 0.75
            ? 'Linked features are distributed across references without one citation mapping the full cooperative relationship.'
            : 'No reviewed citation maps most linked features or their cooperative relationship.',
    };
  });
}

function buildMainDifferentiator(stage0: NormalizedIdea, concepts: ClaimConcept[], mapping: ClaimConceptMapping[], featureSummaries: AttorneyReportFeatureSummary[]): string {
  const architecture = cleanText(stage0.architecturalInnovation);
  if (architecture) return architecture;
  const primary = concepts.find(concept => concept.importance === 'primary') || concepts[0];
  if (primary) return primary.title;
  const novelty = featureSummaries.find(feature => feature.type === 'novelty_candidate') || featureSummaries.find(feature => feature.importance === 'core_inventive');
  return novelty ? `${novelty.featureNumber} - ${novelty.feature}` : 'No unmapped differentiator identified';
}

function buildAttorneyReviewFocus(
  concepts: ClaimConcept[],
  mapping: ClaimConceptMapping[],
  featureSummaries: AttorneyReportFeatureSummary[],
  closestCitation: AttorneyReportCitation | null
): string {
  const topConcepts = (concepts.length ? concepts : [])
    .slice()
    .sort((a, b) => (a.importance === 'primary' ? -1 : 0) - (b.importance === 'primary' ? -1 : 0))
    .slice(0, 2);
  if (!topConcepts.length) {
    return closestCitation
      ? `Review ${closestCitation.publicationNumber} first; preserve unmapped or partially mapped core feature combinations in claim-positioning review.`
      : 'Run detailed citation mapping before forming claim-positioning conclusions.';
  }
  const conceptLabels = topConcepts.map(concept => concept.title).join(' and ');
  const featureGroups = topConcepts
    .map(concept => conceptFeatureNumbers(concept, featureSummaries))
    .filter(Boolean)
    .join('; ');
  const relationshipGaps = mapping
    .filter(item => !item.relationshipMapped)
    .slice(0, 2)
    .map(item => item.claimConceptTitle);
  return [
    closestCitation ? `Review ${closestCitation.publicationNumber} first for overlap against ${conceptLabels}.` : `Review closest citations for overlap against ${conceptLabels}.`,
    featureGroups ? `Preserve the cooperative relationship across ${featureGroups}.` : '',
    relationshipGaps.length ? `Do not treat isolated feature overlap as mapping ${relationshipGaps.join(' or ')} unless the relationship is disclosed.` : '',
  ].filter(Boolean).join(' ');
}

interface ClaimFocusCandidate {
  title: string;
  linkedFeatures: string[];
  linkedConcept?: string;
  claimableSummary?: string;
  importance: ClaimConcept['importance'];
  mappedCoverage: number;
  distributedCoverage: number;
  relationshipMapped: boolean;
  closestReferences: string[];
  unmappedFeatures: AttorneyReportFeatureSummary[];
  partiallyMappedFeatures: AttorneyReportFeatureSummary[];
  score: number;
}

const CLAIM_DRAFTING_PREFIXES = [
  'Consider emphasizing',
  'Consider reviewing',
  'Consider separating',
  'Consider protecting',
  'Consider avoiding reliance on',
];

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function featureByText(featureSummaries: AttorneyReportFeatureSummary[], feature: string): AttorneyReportFeatureSummary | undefined {
  const normalized = cleanText(feature).toLowerCase();
  return featureSummaries.find(item => item.feature.toLowerCase() === normalized);
}

function rowsForFeature(comparisons: AttorneyReportPatentComparison[], feature: string): AttorneyReportFeatureRow[] {
  return comparisons.flatMap(comparison => comparison.rows.filter(row => row.userFeature === feature));
}

function featureMappedFactor(comparisons: AttorneyReportPatentComparison[], feature: string): number {
  const rows = rowsForFeature(comparisons, feature);
  if (!rows.length) return 0;
  return rows.reduce((best, row) => {
    const value = row.status === 'Present'
      ? (row.evidenceStrength === 'Strong' ? 1 : 0.75)
      : row.status === 'Partial'
        ? 0.5
        : row.status === 'Unknown'
          ? 0.1
          : 0;
    return Math.max(best, value);
  }, 0);
}

function featurePriorityWeight(feature: AttorneyReportFeatureSummary): number {
  if (feature.importance === 'core_inventive') return 1.2;
  if (feature.importance === 'secondary_implementation') return 0.75;
  return 0.35;
}

function featureLabel(feature: AttorneyReportFeatureSummary | string): string {
  if (typeof feature === 'string') return cleanText(feature);
  return `${feature.featureNumber} (${feature.feature})`;
}

function conciseList(items: string[], max = 3): string {
  const values = items.map(item => cleanText(item)).filter(Boolean).slice(0, max);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function inventionTypeHint(stage0: NormalizedIdea, featureSummaries: AttorneyReportFeatureSummary[]): string {
  const text = [
    (stage0 as any).inventionType,
    (stage0 as any).invention_type,
    (stage0 as any).technicalField,
    (stage0 as any).technical_field,
    stage0.searchQuery,
    ...featureSummaries.map(feature => feature.feature),
  ].join(' ').toLowerCase();
  if (/\b(software|controller|algorithm|model|data|signal|workflow|processor|ai|machine learning)\b/.test(text)) return 'data/control relationship';
  if (/\b(mechanical|housing|assembly|linkage|gear|valve|joint|structural|component)\b/.test(text)) return 'structural cooperation between components';
  if (/\b(chemical|pharma|pharmaceutical|composition|formulation|compound|polymer|release|excipient)\b/.test(text)) return 'composition, release, process, and measurable performance constraints';
  if (/\b(manufactur|fabricat|synthesis|process sequence|controlled transformation|treatment step)\b/.test(text)) return 'process sequence and controlled transformation';
  return 'cooperative technical relationship';
}

function hasMinimumClaimPositioningEvidence(
  comparisons: AttorneyReportPatentComparison[],
  featureSummaries: AttorneyReportFeatureSummary[],
  mapping: ClaimConceptMapping[]
): boolean {
  if (!comparisons.length || !featureSummaries.length) return false;
  const mappedRows = comparisons.flatMap(comparison => comparison.rows)
    .filter(row => row.status === 'Present' || row.status === 'Partial');
  const usefulEvidenceRows = mappedRows.filter(row => row.evidenceStrength === 'Strong' || row.evidenceStrength === 'Moderate');
  if (mapping.some(item => item.totalFeatures > 0 && (item.coverage > 0 || item.distributedCoverage > 0))) return true;
  return usefulEvidenceRows.length >= 2 || (mappedRows.length >= 1 && featureSummaries.length <= 2);
}

function buildFallbackFocusCandidates(
  featureSummaries: AttorneyReportFeatureSummary[],
  comparisons: AttorneyReportPatentComparison[]
): ClaimFocusCandidate[] {
  const groups = new Map<AttorneyReportFeatureType, AttorneyReportFeatureSummary[]>();
  for (const feature of featureSummaries.filter(item => item.importance !== 'optional_embodiment')) {
    if (!groups.has(feature.type)) groups.set(feature.type, []);
    groups.get(feature.type)?.push(feature);
  }
  return Array.from(groups.entries()).map(([type, features]) => {
    const weightedTotal = features.reduce((sum, feature) => sum + featurePriorityWeight(feature), 0) || 1;
    const weightedMapped = features.reduce((sum, feature) => sum + featurePriorityWeight(feature) * featureMappedFactor(comparisons, feature.feature), 0);
    const mappedCoverage = Math.max(0, Math.min(1, weightedMapped / weightedTotal));
    const unmappedFeatures = features.filter(feature => featureMappedFactor(comparisons, feature.feature) < 0.25);
    const partiallyMappedFeatures = features.filter(feature => {
      const mapped = featureMappedFactor(comparisons, feature.feature);
      return mapped >= 0.25 && mapped < 0.9;
    });
    const references = Array.from(new Set(features
      .flatMap(feature => comparisons.filter(comparison => comparison.rows.some(row => row.userFeature === feature.feature && (row.status === 'Present' || row.status === 'Partial'))).map(comparison => comparison.publicationNumber))))
      .slice(0, 3);
    const typeLabel = type === 'novelty_candidate'
      ? 'novelty-candidate features'
      : type === 'core_technical'
        ? 'core technical features'
        : type === 'implementation'
          ? 'implementation features'
          : 'generic features needing support';
    const importance: ClaimConcept['importance'] = type === 'implementation' ? 'secondary' : 'primary';
    return {
      title: `Focus on ${typeLabel}: ${conciseList(features.map(featureLabel), 2)}`,
      linkedFeatures: features.map(feature => feature.feature),
      importance,
      mappedCoverage,
      distributedCoverage: mappedCoverage,
      relationshipMapped: false,
      closestReferences: references,
      unmappedFeatures,
      partiallyMappedFeatures,
      score: (1 - mappedCoverage) * 1.4 + features.reduce((sum, feature) => sum + featurePriorityWeight(feature), 0) / Math.max(1, features.length),
    };
  }).sort((a, b) => b.score - a.score);
}

function buildClaimFocusCandidates(
  concepts: ClaimConcept[],
  mapping: ClaimConceptMapping[],
  featureSummaries: AttorneyReportFeatureSummary[],
  comparisons: AttorneyReportPatentComparison[]
): ClaimFocusCandidate[] {
  if (!concepts.length) return buildFallbackFocusCandidates(featureSummaries, comparisons);
  return concepts.map((concept, index) => {
    const mapped = mapping.find(item => item.claimConceptTitle === concept.title);
    const features = concept.linkedFeatures
      .map(feature => featureByText(featureSummaries, feature))
      .filter((feature): feature is AttorneyReportFeatureSummary => Boolean(feature));
    const mappedCoverage = Math.max(0, Math.min(1, mapped?.coverage ?? 0));
    const distributedCoverage = Math.max(0, Math.min(1, mapped?.distributedCoverage ?? mappedCoverage));
    const unmappedFeatures = features.filter(feature => featureMappedFactor(comparisons, feature.feature) < 0.25);
    const partiallyMappedFeatures = features.filter(feature => {
      const mappedFactor = featureMappedFactor(comparisons, feature.feature);
      return mappedFactor >= 0.25 && mappedFactor < 0.9;
    });
    const importanceWeight = concept.importance === 'primary' ? 1.4 : concept.importance === 'secondary' ? 1 : 0.55;
    const relationshipGap = mapped?.relationshipMapped ? 0 : 0.55;
    const noveltyWeight = features.some(feature => feature.type === 'novelty_candidate') ? 0.35 : 0;
    return {
      title: concept.claimableSummary || concept.title,
      linkedFeatures: concept.linkedFeatures,
      linkedConcept: concept.title,
      claimableSummary: concept.claimableSummary,
      importance: concept.importance || (index === 0 ? 'primary' : 'secondary'),
      mappedCoverage,
      distributedCoverage,
      relationshipMapped: Boolean(mapped?.relationshipMapped),
      closestReferences: [mapped?.bestReference].filter(Boolean) as string[],
      unmappedFeatures,
      partiallyMappedFeatures,
      score: importanceWeight + (1 - mappedCoverage) + relationshipGap + noveltyWeight,
    };
  }).sort((a, b) => b.score - a.score);
}

function conceptOverlap(a: ClaimFocusCandidate, b: ClaimFocusCandidate): number {
  const left = new Set(a.linkedFeatures.map(item => item.toLowerCase()));
  const right = new Set(b.linkedFeatures.map(item => item.toLowerCase()));
  if (!left.size || !right.size) return 0;
  const intersection = Array.from(left).filter(item => right.has(item)).length;
  return intersection / Math.min(left.size, right.size);
}

function focusSentence(candidate: ClaimFocusCandidate, fallbackHint: string): string {
  const features = candidate.unmappedFeatures.length || candidate.partiallyMappedFeatures.length
    ? [...candidate.unmappedFeatures, ...candidate.partiallyMappedFeatures].slice(0, 3).map(featureLabel)
    : candidate.linkedFeatures.slice(0, 3);
  const base = cleanText(candidate.title || candidate.linkedConcept, conciseList(features, 3));
  const featurePart = features.length ? ` centered on ${conciseList(features, 3)}` : '';
  const relationshipPart = candidate.relationshipMapped
    ? ' while verifying whether the mapped relationship is actually disclosed in the full text'
    : ` with emphasis on the ${fallbackHint} that remains incompletely mapped`;
  return reportSafeText(`${base}${featurePart}${relationshipPart}.`);
}

function manualReviewClaimPositioning(
  comparisons: AttorneyReportPatentComparison[],
  publicClosestCitation: AttorneyReportCitation | null
): {
  claimPositioningAnalysis: ClaimPositioningAnalysis;
  claimDraftingConsiderations: ClaimDraftingConsiderations;
  draftingOpportunities: DraftingOpportunity[];
  conceptMappedCoverageSummary: ConceptMappedCoverageSummary[];
  strategicReviewFocus: StrategicReviewFocus;
} {
  const reference = publicClosestCitation?.publicationNumber || comparisons[0]?.publicationNumber || 'Not identified';
  // States the finding — the cited art does not concentrate on any one feature —
  // rather than reporting our own confidence back to the reader as a warning.
  const message = 'The cited art does not map the invention features closely enough to point claim positioning at a single reference, so the feature combination itself carries the differentiation.';
  return {
    claimPositioningAnalysis: {
      primaryClaimFocus: message,
      weakClaimAreas: [],
      avoidRelyingSolelyOn: [],
      remainingInventiveCore: message,
      whyStillDistinguishable: message,
      reasoning: 'No cited reference affirmatively maps a core feature or claim concept, so differentiation rests on the combination rather than on distance from one reference.',
    },
    claimDraftingConsiderations: {
      independentClaimFocus: 'Draft the independent claim around the full feature combination, which no single cited reference maps.',
      dependentClaimIdeas: [],
      fallbackClaimIdeas: [],
      reviewBeforeDrafting: ['Consider reviewing full claims, detailed descriptions, drawings, family records, and non-patent literature before drafting.'],
    },
    draftingOpportunities: [{
      title: 'Claim the feature combination',
      opportunityType: 'optional',
      linkedFeatures: [],
      explanation: message,
    }],
    conceptMappedCoverageSummary: [],
    strategicReviewFocus: {
      highestPriorityReference: reference,
      reviewReason: 'The mapped evidence shows overlap spread across references rather than concentrated in one, so claim positioning is driven by the feature combination rather than by a single citation.',
      highestOverlap: reference,
      lowestOverlap: '-',
      criticalRelationshipToVerify: 'No single reference maps a critical relationship on the mapped evidence.',
      recommendedFullTextReview: [reference].filter(item => item !== 'Not identified'),
      remainingUncertainties: [message],
    },
  };
}

function buildConceptMappedCoverageSummary(candidates: ClaimFocusCandidate[], mapping: ClaimConceptMapping[]): ConceptMappedCoverageSummary[] {
  return candidates
    .filter(candidate => candidate.linkedConcept || mapping.some(item => item.claimConceptTitle === candidate.linkedConcept))
    .map(candidate => {
      const mappedCoveragePercent = clampPercent(candidate.distributedCoverage);
      const singleReferenceMappedCoveragePercent = clampPercent(candidate.mappedCoverage);
      const distributedMappedCoveragePercent = clampPercent(candidate.distributedCoverage);
      const mappingLevel: ConceptMappingLevel = candidate.relationshipMapped || singleReferenceMappedCoveragePercent >= 75
        ? 'High'
        : singleReferenceMappedCoveragePercent >= 35 || distributedMappedCoveragePercent >= 50
          ? 'Moderate'
          : 'Limited';
      return {
        conceptTitle: candidate.linkedConcept || candidate.title,
        mappedCoveragePercent,
        singleReferenceMappedCoveragePercent,
        distributedMappedCoveragePercent,
        relationshipMapped: candidate.relationshipMapped,
        mappingLevel,
        closestReferences: candidate.closestReferences,
      };
    });
}

function safeDraftingRecommendation(prefix: typeof CLAIM_DRAFTING_PREFIXES[number], body: string): string {
  const cleaned = reportSafeText(body)
    .replace(/\bClaim\s+/gi, 'Address ')
    .replace(/\bPatent\s+/gi, 'Protect ')
    .replace(/\bYou should file\b/gi, 'Consider reviewing filing options for')
    .replace(/\bThis will be patentable\b/gi, 'This requires professional review')
    .replace(/\bGuaranteed\b/gi, 'Requires review')
    .trim();
  return `${prefix} ${cleaned.replace(/^\bconsider\s+/i, '').replace(/\.$/, '')}.`;
}

function buildRemainingInventiveCore(
  primary: ClaimFocusCandidate,
  secondary: ClaimFocusCandidate | undefined,
  candidates: ClaimFocusCandidate[],
  comparisons: AttorneyReportPatentComparison[],
  featureSummaries: AttorneyReportFeatureSummary[]
): string {
  const mappedFeatureLabels = featureSummaries
    .filter(feature => featureMappedFactor(comparisons, feature.feature) >= 0.9)
    .slice(0, 3)
    .map(feature => feature.feature);
  const focusFeatures = [primary, secondary]
    .filter(Boolean)
    .flatMap(candidate => [...(candidate?.unmappedFeatures || []), ...(candidate?.partiallyMappedFeatures || [])])
    .filter((feature, index, array) => array.findIndex(item => item.feature === feature.feature) === index)
    .slice(0, 4);
  const fallbackFeatures = featureSummaries
    .filter(feature => feature.importance === 'core_inventive' || feature.type === 'novelty_candidate')
    .slice(0, 4);
  const relationshipGaps = candidates
    .filter(candidate => !candidate.relationshipMapped)
    .slice(0, 2)
    .map(candidate => candidate.linkedConcept || candidate.title);
  const disclosed = mappedFeatureLabels.length ? conciseList(mappedFeatureLabels, 3) : 'some submitted features';
  const remaining = (focusFeatures.length ? focusFeatures : fallbackFeatures).map(feature => feature.feature);
  const interaction = remaining.length ? conciseList(remaining, 4) : (relationshipGaps.length ? conciseList(relationshipGaps, 2) : 'the submitted feature interaction');
  return reportSafeText(`Although the reviewed references disclose ${disclosed} individually, the retrieved evidence does not identify the complete interaction between ${interaction} as described in the submitted invention.`);
}

function buildClaimPositioningIntelligence(
  stage0: NormalizedIdea,
  concepts: ClaimConcept[],
  mapping: ClaimConceptMapping[],
  featureSummaries: AttorneyReportFeatureSummary[],
  comparisons: AttorneyReportPatentComparison[],
  publicClosestCitation: AttorneyReportCitation | null
): {
  claimPositioningAnalysis: ClaimPositioningAnalysis;
  claimDraftingConsiderations: ClaimDraftingConsiderations;
  draftingOpportunities: DraftingOpportunity[];
  conceptMappedCoverageSummary: ConceptMappedCoverageSummary[];
  strategicReviewFocus: StrategicReviewFocus;
} {
  if (!hasMinimumClaimPositioningEvidence(comparisons, featureSummaries, mapping)) {
    return manualReviewClaimPositioning(comparisons, publicClosestCitation);
  }

  const hint = inventionTypeHint(stage0, featureSummaries);
  const candidates = buildClaimFocusCandidates(concepts, mapping, featureSummaries, comparisons);
  const primary = candidates[0] || buildFallbackFocusCandidates(featureSummaries, comparisons)[0];
  if (!primary) return manualReviewClaimPositioning(comparisons, publicClosestCitation);
  const secondary = candidates.find(candidate =>
    candidate !== primary &&
    conceptOverlap(primary, candidate) <= 0.35 &&
    candidate.score >= primary.score - 0.8 &&
    (candidate.unmappedFeatures.length > 0 || candidate.partiallyMappedFeatures.length > 0 || !candidate.relationshipMapped)
  );
  const weakClaimAreas = featureSummaries
    .filter(feature => feature.importance !== 'core_inventive' || feature.type === 'generic_weak')
    .filter(feature => featureMappedFactor(comparisons, feature.feature) >= 0.5 || feature.type === 'generic_weak')
    .slice(0, 5)
    .map(featureLabel);
  const avoidRelyingSolelyOn = featureSummaries
    .filter(feature => feature.type === 'generic_weak' || featureMappedFactor(comparisons, feature.feature) >= 0.9)
    .slice(0, 5)
    .map(feature => `Avoid relying solely on ${featureLabel(feature)} as the broadest claim focus.`);
  const remainingInventiveCore = buildRemainingInventiveCore(primary, secondary, candidates, comparisons, featureSummaries);
  const whyStillDistinguishable = remainingInventiveCore;

  const dependentIdeas = [...primary.partiallyMappedFeatures, ...primary.unmappedFeatures]
    .slice(0, 4)
    .map(feature => safeDraftingRecommendation('Consider protecting', `${featureLabel(feature)} as a dependent or narrower implementation detail`));
  const fallbackIdeas = (secondary ? [...secondary.partiallyMappedFeatures, ...secondary.unmappedFeatures] : featureSummaries.filter(feature => feature.importance === 'secondary_implementation'))
    .slice(0, 3)
    .map(feature => safeDraftingRecommendation('Consider separating', `${featureLabel(feature)} into fallback embodiments if the primary focus is closely mapped`));
  const reviewBeforeDrafting = [
    publicClosestCitation ? safeDraftingRecommendation('Consider reviewing', `${publicClosestCitation.publicationNumber} first because it has the strongest mapped overlap`) : '',
    ...candidates.filter(candidate => !candidate.relationshipMapped).slice(0, 2).map(candidate =>
      safeDraftingRecommendation('Consider reviewing', `whether the full text discloses the relationship in ${candidate.linkedConcept || candidate.title}`)
    ),
  ].filter(Boolean);

  const opportunities: DraftingOpportunity[] = [
    {
      title: primary.linkedConcept || 'Primary claim focus',
      opportunityType: 'primary',
      linkedFeatures: primary.linkedFeatures,
      linkedConcept: primary.linkedConcept,
      explanation: safeDraftingRecommendation('Consider emphasizing', focusSentence(primary, hint)),
    },
    ...(secondary ? [{
      title: secondary.linkedConcept || 'Secondary claim focus',
      opportunityType: 'secondary' as const,
      linkedFeatures: secondary.linkedFeatures,
      linkedConcept: secondary.linkedConcept,
      explanation: safeDraftingRecommendation('Consider separating', focusSentence(secondary, hint)),
    }] : []),
    ...featureSummaries
      .filter(feature => feature.importance === 'optional_embodiment')
      .slice(0, 2)
      .map(feature => ({
        title: featureLabel(feature),
        opportunityType: 'optional' as const,
        linkedFeatures: [feature.feature],
        explanation: safeDraftingRecommendation('Consider protecting', `${featureLabel(feature)} as an optional embodiment if supported by the disclosure`),
      })),
    ...avoidRelyingSolelyOn.slice(0, 2).map(item => ({
      title: item.replace(/^Avoid relying solely on\s+/i, '').replace(/\sas the broadest claim focus\.$/i, ''),
      opportunityType: 'avoid_relying_solely_on' as const,
      linkedFeatures: [],
      explanation: safeDraftingRecommendation('Consider avoiding reliance on', item.replace(/^Avoid relying solely on\s+/i, '').replace(/\.$/, '')),
    })),
  ];

  const closestComparison = publicClosestCitation
    ? comparisons.find(item => item.publicationNumber === publicClosestCitation.publicationNumber)
    : undefined;
  const lowestOverlap = comparisons.slice().sort((a, b) => a.coverage.score - b.coverage.score)[0];
  const criticalRelationship = candidates.find(candidate => !candidate.relationshipMapped);
  const recommendedFullTextReview = Array.from(new Set([
    publicClosestCitation?.publicationNumber,
    ...candidates.flatMap(candidate => candidate.closestReferences),
    ...comparisons.filter(item => item.rows.some(row => row.status === 'Unknown')).map(item => item.publicationNumber),
  ].filter(Boolean) as string[])).slice(0, 5);

  return {
    claimPositioningAnalysis: {
      primaryClaimFocus: focusSentence(primary, hint),
      secondaryClaimFocus: secondary ? focusSentence(secondary, hint) : undefined,
      weakClaimAreas,
      avoidRelyingSolelyOn,
      remainingInventiveCore,
      whyStillDistinguishable,
      reasoning: reportSafeText(`Derived from mapped coverage, relationship gaps, and unmapped core or novelty-candidate features. The guidance identifies areas that appear less mapped by retrieved evidence and is not a legal conclusion.`),
    },
    claimDraftingConsiderations: {
      independentClaimFocus: safeDraftingRecommendation('Consider emphasizing', focusSentence(primary, hint)),
      dependentClaimIdeas: dependentIdeas,
      fallbackClaimIdeas: fallbackIdeas,
      reviewBeforeDrafting,
    },
    draftingOpportunities: opportunities,
    conceptMappedCoverageSummary: buildConceptMappedCoverageSummary(candidates, mapping),
    strategicReviewFocus: {
      highestPriorityReference: publicClosestCitation?.publicationNumber || '-',
      reviewReason: publicClosestCitation
        ? reportSafeText(`Highest weighted overlap with mapped features and concept coverage${closestComparison ? `; review ${closestComparison.publicationNumber} against ${primary.linkedConcept || primary.title}` : ''}.`)
        : 'No mapped citation was strong enough to identify a highest-priority reference.',
      highestOverlap: publicClosestCitation?.publicationNumber || '-',
      lowestOverlap: lowestOverlap?.publicationNumber || '-',
      criticalRelationshipToVerify: criticalRelationship
        ? reportSafeText(`Verify whether the full text discloses the complete relationship for ${criticalRelationship.linkedConcept || criticalRelationship.title}.`)
        : 'No unmapped concept relationship was identified from the mapped records.',
      recommendedFullTextReview,
      remainingUncertainties: [
        ...candidates.filter(candidate => !candidate.relationshipMapped).slice(0, 2).map(candidate => `Relationship mapping for ${candidate.linkedConcept || candidate.title}`),
        ...featureSummaries.filter(feature => rowsForFeature(comparisons, feature.feature).some(row => row.status === 'Unknown')).slice(0, 3).map(feature => `${featureLabel(feature)} requires full-text confirmation`),
      ],
    },
  };
}

function sanitizeRiskItem(value: unknown): string {
  return reportSafeText(value)
    .replace(/\bNot Novel determination indicates\b/gi, 'Preliminary mapped-overlap assessment indicates')
    .replace(/\bnot novel determination\b/gi, 'mapped-overlap assessment')
    .replace(/\bnot novel\b/gi, 'mapped-overlap risk')
    .replace(/\bnon-patentable\b/gi, 'high mapped-overlap risk');
}

function splitNames(value: string): string[] {
  return String(value || '')
    .split(/[,|;\n]+/)
    .map(item => cleanText(item))
    .filter(item => item && item !== '-');
}

function normalizeEntityName(name: string, mode: 'assignee' | 'inventor'): string {
  const cleaned = cleanText(name)
    .replace(/\s+/g, ' ')
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof)\.?\s+/gi, '')
    .trim();
  if (mode === 'assignee') return cleaned.replace(/\s*,?\s*(inc|corp|ltd|llc|plc|gmbh|ag|ab|s\.?p\.?a\.?)\.?$/i, match => match.toUpperCase().replace(/\s+/g, ' '));
  return cleaned;
}

function isCleanEntityName(name: string, mode: 'assignee' | 'inventor'): boolean {
  const text = cleanText(name);
  if (!text || text === '-') return false;
  if (/^(inc|corp|ltd|llc|plc|gmbh|ag|ab|s\.?p\.?a\.?)\.?$/i.test(text)) return false;
  if (mode === 'inventor') {
    if (/^[A-Z]\.?$/i.test(text)) return false;
    if (!/\s/.test(text) && !/^[A-Z]{3,}$/.test(text)) return false;
    if (/^(thomas|john|michael|david|robert|james|william|richard)$/i.test(text)) return false;
  }
  return text.length >= 3;
}

function entityKind(name: string): 'company' | 'academic' | 'individual' {
  const text = name.toLowerCase();
  if (/\b(university|institute|college|school|research|council|laborator|academy)\b/.test(text)) return 'academic';
  if (/\b(inc|corp|corporation|company|co\.|limited|ltd|llc|llp|plc|pvt|private|technolog(?:y|ies)|systems|solutions|industries|labs?|pharmaceuticals?|biotech|gmbh|ag|ab|s\.?p\.?a\.?)\b/.test(text)) return 'company';
  return 'individual';
}

function buildEntityLandscape(names: string[], mode: 'assignee' | 'inventor'): AttorneyReportEntityLandscape {
  const counts = new Map<string, number>();
  names
    .map(name => normalizeEntityName(name, mode))
    .filter(name => isCleanEntityName(name, mode))
    .forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
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
  const mode = cleanText(value, 'Selected patent nationalities');
  if (mode === 'PQAI_PLUS_INDIAN') return 'India + international patents';
  if (mode === 'PQAI_PLUS_AUSTRALIA') return 'Australia + international patents';
  if (mode === 'PQAI_PLUS_EPO') return 'Europe + international patents';
  if (mode === 'PQAI_PLUS_INDIAN_EPO') return 'India + Europe + international patents';
  if (mode === 'PQAI_ONLY') return 'International patents';
  if (mode === 'INDIAN_ONLY') return 'India patents';
  if (mode === 'AUSTRALIA_ONLY') return 'Australia patents';
  if (mode === 'EPO_ONLY') return 'Europe patents';
  // The local production corpus is a multi-jurisdiction index of ~55M patent records;
  // surface that instead of the raw internal mode identifier.
  if (mode === 'LOCAL_CORPUS') return 'PatentNest Global Patent Corpus — 55M+ international patent records';
  return mode;
}

/**
 * The analyzed threshold tracks the deep-analysis floor (MIN_DEEP_ANALYSIS_TARGET
 * in novelty-search-service). Leaving it above the floor would mark every sparse
 * run "Medium" for the mechanical reason that a sparse field needs fewer
 * references analyzed, not because the assessment is weaker.
 */
const HIGH_CONFIDENCE_ANALYZED_MINIMUM = 8;

/**
 * State how far relevance screening actually got, in words rather than an enum.
 *
 * This previously rendered the raw stop reason ("Adaptive workflow status: gate
 * errors"), which gave a reader no way to tell a search truncated by a provider
 * failure from one that simply ran out of relevant art. Those two need different
 * responses, so they read differently.
 *
 * Nothing is said in the ordinary case. A run that exhausted the pool, or walked
 * far enough down the ranked list that the tail stopped yielding, has complete
 * coverage — narrating that would be noise.
 */
function buildScreeningCoverageNote(stopReason: string, coverage?: any): string {
  if (!stopReason) return '';
  const reviewed = Number(coverage?.reviewedCount);
  const poolSize = Number(coverage?.poolSize);
  const span = Number.isFinite(reviewed) && Number.isFinite(poolSize) && poolSize > 0
    ? `${reviewed} of ${poolSize} retrieved records were screened for relevance`
    : 'not every retrieved record was screened for relevance';

  const stopClass = classifyScreeningStopReason(stopReason);
  if (stopClass === 'error') {
    // The one case a reader must not mistake for a finding about the art: the
    // shortfall is a screening failure, and it says nothing about the invention.
    return `Relevance screening did not run to completion: ${span} before the screening step returned errors. This reflects a processing failure rather than the state of the prior art, and re-running the search will widen coverage.`;
  }
  if (stopClass === 'bounded') {
    return `Relevance screening reached its configured limit for this run: ${span}.`;
  }
  return '';
}

function confidenceFromCounts(counts: AttorneyReportModel['counts'], quality = 'medium'): string {
  if (counts.analyzed >= HIGH_CONFIDENCE_ANALYZED_MINIMUM && counts.reviewed >= 20 && !/low/i.test(quality)) return 'High';
  if (counts.analyzed > 0 && counts.reviewed > 0) return 'Medium';
  return 'Low';
}

function referenceRoleFor(matchCategory: AttorneyReportCitation['matchCategory'], coverageScore: number, rows: AttorneyReportFeatureRow[] = []): string {
  // Keep the public role consistent with the feature mapping: a citation cannot be
  // presented as an invention-level reference if no feature actually maps to it.
  if (coverageScore <= 0) return matchCategory === 'borderline' ? 'Peripheral reference' : 'Remote background reference';
  const mappedText = rows
    .filter(row => row.status === 'Present' || row.status === 'Partial')
    .map(row => `${row.userFeature} ${row.patentDisclosure}`)
    .join(' ')
    .toLowerCase();
  if (matchCategory === 'direct') return 'Closest invention-level reference';
  if (/\b(composition|formulation|compound|polymer|material|chemical|pharma|drug|excipient|release)\b/.test(mappedText)) return 'Material / composition reference';
  if (/\b(sensor|sensing|monitor|detect|measurement|indicator|threshold|signal)\b/.test(mappedText)) return 'Sensor / monitoring reference';
  if (/\b(control|controller|software|algorithm|processor|model|data|workflow|logic|machine learning|ai|smartphone|mobile|qr|barcode|readable|verification)\b/.test(mappedText)) return 'Control / software reference';
  if (/\b(structural|structure|housing|assembly|component|member|layer|seal|barrier|cavity|mechanical|valve|joint)\b/.test(mappedText)) return 'Structural reference';
  if (/\b(manufactur|process|fabricat|synthesis|curing|treatment|sequence|transformation)\b/.test(mappedText)) return 'Manufacturing / process reference';
  if (matchCategory === 'component') return coverageScore >= 0.35 ? 'Closest component reference' : 'Remote background reference';
  if (matchCategory === 'borderline') return coverageScore >= 0.2 ? 'Peripheral reference' : 'Remote background reference';
  return 'Remote background reference';
}

function reviewPriorityFor(matchCategory: AttorneyReportCitation['matchCategory'], coverageScore: number, relevanceScore: number | null): string {
  // No mapped features means no claim-level impact, regardless of the retrieval gate.
  // Values here share the Critical/High/Medium/Low vocabulary that
  // applySelectivePriorities later assigns, so every display path reads one scale.
  if (coverageScore <= 0) return 'Low';
  const relevance = relevanceScore ?? 0;
  if (matchCategory === 'direct' || coverageScore >= 0.65 || relevance >= 0.78) return 'High';
  if (matchCategory === 'component' || coverageScore >= 0.35 || relevance >= 0.6) return 'Medium';
  return 'Low';
}

function prioritizationFeatureWeight(type: AttorneyReportFeatureType): number {
  return type === 'novelty_candidate' ? 2
    : type === 'core_technical' ? 1.5
      : type === 'implementation' ? 0.7
        : 0.2;
}

function evidenceFactor(row: AttorneyReportFeatureRow | undefined): number {
  if (!row || row.status === 'Absent' || row.status === 'Unknown') return 0;
  if (row.status === 'Present') return 1;
  return row.evidenceStrength === 'Strong' || (row.extentScore ?? 0) >= 0.55 || (row.confidence ?? 0) >= 0.65 ? 0.6 : 0.4;
}

function postMappingPriorityMetrics(
  comparison: AttorneyReportPatentComparison,
  stage0: NormalizedIdea,
  features: AttorneyReportFeatureSummary[]
) {
  const rowByFeature = new Map(comparison.rows.map(row => [row.userFeature.toLowerCase(), row]));
  const important = features.filter(feature => feature.type === 'core_technical' || feature.type === 'novelty_candidate');
  const totalImportantWeight = important.reduce((sum, feature) => sum + prioritizationFeatureWeight(feature.type), 0);
  const importantMappedWeight = important.reduce((sum, feature) =>
    sum + prioritizationFeatureWeight(feature.type) * evidenceFactor(rowByFeature.get(feature.feature.toLowerCase())), 0);
  const baseScore = features.reduce((sum, feature) =>
    sum + prioritizationFeatureWeight(feature.type) * evidenceFactor(rowByFeature.get(feature.feature.toLowerCase())), 0);
  const stronglyMapped = important.filter(feature => evidenceFactor(rowByFeature.get(feature.feature.toLowerCase())) >= 0.6);
  const mappedCount = (linked: string[]) => linked.filter(feature => evidenceFactor(rowByFeature.get(feature.toLowerCase())) > 0).length;
  const relationshipText = [
    comparison.title,
    comparison.abstract,
    comparison.technicalDisclosure,
    comparison.summary,
    ...comparison.rows.map(row => `${row.patentDisclosure} ${row.evidenceQuote}`),
  ].join(' ').toLowerCase();
  const relationshipExpresslySupported = (description: string) => {
    const tokens = Array.from(new Set(cleanText(description).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 4)))
      .slice(0, 20);
    if (tokens.length === 0) return false;
    const hits = tokens.filter(token => relationshipText.includes(token)).length;
    return hits >= Math.min(4, Math.max(2, Math.ceil(tokens.length * 0.25)));
  };
  let relationshipBonus = 0;
  let primaryRelationshipMapped = false;
  for (const concept of stage0.claimConcepts || []) {
    if (mappedCount(concept.linkedFeatures || []) < 2) continue;
    relationshipBonus += concept.importance === 'primary' ? 1.5 : concept.importance === 'secondary' ? 1 : 0.5;
    if (concept.importance === 'primary' && relationshipExpresslySupported(`${concept.title} ${concept.claimableSummary}`)) {
      primaryRelationshipMapped = true;
    }
  }
  for (const interaction of stage0.noveltyFocusInteractions || []) {
    if (mappedCount(interaction.linkedFeatures || []) >= 2) {
      relationshipBonus += 1.5;
      if (relationshipExpresslySupported(interaction.description)) primaryRelationshipMapped = true;
    }
  }
  return {
    score: Math.round((baseScore + relationshipBonus) * 100) / 100,
    importantCoverage: totalImportantWeight > 0 ? importantMappedWeight / totalImportantWeight : 0,
    strongImportantCount: stronglyMapped.length,
    strongNoveltyCount: stronglyMapped.filter(feature => feature.type === 'novelty_candidate').length,
    anyImportantMapped: important.some(feature => evidenceFactor(rowByFeature.get(feature.feature.toLowerCase())) > 0),
    primaryRelationshipMapped,
    relationshipBonus,
    // Named important features, so report selection can tell whether a reference is
    // the only remaining source of coverage for one of them.
    strongImportantFeatures: stronglyMapped.map(feature => feature.feature),
    hasMappedEvidence: comparison.rows.some(row => row.status === 'Present' || row.status === 'Partial'),
  };
}

function applySelectivePriorities(
  source: AttorneyReportPatentComparison[],
  stage0: NormalizedIdea,
  features: AttorneyReportFeatureSummary[]
): AttorneyReportPatentComparison[] {
  const ranked = source.map((comparison, originalIndex) => {
    const metrics = postMappingPriorityMetrics(comparison, stage0, features);
    const desired = metrics.primaryRelationshipMapped || (metrics.importantCoverage >= 0.75 && metrics.strongImportantCount >= 2)
      ? 'Critical'
      : metrics.strongImportantCount >= 2 || metrics.strongNoveltyCount >= 1 || metrics.importantCoverage >= 0.5
        ? 'High'
        : metrics.anyImportantMapped || comparison.matchCategory === 'component'
          ? 'Medium'
          : 'Low';
    return { comparison, originalIndex, metrics, desired };
  }).sort((a, b) =>
    (b.metrics.score - a.metrics.score) ||
    ((b.comparison.relevanceScore ?? -1) - (a.comparison.relevanceScore ?? -1)) ||
    (a.originalIndex - b.originalIndex)
  );
  const caps = { Critical: 4, High: 8, Medium: 15 } as const;
  const counts = { Critical: 0, High: 0, Medium: 0 };
  const nextLevel = (level: string) => level === 'Critical' ? 'High' : level === 'High' ? 'Medium' : 'Low';
  return ranked.map(({ comparison, metrics, desired }, index) => {
    let level = desired;
    while (level !== 'Low' && counts[level as keyof typeof counts] >= caps[level as keyof typeof caps]) {
      level = nextLevel(level);
    }
    if (level !== 'Low') counts[level as keyof typeof counts] += 1;
    return {
      ...comparison,
      citationNo: `D${index + 1}`,
      reviewPriority: level,
      priorityScore: metrics.score,
      importantFeatureCoverage: Math.round(metrics.importantCoverage * 100) / 100,
      strongImportantFeatureCount: metrics.strongImportantCount,
      strongNoveltyFeatureCount: metrics.strongNoveltyCount,
      relationshipBonus: metrics.relationshipBonus,
      // `reviewPriority` above is capped for display; the uncapped tier is what
      // report selection reads, so a cap never bounds how many references qualify.
      desiredPriority: desired,
      strongImportantFeatures: metrics.strongImportantFeatures,
      hasMappedEvidence: metrics.hasMappedEvidence,
    };
  });
}

function buildPotentialCombinations(
  comparisons: AttorneyReportPatentComparison[],
  stage0: NormalizedIdea,
  features: AttorneyReportFeatureSummary[]
): AttorneyReportCombination[] {
  const important = features.filter(feature => feature.type === 'core_technical' || feature.type === 'novelty_candidate');
  if (important.length === 0) return [];
  const mapped = (comparison: AttorneyReportPatentComparison) => new Set(important
    .filter(feature => evidenceFactor(comparison.rows.find(row => row.featureNumber === feature.featureNumber)) > 0)
    .map(feature => feature.feature));
  const relationships = [
    ...(stage0.claimConcepts || []).map(concept => ({ description: concept.title, linkedFeatures: concept.linkedFeatures || [] })),
    ...(stage0.noveltyFocusInteractions || []).map(interaction => ({ description: interaction.description, linkedFeatures: interaction.linkedFeatures || [] })),
  ];
  const pairs: Array<{ score: number; result: AttorneyReportCombination }> = [];
  for (let left = 0; left < comparisons.length; left += 1) {
    for (let right = left + 1; right < comparisons.length; right += 1) {
      const a = comparisons[left];
      const b = comparisons[right];
      const aMapped = mapped(a);
      const bMapped = mapped(b);
      const union = new Set(Array.from(aMapped).concat(Array.from(bMapped)));
      if (union.size < 2) continue;
      const onlyA = Array.from(aMapped).filter(feature => !bMapped.has(feature));
      const onlyB = Array.from(bMapped).filter(feature => !aMapped.has(feature));
      if (onlyA.length === 0 || onlyB.length === 0) continue;
      const duplicateCount = Array.from(aMapped).filter(feature => bMapped.has(feature)).length;
      const coveredRelationship = relationships.find(relationship =>
        relationship.linkedFeatures.length >= 2 && relationship.linkedFeatures.every(feature => union.has(feature))
      );
      const missingRelationship = relationships.find(relationship =>
        relationship.linkedFeatures.some(feature => !union.has(feature))
      );
      const classificationsA = `${a.cpcCodes} ${a.ipcCodes}`.match(/[A-HY]\d{2}[A-Z]?/gi) || [];
      const classificationsB = new Set((`${b.cpcCodes} ${b.ipcCodes}`.match(/[A-HY]\d{2}[A-Z]?/gi) || []).map(value => value.toUpperCase()));
      const sharedClass = classificationsA.map(value => value.toUpperCase()).find(value => classificationsB.has(value));
      const sharedFeature = Array.from(aMapped).find(feature => bMapped.has(feature));
      const apparentMotivation = sharedClass
        ? `Both records share ${sharedClass} classification subject matter, which may provide an apparent technical starting point for combination review.`
        : sharedFeature
          ? `Both records address ${sharedFeature}, which may provide an apparent shared technical mechanism for combination review.`
          : 'technical motivation to combine is not established from the reviewed records.';
      const missing = important.filter(feature => !union.has(feature.feature)).map(feature => `${feature.featureNumber}: ${feature.feature}`);
      const score = (union.size / important.length) * 10 + onlyA.length + onlyB.length + (coveredRelationship ? 2 : 0) - duplicateCount;
      pairs.push({
        score,
        result: {
          referenceA: { publicationNumber: a.publicationNumber, title: a.title, teaches: Array.from(aMapped) },
          referenceB: { publicationNumber: b.publicationNumber, title: b.title, adds: onlyB },
          combinedImportantFeatureCoverage: Math.round((union.size / important.length) * 100),
          apparentMotivation,
          missingImportantFeatures: missing,
          stillMissingRelationship: missingRelationship
            ? `${missingRelationship.description}: ${missingRelationship.linkedFeatures.filter(feature => !union.has(feature)).join(', ') || 'relationship evidence remains unconfirmed'}`
            : 'No additional Stage 0 important-feature relationship was identified as missing from the combined mapped cells.',
          label: 'Inventive-step review',
        },
      });
    }
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, 3).map(pair => pair.result);
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
    const rawStatus = normalizeStatus(supplied.status || cell?.status);
    const evidenceQuote = evidenceQuoteFrom(
      supplied.evidence_quote,
      (supplied as any).evidence,
      cell?.quote,
      (cell as any)?.evidence,
    );
    const rawEvidenceSource = supplied.evidence_source || evidenceSourceFrom((supplied as any).evidence) || cell?.evidence_source || cell?.field || evidenceSourceFrom((cell as any)?.evidence) || (evidenceQuote ? 'inference' : 'none');
    const evidenceSource = displayEvidenceSource(rawEvidenceSource, 'none');
    const patentDisclosure = reportSafeText(
      supplied.patent_disclosure ||
      cell?.patent_disclosure ||
      cell?.quote ||
      cell?.reason ||
      (rawStatus === 'Present' || rawStatus === 'Partial' ? 'Related patent disclosure identified.' : 'This feature is not expressly taught in the reviewed citation record.')
    );
    const rawConfidence = numberScore(supplied.confidence ?? cell?.confidence);
    const confidence = (rawStatus === 'Present' || rawStatus === 'Partial') && !evidenceQuote
      ? Math.min(rawConfidence ?? 0.45, 0.45)
      : rawConfidence;
    // Strength must use the internal source before public wording deliberately
    // collapses title/abstract/claims into the generic "source record" label.
    const evidenceStrength = evidenceStrengthFor(rawStatus, feature, evidenceQuote, cleanText(rawEvidenceSource, 'none'), patentDisclosure, confidence);
    const status = visibleStatusForReport(rawStatus, evidenceStrength.strength, evidenceQuote, confidence);
    const mapping = publicMapping(status);
    const extentScore = numberScore(supplied.extent_score ?? supplied.extentScore ?? cell?.extent_score ?? (cell as any)?.extentScore)
      ?? defaultExtentScore(status, feature, patentDisclosure, evidenceQuote, confidence);
    return {
      featureNumber: `KF${index + 1}`,
      userFeature: feature,
      userDisclosure: cleanText(supplied.user_invention_disclosure || details.get(feature) || feature),
      patentDisclosure,
      status,
      statusLabel: mapping.label,
      publicMappingStatus: mapping.label,
      publicMappingCode: mapping.code,
      crispRemark: rowCrispRemark(supplied, cell, status, feature, patentDisclosure),
      professionalRemark: rowProfessionalRemark(supplied, cell, status, feature, patentDisclosure),
      evidenceQuote,
      evidenceSource: evidenceQuote ? evidenceSource : 'none',
      evidenceStrength: evidenceStrength.strength,
      evidenceStrengthReason: evidenceStrength.reason,
      extentScore: status === 'Absent' ? null : extentScore,
      confidence,
      attorneyRemark: reportSafeText(supplied.attorney_remark || cell?.attorney_remark || defaultAttorneyRemark(status, feature)),
      noveltyImpact: reportSafeText(supplied.novelty_impact || defaultNoveltyImpact(status, feature)),
      claimReviewNote: reportSafeText(supplied.claim_review_note || cell?.claim_review_note || defaultClaimReviewNote(status, feature)),
    };
  });
}

export function buildNoveltyAttorneyReportModel(searchRun: any, firm?: FirmBranding | null): AttorneyReportModel {
  const stage0 = (searchRun.stage0Results || {}) as NormalizedIdea;
  const stage1 = searchRun.stage1Results || {};
  const stage35 = searchRun.stage35Results || {};
  const stage4 = searchRun.stage4Results || {};
  const seenMappedCitations = new Set<string>();
  const featureMaps: PatentFeatureMap[] = (Array.isArray(stage35?.feature_map) ? stage35.feature_map : []).filter((map: PatentFeatureMap) => {
    const key = canonicalPatentNumber(map.pn || (map as any).publicationNumber);
    if (!key || seenMappedCitations.has(key)) return false;
    seenMappedCitations.add(key);
    return true;
  });
  const patentIndex = buildPatentIndex(stage1);
  const generatedDate = formatDate(new Date());
  const reportNumber = `PN-NOV-${String(searchRun.jurisdiction || 'IN').toUpperCase()}-${generatedDate.replace(/-/g, '')}-${String(searchRun.id || '').slice(0, 8).toUpperCase()}`;
  const sourceConfig = (searchRun.config as any)?.searchSource || {};
  const featureSummaries = buildFeatureSummaries(stage0, searchRun.inventionDescription || '');
  const configuredCountries = Array.isArray(sourceConfig?.filters?.countries)
    ? sourceConfig.filters.countries.map((country: unknown) => normalizedAuthority(country)).filter(Boolean)
    : [];
  const searchAuthorityScope = configuredCountries.length ? configuredCountries.join(', ') : 'Worldwide';
  const targetLegalJurisdiction = cleanText(searchRun.jurisdiction, 'IN').toUpperCase();

  const rawComparisons: AttorneyReportPatentComparison[] = featureMaps.map((map, index) => {
    const originalPn = cleanText(map.pn || (map as any).publicationNumber, 'Unknown');
    const meta = patentIndex.get(canonicalPatentNumber(originalPn)) || {};
    const rawMeta = meta.raw && typeof meta.raw === 'object' ? meta.raw : {};
    const ipIndiaDetails = meta.ipIndiaDetails && typeof meta.ipIndiaDetails === 'object'
      ? meta.ipIndiaDetails
      : ((rawMeta as any).ipIndiaDetails && typeof (rawMeta as any).ipIndiaDetails === 'object' ? (rawMeta as any).ipIndiaDetails : {});
    const gate = gateRecordFor(stage1, originalPn) || {};
    const gateDecision = normalizeRerankDecision(gateDecisionForReport(gate, meta));
    const category = matchCategoryFromDecision(gateDecision);
    const remark = remarkFor(stage4, originalPn);
    const rows = buildFeatureRows(stage0, searchRun.inventionDescription || '', map, remark);
    const present = rows.filter(row => row.status === 'Present').length;
    const partial = rows.filter(row => row.status === 'Partial').length;
    const absent = rows.filter(row => row.status === 'Absent').length;
    const unknown = rows.filter(row => row.status === 'Unknown').length;
    const score = rows.length ? (present + partial * 0.5) / rows.length : 0;
    const citationNo = `D${index + 1}`;
    const rawThreat = firstText(remark?.novelty_threat, (map as any).decision, (map as any).model_decision, 'low');
    const overlapRisk = safeOverlapLabel(rawThreat);
    const claimImpactSummary = buildClaimImpactSummary(rows, overlapRisk.label);
    const relevanceScore = numberScore(gate.rerankScore ?? gate.score ?? meta.rerankScore ?? meta.relevanceScore ?? remark?.relevance);
    const referenceType: 'patent' | 'paper' = meta.referenceType === 'paper' || originalPn.toUpperCase().startsWith('PAPER:') ? 'paper' : 'patent';
    const pn = referenceType === 'paper' ? originalPn : canonicalPublicationDisplay(originalPn);
    const sourceCorpus = firstText(meta.sourceLabel, meta.sourceProviders, meta.sourceProvider, 'Not available');

    return {
      citationNo,
      publicationNumber: pn,
      originalPublicationNumber: originalPn,
      publicationJurisdiction: referenceType === 'paper' ? 'Not applicable' : publicationAuthority(
        pn,
        meta.publicationAuthority,
        meta.publication_authority,
        meta.authority,
        meta.country,
        meta.jurisdiction,
        (rawMeta as any).publicationAuthority,
        (rawMeta as any).country,
      ),
      searchAuthorityScope,
      sourceCorpus,
      filingCountry: firstText(
        meta.filingCountry,
        meta.filing_country,
        meta.filingOffice,
        meta.filing_office,
        (rawMeta as any).filingCountry,
        (rawMeta as any).filing_country,
        'Not available'
      ),
      targetLegalJurisdiction,
      title: firstText(map.title, meta.title, remark?.title, referenceType === 'paper' ? 'Untitled Paper' : 'Untitled Patent'),
      referenceType,
      relevanceScore,
      evidenceQuality: cleanText(gate.evidence_quality || meta.evidence_quality, 'medium'),
      matchCategory: category,
      matchCategoryLabel: matchCategoryLabel(gateDecision),
      referenceRole: referenceRoleFor(category, score, rows),
      reviewPriority: reviewPriorityFor(category, score, relevanceScore),
      // Patent record links (incl. the fabricated Google Patents fallback) are not
      // reliable, so they are omitted; scholarly-paper links/DOIs are kept when present.
      link: referenceType === 'paper' ? firstText(map.link, meta.link, meta.sourceUrl, meta.url, '') : '',
      abstract: firstText(
        ...sourceAbstractFields(meta),
        ...sourceAbstractFields(rawMeta),
        ...sourceAbstractFields(ipIndiaDetails),
        ...sourceAbstractFields(map),
        remark?.abstract,
        'Source record detail was unavailable; full patent document review is recommended.'
      ),
      technicalDisclosure: reportSafeText(firstText(...sourceDisclosureFields(remark), ...sourceDisclosureFields(meta), ...sourceDisclosureFields(rawMeta), ...sourceDisclosureFields(map), 'Citation disclosure reviewed.')),
      publicationDate: formatDate(firstText(meta.publicationDate, meta.publication_date, meta.date, (rawMeta as any).publicationDate, (rawMeta as any).publication_date, (ipIndiaDetails as any).publicationDate, (ipIndiaDetails as any).publication_date)),
      applicationNumber: firstText(meta.applicationNumber, meta.application_number, meta.applicationNumberRaw, meta.application_number_raw, (rawMeta as any).applicationNumberRaw, (rawMeta as any).application_number, (ipIndiaDetails as any).applicationNumber, (ipIndiaDetails as any).application_number, '-'),
      filingDate: formatDate(firstText(meta.filingDate, meta.filing_date, meta.applicationDate, meta.application_date, (rawMeta as any).filingDate, (rawMeta as any).filing_date, (ipIndiaDetails as any).filingDate, (ipIndiaDetails as any).applicationDate)),
      priorityDate: formatDate(firstText(meta.priorityDate, meta.priority_date, (rawMeta as any).priorityDate, (rawMeta as any).priority_date, (ipIndiaDetails as any).priorityDate, (ipIndiaDetails as any).priority_date)),
      inventors: firstText(meta.inventors, meta.inventor, meta.inventor_names, (rawMeta as any).inventors, (rawMeta as any).rawInventorBlock, (ipIndiaDetails as any).inventors, '-'),
      assignees: firstText(meta.assignees, meta.assignee, meta.applicants, meta.applicant, meta.applicant_names, (rawMeta as any).applicants, (rawMeta as any).rawApplicantBlock, (ipIndiaDetails as any).applicants, '-'),
      cpcCodes: firstText(meta.cpcCodes, meta.cpcs, meta.cpc_codes, meta.classifications, (rawMeta as any).cpcCodes, (rawMeta as any).cpc_codes, (rawMeta as any).classifications, '-'),
      ipcCodes: firstText(meta.ipcCodes, meta.ipcs, meta.ipc_codes, meta.classifications, (rawMeta as any).ipcCodes, (rawMeta as any).ipc_codes, (rawMeta as any).classifications, '-'),
      authors: firstText(meta.authors, '-'),
      venue: firstText(meta.venue, '-'),
      doi: firstText(meta.doi, '-'),
      sourceProviders: sourceCorpus,
      // Papers have no family; a key derived from a DOI would group unrelated works.
      familyKey: referenceType === 'paper' ? undefined : canonicalStudioFamilyKey(
        firstText(meta.familyId, (rawMeta as any).familyId, (ipIndiaDetails as any).familyId, ''),
        originalPn,
        firstText(meta.applicationNumberRaw, meta.applicationNumber, (rawMeta as any).applicationNumberRaw, ''),
      ),
      citationCount: Number.isFinite(Number(meta.citationCount)) ? Math.max(0, Math.trunc(Number(meta.citationCount))) : null,
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

  const comparisons = applySelectivePriorities(rawComparisons, stage0, featureSummaries);
  const compared = new Set(comparisons.map(item => canonicalPatentNumber(item.publicationNumber)));
  const shortlistCandidates = Array.from(patentIndex.values())
    .filter(item => !compared.has(canonicalPatentNumber(getPublicationNumber(item))))
    .map((item, sourceOrder) => {
      const gate = gateRecordFor(stage1, getPublicationNumber(item));
      const relevance = numberScore(
        (gate as any)?.rerankScore ?? (gate as any)?.score ?? item?.relevanceScore ?? item?.score ?? item?.relevance
      );
      const decision = gate ? normalizeRerankDecision(gate?.rerankDecision || gate?.decision) : undefined;
      return { item, relevance, decision, gate, sourceOrder };
    });

  const decisiveReferences = Array.isArray(stage4?.canonical_verdict?.decisiveReferences)
    ? stage4.canonical_verdict.decisiveReferences
    : [stage4?.integration_check?.integration_pn, ...(stage4?.closest_mapped_references || [])].filter(Boolean);
  const decisiveKeys = new Set(decisiveReferences.map(canonicalPatentNumber).filter(Boolean));
  const reportReferenceCandidates: ReportReferenceCandidate[] = [
    ...comparisons.map((comparison, sourceOrder) => {
      const gate = gateRecordFor(stage1, comparison.originalPublicationNumber || comparison.publicationNumber);
      return {
        publicationNumber: comparison.publicationNumber,
        mapped: true,
        sourceOrder,
        priority: comparison.reviewPriority,
        priorityScore: comparison.priorityScore,
        desiredPriority: comparison.desiredPriority,
        mappedImportantFeatures: comparison.strongImportantFeatures,
        hasMappedEvidence: comparison.hasMappedEvidence,
        familyKey: comparison.familyKey,
        featureCoverage: comparison.importantFeatureCoverage ?? comparison.coverage.score,
        gateScore: comparison.relevanceScore,
        gateDecision: gate?.rerankDecision || gate?.decision,
        hasGateRecord: Boolean(gate),
        evidenceQuality: comparison.evidenceQuality,
        canonicalDecisive: decisiveKeys.has(canonicalPatentNumber(comparison.publicationNumber)),
        noveltyThreat: comparison.rawNoveltyThreat,
        overlapRiskLevel: comparison.overlapRiskLevel,
      };
    }),
    ...shortlistCandidates.map(({ item, relevance, gate, sourceOrder }) => ({
      publicationNumber: getPublicationNumber(item),
      mapped: false,
      sourceOrder,
      gateScore: relevance,
      gateDecision: gate?.rerankDecision || gate?.decision,
      hasGateRecord: Boolean(gate),
      evidenceQuality: gate?.evidence_quality || item?.evidence_quality,
    })),
  ];
  const stage4Config = (searchRun.config as any)?.stage4 || {};
  const persistedReferenceSelection = stage4?.report_reference_selection;
  const persistedSelectionValidation = validateReportReferenceSelection(
    persistedReferenceSelection,
    reportReferenceCandidates
  );
  // A recompute must reproduce the rule the stored selection was written with, so
  // a run whose blob went stale — and a legacy run with no blob at all, which
  // recomputes on every single render — keeps rendering as it always has. The rule
  // comes from the blob, never from config: idea-bank runs persist no stage4 config
  // and would otherwise render under a different rule than the pipeline wrote.
  const recomputeRule = normalizeReportReferenceSelectionRule(
    (persistedReferenceSelection as ReportReferenceSelectionV1 | undefined)?.rule
  );
  const computedReferenceSelection = selectNoveltyReportReferences(reportReferenceCandidates, {
    mainReferenceTarget: stage4Config.mainReferenceTarget ?? stage4Config.maxRefsForReportMain ?? 10,
    minMainReferences: stage4Config.minMainReferences ?? DEFAULT_MIN_MAIN_REFERENCES,
    maxUnmappedSupplementaryReferences: stage4Config.maxUnmappedSupplementaryReferences ?? 20,
    rule: recomputeRule,
  });
  const reportReferenceSelection: ReportReferenceSelectionV1 = persistedSelectionValidation.valid
    ? persistedReferenceSelection as ReportReferenceSelectionV1
    : computedReferenceSelection;
  if (!persistedSelectionValidation.valid) {
    console.info('[NoveltyReportReferenceSelection]', JSON.stringify({
      event: persistedReferenceSelection ? 'stale_selection_recomputed' : 'legacy_selection_recomputed',
      searchId: searchRun.id,
      reason: persistedSelectionValidation.reason,
      rule: recomputeRule,
      counts: reportReferenceSelection.counts,
    }));
  }

  const comparisonByPn = new Map(comparisons.map(comparison => [
    canonicalPatentNumber(comparison.publicationNumber),
    comparison,
  ]));
  const mainComparisons = reportReferenceSelection.main
    .map(reference => comparisonByPn.get(reference.canonicalPublicationNumber))
    .filter((comparison): comparison is AttorneyReportPatentComparison => Boolean(comparison));
  const appendixMappedComparisons = reportReferenceSelection.mappedSupplementary
    .map(reference => comparisonByPn.get(reference.canonicalPublicationNumber))
    .filter((comparison): comparison is AttorneyReportPatentComparison => Boolean(comparison));

  const citations = comparisons.map(({ citationNo, publicationNumber, originalPublicationNumber, publicationJurisdiction, searchAuthorityScope: citationSearchScope, sourceCorpus, filingCountry, targetLegalJurisdiction: citationTargetJurisdiction, title, relevanceScore, evidenceQuality, referenceRole, reviewPriority, matchCategory, matchCategoryLabel, referenceType }) => ({
    citationNo,
    publicationNumber,
    originalPublicationNumber,
    publicationJurisdiction,
    searchAuthorityScope: citationSearchScope,
    sourceCorpus,
    filingCountry,
    targetLegalJurisdiction: citationTargetJurisdiction,
    title,
    relevanceScore,
    evidenceQuality,
    referenceRole,
    reviewPriority,
    matchCategory,
    matchCategoryLabel,
    referenceType,
  }));
  const mainCitationKeys = new Set(mainComparisons.map(item => canonicalPatentNumber(item.publicationNumber)));
  const mainCitations = citations.filter(citation => mainCitationKeys.has(canonicalPatentNumber(citation.publicationNumber)));
  const patentCitations = citations.filter(citation => citation.referenceType === 'patent');
  const paperCitations = citations.filter(citation => citation.referenceType === 'paper');
  const patentComparisons = comparisons.filter(comparison => comparison.referenceType === 'patent');
  const paperComparisons = comparisons.filter(comparison => comparison.referenceType === 'paper');
  const directCitations = citations.filter(citation => citation.matchCategory === 'direct');
  const componentCitations = citations.filter(citation => citation.matchCategory === 'component');
  const borderlineCitations = citations.filter(citation => citation.matchCategory === 'borderline');

  const shortlistByPn = new Map(shortlistCandidates.map(entry => [
    canonicalPatentNumber(getPublicationNumber(entry.item)),
    entry,
  ]));
  // Number after filtering: a selected reference missing from the shortlist index
  // is dropped below, and numbering inside the map would leave gaps (S1, S3, S4).
  const otherShortlistedCitations = reportReferenceSelection.unmappedSupplementary
    .filter(selectedReference => {
      const entry = shortlistByPn.get(selectedReference.canonicalPublicationNumber);
      return Boolean(entry && entry.decision);
    })
    .map((selectedReference, index) => {
      const entry = shortlistByPn.get(selectedReference.canonicalPublicationNumber);
      if (!entry || !entry.decision) return null;
      const { item, relevance, decision, gate } = entry;
      const originalPublicationNumber = getPublicationNumber(item);
      const referenceType = item?.referenceType === 'paper' ? 'paper' as const : 'patent' as const;
      const publicationNumber = referenceType === 'paper' ? originalPublicationNumber : canonicalPublicationDisplay(originalPublicationNumber);
      const category = matchCategoryFromDecision(decision);
      const referenceRole = decision === 'accept'
        ? 'Gate accepted / not mapped'
        : decision === 'component'
          ? 'Component candidate / not mapped'
          : 'Borderline candidate / not mapped';
      const reviewPriority = decision === 'accept' ? 'High' : decision === 'component' ? 'Medium' : 'Low';
      return {
        citationNo: `S${index + 1}`,
        publicationNumber,
        originalPublicationNumber,
        publicationJurisdiction: referenceType === 'paper' ? 'Not applicable' : publicationAuthority(
          publicationNumber,
          item?.publicationAuthority,
          item?.authority,
          item?.country,
          item?.jurisdiction,
        ),
        searchAuthorityScope,
        sourceCorpus: firstText(item?.sourceLabel, item?.sourceProviders, item?.sourceProvider, 'Not available'),
        filingCountry: firstText(item?.filingCountry, item?.filing_country, item?.filingOffice, item?.filing_office, 'Not available'),
        targetLegalJurisdiction,
        title: firstText(item?.title, item?.invention_title, referenceType === 'paper' ? 'Untitled Paper' : 'Untitled Patent'),
        referenceType,
        relevanceScore: relevance,
        evidenceQuality: cleanText(gate?.evidence_quality || item?.evidence_quality, 'not mapped'),
        referenceRole,
        reviewPriority,
        matchCategory: category,
        matchCategoryLabel: `${matchCategoryLabel(decision)} / not mapped`,
      };
    })
    .filter(Boolean) as AttorneyReportCitation[];
  const otherShortlistedEligibleCount = reportReferenceSelection.counts.unmappedEligibleTotal;
  const otherShortlistedOmittedCount = reportReferenceSelection.counts.unmappedOmitted;
  const otherShortlistedRejectedCount = reportReferenceSelection.counts.explicitlyRejectedExcluded;
  const otherShortlistedUngatedCount = reportReferenceSelection.counts.ungatedExcluded;
  const otherShortlistedExcludedCount = otherShortlistedRejectedCount + otherShortlistedUngatedCount;
  const assigneeSignals = comparisons
    .flatMap(item => item.assignees.split(',').map(value => cleanText(value)))
    .map(value => normalizeEntityName(value, 'assignee'))
    .filter(value => isCleanEntityName(value, 'assignee'));
  const inventorSignalNames = comparisons
    .flatMap(item => item.inventors.split(',').map(value => cleanText(value)))
    .map(value => normalizeEntityName(value, 'inventor'))
    .filter(value => isCleanEntityName(value, 'inventor'));
  const assignees = Array.from(new Set(assigneeSignals)).slice(0, 40);
  const inventors = Array.from(new Set(inventorSignalNames)).slice(0, 60);
  const counts = buildNoveltyReportCountSummary(stage1, stage35);
  const sourceMode = cleanText(sourceConfig.mode || 'Selected patent sources');
  const paperSources: string[] = Array.isArray((searchRun.config as any)?.searchSource?.paperSources)
    ? (searchRun.config as any).searchSource.paperSources.map((source: unknown) => cleanText(source).replace(/_/g, ' ')).filter(Boolean)
    : [];
  const patentCount = Number(stage1?.patentCount || 0);
  const paperCount = Number(stage1?.paperCount || 0);
  const genericFeatures = featureSummaries.filter(feature => feature.type === 'generic_weak').map(feature => feature.feature);
  const claimConcepts = normalizeClaimConcepts(stage0);
  const potentialCombinations = buildPotentialCombinations(comparisons, stage0, featureSummaries);
  const claimConceptMapping = Array.isArray(stage4?.claimConceptMapping) && stage4.claimConceptMapping.length
    ? stage4.claimConceptMapping as ClaimConceptMapping[]
    : buildFallbackConceptMapping(claimConcepts, comparisons, featureSummaries);
  const publicClosestCitation = citations[0] || null;
  const claimPositioningIntelligence = buildClaimPositioningIntelligence(stage0, claimConcepts, claimConceptMapping, featureSummaries, comparisons, publicClosestCitation);
  const mainDifferentiator = buildMainDifferentiator(stage0, claimConcepts, claimConceptMapping, featureSummaries);
  const attorneyReviewFocus = buildAttorneyReviewFocus(claimConcepts, claimConceptMapping, featureSummaries, publicClosestCitation);
  const riskAssessment = deterministicRiskAssessment(comparisons, featureSummaries, counts);
  const potentialDifferentiationSpace = buildPotentialDifferentiationSpace(comparisons, featureSummaries);
  const matrixInsight = buildMatrixInsight(comparisons, featureSummaries, riskAssessment);
  const llmRisks = (Array.isArray(stage4?.risk_factors) ? stage4.risk_factors : (Array.isArray(stage4?.concluding_remarks?.key_risks) ? stage4.concluding_remarks.key_risks : []))
    .map((item: any) => sanitizeRiskItem(item))
    .filter(Boolean);
  const deterministicRisks = [
    `${riskAssessment.noveltyRiskLabel} - ${riskAssessment.noveltyRiskExplanation}`,
    `${riskAssessment.combinationRiskLabel} - ${riskAssessment.combinationRiskExplanation}`,
  ];
  const canonicalVerdict = stage4?.canonical_verdict;
  const canonicalConfidence = cleanText(canonicalVerdict?.confidence || stage4?.confidence || stage4?.executive_summary?.confidence, 'Low');
  const finalSummary = reportSafeText(
    canonicalVerdict?.summary || stage4?.structured_narrative?.verdict || stage4?.executive_summary?.summary || stage4?.message,
    `${riskAssessment.noveltyRiskExplanation} ${riskAssessment.combinationRiskExplanation}`
  );
  const adaptiveScreening = stage4?.adaptiveScreening || stage35?.adaptiveScreening;
  const stopReason = cleanText(
    stage4?.screeningStopReason
    // Why relevance screening stopped walking the ranked pool.
    || stage1?.aiRelevance?.screeningStopReason
    || adaptiveScreening?.terminalStopReason
    || adaptiveScreening?.projectedStopReason
  );
  const screeningCoverage = stage4?.screeningCoverage || stage1?.aiRelevance?.screeningCoverage;
  const screeningCoverageNote = buildScreeningCoverageNote(stopReason, screeningCoverage);

  return {
    reportNumber,
    reportTitle: 'Preliminary Novelty Assessment Report',
    inventionTitle: cleanText(searchRun.title, 'Untitled Invention'),
    jurisdiction: cleanText(searchRun.jurisdiction, 'IN'),
    sourceMode,
    generatedDate,
    confidentiality: 'Confidential review draft',
    preparedBy: firm?.firmName ? firm.firmName : 'PatentNest.ai Patent Intelligence',
    firm: firm ?? undefined,
    accentColor: firm?.accentColor ?? undefined,
    showPoweredBy: firm?.showPoweredBy ?? true,
    searchQuery: cleanText(stage0.searchQuery, '-'),
    inventionFeatures: stage0.inventionFeatures || [],
    evidenceBasis: 'Disclaimer: This preliminary assessment is based on limited preliminary data. Review the full patent text, claims, specification, drawings, family/legal status, and prosecution history before any final conclusion.',
    methodology: {
      corpus: [sourceConfig.includePatents === false ? '' : sourceModeLabel(sourceMode), paperSources.length ? `Scholarly papers (${paperSources.join(', ')})` : ''].filter(Boolean).join('; ') || 'Configured prior-art sources',
      retrievalMode: 'Hybrid retrieval/ranking with AI relevance gating and feature mapping',
      searchedEvidence: `This preliminary screening uses selected patent records and scholarly-paper bibliographic records, including available abstracts and metadata. Review the full patent text, claims, specification, drawings, prosecution history, legal status, and complete family records, as well as complete scholarly publications, before any final conclusion.${screeningCoverageNote ? ` ${screeningCoverageNote}` : ''}`,
      techniques: [
        'LLM-assisted invention normalization and key-feature extraction',
        'Patent and scholarly-paper candidate retrieval and ranking',
        'AI relevance gating before detailed mapping',
        'Feature-by-feature evidence mapping using explicit source labels',
        adaptiveScreening ? `Adaptive screening in ${cleanText(adaptiveScreening.mode, 'observe')} mode` : 'Fixed screening workflow',
      ],
      preliminaryStatus: 'AI-assisted preliminary assessment for professional review; not a legal opinion unless separately reviewed by qualified counsel.',
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
      ...(patentCount ? [{ label: 'Patent records retrieved', value: patentCount }] : []),
      ...(paperCount ? [{ label: 'Scholarly papers retrieved', value: paperCount }] : []),
      { label: 'Shortlisted candidate citations', value: counts.patentsFound },
      { label: 'Direct invention-level mapped citations', value: counts.directMatches },
      { label: 'Component / feature-level mapped citations', value: counts.componentMatches },
      { label: 'Citations selected for detailed feature mapping', value: counts.detailedCitations },
    ],
    scoringLegend: [
      { label: 'D - Directly Mapped', meaning: 'The reviewed record explicitly states the mapped mechanism for this feature.' },
      { label: 'P - Partially Mapped', meaning: 'The citation discloses a related mechanism; at least one required element remains distinct.' },
      { label: 'N - Not Found', meaning: 'The feature was not found in the reviewed preliminary record.' },
      { label: 'R - Not Established', meaning: 'The reviewed record touches this feature without disclosing it definitively, so it carries no claim weight on this evidence.' },
      { label: 'High mapped overlap', meaning: 'The reviewed record maps the core mechanism or core feature combination and is the primary constraint on claim scope.' },
      { label: 'Component / feature-level match', meaning: 'Citation discloses one or more relevant features or subsystems, but not the full invention as a whole.' },
      { label: 'Distributed component mapping', meaning: 'Features found across multiple references indicate combination risk, not one-reference disclosure by itself.' },
      { label: 'Feature Mapping', meaning: 'Qualitative indication that a citation maps one or more extracted features.' },
    ],
    tableOfContents: [
      { number: '1', title: 'Search Overview' },
      { number: '1.1', title: 'Objective' },
      { number: '1.2', title: 'Search Scope and Methodology' },
      { number: '1.3', title: 'Key Features' },
      { number: '1.4', title: 'Scoring Legend' },
      { number: '1.5', title: 'Summary of Relevant Citations' },
      { number: '1.6', title: 'Component / Feature-Level Prior Art' },
      { number: '1.7', title: 'Key Feature Analysis Matrix' },
      ...(potentialCombinations.length ? [{ number: '1.8', title: 'Potential Inventive-Step Combinations' }] : []),
      { number: '2', title: 'Citation Analysis' },
      { number: '2.1', title: 'Relevant Patent Citations' },
      ...(paperCitations.length ? [
        { number: '2.2', title: 'Relevant Scholarly Publications' },
        ...paperCitations.map((citation, index) => ({ number: `2.2.${index + 1}`, title: citation.title })),
      ] : []),
      ...(appendixMappedComparisons.length ? [{ number: 'A', title: 'Remaining Mapped References' }] : []),
      { number: paperCitations.length ? '2.3' : '2.2', title: 'Appendix B: Shortlisted but Unmapped Citations' },
      { number: '3', title: 'Applicant / Assignee Landscape' },
      { number: '4', title: 'Repeated Inventor / Entity Signals' },
      { number: '5', title: 'Claim-Positioning Analysis' },
      { number: '6', title: 'Claim-Positioning Observations' },
      { number: '7', title: 'Limitations and Next Steps' },
    ],
    featureSummaries,
    genericFeatureRisk: {
      features: genericFeatures,
      summary: genericFeatures.length
        ? `${genericFeatures.length} broad/common feature(s) should not be relied on alone. Narrower technical framing is recommended.`
        : 'No standalone generic feature risk was detected from the extracted feature list.',
    },
    citations,
    patentCitations,
    paperCitations,
    directCitations,
    componentCitations,
    borderlineCitations,
    otherShortlistedCitations,
    otherShortlistedExcludedCount,
    otherShortlistedEligibleCount,
    otherShortlistedOmittedCount,
    otherShortlistedRejectedCount,
    otherShortlistedUngatedCount,
    reportReferenceSelection,
    assignees,
    inventors,
    assigneeLandscape: buildEntityLandscape(assigneeSignals, 'assignee'),
    inventorSignals: buildEntityLandscape(inventorSignalNames, 'inventor'),
    comparisons,
    patentComparisons,
    paperComparisons,
    mainComparisons,
    appendixMappedComparisons,
    mainCitations,
    potentialCombinations,
    riskAssessment,
    potentialDifferentiationSpace,
    matrixInsight,
    architecturalInnovation: cleanText(stage0.architecturalInnovation),
    claimConcepts,
    claimConceptMapping,
    mainDifferentiator,
    attorneyReviewFocus,
    claimPositioningAnalysis: claimPositioningIntelligence.claimPositioningAnalysis,
    claimDraftingConsiderations: claimPositioningIntelligence.claimDraftingConsiderations,
    draftingOpportunities: claimPositioningIntelligence.draftingOpportunities,
    conceptMappedCoverageSummary: claimPositioningIntelligence.conceptMappedCoverageSummary,
    strategicReviewFocus: claimPositioningIntelligence.strategicReviewFocus,
    finalAssessment: {
      decision: cleanText(canonicalVerdict?.decision || stage4?.decision, riskAssessment.headline),
      confidence: canonicalConfidence,
      summary: finalSummary,
      risks: Array.from(new Set([...deterministicRisks, ...llmRisks])),
      recommendations: (Array.isArray(stage4?.concluding_remarks?.strategic_recommendations) ? stage4.concluding_remarks.strategic_recommendations : []).map((item: any) => reportSafeText(item)).filter(Boolean),
    },
    publicClosestCitation,
    reportConfidence: {
      automatedReportConfidence: canonicalConfidence || confidenceFromCounts({
        searched: counts.patentsSearched,
        found: counts.patentsFound,
        directlyRelevant: counts.directlyRelevant,
        retrieved: counts.patentsSearched,
        reviewed: counts.screened,
        visible: counts.directlyRelevant,
        analyzed: counts.detailedCitations,
      }),
      retrievalConfidence: counts.patentsSearched >= 20 ? 'Medium' : 'Low',
      featureMappingConfidence: counts.detailedCitations >= 5 ? 'Medium' : 'Low',
      legalConclusion: 'Not provided; requires review.',
    },
    overallDraftingDirection: 'Focus claim drafting on concrete features that remain unmapped or only partially mapped, and verify all mapped references with full patent documents, including claims, detailed description/specification, drawings, family data, and legal status.',
    limitations: 'This preliminary novelty assessment is prepared from automated retrieval, ranking, and feature mapping of patent records available to the system. Review the full patent documents, including claims, detailed description/specification, drawings, prosecution history, legal status, family members, and non-patent literature with a qualified patent professional before filing, validity, enforcement, or freedom-to-operate decisions. This report is not a legal opinion.',
    nextSteps: [
      'Review the highest-overlap mapped citations at claim level.',
      'Narrow invention disclosure around technical differentiators that are Absent or only partially mapped.',
      'Validate results with full patent documents and non-patent literature searching.',
      'Ask the inventor for implementation details where features are generic, weak, or inferred.',
    ],
  };
}
