export const IP_INDIA_PUBLIC_SEARCH_URL = 'https://iprsearch.ipindia.gov.in/PublicSearch/'
export const IP_INDIA_MAX_SEARCH_FIELDS = 16

export type IpIndiaSearchPayload = {
  source: 'patentnest'
  version: 1
  field: 'AP'
  operator: 'OR'
  applicationNumbers: string[]
  originalPatentNumbers: string[]
  createdAt: string
}

function compactPatentNumber(value: unknown) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

export function normalizeIpIndiaApplicationNumber(value: unknown) {
  let compact = compactPatentNumber(value)
  if (!compact) return null

  compact = compact.replace(/[^A-Z0-9/]/g, '')

  const directApplication = compact.match(/^(\d{6,20})$/)
  if (directApplication) return directApplication[1]

  const inPublication = compact.match(/^IN(\d{6,20})[A-Z]*$/)
  if (inPublication) return inPublication[1]

  const embeddedApplication = compact.match(/(?:^|[^0-9])(\d{10,14})(?:[A-Z]*$|[^0-9])/)
  if (embeddedApplication) return embeddedApplication[1]

  return null
}

export function normalizeIpIndiaApplicationNumbers(values: unknown[]) {
  const seen = new Set<string>()
  const results: string[] = []

  for (const value of values) {
    const normalized = normalizeIpIndiaApplicationNumber(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    results.push(normalized)
  }

  return results
}

export function buildIpIndiaSearchPayload(values: unknown[], now = new Date()) {
  const originalPatentNumbers = values
    .map(value => compactPatentNumber(value))
    .filter(Boolean)

  const applicationNumbers = normalizeIpIndiaApplicationNumbers(originalPatentNumbers)
    .slice(0, IP_INDIA_MAX_SEARCH_FIELDS)

  if (!applicationNumbers.length) return null

  return {
    source: 'patentnest',
    version: 1,
    field: 'AP',
    operator: 'OR',
    applicationNumbers,
    originalPatentNumbers,
    createdAt: now.toISOString(),
  } satisfies IpIndiaSearchPayload
}

export function buildIpIndiaSearchUrl(values: unknown[], now = new Date()) {
  const payload = buildIpIndiaSearchPayload(values, now)
  if (!payload) return null
  return `${IP_INDIA_PUBLIC_SEARCH_URL}#patentnest=${encodeURIComponent(JSON.stringify(payload))}`
}

export function canonicalIndianPublicationFromApplicationNumber(applicationNumber: unknown) {
  const normalized = normalizeIpIndiaApplicationNumber(applicationNumber)
  return normalized ? `IN${normalized}A` : null
}
