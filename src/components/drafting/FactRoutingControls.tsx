'use client'

// Per-fact destination controls for Stage 0's Support Data tab.
//
// Two true axes (claimUse, figureUse) plus one derived axis (Description =
// sectionTargets includes 'detailedDescription'). The six claim states are the
// schema's six states relabeled — never collapsed: `do_not_claim` drives the
// guardrail path (isSupportDataGuardrail) and `fallback` is claim-bearing, so
// merging any of them would silently change what drafting does.

import React from 'react'
import {
  defaultClaimUse,
  defaultFigureUse,
  type SupportClaimUse,
  type SupportDataSource,
  type SupportFigureUse,
} from '@/lib/support-data-sources'

// Light house-style tooltip (same pattern as PreliminaryClaimsStage) — not the
// dark bg-gray-900 variant that predates the Cobalt & Oxford system.
export const RoutingTooltip = ({
  children,
  content,
  align = 'center',
  className = '',
}: {
  children: React.ReactNode
  content: string
  align?: 'center' | 'start' | 'end'
  className?: string
}) => (
  <div className={`group/tip relative ${className}`}>
    {children}
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-50 mt-2 hidden w-60 rounded-lg border border-paper-300 bg-white px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-ai-graphite-600 shadow-lg group-hover/tip:block
        ${align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
    >
      {content}
    </span>
  </div>
)

export const CLAIM_USE_OPTIONS: Array<{ value: SupportClaimUse; label: string; help: string }> = [
  { value: 'core', label: 'Claim 1', help: 'The heart of the invention. Goes into independent claim 1.' },
  { value: 'dependent', label: 'Dependent', help: 'A refinement worth its own dependent claim.' },
  { value: 'fallback', label: 'Fallback', help: 'A reserve position: fully described now so it can be claimed later if the broader claims are narrowed.' },
  { value: 'background_only', label: 'Background', help: 'Context for the background section. Never claimed.' },
  { value: 'do_not_claim', label: 'Keep out', help: 'A guardrail: drafting is explicitly told not to claim this.' },
  { value: 'none', label: 'Not claimed', help: 'Not for the claims, but can still appear in the description.' },
]

export const FIGURE_USE_OPTIONS: Array<{ value: SupportFigureUse; label: string; help: string }> = [
  { value: 'include', label: 'Draw', help: 'Appears in the figures.' },
  { value: 'optional', label: 'If needed', help: 'Illustrator may include it.' },
  { value: 'do_not_show', label: "Don't draw", help: 'Kept out of the figures.' },
]

const segmentClass = (active: boolean) =>
  `rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
    active
      ? 'bg-ai-blue-600 text-white'
      : 'text-ai-graphite-600 hover:bg-paper-100 hover:text-ai-graphite-900'
  }`

function AxisLabel({ label, changed }: { label: string; changed: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
      {label}
      {changed && (
        <RoutingTooltip content="Changed from the suggested setting." align="start">
          <span className="block h-1.5 w-1.5 rounded-full bg-ai-blue-500" aria-label="Changed from suggested" />
        </RoutingTooltip>
      )}
    </span>
  )
}

export type FactRoutingPatch = Partial<Pick<SupportDataSource, 'claimUse' | 'figureUse' | 'sectionTargets'>>

export default function FactRoutingControls({
  source,
  disabled,
  onChange,
}: {
  source: SupportDataSource
  disabled: boolean
  onChange: (patch: FactRoutingPatch) => void
}) {
  const inDescription = source.sectionTargets.includes('detailedDescription')
  // "Out" would leave the fact with no destination — coerce would silently
  // re-default it, so keep the button honest by disabling it instead.
  const descriptionIsOnlyTarget = inDescription && source.sectionTargets.length === 1
  const claimChanged = source.claimUse !== defaultClaimUse(source.kind, source.status)
  const figureChanged = source.figureUse !== defaultFigureUse(source.kind)

  const setDescription = (include: boolean) => {
    if (include === inDescription) return
    const nextTargets = include
      ? [...source.sectionTargets, 'detailedDescription']
      : source.sectionTargets.filter(target => target !== 'detailedDescription')
    onChange({ sectionTargets: nextTargets })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5">
        <AxisLabel label="Claims" changed={claimChanged} />
        <div role="group" aria-label="Claims use" className="flex items-center rounded-md border border-paper-300 bg-white p-0.5">
          {CLAIM_USE_OPTIONS.map(option => (
            <RoutingTooltip key={option.value} content={option.help} align="start">
              <button
                type="button"
                onClick={() => onChange({ claimUse: option.value })}
                disabled={disabled}
                aria-pressed={source.claimUse === option.value}
                className={segmentClass(source.claimUse === option.value)}
              >
                {option.label}
              </button>
            </RoutingTooltip>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <AxisLabel label="Drawings" changed={figureChanged} />
        <div role="group" aria-label="Drawings use" className="flex items-center rounded-md border border-paper-300 bg-white p-0.5">
          {FIGURE_USE_OPTIONS.map(option => (
            <RoutingTooltip key={option.value} content={option.help} align="start">
              <button
                type="button"
                onClick={() => onChange({ figureUse: option.value })}
                disabled={disabled}
                aria-pressed={source.figureUse === option.value}
                className={segmentClass(source.figureUse === option.value)}
              >
                {option.label}
              </button>
            </RoutingTooltip>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <AxisLabel label="Description" changed={false} />
        <div role="group" aria-label="Description use" className="flex items-center rounded-md border border-paper-300 bg-white p-0.5">
          <RoutingTooltip content="Routed into the detailed description (final selection happens at the evidence step)." align="start">
            <button
              type="button"
              onClick={() => setDescription(true)}
              disabled={disabled}
              aria-pressed={inDescription}
              className={segmentClass(inDescription)}
            >
              In
            </button>
          </RoutingTooltip>
          <RoutingTooltip
            content={descriptionIsOnlyTarget
              ? 'This is the fact’s only destination — route it somewhere else first.'
              : 'Kept out of the detailed description.'}
            align="start"
          >
            <button
              type="button"
              onClick={() => setDescription(false)}
              disabled={disabled || descriptionIsOnlyTarget}
              aria-pressed={!inDescription}
              className={segmentClass(!inDescription)}
            >
              Out
            </button>
          </RoutingTooltip>
        </div>
      </div>
    </div>
  )
}
