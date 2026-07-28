// Capability cards for the homepage. Each card pairs a benefit line with a small
// in-card preview of the real artifact — table, claim set, review queue — so the
// grid shows the product instead of describing it.
//
// Every card links to its /features/* detail page. The card is the claim; the
// detail page is the evidence. (Cards used to point at /dashboard, which bounced
// signed-out visitors to the login screen — the deep-dive page is both a better
// destination and one that works for everyone.)

import Link from 'next/link'
import {
  Download,
  FileStack,
  FileText,
  Fingerprint,
  Lightbulb,
  MessageSquareReply,
  PenLine,
  Radar,
  ScanSearch,
  Shapes,
  ShieldCheck,
} from 'lucide-react'
import Reveal from './Reveal'

const DOT: Record<string, string> = {
  high: 'bg-wax-400',
  mid: 'bg-[#f59e0b]',
  low: 'bg-[#10b981]',
  none: 'bg-paper-300',
}

const CHIP: Record<string, string> = {
  good: 'bg-[#ecfdf5] text-[#047857]',
  warn: 'bg-[#fffbeb] text-[#b45309]',
  bad: 'bg-wax-100 text-wax-600',
  info: 'bg-lamp-50 text-lamp-700',
  mute: 'bg-paper-100 text-paper-600',
}

function Card({
  title,
  copy,
  icon: Icon,
  href,
  cta,
  wide = false,
  children,
}: {
  title: string
  copy: string
  icon: React.ElementType
  href: string
  cta: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border border-paper-300 bg-white p-6 transition-all duration-200 hover:border-paper-400 hover:shadow-[0_16px_38px_-22px_rgba(16,24,40,0.26)] ${
        wide ? '' : ''
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <h3 className="text-[16.5px] font-medium leading-snug tracking-[-0.012em] text-ai-graphite-900">
          {title}
        </h3>
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-lamp-50">
          <Icon className="h-4 w-4 text-lamp-600" strokeWidth={1.7} />
        </span>
      </div>

      <p className="mb-5 text-[13.5px] leading-[1.6] text-paper-600">{copy}</p>

      <div className="mb-5 flex-1">{children}</div>

      <Link
        href={href}
        className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-lamp-600 transition-colors hover:text-lamp-700"
      >
        {cta}
        <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
      </Link>
    </div>
  )
}

function Preview({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-paper-300/80 bg-paper-50/70 p-3.5">{children}</div>
  )
}

export default function FeatureGrid() {
  return (
    <section id="features" className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <div className="grid gap-5 lg:grid-cols-3">
        <Reveal>
          <Card
            title="Smart novelty search"
            copy="30M+ patent documents searched and mapped against your invention features, feature by feature."
            icon={ScanSearch}
            href="/features/novelty-search-report"
            cta="Explore novelty"
          >
            <Preview>
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-2 text-[10.5px]">
                <span className="text-[9.5px] uppercase tracking-wider text-paper-500">Feature</span>
                {['Ref A', 'Ref B', 'Ref C'].map((h) => (
                  <span key={h} className="text-[9.5px] uppercase tracking-wider text-paper-500">
                    {h}
                  </span>
                ))}
                {[
                  ['Adaptive calibration', 'mid', 'low', 'none'],
                  ['Predictive model', 'high', 'high', 'high'],
                  ['Modular chamber', 'low', 'mid', 'low'],
                  ['Self-correcting loop', 'low', 'low', 'mid'],
                ].map(([label, a, b, c]) => (
                  <div key={label} className="contents">
                    <span className="truncate text-ai-graphite-700">{label}</span>
                    {[a, b, c].map((tone, i) => (
                      <span key={i} className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
                    ))}
                  </div>
                ))}
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <Card
            title="Ideation"
            copy="One disclosure is rarely one invention. Open the space around it — the axes it varies along, and the assumptions it did not know it was making."
            icon={Lightbulb}
            href="/features/ideation"
            cta="See how ideation works"
          >
            <Preview>
              <div className="space-y-2.5">
                {[
                  ['Reference source', 'stored → derived → inferred'],
                  ['Correction timing', 'per interval → event-driven'],
                  ['Actuation coupling', 'direct → mediated'],
                ].map(([axis, moves]) => (
                  <div key={axis}>
                    <p className="text-[10.5px] font-medium text-ai-graphite-900">{axis}</p>
                    <p className="font-mono text-[9px] leading-[1.5] text-paper-600">{moves}</p>
                  </div>
                ))}
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.12}>
          <Card
            title="Whitespace studies"
            copy="Most empty space is empty for a reason. Every gap is attacked — six adversarial searches and six gates — before it is reported as an opening."
            icon={Radar}
            href="/features/whitespace"
            cta="Explore whitespace"
          >
            <Preview>
              <div className="space-y-1.5 text-[10.5px]">
                {[
                  ['Synonym shifted', 'good', 'CLEAN'],
                  ['Semantic paraphrase', 'warn', 'WEAKENING'],
                  ['CPC adjacent', 'good', 'CLEAN'],
                  ['Assignee pivot', 'warn', 'WEAKENING'],
                  ['Red team', 'good', 'CLEAN'],
                ].map(([label, tone, outcome]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ai-graphite-700">{label}</span>
                    <span className={`flex-none rounded px-1.5 py-0.5 text-[9px] font-medium ${CHIP[tone]}`}>
                      {outcome}
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <Card
            title="Claims engineered with evidence"
            copy="Develop broad-to-narrow claim sets with real-time support checking, prior art awareness, and antecedent validation."
            icon={PenLine}
            href="/features/drafting-pipeline"
            cta="View claim studio"
          >
            <Preview>
              <div className="space-y-2.5 text-[10.5px]">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-ai-graphite-700">
                    <span className="font-mono text-lamp-600">1.</span> A system for adaptive
                    environmental…
                  </span>
                  <span className={`flex-none rounded px-1.5 py-0.5 text-[9px] font-medium ${CHIP.good}`}>
                    Supported
                  </span>
                </div>
                <p className="font-mono text-[9px] text-paper-500">↑ [0041] · Fig. 2</p>
                <div className="h-px bg-paper-300" />
                <p className="text-ai-graphite-700">
                  <span className="font-mono text-lamp-600">2.</span> The system of claim 1,
                  wherein…
                </p>
                <p className="text-ai-graphite-700">
                  <span className="font-mono text-lamp-600">3.</span> The system of claim 1,
                  wherein…
                </p>
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.12}>
          <Card
            title="Complete specifications"
            copy="Draft full specifications in your preferred style and jurisdiction — consistent, structured, and ready for review."
            icon={FileText}
            href="/features/drafting-pipeline"
            cta="See drafting studio"
          >
            <Preview>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {['IPO', 'USPTO', 'EPO', 'PCT', 'JPO'].map((j, i) => (
                  <span
                    key={j}
                    className={`rounded-md px-2 py-1 text-[9.5px] font-medium ${
                      i === 0 ? CHIP.info : CHIP.mute
                    }`}
                  >
                    {j}
                  </span>
                ))}
              </div>
              <p className="mb-1.5 text-[9px] uppercase tracking-wider text-paper-500">
                Detailed description
              </p>
              <div className="space-y-1 font-mono text-[9.5px] text-ai-graphite-700">
                <p>[0041] The system includes…</p>
                <p>[0042] The controller is configured…</p>
                <p>[0063] The sensor array…</p>
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <Card
            title="From sketch to patent drawings"
            copy="Upload a sketch or an image and turn it into examiner-ready figures with accurate numerals and captions."
            icon={Shapes}
            href="/features/drafting-pipeline"
            cta="Try drawing studio"
          >
            <Preview>
              <div className="flex items-center gap-2.5">
                <div className="flex-1 rounded-lg border border-paper-300 bg-white p-2">
                  <svg viewBox="0 0 90 58" className="w-full">
                    <g fill="none" stroke="#98a2b3" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M18 44 L30 14 L60 14 L72 44 Z" />
                      <path d="M30 28 L60 28" />
                      <path d="M45 28 L45 44" />
                    </g>
                  </svg>
                  <p className="text-center font-mono text-[8px] text-paper-500">sketch</p>
                </div>
                <span className="flex-none text-lamp-600">→</span>
                <div className="flex-1 rounded-lg border border-paper-300 bg-white p-2">
                  <svg viewBox="0 0 90 58" className="w-full">
                    <g fill="none" stroke="#101828" strokeWidth="1.3" strokeLinecap="round">
                      <path d="M18 44 L30 14 L60 14 L72 44 Z" />
                      <path d="M30 28 L60 28" />
                      <path d="M45 28 L45 44" />
                    </g>
                    <g stroke="#98a2b3" strokeWidth="0.7" strokeDasharray="2 2">
                      <path d="M60 14 L74 8" />
                      <path d="M60 28 L78 24" />
                    </g>
                    <text x="76" y="7" fontSize="7" fill="#1d4ed8" fontFamily="monospace">
                      120
                    </text>
                    <text x="80" y="24" fontSize="7" fill="#1d4ed8" fontFamily="monospace">
                      140
                    </text>
                  </svg>
                  <p className="text-center font-mono text-[8px] text-paper-500">FIG. 3</p>
                </div>
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.12}>
          <Card
            title="AI review and validation"
            copy="Catch issues early — claim support, internal consistency, undefined terms, and formal requirements."
            icon={ShieldCheck}
            href="/features/drafting-pipeline"
            cta="Run AI review"
          >
            <Preview>
              <div className="space-y-2 text-[10.5px]">
                {[
                  ['Claim 4 lacks antecedent support', 'Critical', 'bad'],
                  ['Fig. 3 numeral mismatch', 'Critical', 'bad'],
                  ['Undefined term: “adaptive threshold”', 'Moderate', 'warn'],
                  ['Abstract exceeds length limit', 'Advisory', 'info'],
                ].map(([label, tag, tone]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ai-graphite-700">{label}</span>
                    <span className={`flex-none rounded px-1.5 py-0.5 text-[9px] font-medium ${CHIP[tone]}`}>
                      {tag}
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.18}>
          <Card
            title="Office action studio"
            copy="Analyse objections, choose a strategy, and draft powerful responses with support verification."
            icon={MessageSquareReply}
            href="/features/fer-response"
            cta="Explore OA studio"
          >
            <Preview>
              <p className="mb-2.5 text-[10.5px] leading-[1.5] text-ai-graphite-700">
                <span className="font-medium">Objection:</span> Claim 1 lacks an inventive step
                over D1 in view of D2.
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {['Argue', 'Amend', 'Argue + amend'].map((s, i) => (
                  <div
                    key={s}
                    className={`rounded-lg border p-2 text-center text-[9.5px] font-medium ${
                      i === 2
                        ? 'border-lamp-300 bg-lamp-50 text-lamp-700'
                        : 'border-paper-300 bg-white text-paper-600'
                    }`}
                  >
                    {s}
                  </div>
                ))}
              </div>
              <p className="mt-2 font-mono text-[9px] text-paper-500">
                ↑ support: [0041], [0060], Fig. 4
              </p>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.24}>
          <Card
            title="Writing personas"
            copy="Teach it how you write by pasting passages from your own patents — section by section, jurisdiction by jurisdiction. Keep it private, or publish one as the firm standard."
            icon={Fingerprint}
            href="/features/writing-personas"
            cta="See style transfer"
          >
            <Preview>
              <div className="mb-2.5 flex items-baseline justify-between">
                <span className="text-[10.5px] font-medium text-ai-graphite-900">CSE patents</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${CHIP.warn}`}>
                  3 of 5
                </span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-paper-200">
                <div className="h-full w-[60%] rounded-full bg-lamp-500" />
              </div>
              <div className="space-y-1.5 text-[10.5px]">
                {[
                  ['Claims', 'good', 'covered'],
                  ['Detailed description', 'good', 'covered'],
                  ['Background', 'good', 'covered'],
                  ['Summary', 'mute', 'missing'],
                ].map(([label, tone, state]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ai-graphite-700">{label}</span>
                    <span className={`flex-none rounded px-1.5 py-0.5 text-[9px] font-medium ${CHIP[tone]}`}>
                      {state}
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
          </Card>
        </Reveal>
      </div>

      {/* two wide cards */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Reveal>
          <Card
            title="Batch drafting"
            copy="Process multiple inventions at once and hold tone, style, and structure consistent across a whole portfolio."
            icon={FileStack}
            href="/features/drafting-pipeline"
            cta="View batch dashboard"
            wide
          >
            <Preview>
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-2.5 text-[10.5px]">
                {['Invention', 'Novelty', 'Draft', 'Status'].map((h) => (
                  <span key={h} className="text-[9.5px] uppercase tracking-wider text-paper-500">
                    {h}
                  </span>
                ))}
                {[
                  ['Smart irrigation system', 72, 90, 'Drafting', 'info'],
                  ['Wearable health monitor', 55, 40, 'In review', 'warn'],
                  ['Modular drone dock', 88, 100, 'Complete', 'good'],
                  ['AI tutoring device', 34, 12, 'Info needed', 'mute'],
                ].map(([label, nov, draft, status, tone]) => (
                  <div key={label as string} className="contents">
                    <span className="truncate text-ai-graphite-700">{label}</span>
                    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-paper-200">
                      <span
                        className="block h-full rounded-full bg-lamp-500"
                        style={{ width: `${nov}%` }}
                      />
                    </span>
                    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-paper-200">
                      <span
                        className="block h-full rounded-full bg-[#10b981]"
                        style={{ width: `${draft}%` }}
                      />
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${CHIP[tone as string]}`}
                    >
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </Preview>
          </Card>
        </Reveal>

        <Reveal delay={0.08}>
          <Card
            title="Export anywhere"
            copy="Export filing-ready documents in every major format and the structures each patent office expects."
            icon={Download}
            href="/features/drafting-pipeline"
            cta="See export options"
            wide
          >
            <Preview>
              <div className="flex flex-wrap gap-1.5">
                {['DOCX', 'PDF', 'PCT XML', 'EPO XML', 'USPTO TXT'].map((f) => (
                  <span
                    key={f}
                    className="rounded-md border border-paper-300 bg-white px-2.5 py-1.5 font-mono text-[9.5px] font-medium text-ai-graphite-700"
                  >
                    {f}
                  </span>
                ))}
              </div>
              <div className="mt-3.5 flex items-center gap-3">
                <span className={`rounded px-2 py-1 text-[9.5px] font-medium ${CHIP.good}`}>
                  Filing ready
                </span>
                <div className="flex-1 border-t border-dashed border-paper-300" />
                <div className="flex -space-x-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-7 w-5 rounded-sm border border-paper-300 bg-white shadow-sm"
                    />
                  ))}
                </div>
              </div>
            </Preview>
          </Card>
        </Reveal>
      </div>
    </section>
  )
}
