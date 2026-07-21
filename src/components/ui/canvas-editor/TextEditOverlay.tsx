'use client'

import { useEffect, useRef, useState } from 'react'
import { TEXT_FONT_FAMILY } from './types'

interface TextEditOverlayProps {
  left: number
  top: number
  fontSizePx: number
  color: string
  initialText: string
  onCommit: (text: string) => void
  onCancel: () => void
}

// HTML textarea positioned over the Konva stage for entering/editing text.
// Enter commits, Shift+Enter inserts a newline, Escape cancels, blur commits.
export default function TextEditOverlay({
  left,
  top,
  fontSizePx,
  color,
  initialText,
  onCommit,
  onCancel
}: TextEditOverlayProps) {
  const [value, setValue] = useState(initialText)
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

  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(value)
  }

  const cancel = () => {
    if (committedRef.current) return
    committedRef.current = true
    onCancel()
  }

  const lines = value.split('\n')
  const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0)

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onMouseDown={e => e.stopPropagation()}
      onBlur={() => {
        if (!readyRef.current) {
          textareaRef.current?.focus()
          return
        }
        commit()
      }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      spellCheck={false}
      rows={lines.length}
      className="absolute z-10 resize-none overflow-hidden rounded-sm border border-dashed border-blue-500 bg-white/80 outline-none"
      style={{
        left,
        top: top - 2,
        color,
        fontSize: fontSizePx,
        lineHeight: 1,
        fontFamily: TEXT_FONT_FAMILY,
        padding: '1px 2px',
        minWidth: Math.max(60, fontSizePx * 2),
        width: `${Math.max(3, longestLine + 2)}ch`
      }}
    />
  )
}
