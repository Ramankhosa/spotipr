import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, DefGrid, FeatureHero, Panel, Section, StageRail } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'The patent drafting pipeline, stage by stage — PatentNest',
  description:
    'Eight stages from invention structure to drafted sections: preliminary claims, prior art, claim refinement, component numerals, figure planning, jurisdiction setup, and section drafting with per-section context injection and filing-readiness validation.',
}

// Sourced from the implementation, stage codes and labels included:
//   stage order + labels + progress   src/app/patents/[patentId]/draft/page.tsx
//   section vocabulary + blurbs       src/lib/persona-guidance.ts
//   context injection flags           prisma/schema.prisma → model SupersetSection
//   diagram kinds, modes, validation  src/lib/patent-diagrams/types.ts
//   review severities, cross-checks   src/lib/ai-review-service.ts
//   figure sequencing                 src/lib/figure-sequence.ts
//   live endpoints  /api/patents/[patentId]/drafting{,/plantuml-render,/style-status,
//                   /user-instructions,/automation,/dd-user-data}, .../validation

const STAGES = [
  {
    code: 'IDEA_ENTRY · 10%',
    label: 'Invention structure',
    copy: 'The disclosure is turned into structure — what the invention is, what it operates on, what problem it solves. Everything downstream reads this, so it is the first and cheapest place to correct a misreading.',
  },
  {
    code: 'PRELIMINARY_CLAIMS · 22%',
    label: 'Preliminary claims',
    copy: 'Claims are drafted early, deliberately before the prose. The claims decide what the specification has to support, so writing the description first means rewriting it later.',
  },
  {
    code: 'RELATED_ART · 35%',
    label: 'Prior art analysis',
    copy: 'Prior art is brought in and reviewed against the preliminary claims — either handed over from a novelty search or entered directly. This is what the background section will later be built from.',
  },
  {
    code: 'CLAIM_REFINEMENT · 45%',
    label: 'Claim refinement',
    copy: 'Now that the art is known, the claims are narrowed and layered — independent scope tested against the closest references, dependents added as fallback positions.',
  },
  {
    code: 'COMPONENT_PLANNER · 58%',
    label: 'Component planner',
    copy: 'Every component of the invention is enumerated and assigned its reference numeral once, centrally. This is why numerals stay consistent between the figures and the description instead of drifting apart.',
  },
  {
    code: 'FIGURE_PLANNER · 70%',
    label: 'Figure planner',
    copy: 'The figure set is planned as a set — which figures exist, in what order, of which kind — then each is generated, validated for filing readiness, and sequenced. Diagrams and hand sketches sit in the same sequence.',
  },
  {
    code: 'COUNTRY_WISE_DRAFTING · 55%',
    label: 'Jurisdiction setup',
    copy: 'The target offices are chosen, and each one contributes its own section list, ordering, and word limits drawn from a superset of canonical sections. One invention, several jurisdiction shapes.',
  },
  {
    code: 'ANNEXURE_DRAFT · 82%',
    label: 'Draft sections',
    copy: 'Sections are drafted one at a time, each receiving only the context its own definition asks for — and each checked against the sections around it rather than in isolation.',
  },
]

const SOURCE_MODES = [
  { term: 'Managed', code: 'MANAGED', copy: 'Generated and maintained by the pipeline. Regenerates cleanly when components or numerals change.' },
  { term: 'Raw override', code: 'RAW_OVERRIDE', copy: 'You took the wheel and edited the diagram source directly. Your edit is preserved rather than overwritten.' },
  { term: 'Imported raw', code: 'IMPORTED_RAW', copy: 'Diagram source brought in from outside and kept as source.' },
  { term: 'Imported image', code: 'IMPORTED_IMAGE', copy: 'An existing image or scanned sketch, sequenced alongside generated figures.' },
]

export default function DraftingPipelineFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Drafting pipeline"
          title="Claims first, prose last,"
          accent="numerals only once."
          lede="A specification is a system of cross-references pretending to be prose. The pipeline drafts it in dependency order — claims before description, components before figures, figures before the sections that cite them — so consistency is a property of the order, not a cleanup task at the end."
          specs={[
            { label: 'Pipeline', value: '8 stages, resumable' },
            { label: 'Section vocabulary', value: '17 canonical sections' },
            { label: 'Figure kinds', value: '4, validated for filing' },
            { label: 'Per section', value: 'Only the context it declares' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              {/* dependency order graphic */}
              <Panel title="Why the order matters" meta="dependency flow">
                <svg viewBox="0 0 520 190" className="w-full" role="img" aria-label="Claims feed the description; components feed the figures; figures and components both feed the detailed description.">
                  <defs>
                    <marker id="dp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0 0 L10 5 L0 10 z" fill="#98a2b3" />
                    </marker>
                  </defs>
                  <g fill="none" stroke="#98a2b3" strokeWidth="1.2" markerEnd="url(#dp-arrow)">
                    <path d="M104 40 H176" />
                    <path d="M104 100 H176" />
                    <path d="M264 40 C300 40, 300 92, 336 92" />
                    <path d="M264 100 H336" />
                    <path d="M104 160 C180 160, 250 130, 336 108" />
                  </g>

                  <g>
                    <rect x="16" y="22" width="88" height="36" rx="3" fill="#eef2fe" stroke="#1d4ed8" strokeWidth="1.3" />
                    <text x="60" y="44" textAnchor="middle" fontSize="11.5" fill="#1e40af" fontFamily="Inter, sans-serif">Claims</text>

                    <rect x="16" y="82" width="88" height="36" rx="3" fill="#eef2fe" stroke="#1d4ed8" strokeWidth="1.3" />
                    <text x="60" y="98" textAnchor="middle" fontSize="10.5" fill="#1e40af" fontFamily="Inter, sans-serif">Components</text>
                    <text x="60" y="111" textAnchor="middle" fontSize="9" fill="#3b5bbf" fontFamily="monospace">+ numerals</text>

                    <rect x="16" y="142" width="88" height="36" rx="3" fill="#fff" stroke="#d0d5dd" strokeWidth="1.2" />
                    <text x="60" y="164" textAnchor="middle" fontSize="11" fill="#475467" fontFamily="Inter, sans-serif">Prior art</text>

                    <rect x="176" y="22" width="88" height="36" rx="3" fill="#fff" stroke="#d0d5dd" strokeWidth="1.2" />
                    <text x="220" y="38" textAnchor="middle" fontSize="10.5" fill="#344054" fontFamily="Inter, sans-serif">Abstract,</text>
                    <text x="220" y="51" textAnchor="middle" fontSize="10.5" fill="#344054" fontFamily="Inter, sans-serif">summary</text>

                    <rect x="176" y="82" width="88" height="36" rx="3" fill="#fff" stroke="#d0d5dd" strokeWidth="1.2" />
                    <text x="220" y="104" textAnchor="middle" fontSize="10.5" fill="#344054" fontFamily="Inter, sans-serif">Figures</text>

                    <rect x="336" y="74" width="168" height="44" rx="3" fill="#fff" stroke="#101828" strokeWidth="1.4" />
                    <text x="420" y="92" textAnchor="middle" fontSize="11" fill="#101828" fontFamily="Inter, sans-serif">Detailed description</text>
                    <text x="420" y="106" textAnchor="middle" fontSize="9" fill="#667085" fontFamily="monospace">cites numerals + figures</text>
                  </g>
                </svg>
                <p className="mt-3 border-t border-paper-300 pt-3 text-[12.5px] leading-[1.6] text-paper-600">
                  Nothing is drafted before the thing it has to agree with. The detailed description is
                  written last because it is the section that cites everything else.
                </p>
              </Panel>

              {/* numerals artifact */}
              <Panel title="Reference numerals, assigned once" meta="COMPONENT_PLANNER">
                <div className="space-y-2 text-[11.5px]">
                  {[
                    ['100', 'Environmental control system'],
                    ['110', 'Sensor array'],
                    ['120', 'Controller'],
                    ['130', 'Actuator assembly'],
                    ['140', 'Reference derivation module'],
                  ].map(([n, label]) => (
                    <div key={n} className="flex items-baseline gap-3">
                      <code className="w-8 flex-none font-mono text-[11px] text-lamp-600">{n}</code>
                      <span className="text-ai-graphite-700">{label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  One list, injected into the figures and into the description. Renumber a component
                  here and both follow — the find-and-replace evening does not happen.
                </p>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="Stage by stage"
          title="Eight stages, each one resumable and each one correctable."
          lede="Progress is tracked per stage, so a draft can be left and picked up. The percentages below are the pipeline's own — they are weights on the work, not a guess at how long it takes."
        >
          <Reveal delay={0.08}>
            <StageRail stages={STAGES} />
          </Reveal>
        </Section>

        <Section
          kicker="Context injection"
          title="Each section is told only what it needs to know."
          lede="A section is not a prompt with everything thrown at it. Every canonical section declares which context it requires, and the drafting call receives exactly that — which is both why the output stays on-topic and why a section can be redrafted without disturbing its neighbours."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Requires prior art', 'requiresPriorArt', 'Background, cross-reference — the sections that characterise the art.'],
                ['Requires figures', 'requiresFigures', 'Brief description of drawings, detailed description.'],
                ['Requires claims', 'requiresClaims', 'Abstract and summary, so they track the claims rather than drift from them.'],
                ['Requires components', 'requiresComponents', 'Detailed description, which cites the numeral list directly.'],
              ].map(([term, code, copy]) => (
                <Panel key={term} title={term} meta={code}>
                  <p className="text-[13px] leading-[1.6] text-paper-600">{copy}</p>
                </Panel>
              ))}
            </div>
            <p className="mt-5 max-w-[74ch] text-[13px] leading-[1.6] text-paper-500">
              Each section also carries its own base instruction, its constraints, whether it is
              required, and a recommended word range — so a jurisdiction can reorder or drop sections
              without the drafting logic being rewritten.
            </p>
          </Reveal>
        </Section>

        <Section
          kicker="Figure planner"
          title="Four kinds of figure, because a method claim and an assembly are not the same drawing."
          lede="The figure set is planned before anything is drawn — which figures, in what order, of which kind. Each kind has its own schema, so a sequence diagram is validated as a sequence rather than as a generic box-and-arrow picture. Relationships inside a figure are typed rather than left as anonymous lines — primary, data input, technical output, control, configuration, validation, storage, optional — which is what lets a drawing be checked for sense instead of merely rendered."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  code: 'COMPONENT',
                  label: 'Component',
                  copy: 'The system and its parts, with reference numerals and typed relationships between them.',
                  svg: (
                    <>
                      <rect x="30" y="10" width="60" height="22" rx="2" />
                      <rect x="12" y="52" width="44" height="22" rx="2" />
                      <rect x="64" y="52" width="44" height="22" rx="2" />
                      <path d="M60 32 L34 52" />
                      <path d="M60 32 L86 52" />
                    </>
                  ),
                },
                {
                  code: 'SEQUENCE',
                  label: 'Sequence',
                  copy: 'Ordered interaction between actors over time — the classic method-claim figure.',
                  svg: (
                    <>
                      <path d="M24 10 V78" strokeDasharray="3 3" />
                      <path d="M60 10 V78" strokeDasharray="3 3" />
                      <path d="M96 10 V78" strokeDasharray="3 3" />
                      <path d="M24 26 H60" />
                      <path d="M60 44 H96" />
                      <path d="M96 62 H24" />
                    </>
                  ),
                },
                {
                  code: 'PROCESS',
                  label: 'Process',
                  copy: 'Flow with branches and decisions, for method steps and conditional behaviour.',
                  svg: (
                    <>
                      <rect x="40" y="8" width="40" height="18" rx="2" />
                      <path d="M60 26 V38" />
                      <path d="M60 38 L74 48 L60 58 L46 48 z" />
                      <path d="M46 48 H20 V70" />
                      <path d="M74 48 H100 V70" />
                    </>
                  ),
                },
                {
                  code: 'CONSTITUENT',
                  label: 'Constituent',
                  copy: 'Composition and containment — what a thing is made of, nested.',
                  svg: (
                    <>
                      <rect x="14" y="10" width="92" height="66" rx="2" />
                      <rect x="24" y="22" width="72" height="20" rx="2" />
                      <rect x="34" y="50" width="52" height="16" rx="2" />
                    </>
                  ),
                },
              ].map((d) => (
                <Panel key={d.code} title={d.label} meta={d.code}>
                  <svg viewBox="0 0 120 88" className="w-full" aria-hidden="true">
                    <g fill="none" stroke="#101828" strokeWidth="1.3" strokeLinecap="round">
                      {d.svg}
                    </g>
                  </svg>
                  <p className="mt-3 border-t border-paper-300 pt-3 text-[12.5px] leading-[1.55] text-paper-600">
                    {d.copy}
                  </p>
                </Panel>
              ))}
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Filing readiness"
          title="A figure that an examiner would object to is caught before you file it."
          lede="Every diagram is validated, not just rendered. The report is explicit about whether the figure is filing-ready, which claim-critical components are missing from it, and whether it has become too dense to be one sheet."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              <Panel title="Claim-critical coverage" meta="required / covered / missing">
                <div className="space-y-2 text-[11.5px]">
                  {[
                    ['Sensor array (110)', 'good', 'covered'],
                    ['Controller (120)', 'good', 'covered'],
                    ['Actuator assembly (130)', 'good', 'covered'],
                    ['Reference module (140)', 'bad', 'missing'],
                  ].map(([label, tone, state]) => (
                    <div key={label as string} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ai-graphite-700">{label}</span>
                      <Chip tone={tone as string}>{state}</Chip>
                    </div>
                  ))}
                </div>
                <p className="mt-3 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  A component the claims depend on, absent from every figure, is a support problem
                  waiting to be raised.
                </p>
              </Panel>

              <Panel title="Complexity" meta="requiresSplit">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {[
                    ['Visible nodes', '14'],
                    ['Connectors', '19'],
                    ['Max row size', '6'],
                    ['Cross-layer links', '4'],
                    ['Nesting depth', '3'],
                    ['Label words, max', '9'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[9.5px] uppercase tracking-wider text-paper-500">{k}</dt>
                      <dd className="text-[12.5px] font-medium text-ai-graphite-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 border-t border-paper-300 pt-3">
                  <Chip tone="warn">Split into two sheets</Chip>
                  <p className="mt-2 text-[12px] leading-[1.6] text-paper-600">
                    The reasons are named, so the split is a decision you can see rather than a
                    silently truncated drawing.
                  </p>
                </div>
              </Panel>

              <Panel title="Render check" meta="FILING vs REVIEW">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {[
                    ['Effective font', '9.4 pt'],
                    ['Aspect ratio', '1.41'],
                    ['Filing ready', 'No'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[9.5px] uppercase tracking-wider text-paper-500">{k}</dt>
                      <dd className="text-[12.5px] font-medium text-ai-graphite-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Text is measured at the size it will actually print at. A figure legible on screen
                  and unreadable on the sheet is a formalities objection, so it is treated as one.
                </p>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Your figures, your way"
          title="Generated, overridden, or imported — all in one sequence."
          lede="A managed figure regenerates when the components change. The moment you edit its source by hand, that edit is respected instead of being overwritten on the next run — and imported images and sketches take their place in the same numbered sequence."
        >
          <DefGrid items={SOURCE_MODES} />
        </Section>

        <Section
          kicker="Voice"
          title="Drafted in your style, not the model's."
          lede="Writing samples are stored per jurisdiction, per persona, and per section, because how you write claims has nothing to do with how you write a background. Five sections carry most of the voice, and their readiness is tracked separately so you know what is actually configured."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="High-impact sections" meta="persona readiness">
                <div className="space-y-2.5 text-[12px]">
                  {[
                    ['Claims', 'ready', 'good'],
                    ['Detailed description', 'ready', 'good'],
                    ['Background', 'partial', 'warn'],
                    ['Summary', 'partial', 'warn'],
                    ['Abstract', 'empty', 'mute'],
                  ].map(([label, state, tone]) => (
                    <div key={label as string} className="flex items-center justify-between gap-2">
                      <span className="text-ai-graphite-700">{label}</span>
                      <Chip tone={tone as string}>{state}</Chip>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Empty is reported as empty. A persona that only has claim samples does not get to
                  claim it has your voice everywhere.
                </p>
              </Panel>
              <Panel title="What a sample teaches" meta="per section">
                <div className="space-y-3 text-[12.5px] leading-[1.6]">
                  {[
                    ['Claims', 'Preamble, transitional phrase, dependency style, antecedent handling.'],
                    ['Detailed description', 'Reference numerals, paragraph rhythm, how you signal alternatives.'],
                    ['Background', 'How you set up the art and the problem — the hedging before “however”.'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="font-medium text-ai-graphite-900">{k}</p>
                      <p className="text-paper-600">{v}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Review"
          title="Sections are checked against each other, not one at a time."
          lede="The interesting defects in a specification live between sections: a claim feature with no home in the description, a numeral in a figure that the prose never mentions. Cross-section rules run from a source section to a target section, and the fix is pointed at the section that has to change — not the one that revealed the problem."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <Panel title="A cross-section rule" meta="source → target">
                <svg viewBox="0 0 480 96" className="w-full" role="img" aria-label="A rule runs from the claims section to the detailed description; the fix is applied to the detailed description.">
                  <defs>
                    <marker id="cs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0 0 L10 5 L0 10 z" fill="#1d4ed8" />
                    </marker>
                  </defs>
                  <rect x="8" y="30" width="120" height="38" rx="3" fill="#fff" stroke="#d0d5dd" strokeWidth="1.2" />
                  <text x="68" y="47" textAnchor="middle" fontSize="11" fill="#344054" fontFamily="Inter, sans-serif">Claims</text>
                  <text x="68" y="60" textAnchor="middle" fontSize="8.5" fill="#667085" fontFamily="monospace">source</text>

                  <path d="M128 49 H196" fill="none" stroke="#1d4ed8" strokeWidth="1.3" markerEnd="url(#cs-arrow)" />
                  <text x="162" y="40" textAnchor="middle" fontSize="8.5" fill="#1d4ed8" fontFamily="monospace">feature missing</text>

                  <rect x="200" y="30" width="150" height="38" rx="3" fill="#eef2fe" stroke="#1d4ed8" strokeWidth="1.3" />
                  <text x="275" y="47" textAnchor="middle" fontSize="11" fill="#1e40af" fontFamily="Inter, sans-serif">Detailed description</text>
                  <text x="275" y="60" textAnchor="middle" fontSize="8.5" fill="#3b5bbf" fontFamily="monospace">target — fix applied here</text>

                  <path d="M350 49 H414" fill="none" stroke="#98a2b3" strokeWidth="1.2" strokeDasharray="3 3" />
                  <circle cx="440" cy="49" r="16" fill="#ecfdf5" stroke="#10b981" strokeWidth="1.3" />
                  <path d="M433 49 l5 5 l10 -11" fill="none" stroke="#047857" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <p className="mt-3 border-t border-paper-300 pt-3 text-[12.5px] leading-[1.6] text-paper-600">
                  The rule fires on the claims but the repair belongs to the description. Sending the
                  fix to the wrong section is how a consistency check turns into a new inconsistency.
                </p>
              </Panel>
              <Panel title="Issue weighting" meta="E / W / S">
                <div className="space-y-2.5">
                  {[
                    ['Error', '×3', 'bad'],
                    ['Warning', '×2', 'warn'],
                    ['Suggestion', '×1', 'info'],
                  ].map(([label, w, tone]) => (
                    <div key={label as string} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="text-ai-graphite-700">{label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-paper-500">{w}</span>
                        <Chip tone={tone as string}>{label}</Chip>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Weighted rather than counted, so ten cosmetic suggestions never outrank one real
                  error.
                </p>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="One invention, several offices"
          title="The section list is the jurisdiction's, not ours."
          lede="Canonical sections sit in a superset with aliases, display order, and per-office word limits. A jurisdiction takes the sections it wants in the order it wants them — objects of the invention here, technical problem and solution there, industrial applicability where it is required — and the same drafted invention comes out shaped correctly for each."
        />

        <ClosingAsk
          title="Draft one specification you have already written."
          lede="Run the pipeline on an invention you drafted by hand. The stage that will tell you most is the component planner — whether the numerals it assigns match the ones you chose, and whether the figures and description agree about them."
        />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
