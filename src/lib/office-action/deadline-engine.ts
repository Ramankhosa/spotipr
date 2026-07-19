import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — deadline engine
 *
 * Pure, deterministic computation of prosecution deadlines from a
 * jurisdiction profile's timeline rules. No DB, no LLM, no country code
 * branches — everything comes from the profile. Date math is calendar-safe
 * (month arithmetic clamps to month end, e.g. 31 Aug + P6M → 28/29 Feb).
 */

export interface ComputedDeadline {
  id: string
  instrument: string
  what: string
  basis?: string
  triggerField: string
  triggerDate: string          // ISO yyyy-mm-dd
  dueDate: string              // ISO yyyy-mm-dd
  extension?: {
    extendedDueDate: string    // due date if the extension is taken
    requestWindowEnds?: string // last day the extension request may be filed
    form?: string
    feePerMonth?: Record<string, number>
    feeFromDateOverride?: string
    note?: string
  }
  consequence?: {
    type: string
    basis?: string
    revivable?: boolean
    note?: string
  }
  daysRemaining: number        // relative to `today` passed to computeDeadlines
  urgency: 'expired' | 'critical' | 'warning' | 'normal'
}

const PERIOD_REGEX = /^P(?=\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/

interface ParsedPeriod { years: number; months: number; weeks: number; days: number }

export function parsePeriod(period: string): ParsedPeriod {
  const m = PERIOD_REGEX.exec(period)
  if (!m) throw new Error(`Invalid period "${period}" — expected ISO-8601 like "P6M" or "P15D"`)
  return {
    years: Number(m[1] || 0),
    months: Number(m[2] || 0),
    weeks: Number(m[3] || 0),
    days: Number(m[4] || 0)
  }
}

function parseIsoDate(value: string): Date {
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (isNaN(d.getTime())) throw new Error(`Invalid date "${value}" — expected ISO yyyy-mm-dd`)
  return d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Adds an ISO period to an ISO date. Month/year arithmetic clamps to the
 * last day of the target month (the convention used in deadline practice:
 * a 6-month period from 31 Aug ends 28/29 Feb, not 2/3 Mar).
 */
export function addPeriod(isoDate: string, period: string): string {
  const { years, months, weeks, days } = parsePeriod(period)
  const start = parseIsoDate(isoDate)

  let result = start
  if (years || months) {
    const y = start.getUTCFullYear() + years
    const totalMonths = start.getUTCMonth() + months
    const targetYear = y + Math.floor(totalMonths / 12)
    const targetMonth = ((totalMonths % 12) + 12) % 12
    const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
    const day = Math.min(start.getUTCDate(), lastDayOfTarget)
    result = new Date(Date.UTC(targetYear, targetMonth, day))
  }
  const extraDays = weeks * 7 + days
  if (extraDays) {
    result = new Date(result.getTime() + extraDays * 86_400_000)
  }
  return toIsoDate(result)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / 86_400_000)
}

function urgencyFor(daysRemaining: number): ComputedDeadline['urgency'] {
  if (daysRemaining < 0) return 'expired'
  if (daysRemaining <= 15) return 'critical'
  if (daysRemaining <= 45) return 'warning'
  return 'normal'
}

/**
 * Computes every deadline the profile declares for the given instrument,
 * using the trigger dates extracted at intake.
 *
 * @param profile        validated officeActionProfile block
 * @param instrumentId   e.g. "FER", "HEARING_NOTICE"
 * @param triggerDates   extracted dates keyed by trigger field, ISO yyyy-mm-dd
 *                       e.g. { dateOfReport: "2026-07-01" }
 * @param today          ISO date used for daysRemaining/urgency (injected for testability)
 */
export function computeDeadlines(
  profile: OfficeActionProfile,
  instrumentId: string,
  triggerDates: Record<string, string>,
  today: string
): ComputedDeadline[] {
  const rules = profile.timeline.deadlines.filter(d => d.instrument === instrumentId)

  const computed: ComputedDeadline[] = []
  for (const rule of rules) {
    const triggerDate = triggerDates[rule.trigger]
    if (!triggerDate) continue  // trigger not extracted (e.g. hearing not yet scheduled)

    const dueDate = addPeriod(triggerDate, rule.period)
    const entry: ComputedDeadline = {
      id: rule.id,
      instrument: rule.instrument,
      what: rule.what || rule.id,
      basis: rule.basis,
      triggerField: rule.trigger,
      triggerDate,
      dueDate,
      consequence: rule.consequence,
      daysRemaining: daysBetween(today, dueDate),
      urgency: 'normal'
    }

    if (rule.extension) {
      entry.extension = {
        extendedDueDate: addPeriod(dueDate, rule.extension.period),
        requestWindowEnds: rule.extension.requestWindow
          ? addPeriod(triggerDate, rule.extension.requestWindow)
          : undefined,
        form: rule.extension.form,
        feePerMonth: rule.extension.feePerMonth,
        feeFromDateOverride: rule.extension.feeFromDateOverride,
        note: rule.extension.note
      }
    }

    entry.urgency = urgencyFor(entry.daysRemaining)
    computed.push(entry)
  }

  return computed.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/**
 * The single most urgent deadline across all documents of a case —
 * what the workspace banner shows.
 */
export function mostUrgentDeadline(deadlines: ComputedDeadline[]): ComputedDeadline | null {
  const active = deadlines.filter(d => d.urgency !== 'expired')
  const pool = active.length > 0 ? active : deadlines
  return pool.length > 0 ? pool.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b)) : null
}
