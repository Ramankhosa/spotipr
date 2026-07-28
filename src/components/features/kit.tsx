// Shared building blocks for the /features/* detail pages.
//
// Same visual system as the homepage — blue-tinted white ground, white cards on
// paper-300 hairlines, cobalt (lamp-600) as the only saturated colour — so a
// feature page reads as the same product, just one level deeper.
//
// Every page built from this kit describes behaviour that exists in the codebase.
// Where a page names a stage, a code, or a report section, that string comes from
// the implementation, not from copywriting.

import Link from 'next/link'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import Reveal from '@/components/home-v2/Reveal'

export const TONE: Record<string, string> = {
  good: 'bg-[#ecfdf5] text-[#047857]',
  warn: 'bg-[#fffbeb] text-[#b45309]',
  bad: 'bg-wax-100 text-wax-600',
  info: 'bg-lamp-50 text-lamp-700',
  mute: 'bg-paper-100 text-paper-600',
}

export function Chip({
  tone = 'mute',
  children,
}: {
  tone?: keyof typeof TONE | string
  children: React.ReactNode
}) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${TONE[tone] ?? TONE.mute}`}>
      {children}
    </span>
  )
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
      <span className="h-px w-7 bg-lamp-600/50" />
      {children}
    </p>
  )
}

export function Section({
  id,
  kicker,
  title,
  lede,
  children,
}: {
  id?: string
  kicker: string
  title: string
  lede?: string
  children?: React.ReactNode
}) {
  return (
    <section id={id} className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <Kicker>{kicker}</Kicker>
        <h2 className="max-w-[24ch] text-[clamp(25px,2.9vw,36px)] font-semibold leading-[1.15] tracking-[-0.024em] text-ai-graphite-900">
          {title}
        </h2>
        {lede && (
          <p className="mt-4 max-w-[62ch] text-[15.5px] leading-[1.65] text-paper-600">{lede}</p>
        )}
      </Reveal>
      {children}
    </section>
  )
}

export function Panel({
  title,
  meta,
  children,
  className = '',
}: {
  title?: string
  meta?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-paper-300 bg-white p-6 transition-all duration-200 hover:border-paper-400 hover:shadow-[0_16px_38px_-22px_rgba(16,24,40,0.22)] ${className}`}
    >
      {title && (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h3 className="text-[16px] font-medium tracking-[-0.012em] text-ai-graphite-900">{title}</h3>
          {meta && (
            <span className="flex-none font-mono text-[10px] uppercase tracking-[0.12em] text-paper-500">
              {meta}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

// A numbered vertical pipeline. Used for the real stage sequences (novelty
// Stage 0 → 4, whitespace FIELD_MAP → VALIDATE, ideation stages 1 → 6).
export function StageRail({
  stages,
}: {
  stages: { code: string; label: string; copy: string }[]
}) {
  return (
    <ol className="relative mt-12">
      <div aria-hidden className="absolute bottom-6 left-[15px] top-3 w-px bg-paper-300" />
      {stages.map((s, i) => (
        <li key={s.code} className="relative flex gap-5 pb-8 last:pb-0">
          <span className="relative z-10 mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full border border-paper-300 bg-white text-[11px] font-semibold text-lamp-600">
            {i + 1}
          </span>
          <div className="pt-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[15.5px] font-medium text-ai-graphite-900">{s.label}</h3>
              <code className="font-mono text-[10.5px] text-paper-500">{s.code}</code>
            </div>
            <p className="mt-1.5 max-w-[68ch] text-[14px] leading-[1.6] text-paper-600">{s.copy}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// Term → meaning pairs, for the real vocabularies (objection codes, whitespace
// types, match categories). Two columns on desktop.
export function DefGrid({
  items,
}: {
  items: { term: string; code?: string; copy: string; tone?: string }[]
}) {
  return (
    <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-paper-300 bg-paper-300 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.term} className="bg-white p-5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-medium text-ai-graphite-900">{it.term}</h3>
            {it.tone && <Chip tone={it.tone}>{it.tone === 'bad' ? 'blocks' : it.tone === 'warn' ? 'flags' : 'passes'}</Chip>}
          </div>
          {it.code && (
            <code className="mb-2 block font-mono text-[10.5px] text-paper-500">{it.code}</code>
          )}
          <p className="text-[13px] leading-[1.6] text-paper-600">{it.copy}</p>
        </div>
      ))}
    </div>
  )
}

export function FeatureHero({
  kicker,
  title,
  accent,
  tail,
  lede,
  specs,
  children,
}: {
  kicker: string
  title: string
  accent: string
  tail?: string
  lede: string
  specs: { label: string; value: string }[]
  children?: React.ReactNode
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-12%] top-[-18%] hidden h-[520px] w-[680px] rounded-full bg-lamp-100/40 blur-3xl lg:block"
      />
      <div className="relative mx-auto max-w-[1240px] px-5 pt-14 sm:px-8 lg:pt-20">
        <Reveal>
          <Kicker>{kicker}</Kicker>
          <h1 className="max-w-[19ch] text-[clamp(32px,4.2vw,52px)] font-semibold leading-[1.07] tracking-[-0.028em] text-ai-graphite-900">
            {title} <span className="text-lamp-600">{accent}</span>
            {tail ? ` ${tail}` : ''}
          </h1>
          <p className="mt-6 max-w-[58ch] text-[16.5px] leading-[1.62] text-paper-600">{lede}</p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/free-trial"
              className="group inline-flex items-center gap-2 rounded-lg bg-lamp-600 px-6 py-3.5 text-[15px] font-medium text-white transition-all duration-150 hover:bg-lamp-700 hover:shadow-[0_12px_28px_-12px_rgba(29,78,216,0.7)] active:scale-[0.985]"
            >
              Request a free trial
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-paper-300 bg-white px-6 py-3.5 text-[15px] font-medium text-ai-graphite-800 transition-all duration-150 hover:border-paper-400 hover:bg-paper-50 active:scale-[0.985]"
            >
              <MessagesSquare className="h-4 w-4 text-lamp-600" />
              Talk to us
            </Link>
          </div>
        </Reveal>

        {children}

        <Reveal delay={0.14}>
          <div className="mt-16 grid grid-cols-2 gap-y-6 rounded-xl border border-paper-300 bg-white px-6 py-6 sm:grid-cols-4 lg:divide-x lg:divide-paper-300">
            {specs.map((s) => (
              <div key={s.label} className="px-2 lg:px-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-paper-500">
                  {s.label}
                </p>
                <p className="mt-1.5 text-[15px] font-medium leading-snug text-ai-graphite-900">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function ClosingAsk({
  title,
  lede,
}: {
  title: string
  lede: string
}) {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-lamp-600 px-8 py-14 sm:px-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '54px 54px',
            }}
          />
          <div className="relative max-w-[46ch]">
            <h2 className="text-[clamp(23px,2.7vw,32px)] font-semibold leading-[1.2] tracking-[-0.022em] text-white">
              {title}
            </h2>
            <p className="mt-4 text-[15.5px] text-lamp-100">{lede}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/free-trial"
                className="group inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-[15px] font-medium text-lamp-700 transition-all duration-150 hover:bg-lamp-50 active:scale-[0.985]"
              >
                Request a free trial
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-6 py-3.5 text-[15px] font-medium text-white transition-all duration-150 hover:border-white/70 hover:bg-white/10 active:scale-[0.985]"
              >
                <MessagesSquare className="h-4 w-4" />
                Talk to us
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-lamp-100/85">
              Trial requests are reviewed by a person, usually within one business day. No card,
              no auto-renewal.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
