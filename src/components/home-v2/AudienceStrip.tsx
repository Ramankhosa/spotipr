// Who it's for — four segments in one row, mirroring the design comp's
// "trusted by innovators worldwide" strip.

import { Building2, GraduationCap, Rocket, UserRound } from 'lucide-react'
import Reveal from './Reveal'

const SEGMENTS = [
  {
    title: 'Patent firms',
    copy: 'Draft faster, review smarter, and deliver stronger patents.',
    icon: Building2,
  },
  {
    title: 'Universities and TTOs',
    copy: 'Intake disclosures, triage novelty, and manage portfolios.',
    icon: GraduationCap,
  },
  {
    title: 'R&D and startups',
    copy: 'Protect innovations early and build IP portfolios with confidence.',
    icon: Rocket,
  },
  {
    title: 'Individual inventors',
    copy: 'From idea to filing-ready application, simplified.',
    icon: UserRound,
  },
]

export default function AudienceStrip() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <p className="mb-6 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
          <span className="h-px w-7 bg-lamp-600/50" />
          Built for everyone who files
        </p>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-paper-300 bg-paper-300 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map(({ title, copy, icon: Icon }) => (
            <div key={title} className="bg-white p-6 transition-colors duration-200 hover:bg-paper-50">
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-lamp-50">
                <Icon className="h-[18px] w-[18px] text-lamp-600" strokeWidth={1.7} />
              </span>
              <h3 className="text-[15px] font-medium text-ai-graphite-900">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-paper-600">{copy}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
