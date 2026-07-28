import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, DefGrid, FeatureHero, Panel, Section, StageRail } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'FER and office action responses — PatentNest',
  description:
    'Parse an examination report into classified objections with verified examiner quotes, choose argue or amend per objection, check every amendment against specification basis, and gate the export on a compliance lint.',
}

// Sourced from the implementation, not written as marketing:
//   canonical codes, deadline models, extensions  src/lib/office-action/oa-profile-schema.ts
//   quote verification                            src/lib/office-action/objection-classifier.ts
//   argue/amend + basis verdicts                  src/lib/office-action/strategy-service.ts
//   export gate                                   src/lib/office-action/compliance-lint.ts
//   deadline arithmetic                           src/lib/office-action/deadline-engine.ts
//   claim charts, citations, DOCX export          src/lib/office-action/*

const STAGES = [
  {
    code: 'document-intake',
    label: 'Read the report as filed',
    copy: 'The examination report goes in as the PDF the office issued. Text is extracted, the instrument is identified from its own detection phrases, and the metadata the profile requires is pulled from the document itself.',
  },
  {
    code: 'objection-classifier',
    label: 'Split it into objections, and verify every quote',
    copy: 'Each objection becomes a record with the office’s own numbering preserved, the claims it affects, the citations it relies on — and the examiner’s words checked back against the source document before anything is drafted.',
  },
  {
    code: 'citation-resolver',
    label: 'Resolve what the examiner actually cited',
    copy: 'Cited documents are pulled and their full text retrieved, so the objection is answered against the reference rather than against the examiner’s one-line characterisation of it.',
  },
  {
    code: 'claim-chart-service',
    label: 'Chart the claim against the citation',
    copy: 'Element by element, where the citation reaches your claim and where it stops. The chart is the input to the strategy call, not a separate deliverable produced afterwards.',
  },
  {
    code: 'strategy-service',
    label: 'Offer argue, amend, or both — with the trade-offs',
    copy: 'Each objection gets up to three options, each with its own rationale, pros, and cons, and one marked recommended. Proposed amendments arrive with tracked insertions and deletions plus a clean version.',
  },
  {
    code: 'basis verdicts',
    label: 'Check every amendment against the specification',
    copy: 'For each amended claim: do the cited paragraph references resolve in the specification as filed, and is the inserted wording actually supported by them. Unsupported insertions are named individually and the claim is marked pass, risk, or fail.',
  },
  {
    code: 'compliance-lint',
    label: 'Gate the export on hard rules',
    copy: 'The final check before anything leaves. A failure blocks the export rather than producing a defective reply — see the gates below.',
  },
]

const CODES = [
  { term: 'Novelty', code: 'NOVELTY', copy: 'IN s.2(1)(j) · US §102 · EP Art.54 — the profile maps the canonical code to the local statute.' },
  { term: 'Inventive step', code: 'INVENTIVE_STEP', copy: 'The obviousness family, including single-reference and combination attacks.' },
  { term: 'Eligibility', code: 'ELIGIBILITY', copy: 'Subject-matter exclusions — in India, the s.3 family including s.3(k).' },
  { term: 'Clarity', code: 'CLARITY', copy: 'Indefiniteness, ambiguous terms, and scope that cannot be determined from the claim.' },
  { term: 'Sufficiency', code: 'SUFFICIENCY', copy: 'Enablement and whether the disclosure supports the breadth claimed.' },
  { term: 'Unity', code: 'UNITY', copy: 'More than one invention in a single application.' },
  { term: 'Added matter', code: 'ADDED_MATTER', copy: 'Amendments reaching beyond the disclosure as filed — the risk the basis check exists to catch.' },
  { term: 'Double patenting', code: 'DOUBLE_PATENTING', copy: 'Conflict with a co-pending or granted claim set.' },
  { term: 'Procedural disclosure', code: 'PROCEDURAL_DISCLOSURE', copy: 'Statements and undertakings the office requires — in India, the s.8 / Form 3 obligation.' },
  { term: 'Formalities', code: 'FORMALITIES', copy: 'Drawing, abstract, and document-format requirements.' },
]

const LINT = [
  { term: 'Every objection answered', code: 'coverage', copy: 'No objection may be left unanswered or unapproved. Unreplied objections are counted and named.', tone: 'bad' },
  { term: 'No empty reply sections', code: 'content', copy: 'An approved section with no text cannot export. A silent model failure must never ship as a blank heading.', tone: 'bad' },
  { term: 'Examiner quotes verified', code: 'quotes', copy: 'Every quote the reply relies on has to be grounded in the source document. An unverified quote blocks the export.', tone: 'bad' },
  { term: 'Amendments cite basis', code: 'basis', copy: 'Each amendment must point at specification paragraphs that exist and support it — the added-matter guard, checked against s.59.', tone: 'bad' },
]

export default function FerFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Office action studio · FER response"
          title="Answer the examiner"
          accent="objection by objection"
          tail="— with the basis checked."
          lede="An examination report is not one problem — it is a numbered list of them, each with its own basis and its own answer. Every objection is classified, quoted verbatim from the report, charted against what the examiner cited, and answered with a strategy you chose. No reply exports until the amendments prove their basis."
          specs={[
            { label: 'Objection vocabulary', value: '11 canonical codes, mapped per office' },
            { label: 'Per objection', value: 'Argue, amend, or both' },
            { label: 'Export gate', value: 'Hard lint — a fail blocks it' },
            { label: 'Output', value: 'DOCX, marked and clean' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="Objection 2 — inventive step" meta="office no. 2.a">
                <p className="mb-3 rounded-lg border-l-2 border-lamp-600 bg-paper-50 p-3 text-[12px] italic leading-[1.6] text-ai-graphite-700">
                  “Claim 1 lacks an inventive step over D1 in view of D2, since the skilled person
                  would combine…”
                </p>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Chip tone="good">Quote verified</Chip>
                  <Chip tone="info">INVENTIVE_STEP</Chip>
                  <span className="font-mono text-[10.5px] text-paper-500">claims 1, 4–7</span>
                </div>
                <p className="mb-2.5 font-mono text-[9.5px] uppercase tracking-wider text-paper-500">
                  Options
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {['Argue', 'Amend', 'Argue + amend'].map((s, i) => (
                    <div
                      key={s}
                      className={`rounded-lg border p-2 text-center text-[10.5px] font-medium ${
                        i === 2
                          ? 'border-lamp-300 bg-lamp-50 text-lamp-700'
                          : 'border-paper-300 bg-white text-paper-600'
                      }`}
                    >
                      {s}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-center font-mono text-[9.5px] text-paper-500">recommended</p>
              </Panel>

              <Panel title="Amendment basis check" meta="claim 1">
                <div className="mb-3 space-y-1 rounded-lg border border-paper-300 bg-paper-50 p-3 font-mono text-[11px] leading-[1.7]">
                  <p className="text-ai-graphite-700">
                    …a controller configured to recalibrate{' '}
                    <span className="bg-[#ecfdf5] text-[#047857]">
                      against a reference derived from a preceding actuation interval
                    </span>
                    <span className="text-wax-600 line-through"> against a stored value</span>…
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {[
                    ['Basis refs', '¶ [0041], [0060]'],
                    ['Refs resolved', 'Yes'],
                    ['Insertion supported', 'Yes'],
                    ['Verdict', 'Pass'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[9.5px] uppercase tracking-wider text-paper-500">{k}</dt>
                      <dd className="text-[12.5px] font-medium text-ai-graphite-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Had a cited paragraph not existed, or the inserted wording not been supported by
                  it, the claim would read <span className="font-medium">risk</span> or{' '}
                  <span className="font-medium">fail</span> and the export would stop.
                </p>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="The pipeline"
          title="From the PDF the office sent to a reply that survives its own audit."
          lede="Each step writes down what it did. The reply you file can be traced back through strategy, chart, citation, and quote to a specific line of the examiner's report."
        >
          <Reveal delay={0.08}>
            <StageRail stages={STAGES} />
          </Reveal>
        </Section>

        <Section
          kicker="Anti-fabrication"
          title="An examiner quote the report does not contain cannot be used."
          lede="Every quote attributed to the examiner is checked back against the extracted source text before it can appear in a reply. Short quotes must match exactly; longer passages must match on a high proportion of consecutive word pairs, which tolerates a stray dash or an OCR glitch inside a long verbatim span while still rejecting a sentence that was never written."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-3">
              <Panel title="Short quotes">
                <p className="text-[13px] leading-[1.6] text-paper-600">
                  Under twelve words: an exact match after normalising dashes, smart quotes, and
                  spacing. No tolerance.
                </p>
              </Panel>
              <Panel title="Long passages">
                <p className="text-[13px] leading-[1.6] text-paper-600">
                  Matched on consecutive word pairs against the source, so extraction noise does not
                  fail a genuine quote.
                </p>
              </Panel>
              <Panel title="Fabrications">
                <p className="mb-3 text-[13px] leading-[1.6] text-paper-600">
                  An invented sentence shares almost no word pairs with the document. It fails, and
                  it is marked unverified.
                </p>
                <Chip tone="bad">Blocks export</Chip>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Objection vocabulary"
          title="Eleven canonical codes, mapped to whichever office you are answering."
          lede="The pipeline reasons in office-agnostic codes; a jurisdiction profile maps each one to local statute. The same classified objection becomes s.2(1)(j) in India, §102 in the United States, and Art.54 at the EPO without re-teaching the pipeline."
        >
          <DefGrid items={CODES} />
        </Section>

        <Section
          kicker="Deadlines"
          title="Three different clocks, because offices do not agree on how time works."
          lede="A response window is not a single rule. The profile records which model an office uses, what an extension buys, which form requests it, what it costs per month, and what happens if the date passes."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {[
                ['Per report', 'PER_REPORT', 'Each report starts its own clock. India, United States, Canada, EPO.'],
                ['Acceptance clock', 'ACCEPTANCE_CLOCK', 'One hard window from the first report to acceptance. Australia, New Zealand.'],
                ['Hybrid', 'HYBRID', 'Per-report clocks running inside an overall compliance ceiling. United Kingdom.'],
              ].map(([term, code, copy]) => (
                <Panel key={term} title={term} meta={code}>
                  <p className="text-[13px] leading-[1.6] text-paper-600">{copy}</p>
                </Panel>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-paper-300 bg-white p-6">
              <p className="mb-4 font-mono text-[9.5px] uppercase tracking-[0.13em] text-paper-500">
                Tracked per deadline
              </p>
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Due date', 'computed from the trigger date and the office period'],
                  ['Extension', 'the extended date, and the last day to request it'],
                  ['Cost', 'form and fee per month, by entity type'],
                  ['If missed', 'the consequence, its statutory basis, and whether it is revivable'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[13.5px] font-medium text-ai-graphite-900">{k}</p>
                    <p className="mt-1 text-[12.5px] leading-[1.55] text-paper-600">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="The export gate"
          title="Four rules that stop a defective reply from being filed."
          lede="These are not warnings. Each one is a hard check, and a failure blocks the DOCX export instead of producing a document that would be defective on the record. A forms checklist runs alongside them — a procedural-disclosure objection, for instance, pulls in the Form 3 requirement."
        >
          <DefGrid items={LINT} />
        </Section>

        <ClosingAsk
          title="Bring a live FER with a date on it."
          lede="Upload the report you are already working on and compare the classified objections against your own read of it. The quotes are verifiable against the PDF, so checking the work takes minutes."
        />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
