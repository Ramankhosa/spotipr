'use client';

import React from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw } from 'lucide-react';

interface Stage4ResultsProps {
  stage4Results: any;
  searchId: string;
  onRerun?: () => Promise<void> | void;
  hidePerPatentRemarks?: boolean;
  hideIdeaBank?: boolean;
  hideConsolidatedButton?: boolean;
}

export default function Stage4ResultsDisplay({
  stage4Results,
  searchId,
  onRerun,
  hidePerPatentRemarks = true,
  hideConsolidatedButton = true,
}: Stage4ResultsProps) {
  const r: any = stage4Results || {};
  const exec = r.executive_summary || {};
  const cards = exec.visual_cards || {};
  const remarks: any[] = Array.isArray(r.per_patent_remarks) ? r.per_patent_remarks : [];
  const metadata = r.report_metadata || {};
  const concl = r.concluding_remarks || {};

  const honestAssessment = concl.honest_assessment || '';
  const courseCorrections = Array.isArray(concl.course_corrections) ? concl.course_corrections : [];
  const inventorActions = Array.isArray(concl.inventor_action_items) ? concl.inventor_action_items : [];
  const overallAssessment = concl.overall_novelty_assessment || '';
  const filingAdvice = concl.filing_advice || '';
  const isLowEvidence = String(overallAssessment).toLowerCase().includes('low evidence');

  const sanitize = (value: any) => (typeof value === 'string' ? value.normalize('NFKC').replace(/\uFFFD/g, '') : value);

  const trail = r.search_trail || {};
  const pqaiInitial = trail.pqai_initial_count ?? r?.search_metadata?.pqai_initial_count ?? undefined;
  const aiAccepted = trail.ai_relevance_accepted ?? r?.search_metadata?.ai_relevance_accepted ?? undefined;
  const aiBorderline = trail.ai_relevance_borderline ?? r?.search_metadata?.ai_relevance_borderline ?? undefined;
  const deepAnalyzed = trail.deeply_analyzed_count ?? (Array.isArray(remarks) ? remarks.length : undefined);
  const displayCardLabel = (key: string) => key === 'Unique Features' ? 'Potential Differentiators' : key;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 border-t-indigo-500 border-t-4 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-medium text-slate-500">AI Novelty Assessment</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {metadata.title || 'AI-Backed Novelty Assessment Report'}
            </h2>
            <div className="mt-2 text-sm text-slate-500">
              Search ID: {metadata.search_id || searchId} | {metadata.date || new Date().toISOString().slice(0, 10)}
            </div>
          </div>

          {overallAssessment && (
            <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${assessmentBadgeClass(overallAssessment)}`}>
              {overallAssessment}
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        {!hideConsolidatedButton && (
          <Link
            href={`/novelty-search/${metadata.search_id || searchId}/consolidated`}
            target="_blank"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Consolidated Report
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
        {onRerun && (
          <button
            type="button"
            onClick={() => onRerun()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Re-run Report Generation
          </button>
        )}
      </div>

      {cards && Object.keys(cards).length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(cards).map(([key, value]) => (
            <KpiCard key={key} label={displayCardLabel(key)} value={String(value)} />
          ))}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Executive Summary</h3>
        <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {sanitize(exec.summary) || 'Summary not available.'}
        </div>
      </section>

      {honestAssessment && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5">
          <h3 className="text-base font-semibold text-indigo-950">Honest Assessment</h3>
          <p className="mt-2 text-sm leading-6 text-indigo-900">{sanitize(honestAssessment)}</p>
        </section>
      )}

      {isLowEvidence && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-base font-semibold text-amber-950">Low Evidence Notice</h3>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            The result is not being treated as positive novelty. It means the available corpus, abstracts, or feature evidence were not strong enough for a high-confidence novelty conclusion.
          </p>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Search Trail</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Patent Database Screened" value={pqaiInitial ?? '-'} />
          <KpiCard label="AI Accepted" value={aiAccepted ?? '-'} />
          <KpiCard label="AI Borderline" value={aiBorderline ?? '-'} />
          <KpiCard label="Deeply Analyzed" value={deepAnalyzed ?? '-'} />
        </div>
      </section>

      {(concl.key_strengths || concl.key_risks) && (
        <div className="grid gap-3 md:grid-cols-2">
          <BulletsCard title="Key Strengths" bullets={concl.key_strengths} tone="emerald" />
          <BulletsCard title="Key Risks" bullets={concl.key_risks} tone="amber" />
        </div>
      )}

      {concl.strategic_recommendations && (
        <BulletsCard title="Strategic Recommendations" bullets={concl.strategic_recommendations} tone="indigo" />
      )}

      {courseCorrections.length > 0 && (
        <BulletsCard title="Course Corrections" bullets={courseCorrections} tone="amber" />
      )}

      {inventorActions.length > 0 && (
        <NumberedCard title="Inventor Action Items" items={inventorActions} />
      )}

      {filingAdvice && (
        <section className="rounded-lg border border-slate-300 bg-slate-50 p-5">
          <h3 className="text-base font-semibold text-slate-900">Filing Advice</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">{sanitize(filingAdvice)}</p>
        </section>
      )}

      {!hidePerPatentRemarks && Array.isArray(concl.per_patent_analysis) && concl.per_patent_analysis.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Prior Art Analysis</h3>
              <p className="mt-1 text-sm text-slate-500">Detailed patent-by-patent assessment for inventor review.</p>
            </div>
            <div className="text-sm text-slate-500">{concl.per_patent_analysis.length} patent(s) analyzed</div>
          </div>
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {concl.per_patent_analysis.map((patent: any, index: number) => (
              <PatentAnalysisAccordion key={index} patent={patent} sanitize={sanitize} />
            ))}
          </div>
        </section>
      )}

      {!hidePerPatentRemarks && (!concl.per_patent_analysis || concl.per_patent_analysis.length === 0) && remarks.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Per-Patent Remarks</h3>
          <div className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
            {remarks.map((item, index) => (
              <LegacyRemarkAccordion key={index} item={item} sanitize={sanitize} />
            ))}
          </div>
        </section>
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
        Disclaimer: This report is AI-generated to assist novelty assessment. Review cited prior art before legal or
        business decisions and consult a registered patent attorney.
      </div>
    </div>
  );
}

function assessmentBadgeClass(value: string) {
  if (value === 'Novel') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (value === 'Partially Novel') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (value === 'Not Novel') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (value === 'Low Evidence') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function KpiCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function BulletsCard({ title, bullets, tone }: { title: string; bullets: string[]; tone: 'emerald' | 'amber' | 'indigo' }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50'
      : 'border-indigo-200 bg-indigo-50';

  return (
    <section className={`rounded-lg border p-5 ${toneClass}`}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {Array.isArray(bullets) && bullets.length > 0 ? (
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
          {bullets.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 text-sm text-slate-600">No items.</div>
      )}
    </section>
  );
}

function NumberedCard({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-medium text-white">
              {index + 1}
            </span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function threatBadge(threat: string) {
  const map: Record<string, { label: string; className: string }> = {
    anticipates: { label: 'High Risk', className: 'border-rose-200 bg-rose-50 text-rose-700' },
    obvious: { label: 'Moderate Risk', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    adjacent: { label: 'Adjacent Art', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    remote: { label: 'Remote', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    novel: { label: 'Novel', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    partial_novelty: { label: 'Partial Novelty', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  };
  return map[threat] || { label: 'Unassessed', className: 'border-slate-200 bg-slate-50 text-slate-700' };
}

function PatentAnalysisAccordion({ patent, sanitize }: { patent: any; sanitize: (value: any) => any }) {
  const pn = patent.pn || patent.patent_number || 'Unknown';
  const title = patent.title || 'Untitled Reference';
  const relevance = typeof patent.relevance === 'number' ? patent.relevance : 0.5;
  const relevancePercent = Math.round(relevance * 100);
  const threat = threatBadge(patent.novelty_threat || patent.decision || 'unknown');
  const detailed = patent.detailedAnalysis || {};
  const relevantParts = Array.isArray(detailed.relevant_parts) ? detailed.relevant_parts : [];
  const irrelevantParts = Array.isArray(detailed.irrelevant_parts) ? detailed.irrelevant_parts : [];

  return (
    <details className="group bg-white open:bg-slate-50">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900">{pn}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${threat.className}`}>{threat.label}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-slate-600">{sanitize(title)}</div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-xs uppercase tracking-wide text-slate-400">Relevance</div>
          <div className="text-lg font-semibold text-slate-900">{relevancePercent}%</div>
        </div>
      </summary>

      <div className="space-y-4 border-t border-slate-200 p-4">
        {(patent.summary || patent.remarks) && (
          <p className="text-sm leading-6 text-slate-700">{sanitize(patent.summary || patent.remarks)}</p>
        )}

        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${relevancePercent}%` }} />
        </div>

        {relevantParts.length > 0 && (
          <AnalysisList title="Overlapping Elements" items={relevantParts} sanitize={sanitize} tone="rose" />
        )}

        {irrelevantParts.length > 0 && (
          <AnalysisList title="Differentiators" items={irrelevantParts} sanitize={sanitize} tone="emerald" />
        )}

        {detailed.novelty_comparison && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Novelty Assessment</div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{sanitize(detailed.novelty_comparison)}</p>
          </div>
        )}

        <Link
          href={`https://patents.google.com/patent/${encodeURIComponent(String(pn).replace(/\s+/g, ''))}`}
          target="_blank"
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Open in Google Patents
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </details>
  );
}

function AnalysisList({
  title,
  items,
  sanitize,
  tone,
}: {
  title: string;
  items: string[];
  sanitize: (value: any) => any;
  tone: 'rose' | 'emerald';
}) {
  const className = tone === 'rose'
    ? 'border-rose-200 bg-rose-50'
    : 'border-emerald-200 bg-emerald-50';

  return (
    <div className={`rounded-lg border p-3 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-700">{title}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
        {items.map((item, index) => (
          <li key={index}>{sanitize(item)}</li>
        ))}
      </ul>
    </div>
  );
}

function LegacyRemarkAccordion({ item, sanitize }: { item: any; sanitize: (value: any) => any }) {
  const pn = item.pn || item.patent_number || 'Unknown PN';
  const href = `https://patents.google.com/patent/${encodeURIComponent(String(pn).replace(/\s+/g, ''))}`;

  return (
    <details className="group bg-white open:bg-slate-50">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-4">
        <div>
          <div className="font-mono text-sm font-semibold text-slate-900">{pn}</div>
          {item.title && <div className="mt-1 text-sm text-slate-600">{sanitize(item.title)}</div>}
        </div>
        <span className="text-xs font-medium text-indigo-600">Details</span>
      </summary>
      <div className="border-t border-slate-200 p-4">
        <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{sanitize(item.remarks) || '-'}</div>
        <Link href={href} target="_blank" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          Open in Google Patents
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </details>
  );
}
