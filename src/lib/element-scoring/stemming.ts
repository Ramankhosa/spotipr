// Client-safe suffix normalisation, shared by element scoring (server) and the
// reader's term highlighting (browser).
//
// Split out of element-scoring.ts for the same reason element-math.ts was: that
// module imports prisma and the corpus embedding service, which pulls adm-zip
// and fs into anything that imports a VALUE from it. A 'use client' component
// importing the stemmer from there breaks `next build`. This file must import
// NOTHING — keep it that way.
//
// Why stemming at all: literal coverage used to be a raw substring test, so
// "rotating" did not match "rotates", "coupled" did not match "coupling", and
// "housing" did not match "houses" — the ordinary way claim language and
// specification language differ. Under-reported coverage feeds straight into the
// element verdict, so the grid said WEAK for documents that use the attorney's
// own words.
//
// This is a deliberately small, deterministic stemmer, not linguistics: strip a
// known suffix while leaving at least four characters, twice, then drop a
// trailing e/y/i. Both sides of every comparison go through it, so the only
// property that matters is that it is consistent.

const STEM_SUFFIXES = [
  'izations', 'ational', 'ization', 'ations', 'ation', 'izing', 'ized', 'izes', 'ised', 'ising',
  'ises', 'ings', 'ment', 'ness', 'able', 'ible', 'ing', 'ion', 'ers', 'est', 'ies', 'ied',
  'ed', 'es', 'er', 'or', 'ly', 's',
]

function stemOnce(word: string): string {
  for (const suffix of STEM_SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length)
    }
  }
  return word
}

export function stemTerm(word: string): string {
  let stem = stemOnce(stemOnce(word))
  if (stem.length > 4 && /[eyi]$/.test(stem)) stem = stem.slice(0, -1)
  return stem
}

/** Every distinct stem in a body of text — the set literal coverage is tested against. */
export function stemSet(text: string): Set<string> {
  const stems = new Set<string>()
  for (const token of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    const word = token.trim()
    if (word.length < 2) continue
    stems.add(stemTerm(word))
  }
  return stems
}

export const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'upon', 'said', 'which', 'wherein',
  'having', 'have', 'has', 'are', 'was', 'were', 'being', 'been', 'configured', 'adapted', 'least', 'one',
  'comprising', 'including', 'includes', 'include', 'plurality', 'first', 'second', 'third', 'each', 'such',
  'when', 'while', 'thereof', 'therein', 'whereby', 'about', 'between', 'within', 'through', 'other',
])

/**
 * Significant words of an element — what "literal coverage" is measured over.
 *
 * Acronyms are kept below the length floor: "RF", "LED", "CPU", "PWM" are often
 * the single most decisive word in an element, and a four-character minimum
 * dropped every one of them.
 */
export function elementTerms(text: string): string[] {
  // Claims are sometimes written in full caps, where "capitalised short word"
  // stops meaning "acronym" and this would admit every stopword-sized token.
  const letters = text.replace(/[^A-Za-z]/g, '')
  const shouty = letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7
  const acronyms = shouty ? [] : (text.match(/\b[A-Z]{2,6}\b/g) || []).map(a => a.toLowerCase())
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))
  return Array.from(new Set([...acronyms, ...words].filter(w => !STOPWORDS.has(w)))).slice(0, 12)
}
