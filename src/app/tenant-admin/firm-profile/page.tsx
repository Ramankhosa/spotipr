'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { Upload, X, Check, Building2, Palette, Phone } from 'lucide-react'

interface FirmProfileForm {
  firmName: string
  logoDataUri: string
  tagline: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  countryCode: string
  postalCode: string
  phone: string
  email: string
  website: string
  accentColor: string
  showPoweredBy: boolean
}

const EMPTY_FORM: FirmProfileForm = {
  firmName: '',
  logoDataUri: '',
  tagline: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  countryCode: '',
  postalCode: '',
  phone: '',
  email: '',
  website: '',
  accentColor: '#1D4ED8',
  showPoweredBy: true,
}

// Cobalt is the platform default; the rest are legible accents that hold contrast as a
// fill behind white text on the report cover.
const ACCENT_PRESETS = ['#1D4ED8', '#0F766E', '#7C3AED', '#B91C1C', '#B45309', '#0E7490', '#1E293B', '#065F46']

const MAX_LOGO_BYTES = 500 * 1024
const LOGO_MAX_DIMENSION = 480 // downscale target — keeps data-URI small and crisp on the cover

export default function FirmProfilePage() {
  const { token } = useAuth()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<FirmProfileForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)

  const setField = useCallback(<K extends keyof FirmProfileForm>(key: K, value: FirmProfileForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const fetchProfile = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/tenant-admin/firm-profile', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load firm profile')
      const data = await res.json()
      setCanEdit(Boolean(data.canEdit))
      if (data.profile) {
        setForm({
          firmName: data.profile.firmName ?? '',
          logoDataUri: data.profile.logoDataUri ?? '',
          tagline: data.profile.tagline ?? '',
          addressLine1: data.profile.addressLine1 ?? '',
          addressLine2: data.profile.addressLine2 ?? '',
          city: data.profile.city ?? '',
          state: data.profile.state ?? '',
          countryCode: data.profile.countryCode ?? '',
          postalCode: data.profile.postalCode ?? '',
          phone: data.profile.phone ?? '',
          email: data.profile.email ?? '',
          website: data.profile.website ?? '',
          accentColor: data.profile.accentColor ?? '#1D4ED8',
          showPoweredBy: data.profile.showPoweredBy ?? true,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handleLogoFile = useCallback(async (file: File) => {
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      toast({ title: 'Logo must be a PNG or JPEG image', variant: 'error' })
      return
    }
    try {
      const dataUri = await downscaleImage(file, LOGO_MAX_DIMENSION)
      const approxBytes = Math.ceil((dataUri.length - dataUri.indexOf(',') - 1) * 0.75)
      if (approxBytes > MAX_LOGO_BYTES) {
        toast({ title: 'Logo is too large even after resizing. Try a simpler image.', variant: 'error' })
        return
      }
      setField('logoDataUri', dataUri)
    } catch {
      toast({ title: 'Could not read that image', variant: 'error' })
    }
  }, [setField, toast])

  const handleSave = useCallback(async () => {
    if (!token) return
    if (form.firmName.trim().length < 2) {
      toast({ title: 'Firm name must be at least 2 characters', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/tenant-admin/firm-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const detail = data?.details?.fieldErrors
          ? Object.values(data.details.fieldErrors).flat()[0]
          : data?.error
        throw new Error(detail || 'Failed to save firm profile')
      }
      toast({ title: 'Firm profile saved', variant: 'success' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to save', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }, [form, token, toast])

  const addressPreviewLines = useMemo(() => {
    const lines: string[] = []
    if (form.addressLine1) lines.push(form.addressLine1)
    if (form.addressLine2) lines.push(form.addressLine2)
    const cityLine = [form.city, form.state, form.postalCode].filter(Boolean).join(', ')
    if (cityLine) lines.push(cityLine)
    if (form.countryCode) lines.push(form.countryCode.toUpperCase())
    return lines
  }, [form.addressLine1, form.addressLine2, form.city, form.state, form.postalCode, form.countryCode])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="h-8 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="mt-2 h-4 w-80 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-56 animate-pulse rounded-xl bg-white dark:bg-gray-800" />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-xl bg-white dark:bg-gray-800" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button onClick={fetchProfile} className="mt-4 text-sm font-medium text-lamp-600 hover:text-lamp-700">
            Try again
          </button>
        </div>
      </div>
    )
  }

  const disabled = !canEdit || saving

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Firm Profile</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
              Your firm&apos;s identity and branding. This appears on the cover of every novelty report your team
              generates, so clients see <span className="font-medium text-gray-700 dark:text-gray-300">your</span> brand.
            </p>
          </div>
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={disabled}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-lamp-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-lamp-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Saving…</>
              ) : (
                <><Check className="h-4 w-4" /> Save changes</>
              )}
            </button>
          )}
        </div>

        {!canEdit && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            You have read-only access. Only an Owner or Admin can edit the firm profile.
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          {/* Form column */}
          <div className="space-y-6">
            {/* Identity */}
            <Section icon={<Building2 className="h-4 w-4" />} title="Firm identity" subtitle="Name and logo shown at the top of the report.">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Firm name" required className="sm:col-span-2">
                  <input
                    type="text"
                    value={form.firmName}
                    onChange={e => setField('firmName', e.target.value)}
                    disabled={disabled}
                    placeholder="e.g. Meridian IP Associates"
                    className={inputClass}
                  />
                </Field>
                <Field label="Tagline" hint="Optional" className="sm:col-span-2">
                  <input
                    type="text"
                    value={form.tagline}
                    onChange={e => setField('tagline', e.target.value)}
                    disabled={disabled}
                    placeholder="e.g. Patents. Trademarks. Strategy."
                    className={inputClass}
                  />
                </Field>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Logo</label>
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900">
                      {form.logoDataUri ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.logoDataUri} alt="Firm logo" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-xs text-gray-400">No logo</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = '' }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={disabled}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <Upload className="h-4 w-4" /> Upload logo
                      </button>
                      {form.logoDataUri && canEdit && (
                        <button
                          type="button"
                          onClick={() => setField('logoDataUri', '')}
                          className="ml-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600"
                        >
                          <X className="h-3.5 w-3.5" /> Remove
                        </button>
                      )}
                      <p className="text-xs text-gray-400">PNG or JPEG, up to 500&nbsp;KB. Auto-resized.</p>
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            {/* Contact */}
            <Section icon={<Phone className="h-4 w-4" />} title="Contact &amp; address" subtitle="Printed in the report footer.">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Address line 1" className="sm:col-span-2">
                  <input type="text" value={form.addressLine1} onChange={e => setField('addressLine1', e.target.value)} disabled={disabled} className={inputClass} />
                </Field>
                <Field label="Address line 2" className="sm:col-span-2">
                  <input type="text" value={form.addressLine2} onChange={e => setField('addressLine2', e.target.value)} disabled={disabled} className={inputClass} />
                </Field>
                <Field label="City">
                  <input type="text" value={form.city} onChange={e => setField('city', e.target.value)} disabled={disabled} className={inputClass} />
                </Field>
                <Field label="State / Region">
                  <input type="text" value={form.state} onChange={e => setField('state', e.target.value)} disabled={disabled} className={inputClass} />
                </Field>
                <Field label="Postal code">
                  <input type="text" value={form.postalCode} onChange={e => setField('postalCode', e.target.value)} disabled={disabled} className={inputClass} />
                </Field>
                <Field label="Country code" hint="ISO-2, e.g. IN">
                  <input type="text" maxLength={2} value={form.countryCode} onChange={e => setField('countryCode', e.target.value.toUpperCase())} disabled={disabled} className={`${inputClass} uppercase`} />
                </Field>
                <Field label="Phone" hint="E.164, e.g. +919812345678">
                  <input type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} disabled={disabled} placeholder="+91…" className={inputClass} />
                </Field>
                <Field label="Email">
                  <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} disabled={disabled} className={inputClass} />
                </Field>
                <Field label="Website" className="sm:col-span-2">
                  <input type="url" value={form.website} onChange={e => setField('website', e.target.value)} disabled={disabled} placeholder="https://" className={inputClass} />
                </Field>
              </div>
            </Section>

            {/* Branding */}
            <Section icon={<Palette className="h-4 w-4" />} title="Report branding" subtitle="Your accent color recolors the report highlights.">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Accent color</label>
                <div className="flex flex-wrap items-center gap-2.5">
                  {ACCENT_PRESETS.map(preset => {
                    const active = form.accentColor.toUpperCase() === preset.toUpperCase()
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setField('accentColor', preset)}
                        disabled={disabled}
                        aria-label={`Accent ${preset}`}
                        aria-pressed={active}
                        className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-white transition dark:ring-offset-gray-800 ${active ? 'ring-2 ring-gray-900 dark:ring-white' : 'ring-1 ring-black/10 hover:scale-110'} disabled:cursor-not-allowed`}
                        style={{ backgroundColor: preset }}
                      />
                    )
                  })}
                  <div className="ml-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : '#1D4ED8'}
                      onChange={e => setField('accentColor', e.target.value.toUpperCase())}
                      disabled={disabled}
                      aria-label="Custom accent color"
                      className="h-8 w-8 cursor-pointer rounded border border-gray-300 bg-transparent dark:border-gray-600"
                    />
                    <input
                      type="text"
                      value={form.accentColor}
                      onChange={e => setField('accentColor', e.target.value)}
                      disabled={disabled}
                      className={`${inputClass} w-28 font-mono text-sm`}
                    />
                  </div>
                </div>
              </div>

              <label className="mt-6 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.showPoweredBy}
                  onChange={e => setField('showPoweredBy', e.target.checked)}
                  disabled={disabled}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-lamp-600 focus:ring-lamp-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-200">Show &ldquo;Powered by PatentNest.ai&rdquo;</span>
                  <span className="block text-gray-500 dark:text-gray-400">A small attribution line in the report footer. Your brand stays front and center.</span>
                </span>
              </label>
            </Section>
          </div>

          {/* Live preview column */}
          <div className="lg:sticky lg:top-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Report cover preview</p>
            <CoverPreview form={form} addressLines={addressPreviewLines} />
          </div>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-lamp-500 focus:outline-none focus:ring-2 focus:ring-lamp-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:disabled:bg-gray-800'

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-lamp-50 text-lamp-600 dark:bg-lamp-900/30 dark:text-lamp-300">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, required, hint, className, children }: { label: string; required?: boolean; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="ml-auto text-xs font-normal text-gray-400">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

// A compact echo of the PDF cover so admins see accent + logo choices immediately.
function CoverPreview({ form, addressLines }: { form: FirmProfileForm; addressLines: string[] }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : '#1D4ED8'
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm dark:border-gray-700">
      <div className="relative flex aspect-[3/4] flex-col justify-between bg-[#0B1220] p-5 text-white">
        <div>
          <div className="mb-3 h-1 w-10 rounded" style={{ backgroundColor: accent }} />
          {form.logoDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logoDataUri} alt="" className="max-h-10 max-w-[70%] object-contain" />
          ) : (
            <div className="text-lg font-bold leading-tight">{form.firmName || 'Your Firm'}</div>
          )}
          <div className="mt-1.5 text-[11px] text-blue-200">Preliminary Novelty Assessment Report</div>
          <div className="mt-8 text-base font-semibold leading-snug text-white/95">Sample Invention Title</div>
        </div>

        <div className="space-y-2">
          <div className="rounded-md bg-white/5 p-3 text-[10px] leading-relaxed">
            <PreviewRow accent={accent} label="Prepared by" value={form.firmName || 'Your Firm'} />
            <PreviewRow accent={accent} label="Source mode" value="Global Patent Corpus — 55M+ records" />
            <PreviewRow accent={accent} label="Jurisdiction" value="IN" />
          </div>
          <div className="text-center text-[9px] leading-relaxed text-blue-200">
            {addressLines.length > 0 && <div>{addressLines.join(', ')}</div>}
            {[form.phone, form.email, form.website].filter(Boolean).length > 0 && (
              <div>{[form.phone, form.email, form.website].filter(Boolean).join('  ·  ')}</div>
            )}
            {form.showPoweredBy && <div className="mt-1 text-blue-300/80">Powered by PatentNest.ai</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewRow({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-20 shrink-0 font-semibold uppercase tracking-wide" style={{ color: accent }}>{label}</span>
      <span className="truncate text-white/90">{value}</span>
    </div>
  )
}

// Resize an image file to fit within maxDim (longest side) and return a data-URI. Keeps the
// logo small enough to embed in the DB and render crisply on the report cover.
async function downscaleImage(file: File, maxDim: number): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('decode failed'))
    image.src = dataUrl
  })
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  if (scale >= 1 && dataUrl.length < MAX_LOGO_BYTES) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  // PNG preserves transparency for logos; JPEG source stays JPEG for smaller size.
  const isJpeg = /jpe?g/i.test(file.type)
  return canvas.toDataURL(isJpeg ? 'image/jpeg' : 'image/png', isJpeg ? 0.9 : undefined)
}
