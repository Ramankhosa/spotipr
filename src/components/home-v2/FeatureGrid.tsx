// Capability blocks for the homepage, "Paper and Ink" treatment.
//
// Each capability is drawn as a patent figure rather than shown as a shrunken
// screenshot of the UI. The drawings live in FeatureFigures.tsx and share one
// line language; see that file for the colour contract.
//
// Every block has exactly three slots, and the consistency is what turns eleven
// drawings into a system:
//   1. THE PLATE — a hairline-boxed figure on the vellum ground.
//   2. THE CAPTION BAR — mono, split: figure number left, the single fact that
//      figure proves right. This replaces the old coloured status chips.
//   3. THE TEXT — title, benefit copy, one mono link. No icon: the drawing is
//      the icon, which is why eleven lucide glyphs left the page.
//
// Figure numbers run FIG. 3 upward because the hero is FIG. 1 and the system
// flow diagram is FIG. 2 — the homepage reads as the drawings section of one
// document, so inserting a section above this one means renumbering here.
//
// Every block links to its /features/* detail page. The block is the claim; the
// detail page is the evidence. (These used to point at /dashboard, which bounced
// signed-out visitors to the login screen.)

import Link from 'next/link'
import Reveal from './Reveal'
import {
  FigBatch,
  FigClaims,
  FigDrawings,
  FigExport,
  FigIdeation,
  FigNovelty,
  FigOfficeAction,
  FigPersona,
  FigReview,
  FigSpecification,
  FigWhitespace,
} from './FeatureFigures'

type Capability = {
  fig: string
  proves: string
  title: string
  copy: string
  href: string
  cta: string
  Figure: () => JSX.Element
}

const CAPABILITIES: Capability[] = [
  {
    fig: 'FIG. 3',
    proves: '2 OF 4 FEATURES CLEAR',
    title: 'Smart novelty search',
    copy: '55M+ documents mapped against your invention feature by feature — so you see exactly which parts are yours and which are already taken.',
    href: '/features/novelty-search-report',
    cta: 'EXPLORE NOVELTY',
    Figure: FigNovelty,
  },
  {
    fig: 'FIG. 4',
    proves: '3 AXES OPENED',
    title: 'Ideation',
    copy: 'One disclosure is rarely one invention. We open the space around it — the axes it varies along, and the assumptions it did not know it was making.',
    href: '/features/ideation',
    cta: 'SEE HOW IDEATION WORKS',
    Figure: FigIdeation,
  },
  {
    fig: 'FIG. 5',
    proves: 'GAPS THAT SURVIVE ATTACK',
    title: 'Whitespace studies',
    copy: 'Most empty space is empty for a reason. Every gap is attacked six ways before we call it an opening — the ones that collapse never reach your report.',
    href: '/features/whitespace',
    cta: 'EXPLORE WHITESPACE',
    Figure: FigWhitespace,
  },
  {
    fig: 'FIG. 6',
    proves: 'SCOPE, NARROWED ON PURPOSE',
    title: 'Claims engineered with evidence',
    copy: 'Broad to narrow, every limitation traced back to a paragraph that supports it — and every boundary drawn where the art forces it, not by guesswork.',
    href: '/features/drafting-pipeline',
    cta: 'VIEW CLAIM STUDIO',
    Figure: FigClaims,
  },
  {
    fig: 'FIG. 7',
    proves: 'YOUR STYLE, YOUR JURISDICTION',
    title: 'Complete specifications',
    copy: 'Draft full specifications with running paragraph numbers, in the structure each office expects — consistent enough to review quickly.',
    href: '/features/drafting-pipeline',
    cta: 'SEE DRAFTING STUDIO',
    Figure: FigSpecification,
  },
  {
    fig: 'FIG. 8',
    proves: 'SKETCH → EXAMINER-READY',
    title: 'From sketch to patent drawings',
    copy: 'Upload a napkin sketch or a photo. Get back formal figures with consistent numerals, captions, and the line weights each office expects.',
    href: '/features/drafting-pipeline',
    cta: 'TRY DRAWING STUDIO',
    Figure: FigDrawings,
  },
  {
    fig: 'FIG. 9',
    proves: 'CAUGHT BEFORE FILING',
    title: 'AI review and validation',
    copy: 'Claim support, internal consistency, undefined terms and formal requirements — checked while there is still time to fix them.',
    href: '/features/drafting-pipeline',
    cta: 'RUN AI REVIEW',
    Figure: FigReview,
  },
  {
    fig: 'FIG. 10',
    proves: 'OBJECTION → RESPONSE',
    title: 'Office action studio',
    copy: 'Read the objection, pick a strategy, and draft the response with every amendment checked against the specification before it goes back.',
    href: '/features/fer-response',
    cta: 'EXPLORE OA STUDIO',
    Figure: FigOfficeAction,
  },
  {
    fig: 'FIG. 11',
    proves: '3 OF 4 SECTIONS LEARNED',
    title: 'Writing personas',
    copy: 'Teach it how you write by pasting passages from your own patents — section by section. Keep it private, or publish one as the firm standard.',
    href: '/features/writing-personas',
    cta: 'SEE STYLE TRANSFER',
    Figure: FigPersona,
  },
  {
    fig: 'FIG. 12',
    proves: 'ONE STYLE ACROSS A PORTFOLIO',
    title: 'Batch drafting',
    copy: 'Process many inventions at once and hold tone, style and structure consistent across a whole portfolio.',
    href: '/features/drafting-pipeline',
    cta: 'VIEW BATCH DASHBOARD',
    Figure: FigBatch,
  },
  {
    fig: 'FIG. 13',
    proves: 'DRAFT + FIGURES + FORMS',
    title: 'A filing-ready package, not just a draft',
    copy: 'The specification, the claims, the figures and the statutory forms your office requires — assembled together, in the formats it accepts, ready to go to the patent office.',
    href: '/features/drafting-pipeline',
    cta: 'SEE WHAT YOU GET',
    Figure: FigExport,
  },
]

export default function FeatureGrid() {
  return (
    <section id="features" className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <div className="mb-14 border-t-2 border-vellum-900 pt-6">
        <p className="font-mono text-[10.5px] tracking-[0.2em] text-ink-examiner">
          FIGS. 3–13 — THE CAPABILITIES
        </p>
        <h2 className="mt-3 max-w-[20ch] text-[clamp(30px,4.6vw,58px)] font-bold leading-[0.98] tracking-[-0.035em] text-vellum-900">
          Every claim on this page is drawn.
        </h2>
        <p className="mt-4 max-w-[58ch] text-[16.5px] leading-[1.6] text-vellum-700">
          Each figure below shows the actual mechanism — what gets searched, what gets
          attacked, what gets supported. Not a screenshot of the software that does it.
        </p>
      </div>

      <div className="grid gap-x-10 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map(({ fig, proves, title, copy, href, cta, Figure }, i) => (
          <Reveal key={fig} delay={(i % 3) * 0.06}>
            <article className="flex h-full flex-col">
              <div className="border border-vellum-900 bg-vellum-100">
                <Figure />
                <div className="flex items-baseline justify-between gap-3 border-t border-vellum-900 px-2.5 py-1.5 font-mono text-[8.5px] tracking-[0.14em] text-vellum-600">
                  <span>{fig}</span>
                  <span className="text-right">{proves}</span>
                </div>
              </div>

              <h3 className="mb-1.5 mt-4 text-[19px] font-semibold tracking-[-0.02em] text-vellum-900">
                {title}
              </h3>
              <p className="mb-3.5 flex-1 text-[13.5px] leading-[1.6] text-vellum-700">{copy}</p>
              <Link
                href={href}
                className="self-start border-b border-lamp-600 pb-0.5 font-mono text-[10.5px] tracking-[0.1em] text-lamp-600 transition-colors hover:text-lamp-700"
              >
                {cta} →
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
