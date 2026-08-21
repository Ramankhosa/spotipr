// The hero product shot for /home-v2, built as real DOM rather than a bitmap so
// it stays crisp at any zoom and the copy inside can be edited like any other
// content. Purely presentational — no live data.

import {
  Bell,
  Boxes,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  ScanSearch,
  Share2,
  ShieldCheck,
} from 'lucide-react'

const NAV = [
  { label: 'Invention brief', icon: Lightbulb },
  { label: 'Ideation', icon: Boxes },
  { label: 'Novelty search', icon: ScanSearch, active: true },
  { label: 'Claims', icon: Layers },
  { label: 'Specification', icon: FileText },
  { label: 'Drawings', icon: ImageIcon },
  { label: 'Review', icon: ShieldCheck },
  { label: 'Prosecution', icon: CheckCircle2 },
]

const REFERENCES = [
  { id: 'US 2020/0148480 A1', tag: 'Partial match', tone: 'warn' as const },
  { id: 'WO 2021/009801 A1', tag: 'Partial match', tone: 'warn' as const },
  { id: 'EP 2020 102 064 A4', tag: 'Low relevance', tone: 'mute' as const },
]

const FEATURES = [
  { label: 'Self-correcting actuation loop', tag: 'Distinctive', tone: 'good' as const },
  { label: 'Adaptive sensor calibration', tag: 'Distinctive', tone: 'good' as const },
  { label: 'Modular environment response', tag: 'Partial', tone: 'warn' as const },
  { label: 'Plant growth chamber', tag: 'Known', tone: 'bad' as const },
]

const TONE: Record<string, string> = {
  good: 'bg-[#ecfdf5] text-[#047857]',
  warn: 'bg-[#fffbeb] text-[#b45309]',
  bad: 'bg-wax-100 text-wax-600',
  mute: 'bg-paper-100 text-paper-600',
}

const DOT: Record<string, string> = {
  good: 'bg-[#10b981]',
  warn: 'bg-[#f59e0b]',
  bad: 'bg-wax-400',
}

const RING = 2 * Math.PI * 15.5

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-paper-300/80 bg-white p-3">
      <p className="mb-2.5 text-[11px] font-medium text-ai-graphite-900">{title}</p>
      {children}
    </div>
  )
}

export default function WorkspaceMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-paper-300 bg-white shadow-[0_40px_80px_-40px_rgba(16,24,40,0.35),0_2px_8px_rgba(16,24,40,0.06)]">
      {/* window chrome */}
      <div className="flex items-center justify-between border-b border-paper-300/80 bg-paper-50 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-lamp-600">◆</span>
          <span className="text-[11.5px] font-medium text-ai-graphite-800">PatentNest workspace</span>
        </div>
        <div className="flex items-center gap-2.5 text-paper-500">
          <Bell className="h-3 w-3" />
          <Share2 className="h-3 w-3" />
        </div>
      </div>

      <div className="flex">
        {/* sidebar */}
        <div className="hidden w-[126px] flex-none border-r border-paper-300/80 bg-paper-50/60 p-2 sm:block">
          {NAV.map(({ label, icon: Icon, active }) => (
            <div
              key={label}
              className={`mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] leading-tight ${
                active
                  ? 'bg-lamp-50 font-medium text-lamp-600'
                  : 'text-paper-600'
              }`}
            >
              <Icon className="h-2.5 w-2.5 flex-none" />
              <span className="truncate">{label}</span>
            </div>
          ))}
        </div>

        {/* body */}
        <div className="grid flex-1 grid-cols-1 gap-2.5 bg-[#f8fafd] p-2.5 md:grid-cols-2">
          <Panel title="Novelty overview">
            <p className="mb-2 text-[9.5px] text-paper-500">Searched across 55M+ patent documents</p>
            <div className="flex items-center gap-3">
              <div className="relative flex-none">
                <svg viewBox="0 0 36 36" className="h-[52px] w-[52px] -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e4e7ec" strokeWidth="3.4" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.5"
                    fill="none"
                    stroke="#1d4ed8"
                    strokeWidth="3.4"
                    strokeLinecap="round"
                    strokeDasharray={RING}
                    strokeDashoffset={RING * 0.18}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-ai-graphite-900">
                  82%
                </span>
              </div>
              <div>
                <p className="text-[12.5px] font-medium text-ai-graphite-900">Distinctive</p>
                <p className="text-[9.5px] text-paper-600">High novelty potential</p>
                <p className="mt-1.5 text-[9.5px] font-medium text-lamp-600">View evidence map →</p>
              </div>
            </div>
          </Panel>

          <Panel title="Top prior art references">
            <div className="space-y-1.5">
              {REFERENCES.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[9.5px] text-ai-graphite-700">{r.id}</span>
                  <span className={`flex-none rounded px-1.5 py-0.5 text-[8.5px] font-medium ${TONE[r.tone]}`}>
                    {r.tag}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[9.5px] font-medium text-lamp-600">See all references →</p>
          </Panel>

          <Panel title="Key inventive features">
            <div className="space-y-1.5">
              {FEATURES.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 flex-none rounded-full ${DOT[f.tone]}`} />
                    <span className="truncate text-[9.5px] text-ai-graphite-700">{f.label}</span>
                  </span>
                  <span className={`flex-none rounded px-1.5 py-0.5 text-[8.5px] font-medium ${TONE[f.tone]}`}>
                    {f.tag}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Claim 1 support">
            <div className="space-y-1.5">
              {[
                'All limitations supported',
                'Paragraphs [0021], [0044], [0061]',
                'Figures 2, 3, 5',
              ].map((line) => (
                <div key={line} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-2.5 w-2.5 flex-none text-[#10b981]" />
                  <span className="truncate text-[9.5px] text-ai-graphite-700">{line}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-200">
              <div className="h-full w-[86%] rounded-full bg-lamp-600" />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
