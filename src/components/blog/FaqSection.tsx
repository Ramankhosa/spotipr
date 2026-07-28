// Follow-up questions, rendered as native <details> rather than a JS accordion.
//
// That choice is deliberate and load-bearing: the answers stay in the DOM when
// collapsed, so crawlers and AI retrievers read every one of them, and keyboard
// and screen-reader behaviour comes free. The same array is emitted as FAQPage
// JSON-LD on the article page — markup and visible text always agree, which is
// the condition Google attaches to FAQ structured data.

import { Plus } from 'lucide-react'
import type { FaqItem } from '@/lib/blog/types'

export default function FaqSection({ faqs }: { faqs: FaqItem[] }) {
  if (!faqs.length) return null

  return (
    <section id="faq" className="mt-16 scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight text-ai-graphite-900">
        Frequently asked questions
      </h2>
      <div className="mt-6 divide-y divide-ai-graphite-900/10 rounded-xl border border-ai-graphite-900/10 bg-white">
        {faqs.map((faq) => (
          <details key={faq.question} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[0.9375rem] font-medium text-ai-graphite-900 transition-colors hover:text-lamp-700">
              {faq.question}
              <Plus
                className="mt-0.5 h-4 w-4 shrink-0 text-ai-graphite-400 transition-transform duration-200 group-open:rotate-45"
                aria-hidden
              />
            </summary>
            <p className="mt-3 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ai-graphite-600">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}
