// Stylized product mockups for the /patentnest landing page — light, believable
// mini-frames of the real studio (disclosure intake, novelty search, claims
// drafting, validation/export). Built in CSS so they stay crisp, on-palette and
// legible at any size; product blue appears only inside these frames.

import {
  Check,
  CheckCircle2,
  Search,
  Sparkles,
  FileDown,
  CircleDot,
} from 'lucide-react'

const frame =
  'overflow-hidden rounded-xl border border-ai-graphite-900/10 bg-white shadow-[0_24px_60px_-32px_rgba(15,23,42,0.25)]'

function Chrome({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-ai-graphite-900/5 bg-paper-50 px-4 py-2.5">
      <span className="flex gap-1.5">
        <i className="h-2 w-2 rounded-full bg-ai-graphite-200" />
        <i className="h-2 w-2 rounded-full bg-ai-graphite-200" />
        <i className="h-2 w-2 rounded-full bg-ai-graphite-200" />
      </span>
      <span className="truncate font-mono text-[10px] tracking-wide text-ai-graphite-500">
        {title}
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- FIG. 1 */

export function DraftingMock() {
  return (
    <div className={frame}>
      <Chrome title="adaptive-irrigation-controller — Draft 3" />
      <div className="grid sm:grid-cols-[190px_1fr]">
        {/* section rail */}
        <aside className="hidden border-r border-ai-graphite-900/5 bg-paper-50 p-3 sm:block">
          <p className="px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-ai-graphite-400">
            Specification
          </p>
          <ul className="space-y-0.5 text-xs text-ai-graphite-600">
            {['Abstract', 'Background', 'Summary'].map((s) => (
              <li key={s} className="flex items-center justify-between rounded-md px-2 py-1.5">
                {s} <Check className="h-3 w-3 text-emerald-600" />
              </li>
            ))}
            <li className="flex items-center justify-between rounded-md bg-ai-blue-50 px-2 py-1.5 font-medium text-ai-blue-700">
              Claims <CircleDot className="h-3 w-3" />
            </li>
            <li className="rounded-md px-2 py-1.5">Figures</li>
            <li className="rounded-md px-2 py-1.5">Validation</li>
          </ul>
        </aside>

        {/* editor */}
        <div className="p-5 sm:p-6">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-ai-graphite-400">
            Claims · independent
          </p>
          <p className="mt-3 font-serif text-[13px] leading-relaxed text-ai-graphite-800">
            <span className="font-semibold">1.</span> An irrigation controller comprising: a
            soil-moisture sensor array; a weather-adaptive scheduling module; and a valve
            interface configured to actuate zones independently in response to a computed
            deficit signal…
          </p>

          {/* AI suggestion */}
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200/70 bg-amber-50/70 p-3">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <div className="text-[11px] leading-relaxed text-amber-900">
              Add dependent claim: <em>calibration routine for the sensor array</em> — supported
              in ¶ [0023].
              <div className="mt-2 flex gap-2">
                <span className="rounded-md bg-ai-graphite-900 px-2 py-0.5 text-[10px] font-medium text-white">
                  Insert claim 2
                </span>
                <span className="rounded-md border border-amber-300 px-2 py-0.5 text-[10px] text-amber-800">
                  Dismiss
                </span>
              </div>
            </div>
          </div>

          {/* status row */}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-ai-graphite-900/5 pt-3 text-[10px] text-ai-graphite-500">
            <span className="flex items-center gap-1.5">
              <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Novelty position · clear
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-1.5 w-1.5 rounded-full bg-ai-blue-500" /> Figure refs · 3 mapped
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-1.5 w-1.5 rounded-full bg-ai-graphite-300" /> Autosaved
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- step mocks */

export function DiscloseMock() {
  return (
    <div className={frame}>
      <Chrome title="New disclosure" />
      <div className="p-5">
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-ai-graphite-400">
          Describe your invention
        </p>
        <div className="mt-3 rounded-lg border border-ai-graphite-900/10 bg-paper-50 p-3 text-[12px] leading-relaxed text-ai-graphite-700">
          A drip-irrigation controller that senses soil moisture in each zone and reschedules
          watering around the weather forecast, so fields stop being watered in the rain…
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-ai-graphite-900/10 px-2.5 py-0.5 text-[10px] text-ai-graphite-600">
            Field · AgTech
          </span>
          <span className="rounded-full border border-ai-graphite-900/10 px-2.5 py-0.5 text-[10px] text-ai-graphite-600">
            Type · Utility
          </span>
          <span className="ml-auto rounded-md bg-ai-graphite-900 px-3 py-1 text-[10px] font-medium text-white">
            Continue
          </span>
        </div>
      </div>
    </div>
  )
}

export function NoveltyMock() {
  return (
    <div className={frame}>
      <Chrome title="Novelty search — evidence map" />
      <div className="p-5">
        <div className="flex items-center gap-2 rounded-lg border border-ai-graphite-900/10 bg-paper-50 px-3 py-2">
          <Search className="h-3.5 w-3.5 text-ai-graphite-400" />
          <span className="text-[12px] text-ai-graphite-700">
            adaptive drip irrigation controller, per-zone moisture…
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {[
            { t: 'Smart irrigation valve network', no: 'US 10,842,B2', pct: 78 },
            { t: 'Weather-linked sprinkler timer', no: 'EP 3,301,A1', pct: 64 },
            { t: 'Soil probe telemetry system', no: 'WO 2019/144', pct: 41 },
          ].map((r) => (
            <li key={r.no} className="flex items-center gap-3 text-[11px]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ai-graphite-800">{r.t}</p>
                <p className="font-mono text-[9px] text-ai-graphite-400">{r.no}</p>
              </div>
              <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-ai-graphite-100">
                <div className="h-full rounded-full bg-ai-blue-400" style={{ width: `${r.pct}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ai-graphite-500">
                {r.pct}%
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700">
          <CheckCircle2 className="h-3 w-3" /> No blocking art found — claims 1–4 clear
        </p>
      </div>
    </div>
  )
}

export function ClaimsMock() {
  return (
    <div className={frame}>
      <Chrome title="Claims — dependent form" />
      <div className="space-y-2.5 p-5 font-serif text-[12px] leading-relaxed text-ai-graphite-800">
        <p>
          <span className="font-semibold">1.</span> An irrigation controller comprising a
          soil-moisture sensor array and a weather-adaptive scheduling module…
        </p>
        <p className="border-l-2 border-ai-blue-200 pl-4">
          <span className="font-semibold">2.</span> The controller of claim 1, wherein the sensor
          array performs a self-calibration routine…
        </p>
        <p className="border-l-2 border-ai-blue-200 pl-4">
          <span className="font-semibold">3.</span> The controller of claim 2, wherein the deficit
          signal is computed per zone…
        </p>
        <p className="!mt-4 inline-flex items-center gap-1.5 rounded-full bg-ai-blue-50 px-2.5 py-1 font-sans text-[10px] font-medium text-ai-blue-700">
          <CheckCircle2 className="h-3 w-3" /> Cross-references valid · antecedent basis clean
        </p>
      </div>
    </div>
  )
}

export function ValidateMock() {
  return (
    <div className={frame}>
      <Chrome title="Validation — pre-filing review" />
      <div className="p-5">
        <ul className="space-y-2 text-[12px] text-ai-graphite-700">
          {[
            'Claims consistent with specification',
            'Figure references complete (FIGS. 1–4)',
            'Novelty position documented',
            'Abstract within 150-word limit',
          ].map((s) => (
            <li key={s} className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              {s}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2 border-t border-ai-graphite-900/5 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-ai-graphite-900 px-3 py-1.5 text-[11px] font-medium text-white">
            <FileDown className="h-3 w-3" /> Export DOCX
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-ai-graphite-900/15 px-3 py-1.5 text-[11px] text-ai-graphite-700">
            Export PDF
          </span>
        </div>
      </div>
    </div>
  )
}
