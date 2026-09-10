'use client'

// Office-form findings for the preliminary claim set.
//
// Every item here is a deterministic check with a statutory basis — the
// objection the office would raise on the claims as written — never the
// model's opinion of its own output. The panel hides itself as soon as the
// claims in the editor differ from the ones the report describes; saving
// recomputes the report.

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { computeClaimsSignature } from '@/lib/claims-signature'
import type { ClaimFormReport, OfficeFormFinding, OfficeFormSeverity } from '@/lib/claim-rules/types'

type PanelClaim = { number?: number | string; text?: string | null }

const SEVERITY_LABELS: Record<OfficeFormSeverity, string> = {
  block: 'Objection likely',
  warn: 'Check',
  info: 'Note',
}

const SEVERITY_STYLES: Record<OfficeFormSeverity, string> = {
  block: 'border-red-200 bg-red-50 text-red-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-paper-300 bg-paper-100 text-ai-graphite-600',
}

const CODE_LABELS: Record<string, string> = {
  NUMBERING_GAP: 'Numbering',
  DEPENDENT_PHRASE_FORM: 'Dependent form',
  PREAMBLE_NOUN_MISMATCH: 'Dependent form',
  MULTIPLE_DEPENDENCY_FORM: 'Multiple dependency',
  MULTIPLE_DEPENDENT_CHAIN: 'Multiple dependency',
  IMPROPER_DEPENDENCY: 'Dependency',
  ANTECEDENT_BASIS: 'Antecedent basis',
  MULTI_SENTENCE: 'Claim form',
  OPTIONAL_LANGUAGE: 'Optional wording',
  FORBIDDEN_PHRASE: 'Claim form',
  OMNIBUS_REFERENCE: 'Omnibus reference',
  OMNIBUS_CLAIM_EXPECTED: 'Omnibus claim',
  USE_CLAIM: 'Claim category',
  METHOD_OF_TREATMENT: 'Medical claim form',
  SWISS_TYPE_FORM: 'Medical claim form',
  SECOND_MEDICAL_USE: 'Medical claim form',
  CRM_NOT_NON_TRANSITORY: 'Medium claim',
  CRM_FORM_NOT_RECOMMENDED: 'Medium claim',
  PROGRAM_PER_SE: 'Program claim',
  ELIGIBILITY_TECHNICAL_ANCHOR: 'Eligibility',
  INDEPENDENT_PER_CATEGORY_EXCEEDED: 'Independent claims',
  UNITY_BREAK: 'Unity',
  CATEGORY_MIX: 'Category',
  FUNCTIONAL_RESULT_STATIC: 'Result in static claim',
  RESULT_ONLY_LIMITATION: 'Result only',
  MEANS_PLUS_FUNCTION: 'Functional claiming',
  INDEFINITE_MODIFIER: 'Definiteness',
  TRADEMARK: 'Definiteness',
  SOURCE_JARGON: 'Terminology',
  MARKUSH_OPEN_GROUP: 'Markush group',
  AND_OR: 'Claim form',
  NEGATIVE_LIMITATION: 'Negative limitation',
  UNSUPPORTED_NUMBER: 'Support',
  TWO_PART_FORM_MISSING: 'Two-part form',
  TWO_PART_FORM_DISCOURAGED: 'Two-part form',
  CHARACTERISED_SPELLING: 'Spelling',
  REFERENCE_NUMERAL_FORM: 'Reference signs',
  PRODUCT_BY_PROCESS: 'Product-by-process',
  INDIAN_3D_FORM: 'Section 3(d)',
  INDIAN_3E_ADMIXTURE: 'Section 3(e)',
  CLAIM_COUNT_OVER_FREE: 'Fees',
  INDEPENDENT_COUNT_OVER_FREE: 'Fees',
  OPENING_ARTICLE: 'Claim form',
  TRAILING_PERIOD: 'Claim form',
  DUPLICATE_CLAIM: 'Duplicate',
  SEQUENCE_CONFLATION: 'Sequence',
  TAUTOLOGY: 'Tautology',
  EXPERIMENTAL_PARAMETER: 'Experimental parameter',
  PICTURE_CLAIM_1: 'Claim 1 scope',
}

function labelFor(code: string): string {
  return CODE_LABELS[code] || code.toLowerCase().replace(/_/g, ' ')
}

export function ClaimFormFindingsPanel(props: {
  report: ClaimFormReport | null | undefined
  claims: PanelClaim[]
  officeName?: string
}) {
  const { report, claims, officeName } = props
  const [open, setOpen] = useState(true)
  const [showNotes, setShowNotes] = useState(false)

  const current = useMemo(() => (report ? report.claimsSignature === computeClaimsSignature(claims) : false), [report, claims])
  if (!report || !current) return null

  const findings: OfficeFormFinding[] = Array.isArray(report.findings) ? report.findings : []
  const objections = findings.filter(finding => finding.severity === 'block')
  const checks = findings.filter(finding => finding.severity === 'warn')
  const notes = findings.filter(finding => finding.severity === 'info')
  const corrections = report.repair?.attempted ? report.repair.resolvedFindingIds.length : 0
  const office = officeName || report.jurisdiction

  if (!findings.length && !corrections) return null

  const visible = [...objections, ...checks, ...(showNotes ? notes : [])]

  return (
    <section className="mt-4 rounded-lg border border-paper-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-ai-graphite-400" /> : <ChevronRight className="h-3.5 w-3.5 text-ai-graphite-400" />}
        <Scale className="h-3.5 w-3.5 text-ai-graphite-500" />
        <span className="text-[12px] font-semibold text-ai-graphite-800">Office form — {office}</span>
        <span className="ml-1 flex items-center gap-1.5 text-[10.5px] text-ai-graphite-500">
          {objections.length > 0 && <span className={`rounded border px-1.5 py-0.5 ${SEVERITY_STYLES.block}`}>{objections.length} likely objection{objections.length === 1 ? '' : 's'}</span>}
          {checks.length > 0 && <span className={`rounded border px-1.5 py-0.5 ${SEVERITY_STYLES.warn}`}>{checks.length} to check</span>}
          {notes.length > 0 && <span className={`rounded border px-1.5 py-0.5 ${SEVERITY_STYLES.info}`}>{notes.length} note{notes.length === 1 ? '' : 's'}</span>}
          {!objections.length && !checks.length && !notes.length && <span className="text-ai-graphite-500">no form issues found</span>}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-paper-200 px-4 py-3">
          {corrections > 0 && (
            <p className="text-[11px] text-ai-graphite-500">
              {corrections} office-form correction{corrections === 1 ? '' : 's'} applied while generating this set.
            </p>
          )}

          {visible.map(finding => (
            <div key={finding.id} className="rounded-md border border-paper-200 bg-white px-3 py-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLES[finding.severity]}`}>
                  {SEVERITY_LABELS[finding.severity]}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-ai-graphite-500">
                  {labelFor(finding.code)}
                </span>
                {finding.claimNumber !== null && (
                  <span className="text-[10px] text-ai-graphite-400">Claim {finding.claimNumber}</span>
                )}
                <span className="rounded bg-paper-100 px-1.5 py-0.5 text-[10px] text-ai-graphite-500" title="Legal basis">
                  {finding.basis}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-ai-graphite-800">{finding.message}</p>
              {finding.excerpt && (
                <p className="mt-1 truncate text-[11px] italic text-ai-graphite-500" title={finding.excerpt}>
                  “{finding.excerpt}”
                </p>
              )}
            </div>
          ))}

          {notes.length > 0 && (
            <button
              type="button"
              onClick={() => setShowNotes(value => !value)}
              className="text-[11px] font-medium text-ai-blue-700 hover:underline"
            >
              {showNotes ? 'Hide notes' : `Show ${notes.length} note${notes.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
