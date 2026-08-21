'use client'

// Homepage hero, "Paper and Ink" treatment.
//
// The page is staged as sheet 1 of the visitor's own patent: warm vellum ground,
// sheet rules and zone marks in the margins, a patent figure instead of a
// product screenshot, and a title block whose approval row carries the pitch
// (DRAWN — PATENTNEST / CHECKED — YOU).
//
// Three rules make this read as premium rather than as another SaaS hero, and
// all three are load-bearing — changing any one of them undoes the effect:
//   1. Display type runs ~8x body size. That ratio, not the colour, is what
//      reads as confidence.
//   2. Data sits in HAIRLINE TABLES ON the ground, never in shadowed cards
//      floating above it. A card asks to be liked; a table asks to be read.
//   3. Colour is semantic only — cobalt is what we draft, red is what the
//      examiner would say, green is verified, amber is weakening. No decorative
//      colour anywhere.
//
// Type note: the app ships Inter (see layout.tsx) whose heaviest loaded weight
// is 700, so the display face is Inter 700 with tight tracking rather than a
// separate display family. font-mono falls through to Tailwind's default stack.
//
// Signed out, the primary action is /free-trial — access is REQUESTED and
// approved by a person, not self-serve. Signed in, it jumps into a new draft.

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import Reveal from './Reveal'

// 'Patent offices' is the DRAFTING coverage and must stay in step with the
// schedule in DraftingCoverage.tsx (which derives its own count from the
// jurisdiction list). 'Jurisdictions' is the search corpus, a different and
// larger number — don't collapse the two.
const STATS = [
  { label: 'Documents searched', value: '55M+', note: 'patent records' },
  { label: 'To a novelty verdict', value: '~15', note: 'minutes, not weeks' },
  { label: 'Patent offices', value: '32', note: 'drafting conventions held' },
  { label: 'Jurisdictions', value: '100+', note: 'searched for prior art' },
]

const INKS = [
  { label: 'COBALT — WHAT WE DRAFT', className: 'text-lamp-600' },
  { label: 'RED — WHAT THE EXAMINER WOULD', className: 'text-ink-examiner' },
  { label: 'GREEN — SUPPORTED', className: 'text-ink-verified' },
  { label: 'AMBER — WEAKENING', className: 'text-ink-weakening' },
]

export default function WorkspaceHero() {
  const { user } = useAuth()

  return (
    <section className="relative bg-vellum-200 px-5 pb-10 pt-8 text-vellum-900 sm:px-8">
      {/* sheet furniture: double rule and zone marks, the drawing-sheet chrome */}
      <div aria-hidden className="pointer-events-none absolute inset-3 hidden border border-vellum-400 sm:block">
        <div className="absolute inset-[5px] border border-vellum-300" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden font-mono text-[8px] tracking-[0.12em] text-vellum-500 sm:block"
      >
        <span className="absolute left-1/2 top-5">4</span>
        <span className="absolute bottom-5 left-1/2">4</span>
        <span className="absolute left-6 top-1/2">C</span>
        <span className="absolute right-6 top-1/2">C</span>
      </div>

      <div className="relative mx-auto max-w-[1240px]">
        <Reveal>
          <p className="mb-7 font-mono text-[10.5px] tracking-[0.2em] text-ink-examiner">
            FIG. 1 — THE INVENTION, AS FILED
          </p>

          {/* The 8:1 scale. Mixed weight inside one headline keeps a long line
              readable at display size — heavy on the nouns, light on the joins.
              Never promise a GRANT here: no drafting tool controls what an
              examiner allows, and an attorney reads that claim as overreach.
              The promise stops at what we actually deliver — a filing-ready
              package. */}
          <h1 className="mb-8 max-w-[16ch] text-[clamp(42px,9vw,126px)] font-bold leading-[0.9] tracking-[-0.042em] [text-wrap:balance]">
            From idea{' '}
            <span className="font-medium tracking-[-0.03em]">to</span> claims{' '}
            <span className="font-medium tracking-[-0.03em]">to</span> a{' '}
            <span className="text-lamp-600">filing-ready package.</span>
          </h1>
        </Reveal>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.96fr)] lg:gap-12">
          <Reveal delay={0.08}>
            <p className="mb-7 max-w-[46ch] text-[17px] leading-[1.62] text-vellum-700">
              Your disclosure becomes a drawing. The drawing becomes claims. The claims get
              attacked — by us, before any examiner does. What you file is a complete
              package: specification, figures, and the forms your office requires.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <Link
                href={user ? '/patents/draft/new' : '/free-trial'}
                className="bg-lamp-600 px-7 py-3.5 text-[14.5px] font-semibold text-white transition-colors duration-150 hover:bg-lamp-700 active:scale-[0.99]"
              >
                {user ? 'Start with my invention' : 'Request a free trial'}
              </Link>
              <Link
                href="#features"
                className="border-b-[1.5px] border-lamp-600 pb-[3px] font-mono text-[11.5px] tracking-[0.08em] text-vellum-900 transition-colors hover:text-lamp-700"
              >
                SEE THE PROCESS ↓
              </Link>
            </div>
          </Reveal>

          <Reveal delay={0.16}>
            <HeroFigure />
          </Reveal>
        </div>

        {/* the hairline stat table — the device that replaces the stat card */}
        <Reveal delay={0.24}>
          <dl className="mt-14 grid grid-cols-2 border border-vellum-900 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className={[
                  'border-vellum-900',
                  i % 2 === 1 ? 'border-l' : '',
                  i >= 2 ? 'border-t' : '',
                  'lg:border-t-0',
                  i > 0 ? 'lg:border-l' : 'lg:border-l-0',
                ].join(' ')}
              >
                <dt className="border-b border-vellum-900 px-3.5 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-vellum-600">
                  {s.label}
                </dt>
                <dd className="px-3.5 pb-5 pt-4 text-[clamp(26px,3.2vw,40px)] font-semibold leading-none tracking-[-0.032em] [font-variant-numeric:tabular-nums]">
                  {s.value}
                  <span className="mt-2 block text-[12px] font-normal tracking-normal text-vellum-600">
                    {s.note}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* the four voices, stated once so the rest of the page can use them */}
        <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
          <ul className="flex flex-wrap gap-2.5">
            {INKS.map((ink) => (
              <li
                key={ink.label}
                className={`border border-current px-3 py-1.5 font-mono text-[9.5px] tracking-[0.1em] ${ink.className}`}
              >
                {ink.label}
              </li>
            ))}
          </ul>

          <div className="hidden grid-cols-2 border border-vellum-400 font-mono text-[8.5px] tracking-[0.09em] text-vellum-600 sm:grid">
            <span className="border-r border-vellum-400 px-3 py-1.5">DWG — PN-2026-001</span>
            <span className="px-3 py-1.5">SHEET 1 OF 7</span>
            <span className="border-r border-t border-vellum-400 px-3 py-1.5">DRAWN — PATENTNEST</span>
            <span className="border-t border-vellum-400 px-3 py-1.5">CHECKED — YOU</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// FIG. 1 — an adaptive control assembly, drawn the way a patent figure is drawn.
// Graphite for the invention, cobalt numerals because PatentNest placed them,
// and one red hatched wedge where a reference overlaps. The strokes carry
// pathLength="1" so a dash-offset transition draws them in; note that Chromium
// ignores pathLength on <rect>/<line>, which is why every stroked shape here is
// a <path>.
function HeroFigure() {
  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 420 250"
        className="block h-auto w-full [--draw:1] motion-safe:[&_.draw]:animate-none"
        role="img"
        aria-label="Patent-style line drawing of an adaptive control assembly, with reference numerals 102, 104 and 106 and a hatched region where prior art reference D1 overlaps"
      >
        {/* chamber */}
        <g fill="none" stroke="#3d4148" strokeWidth="1.5" strokeLinecap="round">
          <path d="M132 60 A62 62 0 1 1 131.9 60" />
          <path d="M132 96 A26 26 0 1 1 131.9 96" />
          <path d="M132 60 L132 96 M132 148 L132 184 M70 122 L96 122 M168 122 L194 122" />
          <path d="M96 46 L168 46 L168 34 L96 34 Z" />
          <path d="M96 198 L168 198 L168 210 L96 210 Z" />
        </g>

        {/* prior-art overlap, hatched in the examiner's ink */}
        <g fill="none" stroke="#b91c1c">
          <path d="M132 122 L194 122 A62 62 0 0 0 163 68 Z" strokeWidth="0.7" strokeDasharray="3 3" />
          <path
            d="M146 112 L180 118 M150 100 L184 106 M156 88 L186 96"
            strokeWidth="0.7"
            opacity="0.6"
          />
          <path d="M172 90 L206 74" strokeWidth="0.7" />
        </g>
        <text x="210" y="72" className="font-mono" fontSize="8.5" fill="#b91c1c" letterSpacing="1">
          D1 OVERLAP
        </text>

        {/* controller */}
        <g fill="none" stroke="#3d4148" strokeWidth="1.5" strokeLinecap="round">
          <path d="M262 88 L360 88 L360 156 L262 156 Z" />
          <path d="M262 108 L360 108" />
          <path d="M276 128 L302 128 M276 140 L320 140" />
          <path d="M194 122 L262 122" />
        </g>

        {/* leaders and numerals — cobalt, because the AI placed them */}
        <g fill="none" stroke="#1d4ed8" strokeWidth="0.7">
          <path d="M88 78 L58 54" />
          <path d="M116 142 L82 184" />
          <path d="M300 88 L300 64" />
        </g>
        <g className="font-mono" fontSize="11" fill="#1d4ed8">
          <text x="30" y="50">102</text>
          <text x="52" y="196">104</text>
          <text x="286" y="58">106</text>
        </g>
      </svg>
      <figcaption className="mt-1.5 text-center font-mono text-[10px] tracking-[0.22em] text-vellum-600">
        FIG. 1
      </figcaption>
    </figure>
  )
}
