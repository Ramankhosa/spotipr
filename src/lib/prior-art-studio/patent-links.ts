// Google Patents links. The corpus stores publication numbers DOCDB-style
// (US-2025178928-A1), but patents.google.com expects the compact form with the
// US pre-grant serial zero-padded to seven digits (US20250178928A1) — the
// plain dash-stripped DOCDB number 404s. Pure helpers, safe on client and
// server; shared by the studio components and the export routes.

const US_PREGRANT = /^US((?:19|20)\d{2})(\d{6})([A-Z]\d?)?$/

export function googlePatentsId(publicationNumber: string): string {
  const compact = publicationNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const pregrant = compact.match(US_PREGRANT)
  if (pregrant) {
    const [, year, serial, kind] = pregrant
    return `US${year}0${serial}${kind || ''}`
  }
  return compact
}

export function googlePatentsUrl(publicationNumber: string): string {
  return `https://patents.google.com/patent/${googlePatentsId(publicationNumber)}`
}

// Corpus rows historically stored a patents.google.com link built from the raw
// hyphenated number, which 404s — trust `link` only when it points somewhere
// else (a genuine external source such as PQAI or IPO India).
export function resolvePatentLink(family: { publicationNumber: string; link?: string | null }): string {
  if (family.link && !/patents\.google\.com/i.test(family.link)) return family.link
  return googlePatentsUrl(family.publicationNumber)
}
