'use client'

/**
 * Super Admin — Request Inbox
 *
 * One triage surface for everything the public forms send in: contact enquiries
 * and free-trial requests. Trial requests are decided here — approving one mints
 * an email-locked invite in the "Inbound Trial Requests" campaign and emails the
 * activation link, so the existing signup, quota and analytics paths are reused
 * rather than duplicated.
 *
 * SUPER_ADMIN_VIEWER can read the inbox; every write is SUPER_ADMIN only and the
 * server enforces that independently of the `canWrite` flag used to grey out UI.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Building2,
  Check,
  CircleUserRound,
  Clock,
  Copy,
  Globe2,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Rocket,
  Search,
  Send,
  UserCheck,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import {
  DEFAULT_TRIAL_DAYS,
  JURISDICTION_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  TRIAL_DURATION_OPTIONS,
  type AccessRequestKind,
  type AccessRequestStatus,
} from '@/lib/access-requests/constants'

// ---------------------------------------------------------------------------
// Types (mirror of the API payloads)
// ---------------------------------------------------------------------------

interface AccessRequestRow {
  id: string
  kind: AccessRequestKind
  status: AccessRequestStatus
  name: string
  email: string
  phone: string | null
  organization: string | null
  jobTitle: string | null
  country: string | null
  topic: string | null
  message: string | null
  useCase: string | null
  teamSize: string | null
  expectedVolume: string | null
  jurisdictions: string[]
  requestedDays: number | null
  sourcePage: string | null
  existingUserId: string | null
  assignedTo: string | null
  internalNotes: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  decisionReason: string | null
  grantedCampaignId: string | null
  grantedInviteId: string | null
  grantedTrialDays: number | null
  inviteSentAt: string | null
  createdAt: string
  updatedAt: string
}

interface RequestEvent {
  id: string
  type: string
  note: string | null
  actorEmail: string | null
  createdAt: string
}

interface InviteSummary {
  id: string
  status: string
  sentAt: string | null
  tokenExpiresAt: string | null
  signedUpAt: string | null
  openCount: number
  clickCount: number
  campaign: { id: string; name: string; trialDurationDays: number } | null
}

interface ExistingUser {
  id: string
  email: string
  name: string | null
  createdAt: string
  roles: string[]
}

interface ListResponse {
  requests: AccessRequestRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  counts: { trialOpen: number; contactOpen: number; totalOpen: number }
  canWrite: boolean
}

interface DetailResponse {
  request: AccessRequestRow & { events: RequestEvent[] }
  invite: InviteSummary | null
  existingUser: ExistingUser | null
  relatedCount: number
  canWrite: boolean
}

type KindFilter = 'ALL' | AccessRequestKind

const STATUS_FILTERS: Array<{ value: string; label: string; statuses: AccessRequestStatus[] }> = [
  { value: 'OPEN', label: 'Open', statuses: ['NEW', 'IN_REVIEW'] },
  { value: 'NEW', label: 'New', statuses: ['NEW'] },
  { value: 'IN_REVIEW', label: 'In review', statuses: ['IN_REVIEW'] },
  { value: 'DECIDED', label: 'Decided', statuses: ['APPROVED', 'REJECTED', 'RESOLVED'] },
  { value: 'SPAM', label: 'Spam', statuses: ['SPAM'] },
  { value: 'ALL', label: 'Everything', statuses: [] },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AccessRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-paper-200">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
        </div>
      }
    >
      <AccessRequestsInbox />
    </Suspense>
  )
}

function AccessRequestsInbox() {
  const { user, isLoading: authLoading } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [rows, setRows] = useState<AccessRequestRow[]>([])
  const [counts, setCounts] = useState({ trialOpen: 0, contactOpen: 0, totalOpen: 0 })
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [canWrite, setCanWrite] = useState(false)

  const [kind, setKind] = useState<KindFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState('OPEN')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(searchParams?.get('request') ?? null)

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
    }),
    []
  )

  // --- Access gate ----------------------------------------------------------
  // Wait for the auth context to settle before deciding — otherwise a signed-in
  // admin gets bounced to /login on the first render.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login?redirect=/super-admin/requests')
      return
    }
    const allowed = user.roles?.some(
      (role) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
    )
    if (!allowed) router.push('/dashboard')
  }, [authLoading, user, router])

  // --- Debounced search -----------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  // --- Fetch list -----------------------------------------------------------
  const fetchRequests = useCallback(
    async (opts: { page?: number; silent?: boolean } = {}) => {
      try {
        if (opts.silent) setRefreshing(true)
        else setLoading(true)
        setError(null)

        const statuses = STATUS_FILTERS.find((f) => f.value === statusFilter)?.statuses ?? []
        const params = new URLSearchParams()
        if (kind !== 'ALL') params.set('kind', kind)
        if (statuses.length) params.set('status', statuses.join(','))
        if (search) params.set('search', search)
        params.set('page', String(opts.page ?? 1))

        const response = await fetch(`/api/super-admin/access-requests?${params}`, {
          headers: authHeaders(),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load requests')
        }

        const data: ListResponse = await response.json()
        setRows(data.requests)
        setCounts(data.counts)
        setPagination(data.pagination)
        setCanWrite(data.canWrite)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [authHeaders, kind, statusFilter, search]
  )

  useEffect(() => {
    if (!user) return
    void fetchRequests()
  }, [user, fetchRequests])

  // Keep the deep-link in the URL so an admin can share a specific request.
  useEffect(() => {
    const current = searchParams?.get('request') ?? null
    if (current === selectedId) return
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (selectedId) params.set('request', selectedId)
    else params.delete('request')
    router.replace(`/super-admin/requests${params.toString() ? `?${params}` : ''}`, {
      scroll: false,
    })
  }, [selectedId, searchParams, router])

  const handleChanged = useCallback(() => {
    void fetchRequests({ page: pagination.page, silent: true })
  }, [fetchRequests, pagination.page])

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-200">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper-200">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                href="/dashboard"
                className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Dashboard
              </Link>
              <h1 className="font-serif text-2xl text-foreground sm:text-3xl">Request inbox</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Contact enquiries and free-trial requests from the public site. Approving a trial
                issues an email-locked invite and sends the activation link.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <StatPill label="Trial" value={counts.trialOpen} tone="primary" />
              <StatPill label="Contact" value={counts.contactOpen} tone="muted" />
              <button
                type="button"
                onClick={() => void fetchRequests({ page: pagination.page, silent: true })}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                  aria-hidden
                />
                Refresh
              </button>
            </div>
          </div>

          {!canWrite && !loading && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Read-only access — decisions require the SUPER_ADMIN role.
            </p>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Filters                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <SegmentedControl
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'TRIAL', label: 'Trial requests' },
              { value: 'CONTACT', label: 'Contact' },
            ]}
            value={kind}
            onChange={(value) => setKind(value as KindFilter)}
          />

          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  statusFilter === filter.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto min-w-[220px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Name, email, organisation…"
              className="w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* List + detail                                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {error}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* List */}
          <div className="space-y-2">
            {loading ? (
              <ListSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState kind={kind} statusFilter={statusFilter} />
            ) : (
              <>
                {rows.map((row) => (
                  <RequestCard
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    onSelect={() => setSelectedId(row.id)}
                  />
                ))}

                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 text-sm">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => void fetchRequests({ page: pagination.page - 1 })}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 transition hover:bg-muted disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-muted-foreground">
                      Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
                    </span>
                    <button
                      type="button"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => void fetchRequests({ page: pagination.page + 1 })}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 transition hover:bg-muted disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Detail */}
          <div className="xl:sticky xl:top-6 xl:self-start">
            {selectedId ? (
              <RequestDetail
                key={selectedId}
                requestId={selectedId}
                authHeaders={authHeaders}
                onChanged={handleChanged}
                onClose={() => setSelectedId(null)}
                toast={toast}
              />
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
                <Inbox className="mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden />
                <p className="text-sm font-medium text-foreground">Select a request</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Pick anything on the left to read the full submission and act on it.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function RequestDetail({
  requestId,
  authHeaders,
  onChanged,
  onClose,
  toast,
}: {
  requestId: string
  authHeaders: () => Record<string, string>
  onChanged: () => void
  onClose: () => void
  toast: ReturnType<typeof useToast>['toast']
}) {
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [decision, setDecision] = useState<'approve' | 'decline' | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/super-admin/access-requests/${requestId}`, {
        headers: authHeaders(),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load the request')
      }
      const data: DetailResponse = await response.json()
      setDetail(data)
      setNotes(data.request.internalNotes || '')
      setNotesDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [requestId, authHeaders])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (body: Record<string, unknown>, successMessage: string) => {
      try {
        setBusy(true)
        const response = await fetch(`/api/super-admin/access-requests/${requestId}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify(body),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Update failed')

        toast({ title: successMessage, variant: 'success' })
        await load()
        onChanged()
      } catch (err) {
        toast({
          title: 'Could not update the request',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'error',
        })
      } finally {
        setBusy(false)
      }
    },
    [requestId, authHeaders, toast, load, onChanged]
  )

  const submitDecision = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        setBusy(true)
        const response = await fetch(`/api/super-admin/access-requests/${requestId}/decision`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'The decision could not be recorded')

        if (body.action === 'approve') {
          setInviteUrl(data.inviteUrl ?? null)
          toast({
            title: data.emailSent ? 'Trial approved and invite sent' : 'Trial approved',
            description: data.emailSent
              ? undefined
              : 'The invite email did not send — copy the activation link below and send it manually.',
            variant: data.emailSent ? 'success' : 'warning',
            duration: data.emailSent ? 5000 : 12000,
          })
        } else {
          toast({ title: 'Request declined', variant: 'success' })
        }

        setDecision(null)
        await load()
        onChanged()
      } catch (err) {
        toast({
          title: 'Decision failed',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'error',
        })
      } finally {
        setBusy(false)
      }
    },
    [requestId, authHeaders, toast, load, onChanged]
  )

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {error || 'Request not found'}
      </div>
    )
  }

  const { request, invite, existingUser, relatedCount, canWrite } = detail
  const isTrial = request.kind === 'TRIAL'
  const decided = request.status === 'APPROVED' || request.status === 'REJECTED'

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="border-b border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <KindBadge kind={request.kind} />
              <StatusPill status={request.status} />
              {request.assignedTo && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  <UserCheck className="h-3 w-3" aria-hidden />
                  Assigned
                </span>
              )}
            </div>
            <h2 className="truncate font-serif text-xl text-foreground">{request.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatDateTime(request.createdAt)}
              {request.sourcePage ? ` · from ${request.sourcePage}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close request"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <ContactLine icon={Mail} value={request.email} href={`mailto:${request.email}`} />
          {request.phone && (
            <ContactLine icon={Phone} value={request.phone} href={`tel:${request.phone}`} />
          )}
          {request.organization && <ContactLine icon={Building2} value={request.organization} />}
          {request.jobTitle && <ContactLine icon={CircleUserRound} value={request.jobTitle} />}
          {request.country && <ContactLine icon={Globe2} value={request.country} />}
        </div>

        {(existingUser || relatedCount > 0) && (
          <div className="mt-4 space-y-2">
            {existingUser && (
              <Callout tone="info">
                This address already has an account
                {existingUser.name ? ` (${existingUser.name})` : ''}, created{' '}
                {formatDate(existingUser.createdAt)}. Approving still sends an invite link — check
                whether they need a plan change instead.
              </Callout>
            )}
            {relatedCount > 0 && (
              <Callout tone="muted">
                {relatedCount} other request{relatedCount === 1 ? '' : 's'} from this email address.
              </Callout>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="space-y-5 p-5">
        {isTrial ? (
          <>
            <DetailBlock label="What they want to do">
              {request.useCase || <span className="italic text-muted-foreground">Not provided</span>}
            </DetailBlock>

            <div className="grid gap-4 sm:grid-cols-2">
              <MetaItem label="Team size" value={request.teamSize} />
              <MetaItem label="Expected filings" value={request.expectedVolume} />
            </div>

            {request.jurisdictions.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Jurisdictions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {request.jurisdictions.map((code) => (
                    <span
                      key={code}
                      className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                    >
                      {JURISDICTION_LABELS[code] || code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <MetaItem label="Topic" value={request.topic} />
            <DetailBlock label="Message">
              {request.message || <span className="italic text-muted-foreground">No message</span>}
            </DetailBlock>
          </>
        )}

        {/* Granted invite */}
        {invite && (
          <div className="rounded-xl border border-primary/25 bg-secondary/40 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Rocket className="h-4 w-4 text-primary" aria-hidden />
              Trial granted
              {request.grantedTrialDays ? ` — ${request.grantedTrialDays} days` : ''}
            </p>
            <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
              <InviteFact label="Invite status" value={invite.status} />
              <InviteFact label="Campaign" value={invite.campaign?.name ?? '—'} />
              <InviteFact label="Sent" value={invite.sentAt ? formatDateTime(invite.sentAt) : 'Not sent'} />
              <InviteFact
                label="Link expires"
                value={invite.tokenExpiresAt ? formatDate(invite.tokenExpiresAt) : '—'}
              />
              <InviteFact
                label="Signed up"
                value={invite.signedUpAt ? formatDateTime(invite.signedUpAt) : 'Not yet'}
              />
              <InviteFact label="Opens / clicks" value={`${invite.openCount} / ${invite.clickCount}`} />
            </dl>
            {inviteUrl && <CopyableLink url={inviteUrl} toast={toast} />}
          </div>
        )}

        {decided && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium text-foreground">
              {request.status === 'APPROVED' ? 'Approved' : 'Declined'} by{' '}
              {request.reviewedBy || 'an admin'}
              {request.reviewedAt ? ` on ${formatDate(request.reviewedAt)}` : ''}
            </p>
            {request.decisionReason && (
              <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">
                {request.decisionReason}
              </p>
            )}
          </div>
        )}

        {/* Internal notes */}
        <div>
          <label
            htmlFor="internal-notes"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Internal notes
          </label>
          <textarea
            id="internal-notes"
            rows={3}
            value={notes}
            disabled={!canWrite}
            onChange={(event) => {
              setNotes(event.target.value)
              setNotesDirty(true)
            }}
            placeholder="Only visible to super admins."
            className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          />
          {notesDirty && canWrite && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void patch({ internalNotes: notes }, 'Notes saved')}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-lamp-700 disabled:opacity-60"
              >
                Save notes
              </button>
              <button
                type="button"
                onClick={() => {
                  setNotes(request.internalNotes || '')
                  setNotesDirty(false)
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-muted"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {canWrite && (
        <div className="border-t border-border bg-muted/30 p-5">
          {decision === 'approve' ? (
            <ApprovePanel
              request={request}
              busy={busy}
              onCancel={() => setDecision(null)}
              onSubmit={(payload) => void submitDecision({ action: 'approve', ...payload })}
            />
          ) : decision === 'decline' ? (
            <DeclinePanel
              busy={busy}
              onCancel={() => setDecision(null)}
              onSubmit={(payload) => void submitDecision({ action: 'decline', ...payload })}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {isTrial && !decided && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDecision('approve')}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-lamp-700 disabled:opacity-60"
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    Approve trial
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDecision('decline')}
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/5 disabled:opacity-60"
                  >
                    <Ban className="h-4 w-4" aria-hidden />
                    Decline
                  </button>
                </>
              )}

              {!isTrial && request.status !== 'RESOLVED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void patch({ status: 'RESOLVED' }, 'Marked resolved')}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-lamp-700 disabled:opacity-60"
                >
                  <Check className="h-4 w-4" aria-hidden />
                  Mark resolved
                </button>
              )}

              <a
                href={`mailto:${request.email}?subject=${encodeURIComponent(
                  isTrial ? 'Your PatentNest.ai trial request' : 'Re: your message to PatentNest.ai'
                )}`}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm transition hover:bg-muted"
              >
                <Send className="h-4 w-4" aria-hidden />
                Reply by email
              </a>

              {request.status === 'NEW' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void patch({ status: 'IN_REVIEW', assignToSelf: true }, 'Picked up for review')
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-60"
                >
                  <UserCheck className="h-4 w-4" aria-hidden />
                  Take it
                </button>
              )}

              {request.status !== 'SPAM' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void patch({ status: 'SPAM' }, 'Marked as spam')}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  <Ban className="h-4 w-4" aria-hidden />
                  Spam
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="border-t border-border p-5">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Activity
        </p>
        <ol className="space-y-3">
          {request.events.map((event) => (
            <li key={event.id} className="flex gap-3 text-sm">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-foreground">
                  <span className="font-medium">{humanizeEvent(event.type)}</span>
                  {event.note ? ` — ${event.note}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                  {event.actorEmail ? ` · ${event.actorEmail}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Decision panels
// ---------------------------------------------------------------------------

function ApprovePanel({
  request,
  busy,
  onCancel,
  onSubmit,
}: {
  request: AccessRequestRow
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: {
    trialDays: number
    inviteExpiryDays: number
    note?: string
    sendEmail: boolean
  }) => void
}) {
  const [trialDays, setTrialDays] = useState(request.requestedDays || DEFAULT_TRIAL_DAYS)
  const [expiryDays, setExpiryDays] = useState(30)
  const [note, setNote] = useState('')
  const [sendEmail, setSendEmail] = useState(true)

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-foreground">
        Approve a trial for {request.name}
        <span className="ml-1 font-normal text-muted-foreground">({request.email})</span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="trial-days"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Trial length
          </label>
          <select
            id="trial-days"
            value={trialDays}
            onChange={(event) => setTrialDays(Number(event.target.value))}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          >
            {TRIAL_DURATION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            How long the trial runs once activated. Files the invite under the inbound campaign
            for that length.
          </p>
        </div>

        <div>
          <label
            htmlFor="expiry-days"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Activation link valid for
          </label>
          <select
            id="expiry-days"
            value={expiryDays}
            onChange={(event) => setExpiryDays(Number(event.target.value))}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          >
            {[7, 14, 30, 60, 90].map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="approve-note" className="mb-1 block text-xs font-medium text-muted-foreground">
          Note to include in the invite email
          <span className="ml-1 font-normal">(optional)</span>
        </label>
        <textarea
          id="approve-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="We've enabled India and US drafting for you — say hello if you'd like a walkthrough."
          className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(event) => setSendEmail(event.target.checked)}
          className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
        />
        Email the activation link now
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({ trialDays, inviteExpiryDays: expiryDays, note, sendEmail })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-lamp-700 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Check className="h-4 w-4" aria-hidden />
          )}
          Grant {trialDays}-day trial
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm transition hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function DeclinePanel({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: { reason?: string; sendEmail: boolean }) => void
}) {
  const [reason, setReason] = useState('')
  const [sendEmail, setSendEmail] = useState(false)

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-foreground">Decline this trial request</p>

      <div>
        <label htmlFor="decline-reason" className="mb-1 block text-xs font-medium text-muted-foreground">
          Reason
          <span className="ml-1 font-normal">
            (recorded on the request; included in the email if you send one)
          </span>
        </label>
        <textarea
          id="decline-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Free-form. e.g. Personal email address with no organisation; asked them to reapply from a work address."
          className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(event) => setSendEmail(event.target.checked)}
          className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
        />
        Email the requester to let them know
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({ reason, sendEmail })}
          className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Ban className="h-4 w-4" aria-hidden />
          )}
          Decline request
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm transition hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function RequestCard({
  row,
  selected,
  onSelect,
}: {
  row: AccessRequestRow
  selected: boolean
  onSelect: () => void
}) {
  const snippet = (row.kind === 'TRIAL' ? row.useCase : row.message) || row.topic || '—'

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-primary bg-secondary/50 shadow-sm'
          : 'border-border bg-card hover:border-primary/40 hover:bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.organization ? `${row.organization} · ` : ''}
            {row.email}
          </p>
        </div>
        <StatusPill status={row.status} compact />
      </div>

      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{snippet}</p>

      <div className="mt-2.5 flex items-center gap-2">
        <KindBadge kind={row.kind} compact />
        <span className="text-[11px] text-muted-foreground">{relativeTime(row.createdAt)}</span>
        {row.grantedInviteId && (
          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
            <Rocket className="h-3 w-3" aria-hidden />
            Invited
          </span>
        )}
      </div>
    </button>
  )
}

function KindBadge({ kind, compact }: { kind: AccessRequestKind; compact?: boolean }) {
  const isTrial = kind === 'TRIAL'
  const Icon = isTrial ? Rocket : MessageSquare
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      } font-medium ${
        isTrial
          ? 'bg-secondary text-secondary-foreground ring-primary/25'
          : 'bg-muted text-muted-foreground ring-border'
      }`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {isTrial ? 'Trial' : 'Contact'}
    </span>
  )
}

function StatusPill({ status, compact }: { status: AccessRequestStatus; compact?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full font-medium ring-1 ring-inset ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]'
      } ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'primary' | 'muted'
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-1.5 text-center ${
        tone === 'primary' ? 'border-primary/30 bg-secondary/60' : 'border-border bg-muted/50'
      }`}
    >
      <p className="text-lg font-semibold leading-none text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label} open
      </p>
    </div>
  )
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === option.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function ContactLine({
  icon: Icon,
  value,
  href,
}: {
  icon: typeof Mail
  value: string
  href?: string
}) {
  const content = (
    <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{value}</span>
    </span>
  )
  return href ? (
    <a href={href} className="min-w-0 transition hover:text-primary">
      {content}
    </a>
  ) : (
    content
  )
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">
        {value || <span className="italic text-muted-foreground">Not provided</span>}
      </p>
    </div>
  )
}

function InviteFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground sm:mt-0.5">{value}</dd>
    </div>
  )
}

function Callout({ tone, children }: { tone: 'info' | 'muted'; children: React.ReactNode }) {
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
        tone === 'info'
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-border bg-muted/50 text-muted-foreground'
      }`}
    >
      {children}
    </p>
  )
}

function CopyableLink({
  url,
  toast,
}: {
  url: string
  toast: ReturnType<typeof useToast>['toast']
}) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card p-2">
      <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{url}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => toast({ title: 'Activation link copied', variant: 'success' }))
            .catch(() => toast({ title: 'Could not copy the link', variant: 'error' }))
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium transition hover:bg-secondary"
      >
        <Copy className="h-3 w-3" aria-hidden />
        Copy
      </button>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[92px] animate-pulse rounded-xl border border-border bg-card/60" />
      ))}
    </div>
  )
}

function EmptyState({ kind, statusFilter }: { kind: KindFilter; statusFilter: string }) {
  const label = kind === 'TRIAL' ? 'trial requests' : kind === 'CONTACT' ? 'enquiries' : 'requests'
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <Inbox className="mb-3 h-7 w-7 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium text-foreground">No {label} here</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        {statusFilter === 'OPEN'
          ? 'Nothing is waiting on you. Switch to "Everything" to see the history.'
          : 'Try a different filter or clear the search.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function relativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(value)
}

function humanizeEvent(type: string): string {
  const map: Record<string, string> = {
    SUBMITTED: 'Submitted',
    STATUS_CHANGED: 'Status changed',
    ASSIGNED: 'Assignment',
    NOTE_ADDED: 'Note',
    APPROVED: 'Approved',
    REJECTED: 'Declined',
    INVITE_SENT: 'Invite',
    EMAIL_SENT: 'Email sent',
    EMAIL_FAILED: 'Email failed',
  }
  return map[type] || type
}
