import type { NormalizedPatentResult, PatentSearchFilters } from './types'

export function normalizeWhitespace(value: unknown) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values.flat()) {
    const text = normalizeWhitespace(value)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

export function normalizeClassification(value: unknown) {
  const text = normalizeWhitespace(value)
    .replace(/^[:;,]+/, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
  return /^na$/i.test(text) ? '' : text.toUpperCase()
}

export function compactPatentKey(value: unknown) {
  return normalizeWhitespace(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function canonicalPublicationNumber(value: unknown) {
  const compact = compactPatentKey(value)
  if (!compact) return ''
  return compact.replace(/[A-Z]\d*$/, '')
}

export function canonicalPatentResultKey(result: NormalizedPatentResult) {
  const byNumber = canonicalPublicationNumber(
    result.publicationNumber || result.publication_number || result.pn
  )
  if (byNumber) return `pn:${byNumber}`
  const title = normalizeWhitespace(result.title).toLowerCase()
  const abstractLead = normalizeWhitespace(result.abstract || result.snippet).toLowerCase().slice(0, 160)
  return `text:${title}|${abstractLead}`
}

export function mergeFilters(base?: PatentSearchFilters, override?: PatentSearchFilters): PatentSearchFilters {
  const merged: PatentSearchFilters = { ...(base || {}), ...(override || {}) }
  merged.anyTextContains = uniqueStrings([
    ...(base?.anyTextContains || []),
    ...(override?.anyTextContains || []),
  ])
  merged.titleContains = uniqueStrings([
    ...(base?.titleContains || []),
    ...(override?.titleContains || []),
  ])
  merged.abstractContains = uniqueStrings([
    ...(base?.abstractContains || []),
    ...(override?.abstractContains || []),
  ])
  merged.patentTextContains = uniqueStrings([
    ...(base?.patentTextContains || []),
    ...(override?.patentTextContains || []),
  ])
  merged.classifications = uniqueStrings([
    ...(base?.classifications || []),
    ...(override?.classifications || []),
  ]).map(normalizeClassification).filter(Boolean)
  merged.cpcCodes = uniqueStrings([
    ...(base?.cpcCodes || []),
    ...(override?.cpcCodes || []),
  ]).map(normalizeClassification).filter(Boolean)
  merged.ipcCodes = uniqueStrings([
    ...(base?.ipcCodes || []),
    ...(override?.ipcCodes || []),
  ]).map(normalizeClassification).filter(Boolean)
  merged.applicants = uniqueStrings([
    ...(base?.applicants || []),
    ...(override?.applicants || []),
  ])
  merged.inventors = uniqueStrings([
    ...(base?.inventors || []),
    ...(override?.inventors || []),
  ])
  merged.excludeTerms = uniqueStrings([
    ...(base?.excludeTerms || []),
    ...(override?.excludeTerms || []),
  ])
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null && value !== ''
    })
  ) as PatentSearchFilters
}

export function clampLimit(limit: unknown, fallback = 20, max = 100) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), max)
}

export function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap(item => (
      typeof item === 'string' ? item.split(/[,;\n]/) : [item]
    )))
  }
  if (typeof value === 'string' && value.trim()) {
    return uniqueStrings(value.split(/[,;\n]/))
  }
  return []
}

export function yearFromDate(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.getUTCFullYear()
}
