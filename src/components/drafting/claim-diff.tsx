'use client'

// Word-level claim diff, shared by the prior-art claim refinement stage and the
// claim challenge panel. Both present the same question to the attorney — "here
// is what this amendment would change, accept or reject it" — so they must
// render it identically.

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string }

/** Longest-common-subsequence word diff. */
export const diffWords = (oldText: string, newText: string): DiffPart[] => {
  const a = (oldText || '').split(/\s+/)
  const b = (newText || '').split(/\s+/)
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      parts.push({ type: 'same', text: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: 'del', text: a[i] })
      i++
    } else {
      parts.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) { parts.push({ type: 'del', text: a[i++] }) }
  while (j < n) { parts.push({ type: 'add', text: b[j++] }) }
  return parts
}

export const renderDiff = (oldText: string, newText: string) => {
  if (!newText || oldText === newText) return <span className="text-ai-graphite-700">{oldText || newText}</span>
  const parts = diffWords(oldText, newText)
  return (
    <span className="text-[13.5px] leading-relaxed text-ai-graphite-700">
      {parts.map((p, idx) => {
        if (p.type === 'same') return <span key={idx}>{p.text} </span>
        if (p.type === 'add') return <span key={idx} className="rounded bg-emerald-50 px-0.5 font-medium text-emerald-800">{p.text} </span>
        return <span key={idx} className="rounded bg-wax-50 px-0.5 text-wax-600 line-through">{p.text} </span>
      })}
    </span>
  )
}
