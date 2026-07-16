'use client'

// "§ 02 · SUMMARY OF THE INVENTION" — the product, explained as four
// instruments of one studio. Each step pairs plain-language benefit copy with a
// believable product frame, alternating sides down the page. This is where the
// story and the product become the same thing.

import { Reveal } from './Reveal'
import SectionLabel from './SectionLabel'
import { DiscloseMock, NoveltyMock, ClaimsMock, ValidateMock } from './mockups'
import type { ReactNode } from 'react'

const STEPS: {
  n: string
  title: string
  body: string
  points: string[]
  mock: ReactNode
}[] = [
  {
    n: 'Step 01 · Disclose',
    title: 'Describe it in your own words',
    body: 'Start from plain language, not legalese. The studio asks the questions an examiner would, and structures your answers into a disclosure.',
    points: ['Guided intake, field by field', 'Nothing lost between your head and the page'],
    mock: <DiscloseMock />,
  },
  {
    n: 'Step 02 · Search',
    title: 'Know it’s novel before you spend',
    body: 'Prior-art search across millions of patents and papers, returned as an evidence map — exactly where your claims are clear, and where they collide.',
    points: ['Semantic search, not keyword roulette', 'A defensible novelty position, documented'],
    mock: <NoveltyMock />,
  },
  {
    n: 'Step 03 · Draft',
    title: 'A specification, not a suggestion',
    body: 'Complete drafts with numbered claims in proper dependent form, definitions, and embodiments — written for attorney review, not rewritten by it.',
    points: ['Claims cross-referenced automatically', 'Antecedent basis checked as you write'],
    mock: <ClaimsMock />,
  },
  {
    n: 'Step 04 · Validate & file',
    title: 'Filed with confidence',
    body: 'Automated validation catches the gaps an examiner would flag, then exports a clean, filing-ready package for your attorney or the patent office.',
    points: ['Pre-filing checklist, every reference verified', 'One-click DOCX and PDF export'],
    mock: <ValidateMock />,
  },
]

export default function StudioSection() {
  return (
    <section id="studio" className="scroll-mt-24 bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>§ 02 · Summary of the invention</SectionLabel>

        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-3xl font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-5xl">
            One studio. Four instruments.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
            Every stage of the application, handled in the same place your idea lives.
          </p>
        </Reveal>

        <div className="mt-20 space-y-24 sm:space-y-28">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className="grid items-center gap-10 md:grid-cols-2 md:gap-16"
            >
              {/* copy */}
              <Reveal className={i % 2 === 1 ? 'md:order-2' : undefined}>
                <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ai-graphite-400">
                  {s.n}
                </p>
                <h3 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-ai-graphite-900 sm:text-3xl">
                  {s.title}
                </h3>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ai-graphite-600">
                  {s.body}
                </p>
                <ul className="mt-6 space-y-2.5">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-start gap-3 text-sm text-ai-graphite-700">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#8a6a1f]" />
                      {p}
                    </li>
                  ))}
                </ul>
              </Reveal>

              {/* product frame */}
              <Reveal delay={0.12} className={i % 2 === 1 ? 'md:order-1' : undefined}>
                {s.mock}
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
