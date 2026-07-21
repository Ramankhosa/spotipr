// Slicing: decide which delivery files a run should touch.
//
// This is what makes the import resumable in year-sized pieces instead of one
// all-or-nothing bulk transfer. Three levels of control:
//   1. delivery  — by deliveryPublicationDatetime (--from / --to)
//   2. file      — by publication year + authority parsed from the FILENAME,
//                  which lets us skip a file without downloading it at all
//   3. record    — parse-time year filter (see the parsers), which still works
//                  even when a delivery is too coarsely chunked to filter above
//
// Filenames observed in the wild look like:
//   DOCDB-202501-Amend-PubDate20250103AndBefore-AP-0001.zip
//   ^      ^yyyyww          ^yyyymmdd            ^authority
// Parsing is deliberately tolerant: when a component cannot be read we return
// null and the caller falls back to record-level filtering rather than guessing.

import type { BddsDelivery, BddsFile, FileSliceInfo } from './types'

/** Two-letter authority code in a dash-delimited segment, e.g. "-AP-0001". */
const AUTHORITY_PATTERN = /-([A-Z]{2})-\d/
/** Explicit publication date, e.g. "PubDate20250103". */
const PUBDATE_PATTERN = /PubDate(\d{4})(\d{2})(\d{2})/i
/**
 * Year-week stamp, e.g. docdb_xml_bck_202607_031_D.zip -> 2026 week 07.
 *
 * ⚠️ THIS IS THE DELIVERY DATE, NOT PUBLICATION COVERAGE. A back-file archive
 * produced in 2026 week 07 contains publications spanning decades. Filtering
 * publication years on it would silently discard almost everything — the
 * DOCDB back file's two deliveries are stamped 2025-10 and 2026-02, so
 * `--year 2019` would match no archive at all while the 2019 publications sit
 * inside them.
 *
 * Only PUBDATE_PATTERN indicates publication coverage. Everything else is a
 * production stamp, recorded as deliveryYear and never used to skip downloads.
 */
const YEARWEEK_PATTERN = /[-_](\d{4})(\d{2})(?:[-_.]|$)/

/**
 * Files that carry no patent data: release notes, spreadsheets of authority
 * codes, and the like. Downloading and parsing these is pure waste.
 */
const NON_DATA_PATTERN = /(readme|release[-_ ]?note|coherence|statistics|\.(docx?|xlsx?|csv|pdf|txt)\s*$)/i

export function isDataFile(fileName: string): boolean {
  return !NON_DATA_PATTERN.test(String(fileName || ''))
}

function plausibleYear(year: number): boolean {
  return year >= 1782 && year <= 2100
}

/**
 * Extract slice coordinates from a delivery filename.
 * Returns nulls for anything that cannot be read with confidence.
 */
export function parseFileSliceInfo(fileName: string): FileSliceInfo {
  const name = String(fileName || '')

  const authorityMatch = name.match(AUTHORITY_PATTERN)
  const authority = authorityMatch ? authorityMatch[1] : null

  const pubDateMatch = name.match(PUBDATE_PATTERN)
  if (pubDateMatch) {
    const year = Number(pubDateMatch[1])
    if (plausibleYear(year)) {
      // "…AndBefore" means the file is an open-ended historical chunk: everything
      // up to that date, so there is no lower bound we can rely on.
      const openEnded = /andbefore/i.test(name)
      return { authority, pubYearFrom: openEnded ? null : year, pubYearTo: year, deliveryYear: null }
    }
  }

  const yearWeekMatch = name.match(YEARWEEK_PATTERN)
  if (yearWeekMatch) {
    const year = Number(yearWeekMatch[1])
    const week = Number(yearWeekMatch[2])
    if (plausibleYear(year) && week >= 1 && week <= 53) {
      // Delivery stamp only — publication years are NOT constrained by it, so
      // the pub bounds stay null and filtering falls to record level.
      return { authority, pubYearFrom: null, pubYearTo: null, deliveryYear: year }
    }
  }

  return { authority, pubYearFrom: null, pubYearTo: null, deliveryYear: null }
}

/** "14.12 EP Full-text data 2026/029" → 2026. */
const DELIVERY_YEARWEEK_PATTERN = /\b(\d{4})\/(\d{1,3})\b/

/**
 * Year from the DELIVERY name.
 *
 * EP full-text ships one ~10 GB zip per weekly delivery, and its filename
 * (EPRTBJV2026000029001001.zip) is opaque to the filename patterns above — but
 * the delivery name carries "2026/029". Since the delivery IS the file there,
 * this is what makes `--year` skip whole 10 GB downloads for that product.
 */
export function parseDeliverySliceInfo(deliveryName: string): FileSliceInfo {
  const match = String(deliveryName || '').match(DELIVERY_YEARWEEK_PATTERN)
  if (match) {
    const year = Number(match[1])
    if (plausibleYear(year)) {
      // A YYYY/WW delivery is a WEEKLY FRONT-FILE: it carries the publications
      // issued in that week, so here — unlike a back-file archive — the delivery
      // year IS the publication year and is safe to slice on. Without this,
      // `--year 2025` on EP full-text would queue all 4.5 TB instead of ~520 GB.
      return { authority: null, pubYearFrom: year, pubYearTo: year, deliveryYear: year }
    }
  }
  return { authority: null, pubYearFrom: null, pubYearTo: null, deliveryYear: null }
}

export interface SliceFilter {
  fromYear?: number | null
  toYear?: number | null
  authorities?: string[] | null
  /**
   * When a year filter is set, exclude files whose publication year cannot be
   * read from the name instead of including them for record-level filtering.
   *
   * Default false, because including is the SAFE choice — an undated file may
   * well contain the years you asked for, and dropping it silently loses data.
   * Set true when you would rather bound the transfer than be exhaustive: on EP
   * full-text it is the difference between 520 GB and 4.1 TB.
   */
  onlyDated?: boolean
  /** Delivery publication date lower/upper bounds, ISO strings. */
  from?: string | null
  to?: string | null
}

export type SkipReason =
  | 'year-out-of-range' | 'authority-excluded' | 'not-a-data-file' | 'undated'

export interface FileDecision {
  file: BddsFile
  delivery: BddsDelivery
  slice: FileSliceInfo
  include: boolean
  /** Set when include === false. */
  skipReason?: SkipReason
  /**
   * True when the filename carried no year, so this file must be downloaded and
   * filtered at record level instead. Surfaced so a run never silently claims
   * it sliced by year when it actually could not.
   */
  requiresRecordLevelFilter: boolean
}

function yearOverlaps(slice: FileSliceInfo, fromYear?: number | null, toYear?: number | null): boolean {
  if (fromYear == null && toYear == null) return true
  // Unknown year → cannot exclude; must be handled at record level.
  if (slice.pubYearFrom == null && slice.pubYearTo == null) return true
  const lower = slice.pubYearFrom ?? Number.NEGATIVE_INFINITY
  const upper = slice.pubYearTo ?? Number.POSITIVE_INFINITY
  if (toYear != null && lower > toYear) return false
  if (fromYear != null && upper < fromYear) return false
  return true
}

/** Filter deliveries by their publication datetime. */
export function selectDeliveries(deliveries: BddsDelivery[], filter: SliceFilter): BddsDelivery[] {
  return (deliveries ?? []).filter(delivery => {
    const stamp = delivery.deliveryPublicationDatetime
    if (!stamp) return true
    if (filter.from && stamp < filter.from) return false
    if (filter.to && stamp > filter.to) return false
    return true
  })
}

/**
 * Decide, per file, whether this run should download it. Files that cannot be
 * excluded on filename evidence are included with requiresRecordLevelFilter set.
 */
export function selectFiles(deliveries: BddsDelivery[], filter: SliceFilter): FileDecision[] {
  const authorities = filter.authorities?.length
    ? new Set(filter.authorities.map(value => value.toUpperCase()))
    : null

  const decisions: FileDecision[] = []
  for (const delivery of selectDeliveries(deliveries, filter)) {
    // The delivery name is the fallback year source for products whose
    // filenames are opaque (notably EP full-text).
    const deliverySlice = parseDeliverySliceInfo(delivery.deliveryName)

    for (const file of delivery.files ?? []) {
      const fileSlice = parseFileSliceInfo(file.fileName)
      const slice: FileSliceInfo =
        fileSlice.pubYearFrom == null && fileSlice.pubYearTo == null
          ? { ...deliverySlice, authority: fileSlice.authority ?? deliverySlice.authority }
          : fileSlice
      const yearUnknown = slice.pubYearFrom == null && slice.pubYearTo == null
      const yearRequested = filter.fromYear != null || filter.toYear != null

      // Release notes and spreadsheets carry no patent data.
      if (!isDataFile(file.fileName)) {
        decisions.push({
          file, delivery, slice, include: false,
          skipReason: 'not-a-data-file',
          requiresRecordLevelFilter: false,
        })
        continue
      }

      if (authorities && slice.authority && !authorities.has(slice.authority)) {
        decisions.push({
          file, delivery, slice, include: false,
          skipReason: 'authority-excluded',
          requiresRecordLevelFilter: false,
        })
        continue
      }

      if (filter.onlyDated && yearRequested && yearUnknown) {
        decisions.push({
          file, delivery, slice, include: false,
          skipReason: 'undated',
          requiresRecordLevelFilter: false,
        })
        continue
      }

      if (!yearOverlaps(slice, filter.fromYear, filter.toYear)) {
        decisions.push({
          file, delivery, slice, include: false,
          skipReason: 'year-out-of-range',
          requiresRecordLevelFilter: false,
        })
        continue
      }

      decisions.push({
        file, delivery, slice, include: true,
        requiresRecordLevelFilter: yearRequested && yearUnknown,
      })
    }
  }
  return decisions
}

export interface SelectionSummary {
  total: number
  included: number
  skipped: number
  needingRecordLevelFilter: number
  /** How many filenames yielded a usable year — the evidence for whether
   *  --year can skip downloads or only filters records. */
  withParsedYear: number
  withParsedAuthority: number
}

export function summarizeSelection(decisions: FileDecision[]): SelectionSummary {
  return decisions.reduce<SelectionSummary>((acc, decision) => {
    acc.total++
    if (decision.include) acc.included++
    else acc.skipped++
    if (decision.requiresRecordLevelFilter) acc.needingRecordLevelFilter++
    if (decision.slice.pubYearFrom != null || decision.slice.pubYearTo != null) acc.withParsedYear++
    if (decision.slice.authority) acc.withParsedAuthority++
    return acc
  }, {
    total: 0, included: 0, skipped: 0,
    needingRecordLevelFilter: 0, withParsedYear: 0, withParsedAuthority: 0,
  })
}
