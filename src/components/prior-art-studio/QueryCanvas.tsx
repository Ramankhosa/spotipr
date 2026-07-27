'use client'

// The Query Canvas: the search as a visible, editable structure. Blocks are
// AND-ed; chips inside a block are OR-ed; each block chooses its lane.
// Copilot proposals arrive as dashed "ghost" chips and are inert until accepted.

import { useState } from 'react'
import { Check, Plus, Sparkles, X } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import type { StudioBlock, StudioBlockMode, StudioPlan } from '@/lib/prior-art-studio/types'

const MODE_HELP: Record<StudioBlockMode, string> = {
  MATCH:
    'MATCH is your required-vocabulary lens. Documents missing every one of these terms are flagged as misses-MATCH and counted in the funnel — but nothing is hidden or deleted; you focus with one click using the pills above the results. Keep MATCH for terms of art you are certain appear verbatim in a ~150-word abstract, or the meets-set will be tiny.',
  EXPAND:
    'EXPAND widens: this concept is matched by meaning, so documents using completely different wording are still found. This is what actually reaches across the 45M-document corpus, and it can never remove a document.',
  BOTH: 'BOTH widens: the words are searched literally AND the concept by meaning, and matching documents rank higher — nothing is required and nothing gets flagged. The safe choice when you want the words to count.',
}

const MODE_ORDER: StudioBlockMode[] = ['MATCH', 'EXPAND', 'BOTH']

interface QueryCanvasProps {
  plan: StudioPlan
  disabled?: boolean
  onChange: (next: StudioPlan, editSummary: string) => void
}

function modeClasses(mode: StudioBlockMode, active: boolean): string {
  if (!active) return 'text-muted-foreground hover:bg-muted hover:text-foreground'
  if (mode === 'EXPAND') return 'bg-lamp-600 text-white shadow-sm'
  if (mode === 'BOTH') return 'bg-brass-600 text-white shadow-sm'
  // MATCH is the only mode that can remove documents — give it the strongest,
  // most "stop"-like weight so its cost is visible before it is chosen.
  return 'bg-foreground text-background shadow-sm'
}

function blockAccent(mode: StudioBlockMode): string {
  if (mode === 'EXPAND') return 'border-l-[3px] border-l-lamp-500'
  if (mode === 'BOTH') return 'border-l-[3px] border-l-brass-500'
  return 'border-l-[3px] border-l-foreground'
}

/** One-word statement of what this mode does to the result set. */
const MODE_EFFECT: Record<StudioBlockMode, { label: string; classes: string }> = {
  MATCH: { label: 'requires', classes: 'bg-foreground/10 text-foreground' },
  EXPAND: { label: 'widens', classes: 'bg-lamp-100 text-lamp-700 dark:bg-lamp-950/50 dark:text-lamp-300' },
  BOTH: { label: 'widens', classes: 'bg-brass-100 text-brass-800 dark:bg-brass-950/50 dark:text-brass-300' },
}

export function QueryCanvas({ plan, disabled, onChange }: QueryCanvasProps) {
  const [newTermFor, setNewTermFor] = useState<string | null>(null)
  const [newTermText, setNewTermText] = useState('')

  const update = (mutate: (draft: StudioPlan) => string) => {
    const draft: StudioPlan = JSON.parse(JSON.stringify(plan))
    const summary = mutate(draft)
    onChange(draft, summary)
  }

  const addTerm = (blockId: string) => {
    const text = newTermText.trim()
    setNewTermText('')
    setNewTermFor(null)
    if (!text) return
    update(draft => {
      const block = draft.blocks.find(b => b.id === blockId)
      if (block && !block.terms.some(t => t.text.toLowerCase() === text.toLowerCase())) {
        block.terms.push({ text, origin: 'user', accepted: true })
      }
      return `Added term "${text}"`
    })
  }

  const suggestionCount =
    plan.blocks.reduce((n, b) => n + b.terms.filter(t => !t.accepted).length, 0) +
    plan.cpc.filter(c => !c.accepted).length +
    plan.notTerms.filter(t => !t.accepted).length

  const acceptAll = () =>
    update(draft => {
      let n = 0
      draft.blocks.forEach(b => b.terms.forEach(t => { if (!t.accepted) { t.accepted = true; n += 1 } }))
      draft.cpc.forEach(c => { if (!c.accepted) { c.accepted = true; n += 1 } })
      draft.notTerms.forEach(t => { if (!t.accepted) { t.accepted = true; n += 1 } })
      return `Accepted all ${n} Copilot suggestions (bulk)`
    })

  const renderChip = (
    term: { text: string; accepted: boolean; origin: string },
    onAccept: () => void,
    onRemove: () => void,
    key: string
  ) => {
    if (!term.accepted) {
      return (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-lamp-400/60 bg-lamp-50 px-2.5 py-0.5 text-xs text-lamp-700 dark:bg-lamp-950/40 dark:text-lamp-300"
          title="Suggested by the query generator — does nothing until you accept it"
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          {term.text}
          <button type="button" aria-label={`Accept suggestion ${term.text}`} className="ml-0.5 rounded-full p-1 hover:bg-lamp-100 dark:hover:bg-lamp-900 sm:p-0.5" onClick={onAccept} disabled={disabled}>
            <Check className="h-3 w-3" />
          </button>
          <button type="button" aria-label={`Reject suggestion ${term.text}`} className="rounded-full p-1 hover:bg-lamp-100 dark:hover:bg-lamp-900 sm:p-0.5" onClick={onRemove} disabled={disabled}>
            <X className="h-3 w-3" />
          </button>
        </span>
      )
    }
    return (
      <span key={key} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground">
        {term.text}
        <button type="button" aria-label={`Remove ${term.text}`} className="rounded-full p-1 text-muted-foreground hover:text-destructive sm:p-0.5" onClick={onRemove} disabled={disabled}>
          <X className="h-3 w-3" />
        </button>
      </span>
    )
  }

  const renderBlock = (block: StudioBlock, index: number) => (
    <div key={block.id}>
      {index > 0 && <div className="my-2 flex items-center gap-2" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground">AND</span>
          <span className="h-px flex-1 bg-border" />
        </div>}
      <div className={`rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow ${blockAccent(block.mode)}`}>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">{block.label}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${MODE_EFFECT[block.mode].classes}`}>
            {MODE_EFFECT[block.mode].label}
          </span>
          <Hint title={`${block.mode} block`} text={MODE_HELP[block.mode]} />
          <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border bg-background" role="group" aria-label={`${block.label} matching mode`}>
            {MODE_ORDER.map(mode => (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                className={`px-2.5 py-1 text-[10px] font-bold tracking-wide transition-colors ${modeClasses(mode, block.mode === mode)}`}
                onClick={() =>
                  update(draft => {
                    const b = draft.blocks.find(x => x.id === block.id)
                    if (b) b.mode = mode
                    return `Block "${block.label}" set to ${mode}`
                  })
                }
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={`Remove block ${block.label}`}
            className="rounded p-1 text-muted-foreground hover:text-destructive"
            disabled={disabled}
            onClick={() => update(draft => {
              draft.blocks = draft.blocks.filter(b => b.id !== block.id)
              return `Removed block "${block.label}"`
            })}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {block.terms.map((term, i) =>
            renderChip(
              term,
              () => update(draft => {
                const t = draft.blocks.find(b => b.id === block.id)?.terms[i]
                if (t) t.accepted = true
                return `Accepted "${term.text}" (Copilot suggestion)`
              }),
              () => update(draft => {
                const b = draft.blocks.find(x => x.id === block.id)
                if (b) b.terms = b.terms.filter((_, j) => j !== i)
                return term.accepted ? `Removed term "${term.text}"` : `Rejected suggestion "${term.text}"`
              }),
              `${block.id}:${i}`
            )
          )}
          {newTermFor === block.id ? (
            <input
              autoFocus
              value={newTermText}
              onChange={e => setNewTermText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addTerm(block.id)
                if (e.key === 'Escape') { setNewTermFor(null); setNewTermText('') }
              }}
              onBlur={() => addTerm(block.id)}
              placeholder="term or phrase…"
              className="w-32 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={`New term for ${block.label}`}
            />
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setNewTermFor(block.id)}
              disabled={disabled}
            >
              <Plus className="h-3 w-3" /> term
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Query canvas</span>
        <Hint
          title="How the canvas works"
          text="Each box is one concept of the invention; the boxes are AND-ed together. Words inside a box are alternatives (OR). Dashed blue chips are AI suggestions — they do nothing until you accept them, so you stay in full control of the query."
        />
        {suggestionCount > 0 && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-lamp-50 px-2.5 py-0.5 text-[11px] font-semibold text-lamp-700 hover:bg-lamp-100 dark:bg-lamp-950/40 dark:text-lamp-300"
            onClick={acceptAll}
            disabled={disabled}
          >
            <Sparkles className="h-3 w-3" /> Accept all {suggestionCount} suggestions
          </button>
        )}
      </div>

      {plan.blocks.map(renderBlock)}

      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        disabled={disabled}
        onClick={() =>
          update(draft => {
            const id = `b${Date.now().toString(36)}`
            draft.blocks.push({ id, label: `Concept ${draft.blocks.length + 1}`, mode: 'MATCH', terms: [] })
            return 'Added a concept block'
          })
        }
      >
        <Plus className="h-3.5 w-3.5" /> Add concept block
      </button>

      {/* CPC classifications */}
      <div className="rounded-lg border border-border bg-card p-2.5 border-l-4 border-l-amber-600/70">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-semibold">Classifications (CPC)</span>
          <Hint
            title="CPC codes"
            text="Patent offices file every document into classification codes. Adding the right codes finds documents that words alone miss. Hover a suggested code to see its plain-language meaning before accepting it."
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.cpc.map((entry, i) => {
            const chip = { text: entry.code, accepted: entry.accepted, origin: entry.origin }
            return (
              <span key={`cpc-${i}`} title={entry.definition || undefined}>
                {renderChip(
                  chip,
                  () => update(draft => { draft.cpc[i].accepted = true; return `Accepted CPC ${entry.code}` }),
                  () => update(draft => { draft.cpc = draft.cpc.filter((_, j) => j !== i); return entry.accepted ? `Removed CPC ${entry.code}` : `Rejected CPC suggestion ${entry.code}` }),
                  `cpc-chip-${i}`
                )}
              </span>
            )
          })}
          {!plan.cpc.length && <span className="text-xs text-muted-foreground">None yet — the generator suggests these, or add via “term”.</span>}
        </div>
      </div>

      {/* Invention elements — drive per-element probes, the strips and the grid */}
      <div className="rounded-lg border border-border bg-card p-2.5 border-l-4 border-l-emerald-600/70">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-semibold">Invention elements</span>
          <Hint
            title="What these do"
            text="Each element is one essential feature of the invention, in a short sentence. They drive a dedicated meaning-probe per element, the E1/E2 evidence strips on every result, and the Element Grid analysis. Edit them freely — the next run re-scores everything."
          />
        </div>
        <div className="space-y-1.5">
          {plan.elements.map((element, i) => (
            <div key={element.id} className="flex items-center gap-1.5">
              <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                E{i + 1}
              </span>
              <input
                defaultValue={element.text}
                key={element.id + element.text}
                disabled={disabled}
                onBlur={e => {
                  const text = e.target.value.trim()
                  if (!text || text === element.text) return
                  update(draft => {
                    const el = draft.elements.find(x => x.id === element.id)
                    if (el) {
                      el.text = text
                      el.origin = 'user'
                    }
                    return `Edited element E${i + 1}`
                  })
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-foreground transition-colors hover:border-border focus:border-border focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label={`Element ${i + 1}`}
              />
              <button
                type="button"
                aria-label={`Remove element ${i + 1}`}
                disabled={disabled}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  update(draft => {
                    draft.elements = draft.elements.filter(x => x.id !== element.id)
                    return `Removed element E${i + 1}`
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {!plan.elements.length && (
            <p className="text-xs text-muted-foreground">
              None yet — the query generator drafts these from your description, or add them by hand.
            </p>
          )}
          <button
            type="button"
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() =>
              update(draft => {
                draft.elements.push({ id: `e${Date.now().toString(36)}`, text: 'New element — describe one essential feature', origin: 'user' })
                return 'Added an element'
              })
            }
          >
            <Plus className="h-3 w-3" /> element
          </button>
        </div>
      </div>

      {/* NOT block */}
      <div className="rounded-lg border border-dashed border-border bg-card p-2.5 border-l-4 border-l-red-600/70">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-semibold">Exclude (NOT)</span>
          <Hint
            title="Excluded terms"
            text="Documents containing these words are pushed out of the results — useful when your terms collide with an unrelated field (e.g. surgical drivers vs. automotive torque wrenches)."
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.notTerms.map((term, i) =>
            renderChip(
              term,
              () => update(draft => { draft.notTerms[i].accepted = true; return `Accepted exclusion "${term.text}"` }),
              () => update(draft => { draft.notTerms = draft.notTerms.filter((_, j) => j !== i); return `Removed exclusion "${term.text}"` }),
              `not-${i}`
            )
          )}
          {!plan.notTerms.length && <span className="text-xs text-muted-foreground">Nothing excluded.</span>}
        </div>
      </div>
    </div>
  )
}
