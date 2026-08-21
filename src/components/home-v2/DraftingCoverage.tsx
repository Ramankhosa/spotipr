// Drafting coverage schedule for the homepage.
//
// Real drawing sheets carry a parts schedule beside the figures; this is that
// device used for something true — the offices PatentNest can draft to, with the
// language each one is drafted in.
//
// The jurisdictions and languages below mirror JURISDICTION_LANGUAGE_MAP in
// src/lib/jurisdiction-language.ts, which is the canonical map the drafting
// pipeline actually resolves against. Keep them in step: if a jurisdiction is
// added there, add it here. Counts are DERIVED from the arrays rather than
// hardcoded, so the headline number cannot drift away from the list beneath it.
//
// Deliberately omitted from that map: REFERENCE (an internal pseudo-jurisdiction
// for reference drafts, not a real office) and GB (a duplicate of UK).

import Reveal from './Reveal'

type Region = {
  label: string
  offices: { code: string; name: string; lang: string }[]
}

const REGIONS: Region[] = [
  {
    label: 'INTERNATIONAL ROUTES',
    offices: [
      { code: 'PCT', name: 'Patent Cooperation Treaty', lang: 'EN' },
      { code: 'WIPO', name: 'World Intellectual Property Org.', lang: 'EN' },
      { code: 'EP', name: 'European Patent Office', lang: 'EN' },
    ],
  },
  {
    label: 'ASIA-PACIFIC',
    offices: [
      { code: 'IN', name: 'India', lang: 'EN' },
      { code: 'AU', name: 'Australia', lang: 'EN' },
      { code: 'JP', name: 'Japan', lang: 'JA' },
      { code: 'CN', name: 'China', lang: 'ZH' },
      { code: 'KR', name: 'Korea', lang: 'KO' },
      { code: 'SG', name: 'Singapore', lang: 'EN' },
      { code: 'MY', name: 'Malaysia', lang: 'EN' },
      { code: 'TW', name: 'Taiwan', lang: 'ZH' },
      { code: 'NZ', name: 'New Zealand', lang: 'EN' },
    ],
  },
  {
    label: 'AMERICAS',
    offices: [
      { code: 'US', name: 'United States', lang: 'EN' },
      { code: 'CA', name: 'Canada', lang: 'EN' },
      { code: 'BR', name: 'Brazil', lang: 'PT' },
      { code: 'MX', name: 'Mexico', lang: 'ES' },
      { code: 'AR', name: 'Argentina', lang: 'ES' },
    ],
  },
  {
    label: 'EUROPE',
    offices: [
      { code: 'UK', name: 'United Kingdom', lang: 'EN' },
      { code: 'DE', name: 'Germany', lang: 'DE' },
      { code: 'FR', name: 'France', lang: 'FR' },
      { code: 'ES', name: 'Spain', lang: 'ES' },
      { code: 'IT', name: 'Italy', lang: 'IT' },
      { code: 'NL', name: 'Netherlands', lang: 'NL' },
      { code: 'CH', name: 'Switzerland', lang: 'DE' },
      { code: 'AT', name: 'Austria', lang: 'DE' },
      { code: 'SE', name: 'Sweden', lang: 'SV' },
      { code: 'PL', name: 'Poland', lang: 'PL' },
      { code: 'RU', name: 'Russia', lang: 'RU' },
    ],
  },
  {
    label: 'MIDDLE EAST & AFRICA',
    offices: [
      { code: 'IL', name: 'Israel', lang: 'HE' },
      { code: 'SA', name: 'Saudi Arabia', lang: 'AR' },
      { code: 'UAE', name: 'United Arab Emirates', lang: 'AR' },
      { code: 'ZA', name: 'South Africa', lang: 'EN' },
    ],
  },
]

const TOTAL_OFFICES = REGIONS.reduce((n, r) => n + r.offices.length, 0)
const TOTAL_LANGUAGES = new Set(REGIONS.flatMap((r) => r.offices.map((o) => o.lang))).size

export default function DraftingCoverage() {
  return (
    <section id="coverage" className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <div className="border-t-2 border-vellum-900 pt-6">
          <p className="font-mono text-[10.5px] tracking-[0.2em] text-ink-examiner">
            SCHEDULE A — DRAFTING COVERAGE
          </p>
          <h2 className="mt-3 max-w-[22ch] text-[clamp(30px,4.6vw,58px)] font-bold leading-[0.98] tracking-[-0.035em] text-vellum-900">
            Drafted to the office it is filed in.
          </h2>
          <p className="mt-4 max-w-[60ch] text-[16.5px] leading-[1.6] text-vellum-700">
            Each office has its own structure, section order, claim conventions and language.
            We draft to the one you are filing in — not a generic specification with the
            country name changed.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <dl className="mt-10 grid grid-cols-2 border border-vellum-900 sm:grid-cols-3">
          <div>
            <dt className="border-b border-vellum-900 px-3.5 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-vellum-600">
              Patent offices
            </dt>
            <dd className="px-3.5 pb-5 pt-4 text-[clamp(26px,3.2vw,40px)] font-semibold leading-none tracking-[-0.032em] text-vellum-900 [font-variant-numeric:tabular-nums]">
              {TOTAL_OFFICES}
            </dd>
          </div>
          <div className="border-l border-vellum-900">
            <dt className="border-b border-vellum-900 px-3.5 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-vellum-600">
              Drafting languages
            </dt>
            <dd className="px-3.5 pb-5 pt-4 text-[clamp(26px,3.2vw,40px)] font-semibold leading-none tracking-[-0.032em] text-vellum-900 [font-variant-numeric:tabular-nums]">
              {TOTAL_LANGUAGES}
            </dd>
          </div>
          <div className="col-span-2 border-t border-vellum-900 sm:col-span-1 sm:border-l sm:border-t-0">
            <dt className="border-b border-vellum-900 px-3.5 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-vellum-600">
              International routes
            </dt>
            <dd className="px-3.5 pb-5 pt-4 text-[clamp(26px,3.2vw,40px)] font-semibold leading-none tracking-[-0.032em] text-vellum-900">
              PCT
              <span className="mt-2 block text-[12px] font-normal tracking-normal text-vellum-600">
                and direct national filings
              </span>
            </dd>
          </div>
        </dl>
      </Reveal>

      <div className="mt-10 space-y-8">
        {REGIONS.map((region, ri) => (
          <Reveal key={region.label} delay={0.04 * ri}>
            <div>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="font-mono text-[10px] tracking-[0.16em] text-vellum-600">
                  {region.label}
                </h3>
                <span className="h-px flex-1 bg-vellum-400" />
                <span className="font-mono text-[10px] tracking-[0.12em] text-vellum-500">
                  {region.offices.length}
                </span>
              </div>

              {/* Borders live on the CELLS, not on a gap-px background: a region
                  whose last row is ragged would otherwise show the container
                  colour through the empty tracks as solid blocks. */}
              <ul className="grid grid-cols-2 border-l border-t border-vellum-900 sm:grid-cols-3 lg:grid-cols-5">
                {region.offices.map((o) => (
                  <li
                    key={o.code}
                    className="flex items-baseline justify-between gap-2 border-b border-r border-vellum-900 bg-vellum-100 px-3 py-2.5"
                  >
                    <span>
                      <span className="block font-mono text-[13px] font-medium tracking-[0.06em] text-vellum-900">
                        {o.code}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-tight text-vellum-600">
                        {o.name}
                      </span>
                    </span>
                    <span className="flex-none font-mono text-[9px] tracking-[0.1em] text-lamp-600">
                      {o.lang}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>

      <p className="mt-6 max-w-[70ch] font-mono text-[10.5px] leading-[1.7] tracking-[0.06em] text-vellum-600">
        LANGUAGE CODES INDICATE THE CANONICAL DRAFTING LANGUAGE FOR EACH OFFICE. FILING FORMS
        AND FIGURE CONVENTIONS FOLLOW THE SAME PROFILE.
      </p>
    </section>
  )
}
