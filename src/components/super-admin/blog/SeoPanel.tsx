'use client'

// The live audit rail: a score, the checks behind it, and a Google preview.
//
// It updates on every keystroke because feedback after the fact is feedback
// nobody acts on. Failing checks sort to the top with the fix stated in the
// imperative — an author should never have to consult the strategy doc to know
// what to do next. The score advises; it never blocks a publish.

import { useMemo } from 'react'
import { AlertTriangle, Check, ChevronDown, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SeoAuditResult, CheckStatus, CheckGroup } from '@/lib/blog/seo-audit'
import { scoreBand } from '@/lib/blog/seo-audit'

const GROUP_LABELS: Record<CheckGroup, { title: string; blurb: string }> = {
  search: { title: 'Search', blurb: 'Classic on-page signals — what Google ranks.' },
  answer: { title: 'Answer engines', blurb: 'What makes the page quotable by AI Overviews and chat assistants.' },
  trust: { title: 'Trust', blurb: 'E-E-A-T: sources, bylines, and honest metadata.' },
}

const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <Check className="h-3.5 w-3.5 text-emerald-600" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  fail: <AlertTriangle className="h-3.5 w-3.5 text-wax-600" />,
}

const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 }

function ScoreDial({ score }: { score: number }) {
  const band = scoreBand(score)
  const tone =
    band.tone === 'good' ? 'text-emerald-600' : band.tone === 'ok' ? 'text-amber-500' : 'text-wax-600'
  const circumference = 2 * Math.PI * 30

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[72px] w-[72px] shrink-0">
        <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
          <circle cx="36" cy="36" r="30" fill="none" stroke="#e4e7ec" strokeWidth="6" />
          <circle
            cx="36" cy="36" r="30" fill="none" strokeWidth="6" strokeLinecap="round"
            className={cn('transition-all duration-500', tone)}
            stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score / 100)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-ai-graphite-900">
          {score}
        </span>
      </div>
      <div>
        <p className={cn('text-sm font-semibold', tone)}>{band.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-ai-graphite-500">
          Weighted across {Object.keys(GROUP_LABELS).length} groups. Advisory — you can publish at
          any score.
        </p>
      </div>
    </div>
  )
}

export default function SeoPanel({
  audit,
  title,
  slug,
  description,
}: {
  audit: SeoAuditResult
  title: string
  slug: string
  description: string
}) {
  const groups = useMemo(() => {
    return (Object.keys(GROUP_LABELS) as CheckGroup[]).map((group) => ({
      group,
      checks: audit.checks
        .filter((check) => check.group === group)
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    }))
  }, [audit.checks])

  const stat = (label: string, value: string | number) => (
    <div key={label} className="rounded border border-paper-200 bg-paper-50 px-2.5 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-ai-graphite-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ai-graphite-900">{value}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-paper-300 bg-white p-5">
        <ScoreDial score={audit.score} />

        <div className="mt-5 grid grid-cols-3 gap-2">
          {stat('Words', audit.stats.words.toLocaleString())}
          {stat('Read', `${audit.stats.readingMinutes} min`)}
          {stat('H2s', audit.stats.h2Count)}
          {stat('Density', `${audit.stats.keywordDensity}%`)}
          {stat('Internal', audit.stats.internalLinks)}
          {stat('Sources', audit.stats.externalLinks)}
        </div>
      </section>

      {/* SERP + AI answer preview */}
      <section className="rounded-lg border border-paper-300 bg-white p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
          Search preview
        </p>
        <div className="mt-3 rounded border border-paper-200 bg-paper-50 p-3">
          <p className="truncate text-xs text-ai-graphite-500">patentnest.ai › blog › {slug || '…'}</p>
          <p className="mt-1 line-clamp-2 text-[15px] leading-snug text-[#1a0dab]">
            {title || 'Untitled article'}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ai-graphite-600">
            {description || 'No meta description yet — search engines will invent one from the body.'}
          </p>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ai-graphite-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Title {audit.stats.titleChars}/65 chars · description {audit.stats.metaChars}/165 chars ·
          direct answer {audit.stats.answerWords}/80 words · {audit.stats.faqCount} FAQs.
        </p>
      </section>

      {groups.map(({ group, checks }) => {
        const failing = checks.filter((c) => c.status !== 'pass').length
        return (
          <details key={group} open={failing > 0} className="group rounded-lg border border-paper-300 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 [&::-webkit-details-marker]:hidden">
              <div>
                <p className="text-sm font-semibold text-ai-graphite-900">{GROUP_LABELS[group].title}</p>
                <p className="mt-0.5 text-[11px] text-ai-graphite-500">{GROUP_LABELS[group].blurb}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[10px]',
                    failing === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  )}
                >
                  {checks.length - failing}/{checks.length}
                </span>
                <ChevronDown className="h-4 w-4 text-ai-graphite-400 transition-transform group-open:rotate-180" />
              </div>
            </summary>

            <ul className="divide-y divide-paper-200 border-t border-paper-200">
              {checks.map((check) => (
                <li key={check.id} className="px-5 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">{STATUS_ICON[check.status]}</span>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'text-[13px] leading-snug',
                          check.status === 'pass' ? 'text-ai-graphite-500' : 'font-medium text-ai-graphite-900'
                        )}
                      >
                        {check.label}
                      </p>
                      {check.status !== 'pass' && (
                        <p className="mt-1 text-[11.5px] leading-relaxed text-ai-graphite-500">
                          {check.hint}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )
      })}
    </div>
  )
}
