import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, FeatureHero, Panel, Section, StageRail } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'Ideation — PatentNest',
  description:
    'Turn one seed idea into a mapped space of inventions: semantic grounding, inventive framing, discovered dimensions, assumption-breaking expansion, mechanism-pure idea generation, and a preliminary novelty gate.',
}

// Sourced from the implementation:
//   the six stages and their real names   src/lib/ideation/ideation-service.ts
//   handoff into novelty search           src/lib/ideation-novelty-handoff.ts
//   idea bank export                      src/app/api/idea-bank/export/route.ts

const STAGES = [
  {
    code: 'SEMANTIC_GROUNDING',
    label: 'Ground the seed in what it actually is',
    copy: 'The starting idea is read for its technical substance rather than its phrasing — what it operates on, what it changes, and what problem it is really addressing. Everything downstream builds on this reading, so it is the first thing you can correct.',
  },
  {
    code: 'INVENTIVE_FRAMING',
    label: 'Frame the inventive question',
    copy: 'The idea is positioned as an inventive proposition: the tension it resolves and the constraint it is fighting. A framing, not a category — the point is to find where invention is possible, not to file it under a label.',
  },
  {
    code: 'DIMENSION_DISCOVERY',
    label: 'Discover the dimensions that matter here',
    copy: 'The axes of variation are derived from this specific invention rather than pulled from a fixed checklist of families. Different inventions have different degrees of freedom, and a generic template flattens exactly the ones worth exploring.',
  },
  {
    code: 'DIMENSION_EXPANSION',
    label: 'Break the assumptions on each axis',
    copy: 'Each dimension is expanded through moves that deliberately violate an assumption the seed idea was making. This is where the mind map stops describing your idea and starts producing neighbouring ones.',
  },
  {
    code: 'IDEA_GENERATION',
    label: 'Generate mechanism-pure ideas',
    copy: 'Candidates are generated as mechanisms — how the thing works — not as benefit statements. A mechanism can be claimed, searched, and drawn; a benefit cannot. Selected nodes can be combined to produce hybrids.',
  },
  {
    code: 'PRELIMINARY_NOVELTY_ASSESSMENT',
    label: 'Gate them, without pretending it is a search',
    copy: 'A first-pass novelty read that runs without prior art, purely to triage a long list before you spend a real search on it. It is labelled preliminary because that is what it is — the actual evidence comes from the novelty search.',
  },
]

export default function IdeationFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Ideation"
          title="One disclosure is rarely"
          accent="one invention."
          lede="An inventor arrives with a single idea and a single way of describing it. Ideation opens that into the space around it — the dimensions it actually varies along, the assumptions it did not know it was making, and the neighbouring mechanisms worth claiming before someone else does."
          specs={[
            { label: 'Pipeline', value: '6 stages from seed to gated ideas' },
            { label: 'Output form', value: 'Mechanisms, not benefits' },
            { label: 'Triage', value: 'Preliminary novelty gate' },
            { label: 'Handoff', value: 'Idea bank, then novelty search' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Panel title="Dimensions discovered" meta="from this invention">
                <div className="space-y-3">
                  {[
                    ['Reference source', 'stored → derived → inferred'],
                    ['Correction timing', 'per interval → continuous → event-driven'],
                    ['Actuation coupling', 'direct → mediated → distributed'],
                  ].map(([axis, moves]) => (
                    <div key={axis}>
                      <p className="text-[12.5px] font-medium text-ai-graphite-900">{axis}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] leading-[1.6] text-paper-600">
                        {moves}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  These axes came out of the invention. A fixed list of dimension families would have
                  produced three different ones, none of them this specific.
                </p>
              </Panel>

              <Panel title="Generated ideas" meta="mechanism-pure">
                <div className="space-y-2.5 text-[11.5px]">
                  {[
                    ['Reference derived from preceding interval', 'good', 'Likely novel'],
                    ['Inferred reference from neighbouring sensors', 'good', 'Likely novel'],
                    ['Event-driven recalibration on drift detection', 'warn', 'Needs search'],
                    ['Continuous correction with stored baseline', 'bad', 'Likely known'],
                  ].map(([label, tone, verdict]) => (
                    <div key={label as string} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ai-graphite-700">{label}</span>
                      <Chip tone={tone as string}>{verdict}</Chip>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  A preliminary gate, run without prior art — enough to decide what deserves a real
                  search, and explicitly not enough to conclude anything.
                </p>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="The pipeline"
          title="Six stages, each one correctable before the next runs."
          lede="The value is in the order. Grounding before framing, framing before dimensions, dimensions before expansion — because an error in the reading of the seed idea propagates into every idea generated from it, and you want to catch it at stage one."
        >
          <Reveal delay={0.08}>
            <StageRail stages={STAGES} />
          </Reveal>
        </Section>

        <Section
          kicker="Mechanisms, not benefits"
          title="'Improves efficiency' cannot be claimed. A mechanism can."
          lede="Idea generation is constrained to produce mechanisms — a specific way something works. It is the difference between an idea that reads like a pitch and one that can be turned into a claim, searched against prior art, and drawn as a figure."
        >
          <Reveal delay={0.08}>
            <div className="mt-12 grid gap-5 sm:grid-cols-2">
              <Panel title="Not this">
                <p className="mb-3 text-[13.5px] leading-[1.6] text-paper-600">
                  “A smarter calibration approach that improves accuracy and reduces maintenance
                  cost.”
                </p>
                <Chip tone="bad">Unclaimable</Chip>
              </Panel>
              <Panel title="This">
                <p className="mb-3 text-[13.5px] leading-[1.6] text-paper-600">
                  “Recalibrating against a reference derived from the preceding actuation interval
                  rather than a stored value.”
                </p>
                <Chip tone="good">Claimable, searchable, drawable</Chip>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="What happens next"
          title="An idea worth keeping leaves ideation and becomes work."
          lede="Ideas can be exported to the idea bank to sit as a portfolio of candidates, or handed straight to a novelty search — carrying their features across in the shape the search already expects, so nothing is retyped and nothing is quietly reinterpreted on the way."
        />

        <ClosingAsk
          title="Start from an idea you think is already finished."
          lede="Ideation is most useful on a disclosure you consider complete. The assumption-breaking moves tend to surface two or three neighbouring mechanisms the inventor had ruled out without noticing."
        />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
