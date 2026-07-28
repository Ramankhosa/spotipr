// The eight-step rail for /home-v2 — one invention, one continuous record.
// Icon tiles stand in for the isometric 3D renders in the design comp; swap the
// tile contents for real assets when they exist without touching the layout.

import {
  Boxes,
  ClipboardList,
  Layers,
  MessageSquareReply,
  PenLine,
  Search,
  ShieldCheck,
  Shapes,
  Target,
} from 'lucide-react'
import Reveal from './Reveal'

const STEPS = [
  { n: 1, label: 'Describe', copy: 'Capture your invention in plain language.', icon: ClipboardList },
  { n: 2, label: 'Explore', copy: 'Break it into components, effects, and options.', icon: Boxes },
  { n: 3, label: 'Search', copy: 'Global prior art search with an evidence map.', icon: Search },
  { n: 4, label: 'Position', copy: "Identify what's known, partial, or distinctive.", icon: Target },
  { n: 5, label: 'Draft', copy: 'Engineer claims and draft complete specifications.', icon: PenLine },
  { n: 6, label: 'Visualize', copy: 'Generate figures from models and diagrams.', icon: Shapes },
  { n: 7, label: 'Validate', copy: 'Review for support, clarity, and consistency.', icon: ShieldCheck },
  { n: 8, label: 'Respond', copy: 'Prepare strong responses to office actions.', icon: MessageSquareReply },
]

export default function JourneySection() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <p className="mb-5 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
          <span className="h-px w-7 bg-lamp-600/50" />
          One invention. One continuous record.
        </p>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-end">
          <h2 className="text-[clamp(26px,3.1vw,38px)] font-semibold leading-[1.14] tracking-[-0.024em] text-ai-graphite-900">
            Every step is connected.
            <br />
            Every decision is traceable.
          </h2>
          <p className="max-w-[52ch] text-[15.5px] leading-[1.62] text-paper-600">
            From the initial disclosure to the final filing, PatentNest keeps claims,
            paragraphs, figures, and prior art linked — so every choice you make can be
            explained later.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="relative mt-14">
          {/* the rail */}
          <div
            aria-hidden
            className="absolute left-[6%] right-[6%] top-[94px] hidden h-px bg-paper-300 lg:block"
          />

          <ol className="relative grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-4 lg:grid-cols-8 lg:gap-x-2">
            {STEPS.map(({ n, label, copy, icon: Icon }) => (
              <li key={n} className="flex flex-col items-center text-center">
                <div className="flex h-[68px] w-[68px] items-center justify-center rounded-2xl border border-paper-300 bg-white shadow-[0_10px_24px_-14px_rgba(16,24,40,0.28)]">
                  <Icon className="h-6 w-6 text-lamp-600" strokeWidth={1.6} />
                </div>

                <span className="relative z-10 mt-4 flex h-5 w-5 items-center justify-center rounded-full bg-lamp-600 text-[10px] font-semibold text-white ring-4 ring-[#f6f8fd]">
                  {n}
                </span>

                <p className="mt-3 text-[14px] font-medium text-ai-graphite-900">{label}</p>
                <p className="mt-1 max-w-[19ch] text-[12px] leading-[1.5] text-paper-600">{copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>
    </section>
  )
}
