'use client'

/**
 * InventorCapture — the one place inventors are entered, anywhere in the app.
 *
 * Embedded in stage 0 (so inventors are captured while the attorney is already pasting the
 * disclosure) and in the Filing tab (so they can be corrected right before the forms are
 * generated). Both mount the same component against the same patent, so whatever is entered
 * in one place is already there in the other.
 *
 * The paste box is the point: an attorney pastes the e-mail or disclosure form they were
 * sent, and gets reviewable, prefilled rows. The model proposes; the attorney reviews every
 * field; nothing reaches a legal document unseen. Fields the extractor could not fill are
 * ringed until they are touched.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { Check, ClipboardPaste, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Field, inputClass } from './filing-ui'

export interface InventorForm {
  honorific: string
  nameBody: string
  familyNameFirst: boolean
  nationality: string
  countryOfResidence: string
  addressLine1: string
  street: string
  city: string
  state: string
  country: string
  pinCode: string
  isAdditionalInventor: boolean
}

export const EMPTY_INVENTOR: InventorForm = {
  honorific: '', nameBody: '', familyNameFirst: false,
  nationality: 'Indian', countryOfResidence: 'India',
  addressLine1: '', street: '', city: '', state: '', country: 'India', pinCode: '',
  isAdditionalInventor: false,
}

export interface InventorCaptureProps {
  patentId: string
  value: InventorForm[]
  onChange: (inventors: InventorForm[]) => void
  /** People already entered on sibling patents — repeat inventors get picked, not retyped. */
  directory?: InventorForm[]
  /** Enables the "same as applicant" shortcut, the norm for university and company filings. */
  applicantAddress?: Partial<InventorForm> | null
  applicantName?: string
  /** Stage 0 hides the Form-5-specific toggle; the Filing tab shows it. */
  showAdditionalInventorToggle?: boolean
  disabled?: boolean
  /**
   * Supply to render a Save button inside the panel. Hosts that already have a page-level
   * Save (the Filing tab) leave this out; hosts that embed the panel on its own (stage 0)
   * pass it so the panel is self-contained.
   */
  onSave?: () => Promise<void> | void
  saving?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toInventorForm(row: any): InventorForm {
  return {
    honorific: row.honorific || row.name?.honorific || '',
    nameBody: row.nameBody || row.name?.nameBody || '',
    familyNameFirst: Boolean(row.familyNameFirst ?? row.name?.familyNameFirst),
    nationality: row.nationality || 'Indian',
    countryOfResidence: row.countryOfResidence || 'India',
    addressLine1: row.addressLine1 || row.address?.addressLine1 || '',
    street: row.street || row.address?.street || '',
    city: row.city || row.address?.city || '',
    state: row.state || row.address?.state || '',
    country: row.country || row.address?.country || 'India',
    pinCode: row.pinCode || row.address?.pinCode || '',
    isAdditionalInventor: Boolean(row.isAdditionalInventor),
  }
}

/** Payload shape for PUT .../filing/inventors — shared so both hosts save identically. */
export function toInventorPayload(inventors: InventorForm[]) {
  return inventors.map(inv => ({
    honorific: inv.honorific || null,
    nameBody: inv.nameBody,
    familyNameFirst: inv.familyNameFirst,
    nationality: inv.nationality,
    countryOfResidence: inv.countryOfResidence,
    addressLine1: inv.addressLine1,
    street: inv.street || null,
    city: inv.city,
    state: inv.state,
    country: inv.country,
    pinCode: inv.pinCode,
    isAdditionalInventor: inv.isAdditionalInventor,
  }))
}

export default function InventorCapture({
  patentId,
  value,
  onChange,
  directory = [],
  applicantAddress,
  applicantName,
  showAdditionalInventorToggle = true,
  disabled = false,
  onSave,
  saving = false,
}: InventorCaptureProps) {
  const { token } = useAuth()
  const { toast } = useToast()

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  // Fields the extractor could not fill, keyed by row index. Cleared as they are edited.
  const [reviewFlags, setReviewFlags] = useState<Record<number, string[]>>({})

  // With no rows yet, lead with the paste box — that is the fast path, not "Add" and type.
  useEffect(() => {
    if (value.length === 0) setPasteOpen(true)
  }, [value.length])

  const clearFlag = (index: number, field: string) => {
    setReviewFlags(prev => {
      const current = prev[index]
      if (!current?.includes(field)) return prev
      const next = { ...prev, [index]: current.filter(f => f !== field) }
      if (!next[index].length) delete next[index]
      return next
    })
  }

  const setField = <K extends keyof InventorForm>(index: number, key: K, fieldValue: InventorForm[K]) => {
    onChange(value.map((inv, i) => (i === index ? { ...inv, [key]: fieldValue } : inv)))
    clearFlag(index, key as string)
  }

  const fieldClass = (index: number, field: string) =>
    reviewFlags[index]?.includes(field)
      ? `${inputClass} border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20`
      : inputClass

  const parsePasted = useCallback(async () => {
    if (!token || !pasteText.trim()) return
    setParsing(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/filing/inventors/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: pasteText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read the inventor details')

      const startIndex = value.length
      const flags: Record<number, string[]> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extracted: InventorForm[] = (data.inventors || []).map((inv: any, i: number) => {
        if (inv.needsReview?.length) flags[startIndex + i] = inv.needsReview
        return { ...toInventorForm(inv), nationality: inv.nationality || '' }
      })

      onChange([...value, ...extracted])
      setReviewFlags(prev => ({ ...prev, ...flags }))
      setPasteText('')
      setPasteOpen(false)

      const gaps = Object.values(flags).flat().length
      toast({
        title: `Found ${extracted.length} inventor${extracted.length === 1 ? '' : 's'}`,
        description: gaps
          ? `${gaps} field${gaps === 1 ? '' : 's'} could not be read — they are highlighted for you to complete.`
          : (data.notes?.[0] || 'Check the details before saving.'),
        variant: 'success',
      })
    } catch (err) {
      toast({ title: 'Could not read the inventor details', description: String(err), variant: 'error' })
    } finally {
      setParsing(false)
    }
  }, [token, patentId, pasteText, value, onChange, toast])

  const copyApplicantAddress = (index: number) => {
    if (!applicantAddress) return
    onChange(value.map((inv, i) => i === index ? {
      ...inv,
      addressLine1: [applicantName, applicantAddress.addressLine1].filter(Boolean).join(', '),
      street: applicantAddress.street || '',
      city: applicantAddress.city || '',
      state: applicantAddress.state || '',
      country: applicantAddress.country || 'India',
      pinCode: applicantAddress.pinCode || '',
    } : inv))
    setReviewFlags(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  const move = (index: number, delta: number) => {
    const next = [...value]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    setReviewFlags({}) // indices no longer line up
  }

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
    setReviewFlags({})
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setPasteOpen(v => !v)}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-lg bg-lamp-50 px-2.5 py-1.5 text-xs font-semibold text-lamp-700 transition hover:bg-lamp-100 disabled:opacity-60 dark:bg-lamp-900/30 dark:text-lamp-300"
        >
          <Sparkles className="h-3.5 w-3.5" /> Paste inventor details
        </button>
        <button
          type="button"
          onClick={() => onChange([...value, { ...EMPTY_INVENTOR }])}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200"
        >
          <Plus className="h-3.5 w-3.5" /> Add manually
        </button>
      </div>

      {pasteOpen && (
        <div className="mb-4 rounded-lg border border-lamp-200 bg-lamp-50/60 p-4 dark:border-lamp-900/40 dark:bg-lamp-900/10">
          <div className="mb-2 flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4 text-lamp-600 dark:text-lamp-400" />
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Paste the inventor details</p>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            An e-mail, a disclosure form, a table out of Excel — anything. We pull out the names, nationalities and
            addresses and fill the rows below for you to check. Nothing is saved until you save.
          </p>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={7}
            disabled={disabled}
            placeholder={'e.g.\n1. Uday Pal, Indian, Lovely Professional University, Jalandhar-Delhi G.T. Road, Phagwara 144411, Punjab, India\n2. Dr. Krishan Arora, Indian, same address'}
            className={`${inputClass} font-mono text-xs`}
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={parsePasted}
              disabled={disabled || parsing || pasteText.trim().length < 5}
              className="inline-flex items-center gap-2 rounded-lg bg-lamp-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-lamp-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {parsing
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</>
                : <><Sparkles className="h-4 w-4" /> Extract inventors</>}
            </button>
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => { setPasteOpen(false); setPasteText('') }}
                className="rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {directory.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            From other patents in this project
          </p>
          <div className="flex flex-wrap gap-1.5">
            {directory.map((person, i) => (
              <button
                key={`${person.nameBody}-${i}`}
                type="button"
                onClick={() => onChange([...value, { ...person }])}
                disabled={disabled}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 transition hover:border-lamp-400 hover:text-lamp-700 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              >
                + {[person.honorific, person.nameBody].filter(Boolean).join(' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {value.length === 0 && !pasteOpen && (
        <p className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
          No inventors yet. Paste the details you were sent, or add them one at a time.
        </p>
      )}

      <div className="space-y-4">
        {value.map((inv, index) => (
          <div key={index} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Inventor {index + 1}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={disabled || index === 0} className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700">↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={disabled || index === value.length - 1} className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700">↓</button>
                <button type="button" onClick={() => remove(index)} disabled={disabled} className="ml-1 rounded p-1 text-gray-400 transition hover:text-red-500 disabled:opacity-30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-6">
              <Field label="Title" className="sm:col-span-1">
                <input value={inv.honorific} onChange={e => setField(index, 'honorific', e.target.value)} disabled={disabled} placeholder="Dr." className={inputClass} />
              </Field>
              <Field label="Name in full" required className="sm:col-span-3">
                <input value={inv.nameBody} onChange={e => setField(index, 'nameBody', e.target.value)} disabled={disabled} placeholder="Family name first" className={fieldClass(index, 'nameBody')} />
              </Field>
              <Field label="Nationality" required className="sm:col-span-1">
                <input value={inv.nationality} onChange={e => setField(index, 'nationality', e.target.value)} disabled={disabled} className={fieldClass(index, 'nationality')} />
              </Field>
              <Field label="Residence" required className="sm:col-span-1">
                <input value={inv.countryOfResidence} onChange={e => setField(index, 'countryOfResidence', e.target.value)} disabled={disabled} className={inputClass} />
              </Field>

              <div className="sm:col-span-6">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Address</span>
                  {applicantAddress && (
                    <button type="button" onClick={() => copyApplicantAddress(index)} disabled={disabled} className="text-xs font-medium text-lamp-600 transition hover:text-lamp-700 disabled:opacity-60">
                      Same as applicant
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-6">
                  <input value={inv.addressLine1} onChange={e => setField(index, 'addressLine1', e.target.value)} disabled={disabled} placeholder="House no. & address" className={`${fieldClass(index, 'addressLine1')} sm:col-span-4`} />
                  <input value={inv.street} onChange={e => setField(index, 'street', e.target.value)} disabled={disabled} placeholder="Street" className={`${inputClass} sm:col-span-2`} />
                  <input value={inv.city} onChange={e => setField(index, 'city', e.target.value)} disabled={disabled} placeholder="City" className={`${fieldClass(index, 'city')} sm:col-span-2`} />
                  <input value={inv.state} onChange={e => setField(index, 'state', e.target.value)} disabled={disabled} placeholder="State" className={`${fieldClass(index, 'state')} sm:col-span-2`} />
                  <input value={inv.country} onChange={e => setField(index, 'country', e.target.value)} disabled={disabled} placeholder="Country" className={`${inputClass} sm:col-span-1`} />
                  <input value={inv.pinCode} onChange={e => setField(index, 'pinCode', e.target.value)} disabled={disabled} placeholder="PIN" className={`${fieldClass(index, 'pinCode')} sm:col-span-1`} />
                </div>
              </div>

              {showAdditionalInventorToggle && (
                <label className="flex items-center gap-2 sm:col-span-6">
                  <input
                    type="checkbox"
                    checked={inv.isAdditionalInventor}
                    onChange={e => setField(index, 'isAdditionalInventor', e.target.checked)}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-gray-300 text-lamp-600 focus:ring-lamp-500"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Additional inventor — signs the assent statement in Form 5 section 4 rather than the application form.
                  </span>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(reviewFlags).length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Highlighted fields could not be read from the pasted text — complete them before generating the forms.
        </p>
      )}

      {onSave && value.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSave()}
            disabled={disabled || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-lamp-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-lamp-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : <><Check className="h-4 w-4" /> Save inventors</>}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Carried straight through to Form 1 and Form 5 when you generate the filing bundle.
          </span>
        </div>
      )}
    </div>
  )
}
