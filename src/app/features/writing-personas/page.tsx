import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, DefGrid, FeatureHero, Panel, Section } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'Writing personas and style transfer — PatentNest',
  description:
    'Teach the drafting engine how you write by pasting your own passages, section by section and jurisdiction by jurisdiction. Five high-impact sections, readiness you can see, and personas a firm can share.',
}

// Sourced from the implementation:
//   high-impact five, readiness, blurbs   src/lib/persona-guidance.ts
//   per-section word limits               src/lib/writing-sample-limits.ts
//   sample resolution order               src/lib/writing-sample-service.ts
//   persona + sample + profile models     prisma/schema.prisma
//   live endpoint  /api/patents/[patentId]/drafting/style-status

const HIGH_IMPACT = [
  {
    key: 'claims',
    label: 'Claims',
    blurb: 'Your claim architecture — preamble, transitional phrase, dependency style, and antecedent handling.',
    range: '100–600 words',
  },
  {
    key: 'detailedDescription',
    label: 'Detailed description',
    blurb: 'Your embodiment prose — reference numerals, paragraph rhythm, and how you signal alternatives.',
    range: '150–800 words',
  },
  {
    key: 'background',
    label: 'Background',
    blurb: 'How you set up the prior art and the problem — the transitions and hedging you use before “however”.',
    range: '80–400 words',
  },
  {
    key: 'summary',
    label: 'Summary',
    blurb: 'How you restate the invention at a high level, and how closely you track the claims.',
    range: '80–400 words',
  },
  {
    key: 'abstract',
    label: 'Abstract',
    blurb: 'Your abstract voice and length.',
    range: '50–200 words',
  },
]

const OTHER_SECTIONS = [
  ['Title', 'How you phrase invention titles — length, specificity, capitalisation.'],
  ['Field of invention', 'Your standard opening sentence for the technical field.'],
  ['Objects of invention', 'How you enumerate the objects of the invention.'],
  ['Brief description of drawings', 'Your figure-caption phrasing and numbering convention.'],
  ['Technical problem', 'How you state the technical problem.'],
  ['Technical solution', 'How you state the technical solution.'],
  ['Advantageous effects', 'How you phrase advantages and effects.'],
  ['Industrial applicability', 'Your standard industrial-applicability wording.'],
  ['Best method', 'How you describe the best mode of carrying out the invention.'],
  ['Preamble', 'Your claim preamble style.'],
  ['Cross-reference', 'Your cross-reference / priority-claim format.'],
  ['List of numerals', 'How you lay out the reference-numeral list.'],
]

const RESOLUTION = [
  { term: 'Primary persona, this jurisdiction', code: 'claims : IN', copy: 'The most specific match wins — the way you write Indian claims, used for an Indian filing.' },
  { term: 'Primary persona, universal', code: "claims : *", copy: 'A sample stored against every jurisdiction, for the parts of your voice that do not change between offices.' },
  { term: 'Any persona, this jurisdiction', code: 'fallback', copy: 'Kept for personas built before the current model, so nothing silently loses its samples.' },
  { term: 'Any persona, universal', code: 'fallback', copy: 'The last resort. If nothing matches at all, the section is drafted without a style sample rather than borrowed from an unrelated one.' },
]

export default function WritingPersonasFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Writing personas · style transfer"
          title="It should read like you"
          accent="wrote it,"
          tail="because you did."
          lede="You do not write a background the way you write a claim, and you do not write for the Indian office the way you write for the EPO. So style is taught per section and per jurisdiction, from passages out of your own granted patents — not from a tone slider."
          specs={[
            { label: 'Taught by', value: 'Your own passages' },
            { label: 'Scope', value: 'Per section, per jurisdiction' },
            { label: 'To be usable', value: '5 high-impact sections' },
            { label: 'Sharing', value: 'Private or firm-wide' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <Panel title="Persona readiness" meta="3 of 5">
                <div className="mb-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[13px] font-medium text-ai-graphite-900">CSE patents</span>
                    <Chip tone="warn">partial</Chip>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-paper-200">
                    <div className="h-full w-[60%] rounded-full bg-lamp-500" />
                  </div>
                  <p className="mt-2 text-[12px] text-paper-600">3 of 5 key sections</p>
                </div>
                <div className="space-y-2 border-t border-paper-300 pt-3 text-[12px]">
                  {[
                    ['Claims', 'good', 'covered'],
                    ['Detailed description', 'good', 'covered'],
                    ['Background', 'good', 'covered'],
                    ['Summary', 'mute', 'missing'],
                    ['Abstract', 'mute', 'missing'],
                  ].map(([label, tone, state]) => (
                    <div key={label as string} className="flex items-center justify-between gap-2">
                      <span className="text-ai-graphite-700">{label}</span>
                      <Chip tone={tone as string}>{state}</Chip>
                    </div>
                  ))}
                </div>
                <p className="mt-3 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-lamp-700">
                  Add 2 more to finish.
                </p>
              </Panel>

              <Panel title="A sample, as you paste it" meta="claims · IN">
                <div className="rounded-lg border border-paper-300 bg-paper-50 p-3.5">
                  <p className="text-[12.5px] leading-[1.75] text-ai-graphite-700">
                    “A system for environmental regulation, the system comprising: a sensor array
                    configured to generate a plurality of measurements; and a controller operatively
                    coupled to the sensor array, wherein the controller is configured to…”
                  </p>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2.5 border-t border-paper-300 pt-3">
                  {[
                    ['Section', 'claims'],
                    ['Jurisdiction', 'IN'],
                    ['Words', '128'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[9.5px] uppercase tracking-wider text-paper-500">{k}</dt>
                      <dd className="text-[12.5px] font-medium text-ai-graphite-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[12px] leading-[1.6] text-paper-600">
                  Recommended 100–600 words for claims. Word count is checked as you paste, because a
                  three-line fragment cannot teach a dependency style.
                </p>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="The high-impact five"
          title="Cover these and the draft is recognisably yours."
          lede="Readiness is measured against five sections, not against all seventeen — because these are the ones where style transfer actually shows, and because a target of five is one an attorney will finish. The rest are refinements you can add whenever you like."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 overflow-hidden rounded-2xl border border-paper-300 bg-white">
              {HIGH_IMPACT.map((s, i) => (
                <div
                  key={s.key}
                  className={`flex flex-col gap-2 px-6 py-5 sm:flex-row sm:items-baseline sm:gap-6 ${
                    i !== 0 ? 'border-t border-paper-300/70' : ''
                  }`}
                >
                  <div className="w-full flex-none sm:w-[190px]">
                    <p className="text-[14.5px] font-medium text-ai-graphite-900">{s.label}</p>
                    <code className="font-mono text-[10.5px] text-paper-500">{s.key}</code>
                  </div>
                  <p className="flex-1 text-[13.5px] leading-[1.6] text-paper-600">{s.blurb}</p>
                  <span className="flex-none font-mono text-[10.5px] text-lamp-600">{s.range}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-[72ch] text-[13px] leading-[1.6] text-paper-500">
              Each range is the recommended window, not a hard limit. Longer samples for the detailed
              description are recommended precisely because more prose carries more of the pattern.
            </p>
          </Reveal>
        </Section>

        <Section
          kicker="Everything else"
          title="Twelve more sections, whenever you want them."
          lede="These only exist in some jurisdictions, and most attorneys never need to fill them. They are here so that when your office does require an industrial-applicability statement, it comes out in your wording rather than a generic one."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-paper-300 bg-paper-300 sm:grid-cols-2 lg:grid-cols-3">
              {OTHER_SECTIONS.map(([label, blurb]) => (
                <div key={label} className="bg-white p-5">
                  <p className="mb-1.5 text-[13.5px] font-medium text-ai-graphite-900">{label}</p>
                  <p className="text-[12.5px] leading-[1.55] text-paper-600">{blurb}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Resolution order"
          title="The most specific sample wins, and nothing is borrowed."
          lede="When a section is drafted, the engine looks for the sample that best matches this section in this jurisdiction, then widens. What it never does is substitute a sample from an unrelated section — if nothing matches, the section is drafted without one and you are not told a style was applied when it was not."
        >
          <DefGrid items={RESOLUTION} />
        </Section>

        <Section
          kicker="Personas"
          title="One attorney, several voices — or one firm, one standard."
          lede="A persona is a named set of samples. Keep several for the technology areas you work in, or publish one as a firm template so a whole team drafts to the same house style."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              <Panel title="Private" meta="PRIVATE">
                <p className="text-[13px] leading-[1.6] text-paper-600">
                  Yours alone. The default, because your drafting style is your work product.
                </p>
              </Panel>
              <Panel title="Organisation" meta="ORGANIZATION">
                <p className="text-[13px] leading-[1.6] text-paper-600">
                  Visible to everyone in your tenant. How a firm gets one recognisable voice across
                  several drafters.
                </p>
              </Panel>
              <Panel title="Template" meta="isTemplate · allowCopy">
                <p className="text-[13px] leading-[1.6] text-paper-600">
                  Marked by an admin as a firm standard. Copyable, so a new associate starts from the
                  house style and adapts it rather than starting empty.
                </p>
              </Panel>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {[
                ['CSE patents', 'Formal claims, detailed embodiments', 'ready'],
                ['Pharma style', 'Long background, heavy on efficacy data', 'partial'],
                ['Firm standard', 'Published template, 5 of 5 covered', 'ready'],
              ].map(([name, desc, state]) => (
                <div key={name} className="rounded-2xl border border-paper-300 bg-white p-5">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <p className="text-[14px] font-medium text-ai-graphite-900">{name}</p>
                    <Chip tone={state === 'ready' ? 'good' : 'warn'}>{state}</Chip>
                  </div>
                  <p className="text-[12.5px] leading-[1.55] text-paper-600">{desc}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="What it is not"
          title="A style sample is not a template, and not training data."
          lede="Your passages are used as reference for how a section should read — voice, rhythm, structure. They are not pasted into your draft, they are not merged with anyone else's, and a private persona stays inside your account. Style is applied per draft, per section, at the moment that section is written."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2">
              <Panel title="Not a template">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  Nothing from your sample is copied into the output. A claims sample teaches the
                  shape of your claims, not the words of that invention.
                </p>
              </Panel>
              <Panel title="Not a blend">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  Samples are resolved one at a time, per section. Two personas are never averaged into
                  a voice that belongs to neither of you.
                </p>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <ClosingAsk
          title="Paste five passages from a patent you are proud of."
          lede="Claims, detailed description, background, summary, abstract — from one specification you already wrote. That is the whole setup, and it is the difference between a draft you rewrite and one you review."
        />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
