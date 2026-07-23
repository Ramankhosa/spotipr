'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ReferenceComponent, TEXT_FONT_FAMILY } from './types'

interface TextEditOverlayProps {
  left: number
  top: number
  fontSizePx: number
  color: string
  initialText: string
  /** Reference numerals offered as suggestions. Free text is always allowed. */
  suggestions?: ReferenceComponent[]
  onCommit: (text: string) => void
  onCancel: () => void
}

const MAX_SUGGESTIONS = 6

// Text entry positioned over the Konva stage. It suggests reference numerals
// from the drafting session, but never constrains input — numerals for parts
// not yet in the reference map can simply be typed.
export default function TextEditOverlay({
  left,
  top,
  fontSizePx,
  color,
  initialText,
  suggestions = [],
  onCommit,
  onCancel
}: TextEditOverlayProps) {
  const [value, setValue] = useState(initialText)
  const [highlighted, setHighlighted] = useState(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const committedRef = useRef(false)
  const readyRef = useRef(false)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.select()
    // A blur in the first moments comes from the click that created this input,
    // not from the user leaving it — reclaim focus instead of committing.
    const timer = setTimeout(() => { readyRef.current = true }, 300)
    return () => clearTimeout(timer)
  }, [])

  const matches = useMemo(() => {
    if (!suggestions.length) return []
    const q = value.trim().toLowerCase()
    const pool = q
      ? suggestions.filter(
          s => s.numeral.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)
        )
      : suggestions
    return pool.slice(0, MAX_SUGGESTIONS)
  }, [suggestions, value])

  // Only flag input that matches nothing in the reference map. Comparing against
  // numerals alone wrongly flagged partial numerals and component names, which
  // the suggestion list was simultaneously showing as valid matches.
  const isUnknown =
    suggestions.length > 0 && !!value.trim() && matches.length === 0

  const commit = (text?: string) => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(text ?? value)
  }

  const cancel = () => {
    if (committedRef.current) return
    committedRef.current = true
    onCancel()
  }

  const lines = value.split('\n')
  const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0)

  return (
    <div className="absolute z-10" style={{ left, top: top - 2 }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => { setValue(e.target.value); setHighlighted(-1) }}
        onMouseDown={e => e.stopPropagation()}
        onBlur={() => {
          if (!readyRef.current) {
            textareaRef.current?.focus()
            return
          }
          // Losing focus to a suggestion click is handled by the button's onMouseDown.
          commit()
        }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'ArrowDown' && matches.length) {
            e.preventDefault()
            setHighlighted(h => (h + 1) % matches.length)
          } else if (e.key === 'ArrowUp' && matches.length) {
            e.preventDefault()
            setHighlighted(h => (h <= 0 ? matches.length - 1 : h - 1))
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            // A highlighted suggestion wins; otherwise whatever was typed is kept.
            commit(highlighted >= 0 && matches[highlighted] ? matches[highlighted].numeral : value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        spellCheck={false}
        rows={lines.length}
        className="block resize-none overflow-hidden rounded-sm border border-dashed border-blue-500 bg-white/80 outline-none"
        style={{
          color,
          fontSize: fontSizePx,
          lineHeight: 1,
          fontFamily: TEXT_FONT_FAMILY,
          padding: '1px 2px',
          minWidth: Math.max(60, fontSizePx * 2),
          width: `${Math.max(3, longestLine + 2)}ch`
        }}
      />

      {matches.length > 0 && (
        <ul className="mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-paper-200 bg-white py-1 shadow-lg">
          {matches.map((m, i) => (
            <li key={`${m.numeral}_${m.name}`}>
              <button
                type="button"
                // Commit on mousedown so the textarea's blur doesn't beat the click.
                onMouseDown={e => { e.preventDefault(); commit(m.numeral) }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs ${
                  i === highlighted ? 'bg-ai-blue-50 text-ai-blue-700' : 'text-ai-graphite-700 hover:bg-paper-100'
                }`}
              >
                <span className="font-semibold tabular-nums">{m.numeral}</span>
                <span className="truncate text-ai-graphite-500">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isUnknown && (
        <p className="mt-1 w-56 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          Not in the reference map — it will be added as free text.
        </p>
      )}
    </div>
  )
}
