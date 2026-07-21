import { useCallback, useState } from 'react'

interface HistoryState<T> {
  stack: T[]
  index: number
}

// Snapshot-based undo/redo. Entries share references to unchanged elements,
// so keeping full snapshots of the shapes array is cheap.
export function useHistory<T>(initial: T, cap = 50) {
  const [hist, setHist] = useState<HistoryState<T>>({ stack: [initial], index: 0 })

  const set = useCallback((next: T) => {
    setHist(h => {
      const stack = h.stack.slice(0, h.index + 1)
      stack.push(next)
      const overflow = Math.max(0, stack.length - cap)
      return { stack: stack.slice(overflow), index: stack.length - 1 - overflow }
    })
  }, [cap])

  const undo = useCallback(() => {
    setHist(h => ({ ...h, index: Math.max(0, h.index - 1) }))
  }, [])

  const redo = useCallback(() => {
    setHist(h => ({ ...h, index: Math.min(h.stack.length - 1, h.index + 1) }))
  }, [])

  const reset = useCallback((value: T) => {
    setHist({ stack: [value], index: 0 })
  }, [])

  return {
    state: hist.stack[hist.index],
    set,
    undo,
    redo,
    reset,
    canUndo: hist.index > 0,
    canRedo: hist.index < hist.stack.length - 1
  }
}
