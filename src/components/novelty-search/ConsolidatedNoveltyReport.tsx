'use client';

import React, { useMemo, useState } from 'react';
import { buildNoveltyAttorneyReportModel } from '@/lib/novelty-attorney-report';
import { useAuth } from '@/lib/auth-context';

const printStyles = `
  @media print {
    @page { size: A4; margin: 1cm; }
    html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
    body { font-size: 11px !important; line-height: 1.35 !important; background: #fff !important; }
    .no-print { display: none !important; }
    .min-h-screen { min-height: 0 !important; }
    .print-break-before { break-before: auto !important; page-break-before: auto !important; }
    .print-break-inside-avoid { break-inside: auto !important; page-break-inside: auto !important; }
    .print-table { page-break-inside: auto; }
    .print-row { break-inside: auto !important; page-break-inside: auto !important; page-break-after: auto !important; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    section, article, table, tbody, tr, td, th, div { max-height: none !important; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

interface ConsolidatedNoveltyReportProps {
  searchId: string;
  searchData: any;
}

type FeatureStatus = 'Present' | 'Partial' | 'Absent' | 'Unknown';

interface FeatureComparisonRow {
  feature_id: string;
  feature: string;
  user_invention_disclosure: string;
  patent_disclosure: string;
  status: FeatureStatus;
  status_label?: string;
  evidence_quote?: string;
  evidence_source: string;
  extent_score?: number;
  confidence?: number;
  attorney_remark: string;
  novelty_impact: string;
  claim_review_note: string;
}

interface CitationView {
  citationNo: string;
  publicationNumber: string;
  title: string;
  link: string;
  abstract: string;
  publicationDate: string;
  applicationNumber: string;
  filingDate: string;
  priorityDate: string;
  inventors: string;
  assignees: string;
  relevance: number | null;
  evidenceQuality: string;
  matchCategory: 'direct' | 'component' | 'borderline' | 'rejected';
  matchCategoryLabel: string;
  noveltyThreat: string;
  coverageScore: number;
  claimImpactSummary: string;
  summary: string;
  rows: FeatureComparisonRow[];
}

function cleanText(value: unknown, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function canonicalPatentNumber(value: unknown) {
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

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(textValuesFrom(value).join(', '));
    if (text) return text;
  }
  return '';
}

function displayEvidenceSource(value: unknown, fallback = 'citation record') {
  const text = cleanText(value, fallback).toLowerCase();
  if (!text || text === 'none' || text === 'citation record') return 'none';
  if (/\babstract\b/.test(text)) return 'abstract';
  if (/\btitle\b/.test(text)) return 'title';
  return 'inference';
}

function reportSafeText(value: unknown, fallback = '') {
  return cleanText(value, fallback)
    .replace(/\bno abstract available\.?/gi, 'No abstract text available; title reviewed where available.')
    .replace(/title\s*\/\s*abstract/gi, 'title/abstract evidence')
    .replace(/title and abstract/gi, 'title/abstract evidence')
    .replace(/\bcomplete information (?:was|is) not available\b/gi, 'source record review is recommended')
    .replace(/\bnot available\b/gi, 'to be confirmed')
    .replace(/\bunavailable\b/gi, 'to be confirmed')
    .replace(/\binsufficient (?:content|information|data|evidence)\b/gi, 'attorney review recommended')
    .replace(/\btoo limited\b/gi, 'marked for attorney review')
    .replace(/\blimited (?:data|information|evidence|content)\b/gi, 'reviewed title/abstract evidence')
    .replace(/\bweak corpus coverage\b/gi, 'citation review scope')
    .replace(/\bmissing (?:analysis|evidence|information)\b/gi, 'attorney review item')
    .replace(/\bevidence (?:is|was) too thin\b/gi, 'attorney review is recommended')
    .replace(/\b(?:only|solely) (?:the )?citation record\b/gi, 'the reviewed title/abstract evidence')
    .replace(/\bcitation record only\b/gi, 'reviewed title/abstract evidence')
    .replace(/\binsufficient\b/gi, 'marked for attorney review')
    .replace(/\blow evidence\b/gi, 'Preliminary Review')
    .replace(/\bavailable patent record\b/gi, 'reviewed patent record')
    .replace(/\bavailable citation record\b/gi, 'reviewed title/abstract evidence')
    .replace(/\bavailable patent disclosure\b/gi, 'reviewed patent disclosure')
    .replace(/\bavailable patent evidence\b/gi, 'reviewed patent evidence')
    .replace(/\bfinal attorney remarks?\b/gi, 'preliminary claim-positioning observations')
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

function formatDate(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return cleanText(value, '-');
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  if (n === null) return null;
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.max(0, Math.min(1, scaled));
}

function pct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function normalizeStatus(value: unknown): FeatureStatus {
  const text = String(value || '').toLowerCase();
  if (text === 'present') return 'Present';
  if (text === 'partial') return 'Partial';
  if (text === 'absent') return 'Absent';
  return 'Unknown';
}

function statusClass(status: FeatureStatus) {
  if (status === 'Present') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'Partial') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'Absent') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function threatClass(threat: string) {
  const text = String(threat || '').toLowerCase();
  if (text.includes('high')) return 'border-blue-200 bg-blue-50 text-blue-700';
  if (text.includes('moderate') || text.includes('related')) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (text.includes('low')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function statusLabel(status: FeatureStatus) {
  if (status === 'Absent') return 'Absent / weak signal';
  if (status === 'Unknown') return 'Mapped, needs review';
  return status;
}

function featureDetailsMap(stage0: any, inventionDescription: string) {
  const map = new Map<string, string>();
  const details = Array.isArray(stage0?.featureDetails) ? stage0.featureDetails : [];
  details.forEach((detail: any) => {
    const feature = cleanText(detail?.feature);
    if (feature) map.set(feature, cleanText(detail?.user_disclosure || detail?.source_excerpt || feature));
  });
  const disclosure = cleanText(stage0?.inventionText || inventionDescription);
  const features = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];
  features.forEach((feature: string) => {
    if (!map.has(feature)) map.set(feature, disclosure ? `${feature}. ${disclosure.slice(0, 220)}` : feature);
  });
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
    stage1?.fallbackCandidates,
  ];
  sources.forEach(source => {
    if (!Array.isArray(source)) return;
    source.forEach((item: any) => {
      const pn = firstText(item?.publicationNumber, item?.publication_number, item?.pn, item?.id, item?.patent_number);
      const key = canonicalPatentNumber(pn);
      if (key && !index.has(key)) index.set(key, item);
    });
  });
  return index;
}

function gateRecordFor(stage1: any, pn: string) {
  const byPn = stage1?.aiRelevance?.byPn || {};
  return byPn[pn] || byPn[String(pn).toUpperCase()] || byPn[canonicalPatentNumber(pn)];
}

function defaultAttorneyRemark(status: FeatureStatus, feature: string, pn: string) {
  if (status === 'Present') return `${pn} appears to disclose this feature in the reviewed patent record.`;
  if (status === 'Partial') return `${pn} is related to this feature, but the reviewed title/abstract evidence does not show all required elements.`;
  if (status === 'Absent') return `${pn} does not show support for this feature in the reviewed disclosure. Treat as a potential distinction, not confirmed novelty.`;
  return `${pn} should be checked by counsel for this feature before final claim positioning.`;
}

function defaultNoveltyImpact(status: FeatureStatus, feature: string) {
  if (status === 'Present') return `Overlap risk: ${feature} is mapped to this citation.`;
  if (status === 'Partial') return `Partial overlap: a narrower distinction may exist for ${feature}.`;
  if (status === 'Absent') return `Potential differentiator: ${feature} is not shown in the reviewed patent disclosure.`;
  return `Review focus: attorney review should confirm how ${feature} is treated in title/abstract evidence.`;
}

function defaultClaimReviewNote(status: FeatureStatus, feature: string) {
  if (status === 'Present') return `Do not rely on ${feature} alone for novelty without a narrower claim distinction.`;
  if (status === 'Partial') return `Emphasize the missing element of ${feature} and verify full text before filing.`;
  if (status === 'Absent') return `Consider claiming ${feature} if supported by the disclosure and after full-text review.`;
  return `Request full patent text or additional inventor detail before relying on ${feature}.`;
}

function textSpecificityScore(value: string) {
  const tokens = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 3 && !['patent', 'feature', 'disclosure', 'supporting', 'available', 'identified'].includes(token));
  return Math.min(1, Array.from(new Set(tokens)).length / 28);
}

function featureOverlapScore(feature: string, disclosure: string) {
  const text = String(disclosure || '').toLowerCase();
  const tokens = Array.from(new Set(String(feature || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 3)));
  if (!tokens.length) return 0;
  return tokens.filter(token => text.includes(token)).length / tokens.length;
}

function defaultExtentScore(status: FeatureStatus, feature: string, patentDisclosure: string, evidenceQuote = '', confidence?: number) {
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

function buildRows(features: string[], stage0: any, inventionDescription: string, patentMap: any, remark: any): FeatureComparisonRow[] {
  const details = featureDetailsMap(stage0, inventionDescription);
  const suppliedRows = new Map<string, any>();
  (Array.isArray(remark?.comparison_rows) ? remark.comparison_rows : []).forEach((row: any) => {
    const feature = cleanText(row?.feature);
    if (feature) suppliedRows.set(feature, row);
  });
  const cells = Array.isArray(patentMap?.feature_analysis) ? patentMap.feature_analysis : [];

  return features.map((feature, index) => {
    const supplied = suppliedRows.get(feature) || {};
    const cell = cells.find((item: any) => cleanText(item?.feature).toLowerCase() === feature.toLowerCase()) || {};
    const status = normalizeStatus(supplied.status || cell.status);
    const evidenceQuote = cleanText(supplied.evidence_quote || cell.quote || '');
    const evidenceSource = displayEvidenceSource(supplied.evidence_source || cell.evidence_source || cell.field || (evidenceQuote ? 'citation disclosure' : 'none'), 'none');
    const confidence = scoreOrNull(supplied.confidence ?? cell.confidence) ?? undefined;
    const patentDisclosure = reportSafeText(
      supplied.patent_disclosure ||
      cell.patent_disclosure ||
      cell.quote ||
        cell.reason ||
        (status === 'Present' || status === 'Partial'
          ? 'Related patent disclosure identified.'
          : 'Supporting disclosure is not shown in this citation.')
      );
    const extentScore = scoreOrNull(supplied.extent_score ?? supplied.extentScore ?? cell.extent_score ?? cell.extentScore)
      ?? defaultExtentScore(status, feature, patentDisclosure, evidenceQuote, confidence);

    return {
      feature_id: cleanText(supplied.feature_id || cell.feature_id || `KF${index + 1}`),
      feature,
      user_invention_disclosure: cleanText(supplied.user_invention_disclosure || cell.user_invention_disclosure || details.get(feature) || feature),
      patent_disclosure: patentDisclosure,
      status,
      status_label: statusLabel(status),
      evidence_quote: evidenceQuote || undefined,
      evidence_source: evidenceQuote ? evidenceSource : (status === 'Present' || status === 'Partial' ? 'inference' : 'none'),
      extent_score: status === 'Absent' || status === 'Unknown' ? undefined : extentScore,
      confidence,
      attorney_remark: reportSafeText(supplied.attorney_remark || cell.attorney_remark || defaultAttorneyRemark(status, feature, cleanText(patentMap?.pn, 'This citation'))),
      novelty_impact: reportSafeText(supplied.novelty_impact || cell.novelty_impact || defaultNoveltyImpact(status, feature)),
      claim_review_note: reportSafeText(supplied.claim_review_note || cell.claim_review_note || defaultClaimReviewNote(status, feature)),
    };
  });
}

function Section({ id, title, children, breakBefore = false }: { id: string; title: string; children: React.ReactNode; breakBefore?: boolean }) {
  return (
    <section className={`mb-10 ${breakBefore ? 'print-break-before' : ''}`} id={id}>
      <div className="mb-4 border-b border-slate-300 pb-2">
        <h2 className="text-xl font-bold text-blue-700">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DenseTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-sm border border-slate-300 bg-white">
      <table className="print-table w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

function HeaderCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`border border-slate-300 bg-blue-700 px-3 py-2 text-left font-semibold text-white ${className}`}>{children}</th>;
}

function Cell({ children, className = '', ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={`border border-slate-300 px-3 py-2 align-top text-slate-800 ${className}`}>{children}</td>;
}

export default function ConsolidatedNoveltyReport({ searchId, searchData }: ConsolidatedNoveltyReportProps) {
  const { authFetch } = useAuth();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const stage0 = searchData?.stage0Results || searchData?.stage0 || {};
  const stage1 = searchData?.stage1Results || searchData?.stage1 || {};
  const stage35 = searchData?.stage35Results || searchData?.stage35 || {};
  const stage4 = searchData?.stage4Results || searchData?.stage4 || {};
  const finalRemarks = stage4?.final_remarks || stage4?.concluding_remarks || {};
  const features: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];
  const featureMaps: any[] = Array.isArray(stage35?.feature_map) ? stage35.feature_map : (Array.isArray(stage35) ? stage35 : []);
  const generatedDate = new Date().toISOString().slice(0, 10);
  const title = cleanText(searchData?.title || stage0?.title, 'Novelty Assessment Report');

  const reportData = useMemo(() => {
    const model = buildNoveltyAttorneyReportModel({
      id: searchId,
      ...searchData,
      stage0Results: stage0,
      stage1Results: stage1,
      stage35Results: stage35,
      stage4Results: stage4,
    });
    const citations: CitationView[] = model.comparisons.map(item => ({
      citationNo: item.citationNo,
      publicationNumber: item.publicationNumber,
      title: item.title,
      link: item.link,
      abstract: item.technicalDisclosure,
      publicationDate: item.publicationDate,
      applicationNumber: item.applicationNumber,
      filingDate: item.filingDate,
      priorityDate: item.priorityDate,
      inventors: item.inventors,
      assignees: item.assignees,
      relevance: item.relevanceScore,
      evidenceQuality: item.evidenceQuality,
      matchCategory: item.matchCategory,
      matchCategoryLabel: item.matchCategoryLabel,
      noveltyThreat: item.noveltyThreat,
      coverageScore: item.coverage.score,
      claimImpactSummary: item.claimImpactSummary,
      summary: item.summary,
      rows: item.rows.map(row => ({
        feature_id: row.featureNumber,
        feature: row.userFeature,
        user_invention_disclosure: row.userDisclosure,
        patent_disclosure: row.patentDisclosure,
        status: row.status,
        status_label: row.statusLabel,
        evidence_quote: row.evidenceQuote || undefined,
        evidence_source: row.evidenceSource,
        extent_score: row.extentScore ?? undefined,
        confidence: row.confidence ?? undefined,
        attorney_remark: row.attorneyRemark,
        novelty_impact: row.noveltyImpact,
        claim_review_note: row.claimReviewNote,
      })),
    }));

    return {
      ...model,
      citations,
      otherShortlisted: model.otherShortlistedCitations,
      assignees: model.assignees,
      inventors: model.inventors,
      stats: {
        patentsSearched: model.counts.searched,
        patentsFound: model.counts.found,
        directlyRelevant: model.counts.directlyRelevant,
        detailedCitations: model.counts.analyzed,
      },
    };
  }, [searchId, searchData, stage0, stage1, stage35, stage4]);

  const handleDownloadProfessionalPDF = async () => {
    try {
      setIsDownloadingPdf(true);
      const response = await authFetch(`/api/novelty-search/${searchId}/attorney-report/pdf`);
      if (!response.ok) throw new Error('Failed to generate professional PDF');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `patentnest-novelty-report-${searchId.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Professional PDF download error:', err);
      alert('Professional PDF generation failed. Please try again.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleGenerateShareLink = async () => {
    try {
      setIsGeneratingShare(true);
      const response = await authFetch(`/api/novelty-search/${searchId}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) throw new Error('Failed to generate share link');
      const data = await response.json();
      if (data.shareUrl) {
        setShareUrl(data.shareUrl);
        setShowShareModal(true);
        navigator.clipboard?.writeText(data.shareUrl).catch(() => undefined);
      }
    } catch (err) {
      console.error('Share link generation error:', err);
      alert('Failed to generate share link. Please try again.');
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert('Share link copied to clipboard.');
    } catch {
      alert('Failed to copy to clipboard. Please copy the link manually.');
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div className="min-h-screen bg-slate-100 text-slate-950 print:bg-white">
        <div className="no-print fixed bottom-6 right-6 z-50 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerateShareLink}
            disabled={isGeneratingShare}
            className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-70"
          >
            {isGeneratingShare ? 'Generating link...' : 'Share Public Link'}
          </button>
          <button
            type="button"
            onClick={handleDownloadProfessionalPDF}
            disabled={isDownloadingPdf}
            className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-slate-800 disabled:opacity-70"
          >
            {isDownloadingPdf ? 'Preparing PDF...' : 'Download Professional Report'}
          </button>
        </div>

        <main className="mx-auto max-w-6xl bg-white px-8 py-10 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
          <header className="mb-10 border-b-4 border-blue-700 pb-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Confidential attorney-review draft</div>
                <h1 className="max-w-4xl text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
                <p className="mt-2 text-sm text-slate-600">Automated Novelty Report</p>
              </div>
              <div className="text-left text-sm text-slate-600 md:text-right">
                <div className="text-xl font-bold text-slate-950">PatentNest.ai</div>
                <div>Report ID: {searchId.slice(0, 8)}</div>
                <div>Generated: {generatedDate}</div>
                <div>Jurisdiction: {cleanText(searchData?.jurisdiction || stage0?.jurisdiction, 'IN')}</div>
              </div>
            </div>
          </header>

          <nav className="mb-10 rounded-sm border border-slate-300 bg-slate-50 p-5 print-break-inside-avoid">
            <h2 className="mb-3 text-lg font-bold text-slate-950">Table Of Contents</h2>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              {[
                ['1.1', 'Objective'],
                ['1.2', 'Search Scope and Methodology'],
                ['1.3', 'Key Features'],
                ['1.4', 'Scoring Legend'],
                ['1.5', 'Summary of Relevant Citations'],
                ['1.6', 'Component / Feature-Level Prior Art'],
                ['1.7', 'Key Feature Analysis'],
                ['2.1', 'Details of Relevant Patent Citations'],
                ['2.3', 'List of Other Shortlisted Citations'],
                ['3', 'Applicant / Assignee Landscape'],
                ['4', 'Repeated Inventor / Entity Signals'],
                ['5', 'Preliminary Claim-Positioning Observations'],
                ['6', 'Limitations and Next Steps'],
              ].map(([number, label]) => (
                <a key={number} href={`#section-${number.replace('.', '-')}`} className="flex gap-3 text-slate-700 hover:text-blue-700">
                  <span className="w-12 font-semibold">{number}</span>
                  <span>{label}</span>
                </a>
              ))}
            </div>
          </nav>

          <Section id="section-1-1" title="1.1 Objective">
            <p className="max-w-4xl text-sm leading-6 text-slate-700">
              The objective of this report is to organize relevant patent records and map available evidence against the extracted key features of the submitted invention for attorney review.
            </p>
            <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-sm border border-slate-300 p-3"><span className="font-semibold">Search query: </span>{cleanText(stage0?.searchQuery, '-')}</div>
              <div className="rounded-sm border border-slate-300 p-3"><span className="font-semibold">Search concluded on: </span>{generatedDate}</div>
              {reportData.countLabels.map(item => (
                <div key={item.label} className="rounded-sm border border-slate-300 p-3">
                  <span className="font-semibold">{item.label}: </span>{item.value || '-'}
                </div>
              ))}
            </div>
          </Section>

          <Section id="section-1-2" title="1.2 Search Scope and Methodology">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-sm border border-slate-300 p-3"><span className="font-semibold">Corpus + retrieval mode: </span>{reportData.methodology.corpus}</div>
              <div className="rounded-sm border border-slate-300 p-3"><span className="font-semibold">Retrieval / mapping mode: </span>{reportData.methodology.retrievalMode}</div>
              <div className="rounded-sm border border-slate-300 p-3 md:col-span-2"><span className="font-semibold">Evidence scope: </span>{reportData.methodology.searchedEvidence}</div>
              <div className="rounded-sm border border-slate-300 p-3 md:col-span-2"><span className="font-semibold">Review status: </span>{reportData.methodology.preliminaryStatus}</div>
            </div>
            <ListBlock title="Techniques Used" items={reportData.methodology.techniques} />
          </Section>

          <Section id="section-1-3" title="1.3 Key Features">
            <p className="mb-4 max-w-4xl text-sm leading-6 text-slate-700">
              Extracted features are classified so generic elements are not treated as equally important to concrete technical mechanisms.
            </p>
            <DenseTable>
              <thead>
                <tr>
                  <HeaderCell className="w-28">Key Feature</HeaderCell>
                  <HeaderCell className="w-44">Feature Type</HeaderCell>
                  <HeaderCell>Feature Description</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {reportData.featureSummaries.map(feature => (
                  <tr className="print-row" key={feature.featureNumber}>
                    <Cell className="font-semibold text-slate-950">{feature.featureNumber}</Cell>
                    <Cell>{feature.typeLabel}</Cell>
                    <Cell>
                      <div>{feature.feature}</div>
                      {feature.genericWarning && <div className="mt-2 text-xs font-semibold text-amber-700">{feature.genericWarning}</div>}
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
            <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <span className="font-semibold">Generic Feature Risk: </span>{reportData.genericFeatureRisk.summary}
            </div>
          </Section>

          <Section id="section-1-4" title="1.4 Scoring Legend">
            <DenseTable>
              <thead>
                <tr>
                  <HeaderCell className="w-48">Score / Status</HeaderCell>
                  <HeaderCell>Meaning</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {reportData.scoringLegend.map(item => (
                  <tr className="print-row" key={item.label}>
                    <Cell className="font-semibold text-slate-950">{item.label}</Cell>
                    <Cell>{item.meaning}</Cell>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
          </Section>

          <Section id="section-1-5" title="1.5 Summary of Relevant Citations">
            <DenseTable>
              <thead>
                <tr>
                  <HeaderCell className="w-16">S.No.</HeaderCell>
                  <HeaderCell className="w-40">Citation No.</HeaderCell>
                  <HeaderCell>Title</HeaderCell>
                  <HeaderCell className="w-44">Match Category</HeaderCell>
                  <HeaderCell className="w-40">Retrieval Relevance</HeaderCell>
                  <HeaderCell className="w-36">Evidence</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {reportData.citations.map((citation, index) => (
                  <tr className="print-row" key={citation.publicationNumber}>
                    <Cell>{index + 1}</Cell>
                    <Cell><a className="font-semibold text-blue-700 underline" href={`#citation-${index + 1}`}>{citation.publicationNumber}</a></Cell>
                    <Cell>{citation.title}</Cell>
                    <Cell>{citation.matchCategoryLabel}</Cell>
                    <Cell>{pct(citation.relevance)}</Cell>
                    <Cell>{citation.evidenceQuality}</Cell>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
          </Section>

          <Section id="section-1-6" title="1.6 Component / Feature-Level Prior Art">
            <p className="mb-4 max-w-4xl text-sm leading-6 text-slate-700">
              These patents disclose one or more relevant invention features or subsystems, but they are not treated as full invention-level matches by themselves.
            </p>
            {reportData.citations.some(citation => citation.matchCategory === 'component') ? (
              <DenseTable>
                <thead>
                  <tr>
                    <HeaderCell className="w-16">S.No.</HeaderCell>
                    <HeaderCell className="w-40">Citation No.</HeaderCell>
                    <HeaderCell>Title</HeaderCell>
                    <HeaderCell className="w-40">Matched Scope</HeaderCell>
                    <HeaderCell className="w-40">Retrieval Relevance</HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {reportData.citations
                    .filter(citation => citation.matchCategory === 'component')
                    .map((citation, index) => (
                      <tr className="print-row" key={citation.publicationNumber}>
                        <Cell>{index + 1}</Cell>
                        <Cell><a className="font-semibold text-blue-700 underline" href={`#citation-${reportData.citations.findIndex(item => item.publicationNumber === citation.publicationNumber) + 1}`}>{citation.publicationNumber}</a></Cell>
                        <Cell>{citation.title}</Cell>
                        <Cell>{citation.matchCategoryLabel}</Cell>
                        <Cell>{pct(citation.relevance)}</Cell>
                      </tr>
                    ))}
                </tbody>
              </DenseTable>
            ) : (
              <div className="rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                No separate component / feature-level references were classified in this run.
              </div>
            )}
          </Section>

          <Section id="section-1-7" title="1.7 Key Feature Analysis">
            <p className="mb-4 max-w-4xl text-sm leading-6 text-slate-700">
              Each cell reflects whether the cited patent record appears to disclose the corresponding key feature. Feature coverage is separate from retrieval relevance and legal conclusions.
            </p>
            <div className="overflow-x-auto rounded-sm border border-slate-300">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <HeaderCell className="sticky left-0 z-10 min-w-40">Citation No.</HeaderCell>
                    {features.map((_, index) => <HeaderCell key={index} className="min-w-24 text-center">KF{index + 1}</HeaderCell>)}
                  </tr>
                </thead>
                <tbody>
                  {reportData.citations.map(citation => (
                    <tr className="print-row" key={citation.publicationNumber}>
                      <Cell className="sticky left-0 z-10 bg-white font-semibold">{citation.publicationNumber}</Cell>
                      {citation.rows.map(row => (
                        <Cell key={row.feature_id} className="text-center">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(row.status)}`}>
                            {row.status_label || statusLabel(row.status)}
                          </span>
                          {typeof row.extent_score === 'number' && <div className="mt-1 text-[10px] text-slate-500">Coverage {pct(row.extent_score)}</div>}
                        </Cell>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="section-2-1" title="2.1 Details of Relevant Patent Citations" breakBefore>
            <p className="mb-5 max-w-4xl text-sm leading-6 text-slate-700">
              The relevant patent records are mapped based on the key features of the submitted invention.
            </p>
            <div className="space-y-10">
              {reportData.citations.map((citation, index) => (
                <article id={`citation-${index + 1}`} key={citation.publicationNumber}>
                  <div className="mb-0 bg-blue-700 px-4 py-3 text-lg font-bold text-white">
                    Reference {index + 1}: {citation.publicationNumber}
                  </div>
                  <DenseTable>
                    <tbody>
                      <tr><Cell className="w-48 font-semibold">Publication No:</Cell><Cell>{citation.publicationNumber}</Cell><Cell className="w-48 font-semibold">Publication Date:</Cell><Cell>{citation.publicationDate}</Cell></tr>
                      <tr><Cell className="font-semibold">Application No:</Cell><Cell>{citation.applicationNumber}</Cell><Cell className="font-semibold">Application Date:</Cell><Cell>{citation.filingDate}</Cell></tr>
                      <tr><Cell className="font-semibold">Priority Date:</Cell><Cell>{citation.priorityDate}</Cell><Cell className="font-semibold">Match Category:</Cell><Cell>{citation.matchCategoryLabel}</Cell></tr>
                      <tr><Cell className="font-semibold">Overlap Category:</Cell><Cell><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${threatClass(citation.noveltyThreat)}`}>{citation.noveltyThreat}</span></Cell><Cell className="font-semibold">Evidence Quality:</Cell><Cell>{citation.evidenceQuality}</Cell></tr>
                      <tr><Cell className="font-semibold">Feature Coverage:</Cell><Cell>{pct(citation.coverageScore)}</Cell><Cell className="font-semibold">Retrieval Relevance:</Cell><Cell>{pct(citation.relevance)}</Cell></tr>
                      <tr><Cell className="font-semibold">Inventor(s):</Cell><Cell colSpan={3}>{citation.inventors}</Cell></tr>
                      <tr><Cell className="font-semibold">Assignee(s):</Cell><Cell colSpan={3}>{citation.assignees}</Cell></tr>
                      <tr><Cell className="font-semibold">Title:</Cell><Cell colSpan={3}>{citation.title}</Cell></tr>
                      <tr><Cell className="font-semibold">Technical Disclosure:</Cell><Cell colSpan={3}>{reportSafeText(citation.abstract)}</Cell></tr>
                      <tr><Cell className="font-semibold">Source:</Cell><Cell colSpan={3}><a className="text-blue-700 underline" href={citation.link} target="_blank" rel="noreferrer">{citation.link}</a></Cell></tr>
                    </tbody>
                  </DenseTable>

                  <div className="mt-4 overflow-x-auto rounded-sm border border-slate-300">
                    <table className="min-w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          <HeaderCell className="w-16">S.No.</HeaderCell>
                          <HeaderCell className="min-w-64">Key Features</HeaderCell>
                          <HeaderCell className="min-w-80">Identified Patent Number: {citation.publicationNumber}</HeaderCell>
                          <HeaderCell className="min-w-64">Attorney Remark / Claim Note</HeaderCell>
                        </tr>
                      </thead>
                      <tbody>
                        {citation.rows.map(row => (
                          <tr className="print-row" key={row.feature_id}>
                            <Cell className="font-semibold">{row.feature_id}</Cell>
                            <Cell>
                              <div className="font-semibold text-slate-950">{row.feature}</div>
                              <div className="mt-2 text-slate-600">{row.user_invention_disclosure}</div>
                            </Cell>
                            <Cell>
                              <div className={`mb-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(row.status)}`}>{row.status_label || statusLabel(row.status)}</div>
                              <div>{row.patent_disclosure}</div>
                              {row.evidence_quote && <div className="mt-2 text-slate-500">Evidence ({row.evidence_source}): {row.evidence_quote}</div>}
                              {!row.evidence_quote && <div className="mt-2 text-slate-500">Evidence source: {row.evidence_source}</div>}
                              {typeof row.extent_score === 'number' && <div className="mt-1 text-slate-500">Feature Coverage: {pct(row.extent_score)}</div>}
                              {typeof row.confidence === 'number' && <div className="mt-1 text-slate-500">Evidence Confidence: {pct(row.confidence)}</div>}
                            </Cell>
                            <Cell>
                              <div className="font-semibold text-slate-950">Remark</div>
                              <div>{row.attorney_remark}</div>
                              <div className="mt-2 font-semibold text-slate-950">Mapped impact</div>
                              <div>{row.novelty_impact}</div>
                              <div className="mt-2 font-semibold text-slate-950">Claim review note</div>
                              <div>{row.claim_review_note}</div>
                            </Cell>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {citation.summary && (
                    <div className="mt-4 rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                      <span className="font-semibold text-slate-950">Reference summary: </span>{citation.summary}
                    </div>
                  )}
                  <div className="mt-4 rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                    <span className="font-semibold text-slate-950">Claim impact summary: </span>{citation.claimImpactSummary}
                  </div>
                </article>
              ))}
            </div>
          </Section>

          {reportData.otherShortlisted.length > 0 && (
            <Section id="section-2-3" title="2.3 List of Other Shortlisted Citations" breakBefore>
              <div className="mb-5 rounded-sm border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-950">
                These citations were shortlisted for reference but not mapped in detail in this report version.
              </div>
              <DenseTable>
                <thead>
                  <tr>
                    <HeaderCell className="w-16">S.No.</HeaderCell>
                    <HeaderCell className="w-44">Citation No.</HeaderCell>
                    <HeaderCell>Title</HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {reportData.otherShortlisted.map((item: any, index: number) => {
                    const pn = firstText(item?.publicationNumber, item?.publication_number, item?.pn, item?.id, item?.patent_number, 'Unknown');
                    return (
                      <tr className="print-row" key={`${pn}-${index}`}>
                        <Cell>{index + 1}</Cell>
                        <Cell><a className="text-blue-700 underline" href={`https://patents.google.com/patent/${pn}`} target="_blank" rel="noreferrer">{pn}</a></Cell>
                        <Cell>{firstText(item?.title, item?.invention_title, 'Untitled Patent')}</Cell>
                      </tr>
                    );
                  })}
                </tbody>
              </DenseTable>
            </Section>
          )}

          <Section id="section-3" title="03 Applicant / Assignee Landscape" breakBefore>
            <EntityLandscapeBlock landscape={reportData.assigneeLandscape} />
          </Section>

          <Section id="section-4" title="04 Repeated Inventor / Entity Signals" breakBefore>
            <EntityLandscapeBlock landscape={reportData.inventorSignals} />
          </Section>

          <Section id="section-5" title="05 Preliminary Claim-Positioning Observations" breakBefore>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-sm border border-slate-300 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automated overlap position</div>
                <div className="mt-2 text-2xl font-bold text-slate-950">{reportData.finalAssessment.decision}</div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{reportData.finalAssessment.summary}</p>
              </div>
              <div className="rounded-sm border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                <div className="font-semibold">Report Confidence</div>
                <p className="mt-2">Automated report confidence: {reportData.reportConfidence.automatedReportConfidence}</p>
                <p>Retrieval confidence: {reportData.reportConfidence.retrievalConfidence}</p>
                <p>Feature-mapping confidence: {reportData.reportConfidence.featureMappingConfidence}</p>
                <p>Legal conclusion: {reportData.reportConfidence.legalConclusion}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <ListBlock title="Key Risks" items={reportData.finalAssessment.risks} />
              <ListBlock title="Strategic Recommendations" items={reportData.finalAssessment.recommendations} />
              <ListBlock title="Confidence Drivers" items={finalRemarks?.confidence_drivers || []} />
            </div>
            <div className="mt-5 rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <span className="font-semibold text-slate-950">Overall drafting direction: </span>{reportData.overallDraftingDirection}
            </div>
            {finalRemarks?.filing_advice && (
              <div className="mt-5 rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <span className="font-semibold text-slate-950">Drafting note: </span>{reportSafeText(finalRemarks.filing_advice)}
              </div>
            )}
          </Section>

          <Section id="section-6" title="06 Limitations and Next Steps" breakBefore>
            <div className="rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {reportData.limitations}
            </div>
            <ListBlock title="What To Do Next" items={reportData.nextSteps} />
          </Section>

          <footer className="mt-12 border-t border-slate-300 pt-6 text-center text-xs leading-5 text-slate-500">
            <p>Generated by PatentNest.ai - Confidential - AI-generated preliminary patent intelligence.</p>
            <p>Not a legal opinion. Consult a qualified patent professional before making filing, validity, enforcement, or FTO decisions.</p>
          </footer>
        </main>

        {showShareModal && shareUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">Share Link Generated</h3>
                  <p className="mt-1 text-sm text-slate-600">This report is accessible through the public share URL below.</p>
                </div>
                <button type="button" onClick={() => setShowShareModal(false)} className="text-slate-400 hover:text-slate-600">Close</button>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-800 break-all">{shareUrl}</div>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setShowShareModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
                <button type="button" onClick={copyShareLink} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Copy Link</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ListBlock({ title, items }: { title: string; items: any[] }) {
  const list = Array.isArray(items) ? items.map(item => reportSafeText(item)).filter(Boolean) : [];
  return (
    <div className="rounded-sm border border-slate-300 p-4">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-950">{title}</h3>
      {list.length > 0 ? (
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
          {list.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Items to be confirmed during attorney review.</p>
      )}
    </div>
  );
}

function EntityLandscapeBlock({ landscape }: { landscape: { summary: string; groups: Array<{ label: string; names: string[] }>; repeated: Array<{ name: string; count: number }> } }) {
  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        {landscape.summary}
      </div>
      {landscape.repeated.length > 0 && (
        <DenseTable>
          <thead>
            <tr>
              <HeaderCell>Repeated Signal</HeaderCell>
              <HeaderCell className="w-32">Count</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {landscape.repeated.map(item => (
              <tr className="print-row" key={item.name}>
                <Cell>{item.name}</Cell>
                <Cell>{item.count}</Cell>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {landscape.groups.map(group => (
          <ListBlock key={group.label} title={group.label} items={group.names} />
        ))}
      </div>
    </div>
  );
}
