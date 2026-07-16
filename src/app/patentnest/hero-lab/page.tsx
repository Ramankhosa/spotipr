import type { Metadata } from 'next'
import Link from 'next/link'
import { SerpentineHeroFig, FourActsHeroFig, CinematicHero } from '@/components/patentnest/hero-variants'

export const metadata: Metadata = {
  title: 'Hero lab — PatentNest.ai',
  description: 'Compare hero-figure variants: serpentine line, four acts, and cinematic stage-by-stage.',
}

// Comparison lab for the homepage hero figure — three answers to "the
// unbroken line is too small to read". Pick by eye, like /patentnest/themes.
export default function HeroLabPage() {
  const variants = [
    {
      key: 'A',
      name: 'Serpentine',
      note: 'The full seven-stage line, switchbacked over three rows — every stage gets ~2× the room, captions at readable size. Keeps the complete story on screen at once.',
      body: <SerpentineHeroFig />,
    },
    {
      key: 'B',
      name: 'Four acts',
      note: 'Fewer, bigger chapters: Disclose → Search → Draft → File & Grant. The lens literally circles “30M+”. Least detail, most legible at a glance — strongest for first-time visitors.',
      body: <FourActsHeroFig />,
    },
    {
      key: 'C',
      name: 'Cinematic',
      note: 'One stage at a time, drawn large, with real HTML type beside it — auto-advances every ~3.5s (hover to pause, click the ticks to jump). Most readable of all; the trade-off is you never see the whole line at once.',
      body: <CinematicHero />,
    },
  ]

  return (
    <div className="min-h-screen bg-paper-200 px-4 py-16 font-sans text-ai-graphite-900 antialiased selection:bg-brass-600/20 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/patentnest"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ai-graphite-500 transition-colors hover:text-ai-graphite-900"
        >
          ← The full application
        </Link>
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.3em] text-brass-600">
          Hero lab · pick by eye
        </p>
        <h1 className="mt-3 font-serif text-3xl font-medium tracking-tight sm:text-4xl">
          Three ways to draw the journey.
        </h1>

        <div className="mt-12 space-y-16">
          {variants.map((v) => (
            <section key={v.key}>
              <div className="flex items-baseline gap-4">
                <span className="font-serif text-2xl font-semibold text-brass-600">{v.key}</span>
                <h2 className="font-serif text-xl font-semibold">{v.name}</h2>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ai-graphite-600">{v.note}</p>
              <div className="mt-5 rounded-xl border border-ai-graphite-900/10 bg-white p-6 sm:p-10">
                {v.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
