export interface UsageDateRange {
  start: Date
  endInclusive: Date
  endExclusive: Date
}

export type ParsedUsageDateRange =
  | { startDate: Date; endDate: Date }
  | { error: string }

export function getUtcDayWindow(now: Date = new Date()): UsageDateRange {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  ))
  const endExclusive = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  ))
  return {
    start,
    endExclusive,
    endInclusive: new Date(endExclusive.getTime() - 1)
  }
}

export function getUtcMonthWindow(now: Date = new Date()): UsageDateRange {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  return {
    start,
    endExclusive,
    endInclusive: new Date(endExclusive.getTime() - 1)
  }
}

export function getCurrentUtcPeriods(now: Date = new Date()) {
  return {
    currentDay: now.toISOString().substring(0, 10),
    currentMonth: now.toISOString().substring(0, 7)
  }
}

export function normalizeUsageDateRange(
  startInput?: Date | string | null,
  endInput?: Date | string | null,
  fallbackDays = 30
): UsageDateRange {
  const parsedEnd = endInput ? new Date(endInput) : new Date()
  const endSource = Number.isNaN(parsedEnd.getTime()) ? new Date() : parsedEnd

  const parsedStart = startInput
    ? new Date(startInput)
    : new Date(endSource.getTime() - fallbackDays * 24 * 60 * 60 * 1000)
  const startSource = Number.isNaN(parsedStart.getTime())
    ? new Date(endSource.getTime() - fallbackDays * 24 * 60 * 60 * 1000)
    : parsedStart

  const start = getUtcDayWindow(startSource).start
  const endWindow = getUtcDayWindow(endSource)
  return {
    start,
    endInclusive: endWindow.endInclusive,
    endExclusive: endWindow.endExclusive
  }
}

export function parseUsageDateRangeParams(
  startInput?: string | null,
  endInput?: string | null,
  fallbackDays = 30
): ParsedUsageDateRange {
  const parsedEnd = endInput ? new Date(endInput) : new Date()
  if (Number.isNaN(parsedEnd.getTime())) {
    return { error: 'Invalid endDate format' }
  }

  const parsedStart = startInput
    ? new Date(startInput)
    : new Date(parsedEnd.getTime() - fallbackDays * 24 * 60 * 60 * 1000)
  if (Number.isNaN(parsedStart.getTime())) {
    return { error: 'Invalid startDate format' }
  }

  if (parsedStart > parsedEnd) {
    return { error: 'startDate must be on or before endDate' }
  }

  return {
    startDate: parsedStart,
    endDate: parsedEnd
  }
}

export function toInclusiveDateRange(range: UsageDateRange) {
  return {
    gte: range.start,
    lte: range.endInclusive
  }
}

export function getDateOnlyMonthRange(monthValue: string): { startDate: string; endDate: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    endDate: `${match[1]}-${match[2]}-${`${lastDay}`.padStart(2, '0')}`
  }
}

export function getDateOnlyYearRange(yearValue: string | number): { startDate: string; endDate: string } | null {
  const yearText = String(yearValue)
  if (!/^\d{4}$/.test(yearText)) return null

  const year = Number(yearText)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return null
  }

  return {
    startDate: `${yearText}-01-01`,
    endDate: `${yearText}-12-31`
  }
}
