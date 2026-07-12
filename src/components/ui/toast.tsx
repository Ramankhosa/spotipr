'use client'

// Lightweight app-wide toast system. Use instead of alert()/confirm() for
// non-blocking feedback: success → toast, recoverable error → toast or inline,
// destructive confirmation → dialog (not this).
//
//   const { toast } = useToast()
//   toast({ title: 'Draft created', variant: 'success' })
//   toast({ title: 'Export failed', description: err.message, variant: 'error' })

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** Auto-dismiss delay in ms. Defaults to 5000; errors default to 8000. */
  duration?: number
  /** Optional action rendered as a button (e.g. Undo). Clicking it dismisses the toast. */
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastOptions {
  id: number
  leaving?: boolean
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>')
  }
  return ctx
}

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof Info; iconClass: string; barClass: string }> = {
  default: { icon: Info, iconClass: 'text-primary', barClass: 'bg-primary' },
  success: { icon: CheckCircle2, iconClass: 'text-success', barClass: 'bg-success' },
  error: { icon: XCircle, iconClass: 'text-destructive', barClass: 'bg-destructive' },
  warning: { icon: AlertTriangle, iconClass: 'text-warning', barClass: 'bg-warning' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    // Trigger the exit transition, then remove.
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 200)
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    const id = ++idRef.current
    const duration = options.duration ?? (options.variant === 'error' ? 8000 : 5000)
    setToasts(prev => [...prev.slice(-4), { ...options, id }])
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
  }, [dismiss])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map(item => {
          const { icon: Icon, iconClass, barClass } = VARIANT_STYLES[item.variant || 'default']
          return (
            <div
              key={item.id}
              role="status"
              className={`pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-lg border border-border bg-card p-4 pr-10 shadow-lg transition-all duration-200 ${
                item.leaving ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100 animate-slide-up'
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${barClass}`} aria-hidden="true" />
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground break-words">{item.description}</p>
                )}
                {item.action && (
                  <button
                    type="button"
                    onClick={() => {
                      item.action?.onClick()
                      dismiss(item.id)
                    }}
                    className="mt-2 text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
