'use client'

/**
 * Shown when an attorney exports a filing bundle that still has blanks.
 *
 * Generation is never blocked — the forms come out either way — but an incomplete statutory
 * form should be a deliberate choice, not something noticed later. This lists exactly which
 * particulars will print blank and makes the attorney confirm before the download starts.
 *
 * Used by both export paths (the Filing tab and the drafting workspace) so the warning
 * reads identically wherever the bundle is produced.
 */

import { AlertTriangle, Download, PenLine } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FILING_SECTION_LABELS, sortFilingIssues, type FilingIssue } from './filing-ui'

export interface IncompleteFilingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issues: FilingIssue[]
  /** Proceed with the download as-is. */
  onConfirm: () => void
  /** Optional "take me there" action, e.g. opening the Filing tab. */
  onGoToFiling?: () => void
  /** Label for the confirm button, e.g. "Download bundle anyway". */
  confirmLabel?: string
  /** Label for the "take me there" action. */
  fixLabel?: string
  busy?: boolean
}

export default function IncompleteFilingDialog({
  open,
  onOpenChange,
  issues,
  onConfirm,
  onGoToFiling,
  confirmLabel = 'Download anyway',
  fixLabel = 'Complete them first',
  busy = false,
}: IncompleteFilingDialogProps) {
  // Ordered the way an attorney works through them, and labelled with the part of the
  // filing each belongs to — the list is otherwise a flat wall of unrelated particulars.
  const blanks = sortFilingIssues(issues.filter(i => i.severity === 'blocking'))
  const advisory = issues.filter(i => i.severity === 'advisory')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Some details will print blank
          </DialogTitle>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            The forms will still be generated. Anything missing is left as a blank space for you to complete by
            hand before filing.
          </p>
        </DialogHeader>

        {blanks.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Will print blank ({blanks.length})
            </p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {blanks.map((issue, i) => (
                <li key={`${issue.field}-${i}`} className="text-sm text-amber-900 dark:text-amber-200">
                  <span className="font-medium">{FILING_SECTION_LABELS[issue.section] || issue.section}</span>
                  {' — '}{issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {advisory.length > 0 && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Worth checking ({advisory.length})
            </p>
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1">
              {advisory.map((issue, i) => (
                <li key={`${issue.field}-${i}`} className="text-sm text-gray-700 dark:text-gray-300">
                  • {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          The same list is included as a text file in the download, so you can work through it away from the screen.
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          {onGoToFiling && (
            <button
              type="button"
              onClick={onGoToFiling}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <PenLine className="h-4 w-4" />
              {fixLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
