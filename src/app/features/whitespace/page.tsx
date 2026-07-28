import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, DefGrid, FeatureHero, Panel, Section, StageRail } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'Whitespace studies — PatentNest',
  description:
    'Find the gaps in a technology field, then attack them. Clustered corpus, rarity signals, six diagnostic gates and adversarial searches that separate a genuine opening from an empty region nobody wants.',
}

// Sourced from the implementation:
//   stages, whitespace types, scores, attacks, gates  src/lib/whitespace/types.ts
//   clustering + grades                               src/lib/whitespace/cluster-stage.ts, binary-kmeans.ts
//   rarity                                            src/lib/whitespace/rarity.ts
//   hypothesis generation and validation              src/lib/whitespace/hypothesize.ts, validate-stage.ts
//   handoff into novelty/drafting                     src/lib/whitespace/convert.ts

const STAGES = [
  {
    code: 'FIELD_MAP',
    label: 'Frame the field',
    copy: 'The scope is written down first — concepts, classifications, explicit exclusions, and the assumptions being made — so the study has a definition you can argue with before any compute is spent. Every edit to it is recorded on an audit trail.',
  },
  {
    code: 'CLUSTER',
    label: 'Cluster the corpus',
    copy: 'Documents from 2000 onward are embedded and split into clusters, and each cluster is graded well-defined, usable, or diffuse. A diffuse cluster is reported as diffuse rather than dressed up as a finding.',
  },
  {
    code: 'SIGNALS',
    label: 'Measure density, rarity, and divergence',
    copy: 'Filing density over time, term divergence between clusters, claim-element families, and genuinely rare feature pairs. This is where an absence starts to become measurable instead of anecdotal.',
  },
  {
    code: 'DEEP_DIVE',
    label: 'Read the rare region closely',
    copy: 'The sparse pairs are examined against the documents that surround them, to establish what is actually claimed nearby and what the gap is bounded by.',
  },
  {
    code: 'VALIDATE',
    label: 'Attack the hypothesis',
    copy: 'Each candidate opening is then actively attacked — six adversarial search strategies and six diagnostic gates. A hypothesis that survives has been shot at; one that does not is recorded as refuted, with the query that refuted it.',
  },
]

const TYPES = [
  { term: 'Genuine', code: 'GENUINE', copy: 'Survived the attacks and the gates. A real opening that appears both unclaimed and worth claiming.' },
  { term: 'Patent whitespace', code: 'PATENT_WHITESPACE', copy: 'Nothing in the patent record — but the literature or the market may already know about it.' },
  { term: 'Claim whitespace', code: 'CLAIM_WHITESPACE', copy: 'Present in disclosures but never claimed. Often the most useful kind, and the easiest to miss.' },
  { term: 'Data whitespace', code: 'DATA_WHITESPACE', copy: 'The gap is in the corpus, not the world. Coverage is too thin here to conclude anything — and the study says so.' },
  { term: 'Terminology whitespace', code: 'TERMINOLOGY_WHITESPACE', copy: 'The idea exists under different words. An artefact of vocabulary, caught by paraphrase and synonym attacks.' },
  { term: 'Scientific whitespace', code: 'SCIENTIFIC_WHITESPACE', copy: 'Published in the literature but not carried into patents.' },
  { term: 'Product whitespace', code: 'PRODUCT_WHITESPACE', copy: 'Shipping in products without patent coverage.' },
  { term: 'Technical feasibility', code: 'TECHNICAL_FEASIBILITY_WHITESPACE', copy: 'Empty because it does not work yet. The gate that most often explains a suspiciously clean result.' },
  { term: 'Commercial whitespace', code: 'COMMERCIAL_WHITESPACE', copy: 'Technically open, commercially uninteresting. Nobody filed because nobody would buy it.' },
  { term: 'Regulatory whitespace', code: 'REGULATORY_WHITESPACE', copy: 'Blocked or shaped by regulation rather than by the state of the art.' },
]

const ATTACKS = [
  ['Synonym shifted', 'SYNONYM_SHIFTED', 'The same idea in other words.'],
  ['Semantic paraphrase', 'SEMANTIC_PARAPHRASE', 'The same idea, restructured.'],
  ['CPC adjacent', 'CPC_ADJACENT', 'The neighbouring classifications.'],
  ['Assignee pivot', 'ASSIGNEE_PIVOT', 'What the obvious filers already hold.'],
  ['Red team', 'RED_TEAM', 'A deliberate attempt to refute it.'],
  ['Literature', 'LITERATURE', 'Non-patent publications.'],
]

export default function WhitespaceFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Whitespace studies"
          title="Most empty space is empty"
          accent="for a reason."
          lede="Finding a gap in a patent landscape is easy — plot anything and holes appear. The hard part is telling a real opening apart from a thin corpus, a vocabulary mismatch, or an idea that simply does not work. So every gap is attacked before it is reported."
          specs={[
            { label: 'Pipeline', value: '5 stages, audited end to end' },
            { label: 'Gap taxonomy', value: '10 reasons a space is empty' },
            { label: 'Validation', value: '6 attacks, 6 diagnostic gates' },
            { label: 'Handoff', value: 'Straight into novelty search' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="Hypothesis strength" meta="multiplicative">
                <div className="space-y-2.5">
                  {[
                    ['Density', 82],
                    ['Rarity', 74],
                    ['Semantic novelty', 68],
                    ['Evidence quality', 55],
                    ['Crowdedness', 71],
                  ].map(([label, v]) => (
                    <div key={label as string} className="flex items-center gap-3">
                      <span className="w-[112px] flex-none text-[11.5px] text-ai-graphite-700">{label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-200">
                        <span
                          className="block h-full rounded-full bg-lamp-500"
                          style={{ width: `${v}%` }}
                        />
                      </span>
                      <span className="w-8 flex-none text-right font-mono text-[10.5px] text-paper-500">
                        {v as number}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Strength is the product of its pillars, not their average. One collapsed pillar
                  collapses the score — a beautifully rare gap with no evidence behind it does not get
                  to rank highly.
                </p>
              </Panel>

              <Panel title="Validation record" meta="6 attacks planned">
                <div className="space-y-2 text-[11.5px]">
                  {[
                    ['Synonym shifted', '0 hits', 'good', 'CLEAN'],
                    ['Semantic paraphrase', '2 hits', 'warn', 'WEAKENING'],
                    ['CPC adjacent', '0 hits', 'good', 'CLEAN'],
                    ['Assignee pivot', '1 hit', 'warn', 'WEAKENING'],
                    ['Red team', '0 hits', 'good', 'CLEAN'],
                    ['Literature', '—', 'mute', 'NOT_RUN'],
                  ].map(([label, hits, tone, outcome]) => (
                    <div key={label as string} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ai-graphite-700">{label}</span>
                      <span className="flex flex-none items-center gap-2">
                        <span className="font-mono text-[10px] text-paper-500">{hits}</span>
                        <Chip tone={tone as string}>{outcome}</Chip>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Five attacks ran, one could not — and the reason is recorded. A study that quietly
                  skips its own tests would report a stronger result than it earned.
                </p>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="The pipeline"
          title="Five stages, and the last one exists to destroy the first four."
          lede="Discovery is the cheap half. The validate stage is adversarial by design: its job is to refute what the earlier stages proposed, and a hypothesis is only interesting once it has been through it."
        >
          <Reveal delay={0.08}>
            <StageRail stages={STAGES} />
          </Reveal>
        </Section>

        <Section
          kicker="Six gates"
          title="Before you call it an opportunity, rule out the boring explanations."
          lede="Each gate is a specific reason a region of a landscape can look empty without being available. They return passed, passed with weakening, failed, advisory, or unassessed — and unassessed is reported honestly rather than treated as a pass."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['G1 · Data', 'Is the corpus even dense enough here to support a conclusion?'],
                ['G2 · Terminology', 'Does this exist under another name?'],
                ['G3 · Adjacent claims', 'Is a neighbouring claim already reading on it?'],
                ['G4 · Feasibility', 'Is it empty because it cannot be built yet?'],
                ['G5 · Commercial', 'Is it empty because there is no market?'],
                ['G6 · Regulatory', 'Is it empty because regulation forecloses it?'],
              ].map(([term, copy]) => (
                <Panel key={term} title={term}>
                  <p className="text-[13px] leading-[1.6] text-paper-600">{copy}</p>
                </Panel>
              ))}
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Attack strategies"
          title="Six ways to try to prove your own finding wrong."
          lede="Each attack is a real search with a recorded query and hit count, and each returns clean, weakening, or refuting. A refuting result means the full combination already exists — better to learn that here than in an examination report."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {ATTACKS.map(([term, code, copy]) => (
                <Panel key={term} title={term} meta={code}>
                  <p className="text-[13px] leading-[1.6] text-paper-600">{copy}</p>
                </Panel>
              ))}
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Gap taxonomy"
          title="Ten reasons a space is empty. Only one of them is good news."
          lede="A study does not return 'whitespace found'. It returns which kind of emptiness it found, which is the difference between a filing opportunity and a warning that your corpus is too thin to say anything."
        >
          <DefGrid items={TYPES} />
        </Section>

        <Section
          kicker="What happens next"
          title="A surviving hypothesis becomes an invention you can search and draft."
          lede="Converting a hypothesis rewrites it into the same feature shape the novelty search and drafting flows already consume — with no new model call and no new claims invented at the boundary. The study's own audit trail travels with it: scope, runs, edits, hypotheses, challenges, and notes."
        />

        <ClosingAsk
          title="Point it at a field you already know well."
          lede="Run a study on a technology area you have opinions about. The gates and the attack log will tell you quickly whether the result is worth anything — including when the honest answer is that the corpus cannot support one."
        />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
