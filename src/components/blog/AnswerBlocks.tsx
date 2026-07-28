// The two blocks that make an article quotable.
//
// AnswerBox sits directly under the H1 and answers the headline in 40–80 words.
// It exists because retrieval engines weigh a page's opening most heavily, and
// because a reader who only wants the number should get it without scrolling.
// KeyTakeaways repeats the load-bearing facts as standalone sentences — each one
// has to survive being lifted out of the page on its own.

import { Check, Sparkles } from 'lucide-react'

export function AnswerBox({ children }: { children: React.ReactNode }) {
  return (
    <aside
      aria-label="The short answer"
      className="mt-8 rounded-xl border border-lamp-200 bg-lamp-50/60 p-6 sm:p-7"
    >
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-lamp-700">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        The short answer
      </p>
      <p className="mt-3 text-[1.0625rem] leading-relaxed text-ai-graphite-800">{children}</p>
    </aside>
  )
}

export function KeyTakeaways({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <section
      aria-label="Key takeaways"
      className="mt-8 rounded-xl border border-ai-graphite-900/10 bg-white p-6 sm:p-7"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-500">
        Key takeaways
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed text-ai-graphite-700">
            <Check className="mt-1 h-4 w-4 shrink-0 text-lamp-600" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
