'use client'

// Unobtrusive contextual help: a small "?" icon that reveals a short
// explanation on hover, focus, or tap. Silent until asked — never a banner.
//
//   <Hint text="Figure numbers follow the components in your specification." />
//   <Hint title="Figure plan" text="The set of drawings your patent will include." />

import { useEffect, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'

interface HintProps {
  text: string
  title?: string
  /** Where the popover opens relative to the icon. Defaults to 'bottom'. */
  side?: 'bottom' | 'top'
  className?: string
}

export function Hint({ text, title, side = 'bottom', className = '' }: HintProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={title ? `Help: ${title}` : 'Help'}
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg border border-border bg-card p-3 text-left shadow-lg ${
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
        >
          {title && <span className="mb-1 block text-xs font-semibold text-foreground">{title}</span>}
          <span className="block text-xs leading-relaxed text-muted-foreground">{text}</span>
        </span>
      )}
    </span>
  )
}

export default Hint
