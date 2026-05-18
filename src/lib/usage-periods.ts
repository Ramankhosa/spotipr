export interface UsageDateRange {
  start: Date
  endInclusive: Date
  endExclusive: Date
}

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

export function toInclusiveDateRange(range: UsageDateRange) {
  return {
    gte: range.start,
    lte: range.endInclusive
  }
}
