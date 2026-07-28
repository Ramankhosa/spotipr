import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, DefGrid, FeatureHero, Panel, Section, StageRail } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'Novelty search and the attorney report — PatentNest',
  description:
    'A numbered, citation-by-citation novelty report: feature-level mapping with quoted evidence, match categories, inventive-step combinations, assignee landscape, and a declared confidence level on every conclusion.',
}

// Every label, stage code, and report section on this page is taken from the
// implementation, not invented for marketing:
//   report model + table of contents  src/lib/novelty-attorney-report.ts
//   pipeline stages + prompts         src/lib/novelty-search-service.ts
//   match categories                  src/lib/novelty-prior-art-visibility.ts
//   count summary                     src/lib/novelty-report-counts.ts
//   PDF export  /api/novelty-search/[searchId]/attorney-report/pdf
// If the pipeline changes, this page is expected to change with it.

const TOC = [
  ['1', 'Search overview'],
  ['1.1', 'Objective'],
  ['1.2', 'Search scope and methodology'],
  ['1.3', 'Key features'],
  ['1.4', 'Scoring legend'],
  ['1.5', 'Summary of relevant citations'],
  ['1.6', 'Component / feature-level prior art'],
  ['1.7', 'Key feature analysis matrix'],
  ['1.8', 'Potential inventive-step combinations'],
  ['2', 'Citation analysis'],
  ['2.1', 'Relevant patent citations'],
  ['2.2', 'Relevant scholarly publications'],
  ['A', 'Appendix A — remaining mapped references'],
  ['B', 'Appendix B — shortlisted but unmapped citations'],
  ['3', 'Applicant / assignee landscape'],
  ['4', 'Repeated inventor / entity signals'],
  ['5', 'Claim-positioning analysis'],
  ['6', 'Claim-positioning observations'],
  ['7', 'Limitations and next steps'],
]

const STAGES = [
  {
    code: 'Stage 0',
    label: 'Normalise the disclosure and build the query',
    copy: 'Your invention is decomposed into discrete features and turned into retrieval vocabulary — including classification-aware and EPO-style keyword groups — so the search runs on the concepts in the invention rather than the words you happened to type.',
  },
  {
    code: 'Stage 1',
    label: 'Retrieve across patents and scholarly literature',
    copy: 'Candidates come back from the patent corpus and from non-patent literature. Papers are carried through as first-class references, not footnotes — they get their own citation section in the report.',
  },
  {
    code: 'Stage 1.5',
    label: 'Screen for relevance, and record the routing',
    copy: 'An adaptive screening gate sorts every candidate into direct, component, borderline, or rejected. This is the only stage allowed to make that routing call, and the counts it produces are what the report reconciles against.',
  },
  {
    code: 'Stage 3.5a / 3.5b',
    label: 'Map every feature against every surviving reference',
    copy: 'Each invention feature is compared to each reference and given a status, an extent score, a confidence value, and a verbatim quote with its source location. No mapping is accepted without the evidence attached.',
  },
  {
    code: 'Stage 3.5c',
    label: 'Write the per-reference remarks',
    copy: 'Each reference gets its own analysis — what it teaches, where it stops, and what that means for claim scope — rather than a single blended summary that hides which document did the damage.',
  },
  {
    code: 'Stage 4',
    label: 'Assemble claim positioning and the risk view',
    copy: 'Claim-positioning observations are derived strictly from the mapped overlaps above, then combined with novelty risk, inventive-step combinations, and a declared confidence level for the report as a whole.',
  },
]

const MATCH = [
  {
    term: 'Direct',
    code: "matchCategory: 'direct'",
    copy: 'The reference addresses the invention as a whole. These lead the citation analysis and drive the novelty risk conclusion.',
  },
  {
    term: 'Component',
    code: "matchCategory: 'component'",
    copy: 'The reference teaches part of the invention. Collected in their own section, because a feature covered by three partial references is an inventive-step problem, not a novelty one.',
  },
  {
    term: 'Borderline',
    code: "matchCategory: 'borderline'",
    copy: 'Arguably relevant. Kept visible and labelled rather than silently dropped, so a reviewer can disagree with the screen.',
  },
  {
    term: 'Rejected',
    code: "matchCategory: 'rejected'",
    copy: 'Screened out. Still counted, and the shortlisted-but-unmapped set is listed in Appendix B so the gap between retrieved and analysed is auditable.',
  },
]

const FEATURE_TYPES = [
  {
    term: 'Core technical',
    code: "type: 'core_technical'",
    copy: 'The technical heart of the invention. Coverage of these features is what the novelty risk headline is computed from.',
  },
  {
    term: 'Novelty candidate',
    code: "type: 'novelty_candidate'",
    copy: 'A feature that looks like it could carry novelty on its own — flagged for the claim-positioning section.',
  },
  {
    term: 'Implementation',
    code: "type: 'implementation'",
    copy: 'Necessary to build, but unlikely to distinguish. Kept in the matrix so the record is complete without inflating the conclusion.',
  },
  {
    term: 'Generic / weak',
    code: "type: 'generic_weak'",
    copy: 'Boilerplate that would not survive as a distinguishing feature. Called out explicitly with a generic-feature risk note, rather than left to look like coverage.',
  },
]

export default function NoveltyReportFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Novelty search · attorney report"
          title="A novelty report that shows"
          accent="its evidence"
          tail="line by line."
          lede="Not a relevance score and a list of links. A numbered report that maps every feature of your invention against every reference it kept, quotes the passage it relied on, says how confident it is, and tells you where it stopped."
          specs={[
            { label: 'Report sections', value: '7 numbered parts, 2 appendices' },
            { label: 'Evidence unit', value: 'Feature × reference, with quote' },
            { label: 'Reference types', value: 'Patents and scholarly papers' },
            { label: 'Export', value: 'PDF, with the numbering intact' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              {/* the matrix — the signature artifact */}
              <Panel title="Key feature analysis matrix" meta="§ 1.7">
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-2.5 text-[11.5px]">
                  {['Invention feature', 'D1', 'D2', 'D3'].map((h) => (
                    <span key={h} className="font-mono text-[9.5px] uppercase tracking-wider text-paper-500">
                      {h}
                    </span>
                  ))}
                  {[
                    ['Self-correcting actuation loop', 'good', 'good', 'good'],
                    ['Adaptive sensor calibration', 'warn', 'good', 'good'],
                    ['Modular environment response', 'warn', 'warn', 'good'],
                    ['Plant growth chamber', 'bad', 'bad', 'warn'],
                  ].map(([label, a, b, c]) => (
                    <div key={label as string} className="contents">
                      <span className="truncate text-ai-graphite-700">{label}</span>
                      {[a, b, c].map((t, i) => (
                        <span
                          key={i}
                          className={`h-2.5 w-2.5 rounded-full ${
                            t === 'bad' ? 'bg-wax-400' : t === 'warn' ? 'bg-[#f59e0b]' : 'bg-[#10b981]'
                          }`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-paper-300 pt-3 text-[10.5px] text-paper-600">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-wax-400" /> disclosed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> partial
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#10b981]" /> not found
                  </span>
                </div>
              </Panel>

              {/* one cell, opened up */}
              <Panel title="One cell, opened" meta="feature × reference">
                <div className="space-y-3 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="info">Feature 2</Chip>
                    <span className="font-mono text-[10.5px] text-paper-500">× US 2020/0148480 A1</span>
                  </div>
                  <p className="rounded-lg border-l-2 border-lamp-600 bg-paper-50 p-3 text-[12px] italic leading-[1.6] text-ai-graphite-700">
                    “…the controller recalibrates the sensor array against a reference value at each
                    actuation interval…”
                  </p>
                  <p className="font-mono text-[10px] text-paper-500">source: ¶ [0042], col. 6 ln. 11</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-paper-300 pt-3">
                    {[
                      ['Status', 'Partially disclosed'],
                      ['Evidence strength', 'Moderate'],
                      ['Extent score', '0.62'],
                      ['Confidence', '0.78'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="font-mono text-[9.5px] uppercase tracking-wider text-paper-500">{k}</dt>
                        <dd className="text-[12.5px] font-medium text-ai-graphite-900">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                    Recalibration is taught, but tied to a fixed reference value — the claimed
                    self-derived reference is not disclosed.
                  </p>
                </div>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="What lands on your desk"
          title="Seven numbered parts, and two appendices for the things most tools hide."
          lede="The report is built as a document with a table of contents, not a dashboard you have to screenshot. Sections appear only when there is something in them — scholarly citations and inventive-step combinations are conditional on the search actually finding them."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 overflow-hidden rounded-2xl border border-paper-300 bg-white">
              {TOC.map(([num, title], i) => {
                const isTop = !num.includes('.') && num !== 'A' && num !== 'B'
                const isAppendix = num === 'A' || num === 'B'
                return (
                  <div
                    key={num}
                    className={`flex items-baseline gap-4 px-6 py-2.5 ${
                      i !== 0 ? 'border-t border-paper-300/70' : ''
                    } ${isTop ? 'bg-paper-50/80' : ''}`}
                  >
                    <span
                      className={`w-10 flex-none font-mono text-[11px] ${
                        isTop || isAppendix ? 'text-lamp-600' : 'text-paper-500'
                      }`}
                    >
                      {num}
                    </span>
                    <span
                      className={`text-[14px] ${
                        isTop
                          ? 'font-medium text-ai-graphite-900'
                          : isAppendix
                            ? 'text-ai-graphite-700'
                            : 'text-paper-600'
                      }`}
                    >
                      {title}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-4 max-w-[70ch] text-[13px] leading-[1.6] text-paper-500">
              Appendix B exists on purpose. It lists references that were shortlisted but never
              mapped, so the difference between what was retrieved and what was analysed is a number
              you can see rather than one you have to trust.
            </p>
          </Reveal>
        </Section>

        <Section
          kicker="How the search runs"
          title="Six stages, and only one of them is allowed to decide relevance."
          lede="Separating retrieval from screening from mapping is what makes the report auditable: each stage has one job, and the stage that routed a reference is not the stage that later argues about it."
        >
          <Reveal delay={0.08}>
            <StageRail stages={STAGES} />
          </Reveal>
        </Section>

        <Section
          kicker="Reference routing"
          title="Every reference is labelled, including the ones that were thrown out."
          lede="A search that only shows you its hits is asking you to trust its filter. Each candidate keeps its routing label through to the report, and the counts reconcile: searched, retrieved, reviewed, visible, analysed."
        >
          <DefGrid items={MATCH} />
        </Section>

        <Section
          kicker="Feature classification"
          title="Not every feature deserves to count toward your novelty."
          lede="Features are typed before they are mapped, and the risk headline is computed from the core ones only. A boilerplate feature that no reference discloses is not evidence of novelty, and the report refuses to present it as such."
        >
          <DefGrid items={FEATURE_TYPES} />
        </Section>

        <Section
          kicker="Inventive step"
          title="The problem is rarely one document. It is two."
          lede="When no single reference covers the core features but a pair does, the report constructs the combination explicitly — what A teaches, what B adds, the apparent motivation to combine, and what the combination still does not reach."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              <Panel title="Reference A teaches" meta="§ 1.8">
                <ul className="space-y-2 text-[13px] leading-[1.6] text-paper-600">
                  <li>· Closed-loop actuation with feedback</li>
                  <li>· Sensor array in a growth enclosure</li>
                </ul>
              </Panel>
              <Panel title="Reference B adds">
                <ul className="space-y-2 text-[13px] leading-[1.6] text-paper-600">
                  <li>· Calibration against a derived reference</li>
                </ul>
              </Panel>
              <Panel title="Still missing">
                <p className="mb-3 text-[13px] leading-[1.6] text-paper-600">
                  Neither reference relates the derived reference back to the actuation interval —
                  the relationship the claim depends on.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="warn">Inventive-step review</Chip>
                  <span className="font-mono text-[10.5px] text-paper-500">coverage 78%</span>
                </div>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Landscape"
          title="Who else is working in this space, and who keeps showing up."
          lede="The same search that finds your prior art already knows who filed it. The report groups applicants and assignees, and flags inventors and entities that recur across the results — the signal that a competitor is building a portfolio rather than filing once."
        />

        <Section
          kicker="What it will not do"
          title="The report states its own confidence, and its own limits."
          lede="Four confidence values are recorded separately, because they fail for different reasons — a strong retrieval with weak feature mapping is a different problem from the reverse, and collapsing them into one number hides which one you have."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Retrieval confidence', 'Whether the search reached the right corpus and vocabulary.'],
                ['Feature mapping confidence', 'Whether each feature-to-reference call is well evidenced.'],
                ['Automated report confidence', 'Confidence in the assembled document as a whole.'],
                ['Legal conclusion', 'Explicitly not asserted. This is preliminary analysis for an attorney to weigh.'],
              ].map(([term, copy], i) => (
                <Panel key={term} title={term}>
                  <p className="text-[13px] leading-[1.6] text-paper-600">{copy}</p>
                  {i === 3 && (
                    <div className="mt-3">
                      <Chip tone="mute">Preliminary</Chip>
                    </div>
                  )}
                </Panel>
              ))}
            </div>
            <p className="mt-6 max-w-[74ch] text-[13.5px] leading-[1.65] text-paper-600">
              Novelty is determined by the Controller, not by a search. The report closes with a
              limitations section and concrete next steps, and every conclusion in it is framed as
              analysis for a qualified attorney to accept, narrow, or reject.
            </p>
          </Reveal>
        </Section>

        <ClosingAsk
          title="Run it on an invention you already know the answer to."
          lede="The fastest way to judge a novelty report is to point it at a disclosure whose prior art you have already read, and see whether it finds what you found — and says so with the evidence attached."
        />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
