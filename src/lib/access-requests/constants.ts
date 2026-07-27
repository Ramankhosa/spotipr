/**
 * Shared vocabulary for inbound access requests.
 *
 * Imported by both the public forms (client) and the API/service layer (server),
 * so this file must stay free of prisma / node-only imports.
 */

export type AccessRequestKind = 'CONTACT' | 'TRIAL'

export type AccessRequestStatus =
  | 'NEW'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESOLVED'
  | 'SPAM'

/** Statuses a request of each kind is allowed to land in. */
export const STATUSES_BY_KIND: Record<AccessRequestKind, AccessRequestStatus[]> = {
  CONTACT: ['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM'],
  TRIAL: ['NEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SPAM'],
}

export const ALL_STATUSES: AccessRequestStatus[] = [
  'NEW',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'RESOLVED',
  'SPAM',
]

export const STATUS_LABELS: Record<AccessRequestStatus, string> = {
  NEW: 'New',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  RESOLVED: 'Resolved',
  SPAM: 'Spam',
}

/** Tailwind classes for the status pill — kept next to the labels so they stay in sync. */
export const STATUS_STYLES: Record<AccessRequestStatus, string> = {
  NEW: 'bg-amber-50 text-amber-800 ring-amber-200',
  IN_REVIEW: 'bg-lamp-50 text-lamp-800 ring-lamp-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 ring-rose-200',
  RESOLVED: 'bg-slate-100 text-slate-700 ring-slate-200',
  SPAM: 'bg-zinc-100 text-zinc-500 ring-zinc-200',
}

/** "Open" = still needs a human. Drives the inbox badge counts. */
export const OPEN_STATUSES: AccessRequestStatus[] = ['NEW', 'IN_REVIEW']

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------

export const CONTACT_TOPICS = [
  'Patent Drafting',
  'Novelty & Prior Art Search',
  'Office Action Response',
  'Idea Bank',
  'Pricing & Plans',
  'Partnership',
  'Support',
  'Other',
] as const

export type ContactTopic = (typeof CONTACT_TOPICS)[number]

// ---------------------------------------------------------------------------
// Trial request form
// ---------------------------------------------------------------------------

export const TEAM_SIZES = [
  'Just me',
  '2–5 people',
  '6–20 people',
  '21–100 people',
  '100+ people',
] as const

export const EXPECTED_VOLUMES = [
  'Under 5 filings a year',
  '5–20 filings a year',
  '21–50 filings a year',
  '50+ filings a year',
  'Not sure yet',
] as const

/** Jurisdictions offered on the trial form. Codes match the country profiles. */
export const TRIAL_JURISDICTIONS = [
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'EP', label: 'Europe (EPO)' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'WO', label: 'PCT / WIPO' },
  { code: 'AU', label: 'Australia' },
  { code: 'CA', label: 'Canada' },
  { code: 'JP', label: 'Japan' },
] as const

export const TRIAL_JURISDICTION_CODES = TRIAL_JURISDICTIONS.map((j) => j.code) as string[]

export const JURISDICTION_LABELS: Record<string, string> = Object.fromEntries(
  TRIAL_JURISDICTIONS.map((j) => [j.code, j.label])
)

/** Trial lengths a super admin can grant. */
export const TRIAL_DURATION_OPTIONS = [7, 14, 21, 30, 60, 90]

export const DEFAULT_TRIAL_DAYS = 14

// ---------------------------------------------------------------------------
// Field limits — enforced on the server, mirrored in the forms
// ---------------------------------------------------------------------------

export const FIELD_LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  organization: 160,
  jobTitle: 120,
  country: 80,
  topic: 80,
  message: 4000,
  useCase: 4000,
  decisionReason: 2000,
  internalNotes: 8000,
} as const
