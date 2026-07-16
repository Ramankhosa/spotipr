'use client'

// Small live demo for /patentnest/themes: one representative document card
// rendered three ways — Brass (current v3), Letters Patent (sealing wax), and
// Banker's Green (lamp green) — driven entirely by CSS variables so the only
// thing that changes between themes is the palette. Verdict chips are fixed
// across themes on purpose: semantic colors never follow the brand.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

type ThemeKey = 'brass' | 'wax' | 'lamp'

const THEMES: Record<
  ThemeKey,
  {
    name: string
    story: string
    base: string
    page: string
    ink: string
    inkSoft: string
    hairline: string
    label: string
    accent: string
    onAccent: string
    tint: string
    tintBorder: string
    tintText: string
    blue: string
    seal: string
  }
> = {
  brass: {
    name: 'Brass',
    story: 'The archive — seals, hairlines, grant ceremony',
    base: '#faf9f7',
    page: '#ffffff',
    ink: '#0f172a',
    inkSoft: '#475569',
    hairline: 'rgba(15,23,42,0.12)',
    label: '#8a6a1f',
    accent: '#8a6a1f',
    onAccent: '#faf9f7',
    tint: '#f3ecd9',
    tintBorder: '#e0d3ae',
    tintText: '#5c470f',
    blue: '#0369a1',
    seal: '#8a6a1f',
  },
  wax: {
    name: 'Letters patent',
    story: 'Sealing wax — warm, human, authenticated',
    base: '#f2efe8',
    page: '#fdfcfa',
    ink: '#211f1c',
    inkSoft: '#5c574e',
    hairline: 'rgba(33,31,28,0.14)',
    label: '#8a6a1f',
    accent: '#a03b25',
    onAccent: '#fdfcfa',
    tint: '#f6e3dd',
    tintBorder: '#e6c3b8',
    tintText: '#7c2d1a',
    blue: '#31567e',
    seal: '#a03b25',
  },
  lamp: {
    name: "Banker's green",
    story: 'The reading lamp — cleared, growing, certified',
    base: '#f0eee6',
    page: '#fdfcfa',
    ink: '#20221e',
    inkSoft: '#5a5c53',
    hairline: 'rgba(32,34,30,0.14)',
    label: '#8a6a1f',
    accent: '#2e5d47',
    onAccent: '#fdfcfa',
    tint: '#e3ecdd',
    tintBorder: '#c6d6bd',
    tintText: '#1c3a2c',
    blue: '#31567e',
    seal: '#8a6a1f',
  },
}

// Verdict colors are deliberately identical in every theme.
const VERDICTS = [
  { label: 'Claims 1–4 clear', bg: '#dcefe3', text: '#116041' },
  { label: 'Claim 5 partial', bg: '#f6ecd7', text: '#7a5308' },
  { label: '2 refs unknown', bg: '#ece9e0', text: '#57554d' },
]

export default function ThemeLab() {
  const [key, setKey] = useState<ThemeKey>('lamp')
  const t = THEMES[key]

  return (
    <div
      className="min-h-screen font-sans antialiased transition-colors duration-500"
      style={{ backgroundColor: t.base, color: t.ink }}
    >
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Link
          href="/patentnest"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors duration-500"
          style={{ color: t.inkSoft }}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> The full application
        </Link>

        <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p
              className="font-mono text-[11px] uppercase tracking-[0.3em] transition-colors duration-500"
              style={{ color: t.label }}
            >
              Theme lab · pick by eye
            </p>
            <p className="mt-2 text-sm transition-colors duration-500" style={{ color: t.inkSoft }}>
              {t.story}
            </p>
          </div>

          {/* switcher */}
          <div
            className="flex rounded-lg border p-1 transition-colors duration-500"
            style={{ borderColor: t.hairline, backgroundColor: t.page }}
          >
            {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setKey(k)}
                data-theme-btn={k}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-300"
                style={
                  key === k
                    ? { backgroundColor: t.ink, color: t.page }
                    : { color: t.inkSoft }
                }
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: THEMES[k].accent }}
                />
                {THEMES[k].name}
              </button>
            ))}
          </div>
        </div>

        {/* the document card */}
        <div
          className="mt-8 rounded-xl border p-7 transition-colors duration-500 sm:p-9"
          style={{ backgroundColor: t.page, borderColor: t.hairline }}
        >
          <div className="flex items-center gap-4">
            <p
              className="font-mono text-[11px] uppercase tracking-[0.3em] transition-colors duration-500"
              style={{ color: t.label }}
            >
              § 02 · Novelty search
            </p>
            <span
              className="h-px flex-1 transition-colors duration-500"
              style={{ backgroundColor: t.hairline }}
            />
          </div>

          <h1
            className="mt-5 font-serif text-3xl font-medium leading-tight tracking-tight transition-colors duration-500 sm:text-4xl"
            style={{ color: t.ink }}
          >
            Novelty is not a feeling. It&rsquo;s a finding.
          </h1>
          <p
            className="mt-3 max-w-xl text-[15px] leading-relaxed transition-colors duration-500"
            style={{ color: t.inkSoft }}
          >
            Adaptive irrigation controller — 14 inventive features mapped against 42 references
            across USPTO, EPO, WIPO, and Indian collections.
          </p>

          {/* serif document voice */}
          <p
            className="mt-5 border-l-2 pl-4 font-serif text-[17px] italic leading-relaxed transition-colors duration-500"
            style={{ color: t.ink, borderColor: t.accent }}
          >
            1. An irrigation controller comprising a soil-moisture sensor array and a
            weather-adaptive scheduling module&hellip;
          </p>

          {/* AI wash — the accent's home */}
          <div
            className="mt-6 flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors duration-500"
            style={{ backgroundColor: t.tint, borderColor: t.tintBorder }}
          >
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ backgroundColor: t.accent }}
              />
              <span
                className="relative inline-flex h-2 w-2 rounded-full"
                style={{ backgroundColor: t.accent }}
              />
            </span>
            <p className="text-[13px] transition-colors duration-500" style={{ color: t.tintText }}>
              AI is mapping features to evidence — batch 3 of 6. Verbatim quotes required for
              every Present verdict.
            </p>
          </div>

          {/* verdicts — fixed across themes */}
          <div className="mt-5 flex flex-wrap gap-2">
            {VERDICTS.map((v) => (
              <span
                key={v.label}
                className="rounded-full px-3 py-1 text-xs"
                style={{ backgroundColor: v.bg, color: v.text }}
              >
                {v.label}
              </span>
            ))}
          </div>

          {/* actions */}
          <div
            className="mt-7 flex flex-wrap items-center gap-3 border-t pt-6 transition-colors duration-500"
            style={{ borderColor: t.hairline }}
          >
            <button
              className="rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-300 active:scale-[0.98]"
              style={{ backgroundColor: t.accent, color: t.onAccent }}
            >
              Draft with AI
            </button>
            <button
              className="rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-300 active:scale-[0.98]"
              style={{ backgroundColor: t.ink, color: t.page }}
            >
              Freeze claims
            </button>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-sm underline-offset-4 transition-colors duration-500 hover:underline"
              style={{ color: t.blue }}
            >
              Search methodology
            </a>

            {/* seal */}
            <span
              className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] transition-colors duration-500"
              style={{ color: t.seal }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="12" cy="12" r="6.2" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 1.8" />
                <path d="M9 12.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Granted
            </span>
          </div>
        </div>

        {/* hex readout */}
        <div
          className="mt-5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors duration-500"
          style={{ color: t.inkSoft }}
        >
          <span>base {t.base}</span>
          <span>ink {t.ink}</span>
          <span style={{ color: t.accent }}>accent {t.accent}</span>
          <span style={{ color: t.label }}>label {t.label}</span>
          <span style={{ color: t.blue }}>blue {t.blue}</span>
        </div>
      </div>
    </div>
  )
}
