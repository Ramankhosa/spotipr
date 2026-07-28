'use client'

// Share controls for the article rail. LinkedIn and X because that is where
// patent practitioners actually pass links around, plus copy-to-clipboard for
// everything else (email, Slack, WhatsApp) without loading a third-party widget
// that would watch our readers.

import { useState } from 'react'
import { Check, Link2, Linkedin } from 'lucide-react'

export default function ShareLinks({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard denied (insecure context, or the user said no) — the address
      // bar still has the URL, so there is nothing useful to recover here.
    }
  }

  const button =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-ai-graphite-900/10 bg-white text-ai-graphite-400 transition-colors hover:border-ai-graphite-900/25 hover:text-lamp-600'

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
        Share
      </span>
      <a
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={button}
        aria-label="Share on LinkedIn"
      >
        <Linkedin className="h-3.5 w-3.5" />
      </a>
      <a
        href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={button}
        aria-label="Share on X"
      >
        <span className="text-[13px] font-semibold leading-none">𝕏</span>
      </a>
      <button type="button" onClick={copy} className={button} aria-label="Copy link">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
