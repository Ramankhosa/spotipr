'use client'

// The Element Grid: results scored the way claims are argued — per element,
// not per document. Full rows are §102 anticipation candidates; complementary
// rows are surfaced as §103 coverage arithmetic.
//
// Two rules the design insists on, and this component enforces:
//   1. Cells are CATEGORICAL and every one opens its evidence (matched terms,
//      the text tier it was read from). No number is shown without something
//      behind it.
//   2. Coverage is arithmetic; combining references is a legal judgment. A
//      theory cannot be pinned without an attorney-authored motivation.

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Link2, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import {
  coveredElements,
  findAnticipationCandidates,
  findCombinations,
} from '@/lib/prior-art-studio/element-math'
import type {
  StudioElement,
  StudioElementCell,
  StudioElementVerdict,
  StudioResultFamily,
  StudioTheoryPayload,
} from '@/lib/prior-art-studio/types'

const VERDICT_STYLE: Record<StudioElementVerdict, string> = {
  STRONG: 'bg-amber-600 text-white',
  PART: 'bg-amber-600/45 text-foreground',
  WEAK: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  NONE: 'bg-muted text-muted-foreground/50',
}

const VERDICT_LABEL: Record<StudioElementVerdict, string> = {
  STRONG: 'STRONG',
  PART: 'PART',
  WEAK: 'WEAK',
  NONE: '—',
}

interface ElementGridProps {
  elements: StudioElement[]
  families: StudioResultFamily[]
  theories: StudioTheoryPayload[]
  onPinTheory: (input: {
    kind: 'ANTICIPATION' | 'COMBINATION'
    publicationNumbers: string[]
    familyKeys: string[]
    motivation: string
    elementCoverage?: unknown
  }) => Promise<void>
  onRemoveTheory: (theoryId: string) => void
  onOpenDocument: (family: StudioResultFamily) => void
  pinning?: boolean
}

export function ElementGrid({
  elements,
  families,
  theories,
  onPinTheory,
  onRemoveTheory,
  onOpenDocument,
  pinning,
}: ElementGridProps) {
  const [openCell, setOpenCell] = useState<string | null>(null)
  const [motivation, setMotivation] = useState<Record<string, string>>({})

  const rows = useMemo(
    () =>
      families.map(f => ({
        familyKey: f.familyKey,
        publicationNumber: f.publicationNumber,
        cells: f.elementCells,
        family: f,
      })),
    [families]
  )

  const assessedRows = useMemo(
    () => rows.filter(row => row.family.elementAssessmentStatus === 'ASSESSED' && row.cells),
    [rows]
  )
  const anticipation = useMemo(() => findAnticipationCandidates({ elements, rows: assessedRows }), [elements, assessedRows])
  const combinations = useMemo(() => findCombinations({ elements, rows: assessedRows }), [elements, assessedRows])
  const anticipationKeys = new Set(anticipation.map(a => a.familyKey))

  if (!elements.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No claim elements yet. Add them under <b>Invention elements</b> on the canvas (or let the query generator
        draft them) — the grid scores every result against each element.
      </div>
    )
  }

  if (!families.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Run the search to score results against your {elements.length} elements.
      </div>
    )
  }

  const theoryFor = (pubs: string[]) =>
    theories.find(t => t.publicationNumbers.slice().sort().join('|') === pubs.slice().sort().join('|'))

  const pin = async (
    kind: 'ANTICIPATION' | 'COMBINATION',
    key: string,
    publicationNumbers: string[],
    familyKeys: string[],
    elementCoverage?: unknown
  ) => {
    const text = (motivation[key] || '').trim()
    await onPinTheory({ kind, publicationNumbers, familyKeys, motivation: text, elementCoverage })
    setMotivation(current => ({ ...current, [key]: '' }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Element grid</span>
        <Hint
          title="Scored the way claims are argued"
          text="Each column is one element of your invention. A row that covers every element is a single-reference (§102) candidate; two rows that complete each other are a possible §103 combination. Click any cell to see the evidence behind it."
        />
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          {(['STRONG', 'PART', 'WEAK', 'NONE'] as StudioElementVerdict[]).map(v => (
            <span key={v} className={`rounded px-1.5 py-0.5 font-mono font-bold ${VERDICT_STYLE[v]}`}>
              {VERDICT_LABEL[v]}
            </span>
          ))}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Document
              </th>
              {elements.map((element, i) => (
                <th
                  key={element.id}
                  className="border-b border-border px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  title={element.text}
                >
                  E{i + 1}
                  <span className="ml-1 font-normal normal-case tracking-normal opacity-70">
                    {element.text.length > 22 ? `${element.text.slice(0, 22)}…` : element.text}
                  </span>
                </th>
              ))}
              <th className="border-b border-border px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Evidence tier
              </th>
              <th className="border-b border-border px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reading
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isAnticipation = anticipationKeys.has(row.familyKey)
              const assessmentStatus = row.family.elementAssessmentStatus || (row.cells ? 'ASSESSED' : 'UNASSESSED')
              const tier = assessmentStatus === 'ASSESSED' && elements.some(e => row.cells?.[e.id]?.tier === 'claims') ? 'claims' : 'abstract'
              const covered = assessmentStatus === 'ASSESSED' ? coveredElements(row.cells, elements).length : 0
              return (
                <tr key={row.familyKey} className={isAnticipation ? 'bg-emerald-500/[0.07]' : undefined}>
                  <td className="border-b border-border px-3 py-2 align-middle">
                    <button
                      type="button"
                      onClick={() => onOpenDocument(row.family)}
                      className="font-mono text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-400"
                    >
                      {row.publicationNumber}
                    </button>
                    <div className="max-w-[220px] truncate text-[10px] text-muted-foreground">{row.family.title}</div>
                  </td>
                  {elements.map(element => {
                    const cell = assessmentStatus === 'ASSESSED' ? row.cells?.[element.id] : undefined
                    const verdict = cell?.verdict
                    const cellKey = `${row.familyKey}:${element.id}`
                    return (
                      <td key={element.id} className="relative border-b border-border px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setOpenCell(openCell === cellKey ? null : cellKey)}
                          className={`w-full rounded px-1.5 py-1 text-center font-mono text-[9px] font-bold ${
                            verdict ? VERDICT_STYLE[verdict] : 'bg-muted text-muted-foreground'
                          }`}
                          aria-expanded={openCell === cellKey}
                        >
                          {verdict ? VERDICT_LABEL[verdict] : assessmentStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT ASSESSED'}
                        </button>
                        {openCell === cellKey && (
                          <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-popover p-2.5 text-[11px] shadow-lg">
                            <p className="mb-1 font-semibold text-foreground">{element.text}</p>
                            {cell ? (
                              <>
                                <p className="text-muted-foreground">
                                  Words found in this document:{' '}
                                  {cell.matchedTerms.length ? (
                                    <b className="text-foreground">{cell.matchedTerms.join(', ')}</b>
                                  ) : (
                                    <i>none — this verdict rests on meaning similarity only</i>
                                  )}
                                </p>
                                <p className="mt-1 text-muted-foreground">
                                  Read from <b className="text-foreground">{cell.tier === 'claims' ? 'claims text' : 'title + abstract'}</b>
                                  {cell.tier === 'abstract' && ' — abstract-tier evidence is not a claim mapping.'}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => onOpenDocument(row.family)}
                                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-400"
                                >
                                  <Link2 className="h-3 w-3" /> Open the document
                                </button>
                              </>
                            ) : (
                              <p className="text-muted-foreground">
                                {assessmentStatus === 'UNAVAILABLE'
                                  ? 'Assessment unavailable — scoring did not complete. This is not a NONE finding.'
                                  : 'Not assessed — this document was outside the automatic assessment window.'}
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="border-b border-border px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                        tier === 'claims'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {assessmentStatus === 'ASSESSED'
                        ? tier === 'claims' ? 'claims' : 'abstract'
                        : assessmentStatus === 'UNAVAILABLE' ? 'unavailable' : 'not assessed'}
                    </span>
                  </td>
                  <td className="border-b border-border px-2 py-2 text-[10px]">
                    {isAnticipation ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        §102 candidate
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {covered}/{elements.length} elements
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* §102 candidates — pin with a rationale */}
      {anticipation.map(candidate => {
        const key = `ant:${candidate.familyKey}`
        const existing = theoryFor([candidate.publicationNumber])
        return (
          <div key={key} className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">Single-reference candidate:</span>
              <span className="font-mono">{candidate.publicationNumber}</span>
              <span className="text-muted-foreground">
                covers all {elements.length} elements ({candidate.strongCount} strongly)
              </span>
            </div>
            {existing ? (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-card p-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <p className="flex-1 text-muted-foreground">{existing.motivation}</p>
                <button type="button" onClick={() => onRemoveTheory(existing.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={motivation[key] || ''}
                  onChange={e => setMotivation(c => ({ ...c, [key]: e.target.value }))}
                  placeholder="Your reading of this reference (required to pin)…"
                  className="min-w-[240px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  disabled={pinning}
                  onClick={() => pin('ANTICIPATION', key, [candidate.publicationNumber], [candidate.familyKey])}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {pinning ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Pin §102 candidate
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* §103 combinations — motivation mandatory */}
      {combinations.map((combo, i) => {
        const key = `combo:${combo.publicationNumbers.join('+')}`
        const existing = theoryFor(combo.publicationNumbers)
        return (
          <div key={key} className="rounded-lg border border-blue-500/40 bg-blue-500/[0.06] p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-blue-800 dark:text-blue-300">Complementary coverage {i + 1}:</span>
              <span className="font-mono">{combo.publicationNumbers.join('  +  ')}</span>
              <span className="text-muted-foreground">
                jointly reach all {combo.total} elements
              </span>
            </div>
            <p className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
              Coverage is arithmetic. Whether these references may properly be combined is your judgment — and the
              motivation you write here goes into the search report.
            </p>
            {existing ? (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-card p-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <p className="flex-1 text-muted-foreground">{existing.motivation}</p>
                <button type="button" onClick={() => onRemoveTheory(existing.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={motivation[key] || ''}
                  onChange={e => setMotivation(c => ({ ...c, [key]: e.target.value }))}
                  placeholder="Motivation to combine (required — e.g. same field, common problem, express suggestion)…"
                  className="min-w-[260px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  disabled={pinning}
                  onClick={() => pin('COMBINATION', key, combo.publicationNumbers, combo.familyKeys, combo.coverage)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {pinning ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Pin §103 theory
                </button>
              </div>
            )}
          </div>
        )
      })}

      {!anticipation.length && !combinations.length && (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {rows.some(row => row.family.elementAssessmentStatus !== 'ASSESSED')
            ? 'No theory is shown from the assessed subset. Some documents are not assessed or unavailable, so this is not a novelty conclusion.'
            : 'No assessed document covers every element, and no two assessed documents complete each other. Widen a block to EXPAND if you want to press the search harder before concluding.'}
        </p>
      )}
    </div>
  )
}
