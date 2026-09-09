// Office-form validator: deterministic, jurisdiction-aware checks over a claim
// set, run at generation time and again whenever the attorney saves.
//
// The fifteen jurisdiction-blind rules in claim-challenge-lint.ts are reused as
// they are; this module adds the checks that depend on the office (claim
// categories that do not exist there, medical and software forms, dependency
// modes, two-part form, fee thresholds) and the structural checks the
// normaliser can cure on its own.
//
// Every finding carries the statute or rule it rests on and is worded as the
// objection would be. Nothing here is the model's opinion of its own output.

import type { DraftClaim } from '@/lib/draft-claims-parser'
import { dependencyFromClaimText } from '@/lib/draft-claims-parser'
import {
  findAndOr,
  findDuplicateClaims,
  findFunctionalResultStatic,
  findImproperDependencies,
  findIndefiniteModifiers,
  findMeansPlusFunction,
  findMultiSentenceClaims,
  findNegativeLimitations,
  findOmnibusReferences,
  findOptionalLanguage,
  findPictureClaim1,
  findSequenceConflation,
  findSourceJargon,
  findTrademarks,
  referencedClaimNumbers,
  type ChallengeLintFinding,
} from '@/lib/claim-challenge-lint'
import type { ClaimRuleProfile, OfficeFormFinding, OfficeFormFix, OfficeFormSeverity } from './types'

export type OfficeFormLintContext = {
  components?: unknown
  /** Concatenated source text (raw idea + normalised fields); enables the number-support check. */
  sourceText?: string
  inventionType?: unknown
  patentTypePrimary?: string
}

type Draft = Omit<OfficeFormFinding, 'id' | 'jurisdiction'>

const SEVERITY_RANK: Record<OfficeFormSeverity, number> = { block: 0, warn: 1, info: 2 }

const STATIC_CATEGORIES = new Set(['apparatus', 'system', 'composition', 'product', 'medium', 'program', 'kit', 'compound'])
const PRODUCT_LIKE = new Set(['apparatus', 'system', 'product', 'composition', 'compound', 'kit'])

const GENERIC_NOUNS = new Set([
  'device', 'apparatus', 'system', 'method', 'process', 'composition', 'product', 'invention', 'assembly',
  'article', 'kit', 'medium', 'compound', 'formulation', 'arrangement', 'unit', 'machine',
])

const ANTECEDENT_STOPWORDS = new Set([
  'invention', 'claim', 'claims', 'method', 'system', 'apparatus', 'composition', 'device', 'step', 'steps',
  'present', 'process', 'product', 'preceding', 'previous', 'foregoing', 'following', 'same', 'first', 'second',
  'third', 'fourth', 'other', 'art', 'prior', 'like', 'group', 'range', 'order', 'form', 'case', 'use',
  'manufacture', 'preparation', 'treatment', 'weight', 'total', 'formula', 'presence', 'absence', 'ratio',
  'amount', 'basis', 'thickness', 'length', 'width', 'height', 'temperature', 'pressure', 'time', 'number',
  'surface', 'direction', 'position', 'state', 'condition', 'event', 'result', 'output', 'input',
])

const HARDWARE_ANCHOR = /\b(processor|processors|microprocessor|microcontroller|controller|circuit|circuitry|sensor|sensors|memory|actuator|transceiver|antenna|camera|display|server|computer|gpu|fpga|asic|hardware|device|machine|robot|vehicle|network interface|storage medium|electrode|motor|pump|valve|battery|transducer)\b/i

const MEDICAL_ACT = /\b(treat(?:ing|ment|s)?|therap(?:y|eutic)|diagnos(?:ing|is|e)|surg(?:ery|ical)|prophyla(?:xis|ctic)|administer(?:ing)?|dosing|curing|alleviat(?:ing|e)|prevent(?:ing|ion))\b/i
const MEDICAL_SUBJECT = /\b(subject|patient|human|humans|person|individual|animal|mammal|body|in need thereof)\b/i
const SWISS_TYPE = /\buse\s+of\b[^.;]{0,160}?\b(?:in|for)\s+the\s+(?:manufacture|preparation|production)\s+of\s+(?:a|an)\s+(?:medicament|pharmaceutical|drug|composition)/i
const FOR_USE_IN = /\bfor\s+use\s+in\b[^.;]{0,80}?\b(?:treat|therap|prevent|diagnos)/i
const USE_PREAMBLE = /^\s*(?:the\s+|a\s+|an\s+)?use\s+of\b/i
const PRODUCT_BY_PROCESS = /\b(?:obtain(?:ed|able)|produced|prepared|made|manufactured)\s+(?:by|according\s+to)\s+(?:the|a)\s+(?:method|process)\b/i
const TWO_PART_CONNECTOR = /\b(characteri[sz]ed\s+(?:in\s+that|by)|caracterizad[oa]\s+por|отличающ|其特征在于)/i
const JEPSON = /\bwherein\s+the\s+improvement\s+comprises\b/i
const OMNIBUS_CLAIM = /\bsubstantially\s+as\s+(?:herein\s+)?described\b|\bas\s+herein\s+described\b/i
const REFERENCE_SIGN = /\(\s*\d{1,4}[a-z]?\s*(?:,\s*\d{1,4}[a-z]?\s*)*\)/
const MARKUSH_OPEN = /\bgroup\s+(?:comprising|including|consisting\s+essentially\s+of)\b/i
const RESULT_ONLY = /\b(?:so\s+as\s+to|such\s+that|thereby|in\s+order\s+to|whereby)\b[^;,.]{0,80}?\b(?:improv|increas|reduc|enhanc|optimi|maximi|minimi|ensur|eliminat|achiev)/i
const CATEGORY_MIX_STATIC = /\b(?:the\s+method\s+(?:comprising|of\s+claim)|steps?\s+of\s+(?:receiving|determining|controlling|transmitting|generating|calculating)|(?:a|the)\s+user\s+(?:presses|selects|enters|inputs|operates|manually))\b/i
const NEW_FORM_TERMS = /\b(salt|ester|ether|polymorph|hydrate|solvate|isomer|enantiomer|crystalline\s+form|particle\s+size|metabolite|pure\s+form|prodrug)\b/i
const COMPOSITION_RELATIONSHIP = /\b(synerg|ratio|weight|w\/w|%|percent|release|stabil|coat|layer|matrix|particle|encapsul|bound|conjugat|configured|dispersed|dissolved|emulsi|micell|liposom|granul|nanopart|film|core|shell|ph\b|viscosity|concentration|mg|ml|molar)/i

function lower(text: string) {
  return String(text || '').toLowerCase()
}

function excerptAround(text: string, needle: string, width = 70): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return text.slice(0, width).trim()
  const start = Math.max(0, idx - Math.floor(width / 2))
  const end = Math.min(text.length, idx + needle.length + Math.floor(width / 2))
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function claimCategory(claim: DraftClaim): string {
  return String((claim as any)?.category || '').trim().toLowerCase()
}

/** Text up to the transition or the first clause break: "a control system for a vehicle". */
export function claimPreamble(text: string): string {
  const cut = lower(text).search(
    /\s*(?:,|:|;|\bcomprising\b|\bconsisting\b|\bincluding\b|\bwherein\b|\bcharacteri[sz]ed\b|\bcaracterizad|\baccording\s+to\b|\bas\s+(?:claimed|recited|defined|set\s+forth)\s+in\b|\bof\s+claims?\s+\d)/
  )
  const preamble = cut >= 0 ? String(text || '').slice(0, cut) : String(text || '')
  return preamble.trim().slice(0, 160)
}

/** The preamble's head noun phrase without article or purpose clause: "control system". */
export function preambleNounPhrase(text: string): string {
  const preamble = claimPreamble(text)
    .replace(/^\s*(?:a|an|the|said)\s+/i, '')
    .replace(/\s+(?:for|to|of|which|that|having|in|with|adapted|configured|used)\b[\s\S]*$/i, '')
    .trim()
  return preamble.split(/\s+/).slice(0, 6).join(' ')
}

function isIndependent(claim: DraftClaim): boolean {
  if (claim.type === 'independent') return true
  if (claim.type === 'dependent') return false
  return dependencyFromClaimText(claim.text) === undefined && !/^\s*(?:the|said)\s+/i.test(claim.text)
}

function singularise(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|us|is)$/.test(word)) return word
  if (/es$/.test(word) && /(sh|ch|x|z)es$/.test(word)) return word.replace(/es$/, '')
  return word.replace(/s$/, '')
}

function nounMatches(a: string, b: string): boolean {
  const left = lower(a).trim()
  const right = lower(b).trim()
  if (!left || !right) return true
  if (left === right) return true
  if (right.includes(left) || left.includes(right)) return true
  const leftHead = singularise(left.split(/\s+/).pop() || '')
  const rightHead = singularise(right.split(/\s+/).pop() || '')
  return Boolean(leftHead) && leftHead === rightHead
}

function distinctiveTokens(text: string): Set<string> {
  const stop = new Set([
    'comprising', 'wherein', 'configured', 'according', 'claim', 'claims', 'method', 'system', 'apparatus',
    'device', 'composition', 'product', 'process', 'having', 'including', 'least', 'plurality', 'thereof',
    'between', 'through', 'within', 'about', 'first', 'second', 'third', 'said', 'that', 'which', 'with',
    'from', 'into', 'onto', 'each', 'being', 'further', 'consisting', 'selected', 'group', 'least',
  ])
  return new Set(
    (lower(text).match(/\b[a-z][a-z-]{4,}\b/g) || []).filter(token => !stop.has(token))
  )
}

function extractNumbers(text: string): string[] {
  const out: string[] = []
  const stripped = String(text || '').replace(/\bclaims?\s+\d+(?:\s*(?:[-,]|to|and|or|through)\s*\d+)*/gi, ' ')
  const regex = /\b\d+(?:[.,]\d+)?\b/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(stripped)) !== null) {
    if (!out.includes(match[0])) out.push(match[0])
  }
  return out
}

function normaliseSource(text: string): string {
  return lower(text).replace(/[^a-z0-9.%/-]+/g, ' ').replace(/\s+/g, ' ')
}

// ── Basis strings ────────────────────────────────────────────────────────────

function basis(code: string, rules: ClaimRuleProfile): string {
  const j = rules.jurisdiction
  const table: Record<string, Record<string, string>> = {
    ANTECEDENT_BASIS: { US: '35 USC 112(b); MPEP 2173.05(e)', EP: 'Article 84 EPC (clarity)', IN: 'Section 10(4)(c) Patents Act 1970', CN: 'Article 26.4 Patent Law', JP: 'Article 36(6)(ii) Patent Act', KR: 'Article 42(4) Patent Act' },
    USE_CLAIM: { US: '35 USC 101 (a "use" is not a statutory category; MPEP 2173.05(q))', IN: 'Section 2(1)(j) Patents Act 1970 (an invention is a product or a process)', JP: 'Article 2(3) Patent Act (categories are product, process and process of manufacture)', KR: 'Article 2 Patent Act (categories are product and process)', CN: 'Guidelines Part II Ch. 2 (a use claim is a process claim)' },
    METHOD_OF_TREATMENT: { EP: 'Article 53(c) EPC; Article 54(4)-(5) EPC for the purpose-limited product form', UK: 'Section 4A Patents Act 1977', DE: '§2a(1) Nr. 2 PatG', IN: 'Section 3(i) Patents Act 1970', JP: 'Article 29(1) Patent Act (industrial applicability; Examination Guidelines Part III Ch. 1)', KR: 'Article 29(1) Patent Act (industrial applicability)', CN: 'Article 25(1)(iii) Patent Law', BR: 'Article 10(VIII) LPI', ZA: 'Section 25(11) Patents Act 1978', CA: 'Section 2 Patent Act (Tennessee Eastman v. Commissioner)', PCT: 'PCT Rule 39.1(iv) and Article 53(c) EPC / Section 3(i) IN in the national phase' },
    SWISS_TYPE_FORM: { EP: 'G 2/08 (OJ EPO 2010, 456): Swiss-type claims not allowed for applications filed on or after 29 January 2011', UK: 'Section 4A(3)-(4) Patents Act 1977 following G 2/08', DE: '§3(3)-(4) PatG following G 2/08', IN: 'Sections 3(d) and 3(i) Patents Act 1970 (no second medical use claims)' },
    SECOND_MEDICAL_USE: { IN: 'Sections 3(d) and 3(i) Patents Act 1970' },
    CRM_NOT_NON_TRANSITORY: { US: '35 USC 101; In re Nuijten; USPTO Kappos memorandum of 26 Jan 2010 ("non-transitory")', PCT: '35 USC 101 in the US national phase' },
    CRM_FORM_NOT_RECOMMENDED: { IN: 'Section 3(k) Patents Act 1970; CRI Guidelines' },
    PROGRAM_PER_SE: { EP: 'Article 52(2)(c) and (3) EPC; Guidelines F-IV 3.9.1', UK: 'Section 1(2)(c) Patents Act 1977', DE: '§1(3) Nr. 3, (4) PatG', IN: 'Section 3(k) Patents Act 1970', KR: 'Examination Guidelines (a program per se is not a product)', JP: 'Article 2(3)(i) Patent Act (a program is claimable as a product)', CN: 'Guidelines Part II Ch. 9' },
    ELIGIBILITY_TECHNICAL_ANCHOR: { US: '35 USC 101; Alice Corp. v. CLS Bank; MPEP 2106', EP: 'Article 52(2)-(3) EPC; T 641/00 (COMVIK)', IN: 'Section 3(k) Patents Act 1970; Ferid Allani v. Union of India', CN: 'Article 2(2) and Article 25(1)(ii) Patent Law', JP: 'Article 2(1) Patent Act', KR: 'Article 2(1) Patent Act' },
    INDEPENDENT_PER_CATEGORY_EXCEEDED: { EP: 'Rule 43(2) EPC' },
    UNITY_BREAK: { US: '35 USC 121 (restriction)', EP: 'Article 82 and Rule 44 EPC', IN: 'Section 10(5) Patents Act 1970', PCT: 'PCT Rule 13', CN: 'Article 31 Patent Law', JP: 'Article 37 Patent Act', KR: 'Article 45 Patent Act' },
    MULTIPLE_DEPENDENT_CHAIN: { US: '35 USC 112(e); 37 CFR 1.75(c); MPEP 608.01(n)', PCT: 'PCT Rule 6.4(a)', CN: 'Implementing Regulations Rule 25(2)', JP: 'Article 36(6)(iv) Patent Act; Ordinance for Enforcement Rule 24-3 (multi-multi claims prohibited from 1 April 2022)', KR: 'Enforcement Decree Article 5(6)', BR: 'INPI Normative Instruction 30/2013 §3.6', RU: 'Rospatent Requirements to the claims', EP: 'Rule 43(4) EPC (permitted here; objected to in the US, PCT, CN, JP and KR)', UK: 'Rule 12 Patents Rules 2007 (permitted here; objected to in the US, PCT, CN, JP and KR)', IN: 'Permitted before the Indian Patent Office; objected to in the US, PCT, CN, JP and KR' },
    MULTIPLE_DEPENDENCY_FORM: { US: '35 USC 112(e); MPEP 608.01(n) (alternative form only)', PCT: 'PCT Rule 6.4(a)', CN: 'Implementing Regulations Rule 25(2)', KR: 'Enforcement Decree Article 5(5)', JP: 'Ordinance for Enforcement Rule 24-3' },
    TWO_PART_FORM_MISSING: { BR: 'Article 25 LPI; INPI Normative Instruction 30/2013 (the "caracterizado por" expression is mandatory)', CN: 'Implementing Regulations Rule 22 (two-part form for independent claims)', RU: 'Rospatent Requirements to the claims (ограничительная и отличительная части)' },
    TWO_PART_FORM_DISCOURAGED: { US: 'MPEP 2129 (a Jepson preamble is an implied admission of prior art)' },
    OMNIBUS_CLAIM_EXPECTED: { ZA: 'Regulation 30, Patent Regulations 1978 (omnibus claims customary)' },
    REFERENCE_NUMERAL_FORM: { EP: 'Rule 43(7) EPC', DE: '§9(8) PatV' },
    PRODUCT_BY_PROCESS: { EP: 'Guidelines F-IV 4.12', JP: 'Supreme Court 2015 (Ju) 1204 (Pravastatin)', KR: 'Supreme Court 2011Hu927', US: 'MPEP 2113' },
    INDIAN_3D_FORM: { IN: 'Section 3(d) Patents Act 1970; Novartis v. Union of India (2013)' },
    INDIAN_3E_ADMIXTURE: { IN: 'Section 3(e) Patents Act 1970' },
    CLAIM_COUNT_OVER_FREE: { US: '37 CFR 1.16(i)', EP: 'Rule 45 EPC', IN: 'First Schedule, Patents Rules 2003', CN: 'Fee schedule (claims beyond 10)', UK: 'Patents (Fees) Rules', DE: '§2 PatKostG', AU: 'Schedule 7 Patents Regulations', CA: 'Schedule 2 Patent Rules', BR: 'INPI fee schedule', RU: 'Fee schedule' },
    INDEPENDENT_COUNT_OVER_FREE: { US: '37 CFR 1.16(h)', RU: 'Fee schedule' },
  }
  const generic: Record<string, string> = {
    NUMBERING_GAP: 'Claims must be numbered consecutively in Arabic numerals',
    DEPENDENT_PHRASE_FORM: `Customary dependent-claim form before the ${rules.office}`,
    PREAMBLE_NOUN_MISMATCH: 'A dependent claim must refer back to the subject-matter of the claim it depends on',
    OPENING_ARTICLE: 'Claim drafting convention',
    TRAILING_PERIOD: 'A claim is a single sentence ending in a period',
    CHARACTERISED_SPELLING: `House spelling before the ${rules.office}`,
    MARKUSH_OPEN_GROUP: 'A Markush group is closed: "selected from the group consisting of"',
    FORBIDDEN_PHRASE: `Phrasing objected to by the ${rules.office}`,
    ANTECEDENT_BASIS: 'Clarity: every "the/said" element needs an earlier introduction',
    USE_CLAIM: 'Use claims are not a permitted claim category',
    METHOD_OF_TREATMENT: 'Methods of medical treatment are not patentable in this office',
    SWISS_TYPE_FORM: 'Swiss-type claim form',
    SECOND_MEDICAL_USE: 'Second medical use claims',
    CRM_NOT_NON_TRANSITORY: 'A transitory signal is not a statutory medium',
    CRM_FORM_NOT_RECOMMENDED: 'Computer programme per se',
    PROGRAM_PER_SE: 'A computer program as such is excluded',
    ELIGIBILITY_TECHNICAL_ANCHOR: 'Technical character / patent-eligible subject matter',
    INDEPENDENT_PER_CATEGORY_EXCEEDED: 'One independent claim per category',
    UNITY_BREAK: 'Unity of invention',
    CATEGORY_MIX: 'Mixed statutory categories in one claim (indefiniteness; IPXL Holdings v. Amazon)',
    RESULT_ONLY_LIMITATION: 'Result to be achieved is not a technical limitation (Guidelines F-IV 4.10; MPEP 2173.05(g))',
    UNSUPPORTED_NUMBER: 'Support / written description: a value absent from the disclosure is new matter',
    TWO_PART_FORM_MISSING: 'Two-part form expected for independent claims',
    TWO_PART_FORM_DISCOURAGED: 'Two-part form discouraged',
    REFERENCE_NUMERAL_FORM: 'Reference signs',
    PRODUCT_BY_PROCESS: 'Product-by-process claims',
    OMNIBUS_CLAIM_EXPECTED: 'Omnibus claim customary',
    MULTIPLE_DEPENDENT_CHAIN: 'A multiple dependent claim depending on another multiple dependent claim (PCT Rule 6.4(a); objected to in the US, CN, JP and KR)',
    DUPLICATE_CLAIM: 'Duplicate claims',
    IMPROPER_DEPENDENCY: 'A dependent claim refers back to an earlier claim',
    CLAIM_COUNT_OVER_FREE: 'Excess-claim fees',
    INDEPENDENT_COUNT_OVER_FREE: 'Excess independent-claim fees',
  }
  return table[code]?.[j] || generic[code] || code
}

function reusedBasis(code: string, rules: ClaimRuleProfile): string {
  const j = rules.jurisdiction
  const clarity: Record<string, string> = { US: '35 USC 112(b); MPEP 2173.05', EP: 'Article 84 EPC', IN: 'Section 10(4)(c) Patents Act 1970', CN: 'Article 26.4 Patent Law', JP: 'Article 36(6)(ii) Patent Act', KR: 'Article 42(4) Patent Act', PCT: 'PCT Article 6' }
  switch (code) {
    case 'INDEFINITE_MODIFIER':
    case 'TRADEMARK':
    case 'OPTIONAL_LANGUAGE':
    case 'AND_OR':
    case 'MULTI_SENTENCE':
    case 'SOURCE_JARGON':
      return clarity[j] || 'Clarity / definiteness'
    case 'OMNIBUS_REFERENCE':
      return ({ EP: 'Rule 43(6) EPC', US: 'MPEP 2173.05(s); Ex parte Fressola', UK: 'Rule 12(6C) Patents Rules 2007', CN: 'Implementing Regulations Rule 22(3)', IN: 'Section 10(4)(c) Patents Act 1970' } as Record<string, string>)[j] || 'No reference to the description or drawings inside a claim'
    case 'MEANS_PLUS_FUNCTION':
      return ({ US: '35 USC 112(f); Williamson v. Citrix', CN: 'Guidelines Part II Ch. 2 3.2.1 (functional features)', EP: 'Guidelines F-IV 6.5' } as Record<string, string>)[j] || 'Functional claiming'
    case 'IMPROPER_DEPENDENCY':
      return ({ US: '35 USC 112(d); 37 CFR 1.75(c)', EP: 'Rule 43(3)-(4) EPC', PCT: 'PCT Rule 6.4', IN: 'Section 10(4)(c) Patents Act 1970' } as Record<string, string>)[j] || 'A dependent claim refers back to an earlier claim'
    case 'MULTIPLE_DEPENDENT_CHAIN':
      return basis('MULTIPLE_DEPENDENT_CHAIN', rules)
    case 'DUPLICATE_CLAIM':
      return ({ US: 'MPEP 706.03(k) (duplicate claims)', EP: 'Article 84 EPC (conciseness)' } as Record<string, string>)[j] || 'Duplicate claims'
    case 'NEGATIVE_LIMITATION':
      return ({ US: 'MPEP 2173.05(i)', EP: 'G 1/03, G 2/10 (disclaimers)' } as Record<string, string>)[j] || 'Negative limitation needs basis in the disclosure'
    case 'FUNCTIONAL_RESULT_STATIC':
      return 'A result recited in a product claim carries no patentable weight; recite the structure (MPEP 2114; Guidelines F-IV 4.13)'
    case 'SEQUENCE_CONFLATION':
      return 'WIPO Standard ST.26'
    case 'PICTURE_CLAIM_1':
      return 'Claim scope strategy (independent claim written at embodiment level)'
    default:
      return code
  }
}

// ── Reused rule severities ───────────────────────────────────────────────────

function reusedSeverity(code: string, rules: ClaimRuleProfile): { severity: OfficeFormSeverity; fix: OfficeFormFix } | null {
  switch (code) {
    case 'DUPLICATE_CLAIM':
      return { severity: 'block', fix: 'auto' }
    case 'IMPROPER_DEPENDENCY':
    case 'MULTI_SENTENCE':
    case 'OPTIONAL_LANGUAGE':
      return { severity: 'block', fix: 'llm' }
    case 'MULTIPLE_DEPENDENT_CHAIN':
      return rules.multiOnMultiProhibited ? { severity: 'block', fix: 'llm' } : { severity: 'info', fix: 'manual' }
    case 'OMNIBUS_REFERENCE':
      if (rules.omnibusClaims === 'forbidden') return { severity: 'block', fix: 'llm' }
      return null // permitted or customary: an omnibus reference is not a defect
    case 'MEANS_PLUS_FUNCTION':
      return ['US', 'CN'].includes(rules.jurisdiction) ? { severity: 'warn', fix: 'llm' } : { severity: 'info', fix: 'llm' }
    // Hard rejections at every office (indefiniteness; ST.26 sequence desk):
    // blocking, so the repair pass cures them when the prompt did not.
    case 'INDEFINITE_MODIFIER':
    case 'SEQUENCE_CONFLATION':
      return { severity: 'block', fix: 'llm' }
    // Jargon is blocking in an independent claim (fromChallengeLint promotes it
    // there); in a dependent claim the inventor's term is allowed and expected.
    case 'SOURCE_JARGON':
    case 'TRADEMARK':
    case 'AND_OR':
    case 'FUNCTIONAL_RESULT_STATIC':
      return { severity: 'warn', fix: 'llm' }
    case 'NEGATIVE_LIMITATION':
    case 'PICTURE_CLAIM_1':
      return { severity: 'warn', fix: 'manual' }
    default:
      return { severity: 'warn', fix: 'manual' }
  }
}

function fromChallengeLint(findings: ChallengeLintFinding[], rules: ClaimRuleProfile, claims: DraftClaim[] = []): Draft[] {
  const out: Draft[] = []
  const independentNumbers = new Set(claims.filter(isIndependent).map(claim => Number(claim.number)))
  for (const finding of findings) {
    const mapped = reusedSeverity(finding.code, rules)
    if (!mapped) continue
    if (finding.code === 'SOURCE_JARGON' && independentNumbers.has(Number(finding.claimNumber))) {
      mapped.severity = 'block'
    }
    let message = finding.message
    if (finding.code === 'MULTIPLE_DEPENDENT_CHAIN') {
      message = rules.multiOnMultiProhibited
        ? `Claim ${finding.claimNumber} is a multiple dependent claim that depends on another multiple dependent claim, which the ${rules.office} does not permit.`
        : `Claim ${finding.claimNumber} is a multiple dependent claim that depends on another multiple dependent claim; permitted here, but objected to in several other offices.`
    }
    out.push({
      code: finding.code,
      severity: mapped.severity,
      fix: mapped.fix,
      claimNumber: finding.claimNumber,
      excerpt: finding.excerpt,
      message,
      basis: reusedBasis(finding.code, rules),
    })
  }
  return out
}

// ── Office-specific and structural rules ─────────────────────────────────────

function checkNumbering(claims: DraftClaim[]): Draft[] {
  const numbers = claims.map(claim => Number(claim.number)).filter(Number.isFinite).sort((a, b) => a - b)
  const gaps = numbers.some((number, index) => number !== index + 1)
  if (!gaps) return []
  return [{
    code: 'NUMBERING_GAP',
    severity: 'block',
    fix: 'auto',
    claimNumber: null,
    excerpt: numbers.join(', '),
    message: 'The claims are not numbered consecutively from 1.',
    basis: 'Claims must be numbered consecutively in Arabic numerals (37 CFR 1.75(f); Rule 43(5) EPC; PCT Rule 6.1(b))',
  }]
}

function checkDependencyForm(claims: DraftClaim[], rules: ClaimRuleProfile): Draft[] {
  const out: Draft[] = []
  if (rules.language !== 'en') return out
  const numbers = claims.map(claim => Number(claim.number))
  for (const claim of claims) {
    const text = String(claim.text || '')
    const parent = dependencyFromClaimText(text)
    if (parent === undefined) continue
    const { multiple } = referencedClaimNumbers(text, Number(claim.number), numbers)

    // Multiple dependency mode.
    if (multiple && rules.multipleDependencyMode === 'none') {
      out.push({
        code: 'MULTIPLE_DEPENDENCY_FORM',
        severity: 'block',
        fix: 'llm',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, 'claim'),
        message: `Claim ${claim.number} depends on more than one claim; each dependent claim must refer to a single earlier claim here.`,
        basis: basis('MULTIPLE_DEPENDENCY_FORM', rules),
      })
    } else if (multiple && rules.multipleDependencyMode === 'alternative_only' && /\bclaims?\s+\d+(?:\s*,\s*\d+)*\s+and\s+\d+/i.test(text)) {
      out.push({
        code: 'MULTIPLE_DEPENDENCY_FORM',
        severity: 'block',
        fix: 'auto',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, ' and '),
        message: `Claim ${claim.number} refers to several claims conjunctively ("claims … and …"); a multiple dependent claim must refer to them in the alternative ("claim 1 or 2").`,
        basis: basis('MULTIPLE_DEPENDENCY_FORM', rules),
      })
    }

    // Dependent phrase style.
    const opening = text.slice(0, 200)
    const style = /^\s*(?:the|said)\s+[^.;,:]{0,80}?\s+of\s+(?:any\s+(?:one\s+)?of\s+)?claims?\s+\d/i.test(opening)
      ? 'of'
      : /\bas\s+claimed\s+in\b/i.test(opening)
        ? 'as_claimed_in'
        : /\baccording\s+to\b/i.test(opening)
          ? 'according_to'
          : 'other'
    const expected = rules.dependentClaimPhrase === 'characterized' ? 'according_to' : rules.dependentClaimPhrase
    if (style !== expected) {
      out.push({
        code: 'DEPENDENT_PHRASE_FORM',
        severity: 'info',
        fix: 'auto',
        claimNumber: Number(claim.number),
        excerpt: opening.slice(0, 60),
        message: `Claim ${claim.number} uses a dependent-claim phrasing that is not the customary form before the ${rules.office}.`,
        basis: basis('DEPENDENT_PHRASE_FORM', rules),
      })
    }

    // Preamble noun must match the parent's.
    const parentClaim = claims.find(candidate => Number(candidate.number) === parent)
    if (parentClaim) {
      const match = opening.match(/^\s*(?:the|said|a|an)\s+([^.;,:]{1,80}?)\s+(?:of|according\s+to|as\s+(?:claimed|recited|defined|set\s+forth)\s+in|as\s+in)\s+(?:any\s+(?:one\s+)?of\s+)?(?:the\s+)?(?:preceding\s+)?claims?\s+\d/i)
      const dependentNoun = match ? match[1].trim() : ''
      const parentNoun = preambleNounPhrase(parentClaim.text)
      if (dependentNoun && parentNoun && !nounMatches(dependentNoun, parentNoun)) {
        const dependentHead = lower(dependentNoun).split(/\s+/).pop() || ''
        out.push({
          code: 'PREAMBLE_NOUN_MISMATCH',
          severity: 'block',
          fix: GENERIC_NOUNS.has(dependentHead) || parentNoun.split(/\s+/).length <= 4 ? 'auto' : 'llm',
          claimNumber: Number(claim.number),
          excerpt: opening.slice(0, 60),
          message: `Claim ${claim.number} refers to "the ${dependentNoun}" of claim ${parent}, but claim ${parent} claims "${parentNoun}".`,
          basis: basis('PREAMBLE_NOUN_MISMATCH', rules),
        })
      }
    }
  }
  return out
}

function chainText(claim: DraftClaim, claims: DraftClaim[]): string {
  const chain: string[] = []
  const visited = new Set<number>()
  let current: DraftClaim | undefined = claim
  while (current && !visited.has(Number(current.number))) {
    visited.add(Number(current.number))
    const parent: number | undefined = current.type === 'dependent' && current.dependsOn ? Number(current.dependsOn) : dependencyFromClaimText(current.text)
    if (parent === undefined) break
    const parentClaim: DraftClaim | undefined = claims.find(candidate => Number(candidate.number) === parent)
    if (!parentClaim) break
    chain.unshift(String(parentClaim.text || ''))
    current = parentClaim
  }
  return chain.join(' ')
}

function checkAntecedentBasis(claims: DraftClaim[], rules: ClaimRuleProfile): Draft[] {
  const out: Draft[] = []
  if (rules.language !== 'en') return out
  for (const claim of claims) {
    const text = String(claim.text || '')
    const parents = chainText(claim, claims)
    const regex = /\b(?:the|said)\s+([a-z][a-z-]+(?:\s+[a-z][a-z-]+)?)\b/gi
    const reported = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const phrase = match[1].toLowerCase()
      const words = phrase.split(/\s+/)
      const head = words[words.length - 1]
      if (ANTECEDENT_STOPWORDS.has(head) || ANTECEDENT_STOPWORDS.has(words[0])) continue
      if (/^(?:of|in|on|at|to|for|by|with|from|and|or)$/.test(words[0])) continue
      const prior = `${parents} ${text.slice(0, match.index)}`.toLowerCase()
      const introduced = (candidate: string) => {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const singular = singularise(candidate).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`\\b(?:${escaped}|${singular})\\b`, 'i').test(prior)
      }
      if (introduced(phrase) || introduced(head)) continue
      if (reported.has(phrase)) continue
      reported.add(phrase)
      out.push({
        code: 'ANTECEDENT_BASIS',
        severity: 'block',
        fix: 'llm',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, match[0]),
        message: `Claim ${claim.number} refers to "${match[0]}" with no earlier "a/an ${phrase}" in the claim or the claims it depends on.`,
        basis: basis('ANTECEDENT_BASIS', rules),
      })
    }
  }
  return out
}

function checkForbiddenPhrases(claims: DraftClaim[], rules: ClaimRuleProfile): Draft[] {
  const out: Draft[] = []
  for (const claim of claims) {
    const text = String(claim.text || '')
    for (const phrase of rules.forbiddenPhrases) {
      if (!phrase || !lower(text).includes(lower(phrase))) continue
      out.push({
        code: 'FORBIDDEN_PHRASE',
        severity: 'block',
        fix: 'llm',
        claimNumber: Number(claim.number),
        excerpt: excerptAround(text, phrase),
        message: `Claim ${claim.number} contains "${phrase}", which the ${rules.office} objects to.`,
        basis: basis('FORBIDDEN_PHRASE', rules),
      })
    }
  }
  return out
}

function checkOmnibusExpected(claims: DraftClaim[], rules: ClaimRuleProfile): Draft[] {
  if (rules.omnibusClaims !== 'customary' || claims.length === 0) return []
  const present = claims.some(claim => OMNIBUS_CLAIM.test(String(claim.text || '')))
  if (present) return []
  return [{
    code: 'OMNIBUS_CLAIM_EXPECTED',
    severity: 'info',
    fix: 'manual',
    claimNumber: null,
    excerpt: '',
    message: `No omnibus claim ("… substantially as herein described with reference to the accompanying drawings") closes the set; one is customary before the ${rules.office}.`,
    basis: basis('OMNIBUS_CLAIM_EXPECTED', rules),
  }]
}

function checkCategories(claims: DraftClaim[], rules: ClaimRuleProfile, context: OfficeFormLintContext): Draft[] {
  const out: Draft[] = []
  const independents = claims.filter(isIndependent)

  for (const claim of claims) {
    const text = String(claim.text || '')
    const category = claimCategory(claim)
    const preamble = claimPreamble(text)
    const number = Number(claim.number)

    // Use claims.
    if (USE_PREAMBLE.test(text) || category === 'use') {
      if (rules.useClaims === 'not_allowed') {
        out.push({ code: 'USE_CLAIM', severity: 'block', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} is a use claim ("Use of …"), which is not a permitted claim category before the ${rules.office}; recast it as a method with steps or as a product.`, basis: basis('USE_CLAIM', rules) })
      } else if (rules.useClaims === 'allowed_as_method') {
        out.push({ code: 'USE_CLAIM', severity: 'warn', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} is a use claim; the ${rules.office} examines it as a method claim, so recite the steps of the use.`, basis: basis('USE_CLAIM', rules) })
      }
    }

    // Methods of medical treatment.
    const isMethod = category === 'method' || /\b(method|process)\b/i.test(preamble)
    if (isMethod && MEDICAL_ACT.test(text) && MEDICAL_SUBJECT.test(text) && !SWISS_TYPE.test(text)) {
      const excluded = ['for_use_only', 'swiss_type_only', 'composition_only', 'use_claim_only'].includes(rules.medicalMethodClaims)
      if (excluded) {
        const form: Record<string, string> = {
          for_use_only: 'a purpose-limited product claim ("X for use in the treatment of Y")',
          swiss_type_only: 'a Swiss-type use claim ("Use of X in the manufacture of a medicament for treating Y")',
          composition_only: 'a composition claim ("A pharmaceutical composition for treating Y, comprising X …") and its preparation process',
          use_claim_only: 'a use claim ("Use of X for treating Y")',
        }
        out.push({ code: 'METHOD_OF_TREATMENT', severity: 'block', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a method of treating or diagnosing a subject, which the ${rules.office} excludes from patentability; recast it as ${form[rules.medicalMethodClaims]}.`, basis: basis('METHOD_OF_TREATMENT', rules) })
      } else if (rules.medicalMethodClaims === 'allowed_with_for_use_mirror') {
        const mirror = claims.some(other => other !== claim && FOR_USE_IN.test(String(other.text || '')))
        if (!mirror) {
          out.push({ code: 'METHOD_OF_TREATMENT', severity: 'warn', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} is a method of treatment; it is excluded in the EP, IN, JP, KR and CN national phases, so add a purpose-limited product mirror ("X for use in the treatment of Y").`, basis: basis('METHOD_OF_TREATMENT', rules) })
        }
      }
    }

    // Swiss-type and second medical use forms.
    if (SWISS_TYPE.test(text)) {
      if (['for_use_only', 'composition_only'].includes(rules.medicalMethodClaims)) {
        out.push({ code: 'SWISS_TYPE_FORM', severity: 'block', fix: 'llm', claimNumber: number, excerpt: excerptAround(text, 'manufacture'), message: rules.medicalMethodClaims === 'for_use_only' ? `Claim ${number} uses the Swiss-type form, which the ${rules.office} no longer accepts; claim "X for use in the treatment of Y" instead.` : `Claim ${number} claims a medical use, which the ${rules.office} does not accept; claim the composition and its preparation instead.`, basis: basis('SWISS_TYPE_FORM', rules) })
      } else if (rules.useClaims === 'not_allowed') {
        out.push({ code: 'USE_CLAIM', severity: 'block', fix: 'llm', claimNumber: number, excerpt: excerptAround(text, 'use of'), message: `Claim ${number} is a Swiss-type use claim; a use is not a permitted claim category before the ${rules.office}.`, basis: basis('USE_CLAIM', rules) })
      }
    } else if (rules.medicalMethodClaims === 'composition_only' && FOR_USE_IN.test(text) && PRODUCT_LIKE.has(category)) {
      out.push({ code: 'SECOND_MEDICAL_USE', severity: 'warn', fix: 'manual', claimNumber: number, excerpt: excerptAround(text, 'for use in'), message: `Claim ${number} is drafted as a purpose-limited "for use in" claim; the ${rules.office} does not grant second-medical-use protection, so the claim must stand on its compositional distinction.`, basis: basis('SECOND_MEDICAL_USE', rules) })
    }

    // Computer-readable medium and program forms.
    if (category === 'medium') {
      if (rules.crmClaimForm === 'non_transitory_medium' && !/\bnon-transitory\b/i.test(text)) {
        out.push({ code: 'CRM_NOT_NON_TRANSITORY', severity: 'block', fix: 'auto', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a computer-readable medium without "non-transitory"; as written it reads on a transitory signal, which is not statutory subject matter.`, basis: basis('CRM_NOT_NON_TRANSITORY', rules) })
      } else if (rules.jurisdiction === 'PCT' && !/\bnon-transitory\b/i.test(text)) {
        out.push({ code: 'CRM_NOT_NON_TRANSITORY', severity: 'info', fix: 'auto', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a computer-readable medium without "non-transitory"; the US national phase will require it.`, basis: basis('CRM_NOT_NON_TRANSITORY', rules) })
      }
      if (rules.crmClaimForm === 'not_recommended') {
        out.push({ code: 'CRM_FORM_NOT_RECOMMENDED', severity: 'warn', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a computer-readable medium; before the ${rules.office} a medium claim is treated as a computer programme per se unless it is tied to hardware and a technical effect.`, basis: basis('CRM_FORM_NOT_RECOMMENDED', rules) })
      }
    }
    if (category === 'program') {
      if (rules.crmClaimForm === 'program_and_medium' && !/\b(instructions|when\s+(?:the\s+program\s+is\s+)?executed|cause(?:s)?\s+(?:the|a)\s+computer)\b/i.test(text)) {
        out.push({ code: 'PROGRAM_PER_SE', severity: 'block', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a computer program without the accepted formulation; write "A computer program comprising instructions which, when the program is executed by a computer, cause the computer to carry out the method of claim N".`, basis: basis('PROGRAM_PER_SE', rules) })
      } else if (rules.crmClaimForm === 'program_stored_in_medium' && !/\bstored\s+(?:in|on)\s+(?:a|the)\b[^.;]{0,40}\bmedium\b/i.test(text)) {
        out.push({ code: 'PROGRAM_PER_SE', severity: 'block', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a program per se; the ${rules.office} accepts only "A computer program stored in a computer-readable medium …".`, basis: basis('PROGRAM_PER_SE', rules) })
      } else if (['medium_only', 'not_recommended'].includes(rules.crmClaimForm)) {
        out.push({ code: 'PROGRAM_PER_SE', severity: rules.crmClaimForm === 'not_recommended' ? 'block' : 'warn', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} claims a computer program as such, which the ${rules.office} does not accept as a claim category; claim the method and the hardware that performs it${rules.crmClaimForm === 'medium_only' ? ', or a computer-readable medium' : ''}.`, basis: basis('PROGRAM_PER_SE', rules) })
      }
    }

    // Product-by-process wording.
    if (PRODUCT_LIKE.has(category) && PRODUCT_BY_PROCESS.test(text)) {
      out.push({ code: 'PRODUCT_BY_PROCESS', severity: rules.productByProcess === 'only_if_necessary' ? 'warn' : 'info', fix: 'manual', claimNumber: number, excerpt: excerptAround(text, 'by the'), message: rules.productByProcess === 'only_if_necessary' ? `Claim ${number} defines a product by its process of manufacture; the ${rules.office} allows this only where the product cannot be defined by its structure or composition.` : `Claim ${number} defines a product by its process of manufacture; the claim will be construed by that process, so prefer a structural or compositional definition where the disclosure gives one.`, basis: basis('PRODUCT_BY_PROCESS', rules) })
    }

    // Static claims reciting method steps or user actions.
    if (STATIC_CATEGORIES.has(category) && CATEGORY_MIX_STATIC.test(text)) {
      out.push({ code: 'CATEGORY_MIX', severity: 'warn', fix: 'llm', claimNumber: number, excerpt: excerptAround(text, (CATEGORY_MIX_STATIC.exec(text) || [''])[0]), message: `Claim ${number} is a ${category} claim that recites method steps or a user's actions; recite the structure configured to perform them, or move the steps to the method claim.`, basis: basis('CATEGORY_MIX', rules) })
    }

    // Result-only limitations.
    const resultMatch = RESULT_ONLY.exec(text)
    if (resultMatch) {
      out.push({ code: 'RESULT_ONLY_LIMITATION', severity: 'warn', fix: 'llm', claimNumber: number, excerpt: excerptAround(text, resultMatch[0].slice(0, 30)), message: `Claim ${number} recites a result to be achieved ("${resultMatch[0].trim().slice(0, 50)}…") rather than the feature that achieves it.`, basis: basis('RESULT_ONLY_LIMITATION', rules) })
    }

    // Two-part form.
    if (isIndependent(claim)) {
      if (rules.twoPartForm === 'required' && !TWO_PART_CONNECTOR.test(text)) {
        out.push({ code: 'TWO_PART_FORM_MISSING', severity: rules.language === 'pt-BR' ? 'block' : 'warn', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: rules.language === 'pt-BR' ? `Claim ${number} lacks the mandatory "caracterizado por" expression.` : `Claim ${number} is not in two-part form; the ${rules.office} expects a preamble of shared features and a characterising portion introduced by "characterized in that".`, basis: basis('TWO_PART_FORM_MISSING', rules) })
      }
      if (rules.twoPartForm === 'discouraged' && (TWO_PART_CONNECTOR.test(text) || JEPSON.test(text))) {
        out.push({ code: 'TWO_PART_FORM_DISCOURAGED', severity: 'info', fix: 'manual', claimNumber: number, excerpt: excerptAround(text, 'characteri'), message: `Claim ${number} uses two-part (Jepson) form; before the ${rules.office} the preamble is then taken as an admission of prior art.`, basis: basis('TWO_PART_FORM_DISCOURAGED', rules) })
      }
    }
    if (rules.language === 'pt-BR' && !isIndependent(claim) && !TWO_PART_CONNECTOR.test(text)) {
      out.push({ code: 'TWO_PART_FORM_MISSING', severity: 'block', fix: 'llm', claimNumber: number, excerpt: preamble.slice(0, 60), message: `Claim ${number} lacks the mandatory "caracterizado por" expression.`, basis: basis('TWO_PART_FORM_MISSING', rules) })
    }

    // Spelling of "characterised".
    if (rules.language === 'en') {
      const spelled = /characteri(s|z)(ed|ing|es)\b/i.exec(text)
      if (spelled && spelled[1].toLowerCase() !== rules.characterisedSpelling) {
        out.push({ code: 'CHARACTERISED_SPELLING', severity: 'info', fix: 'auto', claimNumber: number, excerpt: excerptAround(text, spelled[0]), message: `Claim ${number} spells "${spelled[0]}" against the house spelling for the ${rules.office}.`, basis: basis('CHARACTERISED_SPELLING', rules) })
      }
    }

    // Reference signs.
    if (rules.referenceNumerals === 'not_allowed' && REFERENCE_SIGN.test(text)) {
      out.push({ code: 'REFERENCE_NUMERAL_FORM', severity: 'warn', fix: 'manual', claimNumber: number, excerpt: excerptAround(text, (REFERENCE_SIGN.exec(text) || [''])[0]), message: `Claim ${number} contains reference numerals, which are not used in claims before the ${rules.office}.`, basis: basis('REFERENCE_NUMERAL_FORM', rules) })
    }

    // Markush groups.
    if (MARKUSH_OPEN.test(text)) {
      out.push({ code: 'MARKUSH_OPEN_GROUP', severity: 'warn', fix: 'auto', claimNumber: number, excerpt: excerptAround(text, 'group'), message: `Claim ${number} recites an open Markush group; the accepted form is "selected from the group consisting of".`, basis: basis('MARKUSH_OPEN_GROUP', rules) })
    }

    // Trailing period and opening article.
    if (!/\.\s*$/.test(text)) {
      out.push({ code: 'TRAILING_PERIOD', severity: 'info', fix: 'auto', claimNumber: number, excerpt: text.slice(-40), message: `Claim ${number} does not end with a period.`, basis: basis('TRAILING_PERIOD', rules) })
    }
    if (rules.language === 'en' && /^\s*[a-z]/.test(text)) {
      out.push({ code: 'OPENING_ARTICLE', severity: 'info', fix: 'auto', claimNumber: number, excerpt: text.slice(0, 40), message: `Claim ${number} does not start with a capital letter.`, basis: basis('OPENING_ARTICLE', rules) })
    }

    // India-specific pharmaceutical hooks.
    if (rules.jurisdiction === 'IN' && (category === 'compound' || category === 'composition') && NEW_FORM_TERMS.test(text)) {
      out.push({ code: 'INDIAN_3D_FORM', severity: 'info', fix: 'manual', claimNumber: number, excerpt: excerptAround(text, (NEW_FORM_TERMS.exec(text) || [''])[0]), message: `Claim ${number} claims a form of a substance (salt, polymorph, ester, isomer, particle size or the like); under s.3(d) it is the same substance as the known one unless the disclosure shows a significant enhancement of efficacy.`, basis: basis('INDIAN_3D_FORM', rules) })
    }
  }

  // Composition claims that read as a mere admixture (India).
  if (rules.jurisdiction === 'IN') {
    for (const claim of independents) {
      if (claimCategory(claim) !== 'composition') continue
      const text = String(claim.text || '')
      if (/\bcomprising\b/i.test(text) && !COMPOSITION_RELATIONSHIP.test(text)) {
        out.push({ code: 'INDIAN_3E_ADMIXTURE', severity: 'info', fix: 'manual', claimNumber: Number(claim.number), excerpt: claimPreamble(text).slice(0, 60), message: `Claim ${claim.number} lists constituents without a compositional relationship (ratio, structure, release or stability behaviour); under s.3(e) a mere admixture whose properties are the aggregate of its components is not patentable.`, basis: basis('INDIAN_3E_ADMIXTURE', rules) })
      }
    }
  }

  // One independent claim per category (EP Rule 43(2)).
  if (rules.singleIndependentPerCategory) {
    const byCategory = new Map<string, DraftClaim[]>()
    for (const claim of independents) {
      const key = claimCategory(claim) || 'unknown'
      byCategory.set(key, [...(byCategory.get(key) || []), claim])
    }
    for (const [category, group] of Array.from(byCategory.entries())) {
      if (group.length < 2) continue
      const nouns = new Set(group.map((claim: DraftClaim) => lower(preambleNounPhrase(claim.text))))
      const sameNoun = nouns.size < group.length
      for (const claim of group.slice(1)) {
        out.push({ code: 'INDEPENDENT_PER_CATEGORY_EXCEEDED', severity: sameNoun ? 'block' : 'warn', fix: 'llm', claimNumber: Number(claim.number), excerpt: claimPreamble(claim.text).slice(0, 60), message: `Claim ${claim.number} is a second independent ${category} claim; the ${rules.office} allows one independent claim per category unless the claims cover interrelated products, different uses, or alternative solutions to one problem. Make it dependent on claim ${group[0].number} or recast its category.`, basis: basis('INDEPENDENT_PER_CATEGORY_EXCEEDED', rules) })
      }
    }
  }

  // Unity: every independent claim shares Claim 1's distinctive features.
  if (independents.length > 1) {
    const first = independents[0]
    const firstTokens = distinctiveTokens(first.text)
    for (const claim of independents.slice(1)) {
      const tokens = distinctiveTokens(claim.text)
      let shared = 0
      for (const token of Array.from(tokens)) if (firstTokens.has(token)) shared += 1
      if (shared < 2) {
        out.push({ code: 'UNITY_BREAK', severity: 'warn', fix: 'manual', claimNumber: Number(claim.number), excerpt: claimPreamble(claim.text).slice(0, 60), message: `Claim ${claim.number} shares almost none of the distinguishing features of claim ${first.number}; independent claims must be linked by the same special technical features or the set lacks unity.`, basis: basis('UNITY_BREAK', rules) })
      }
    }
  }

  // Software inventions without a technical anchor.
  const inventionTypes = Array.isArray(context.inventionType)
    ? context.inventionType.map(item => String(item).toUpperCase())
    : typeof context.inventionType === 'string' ? [context.inventionType.toUpperCase()] : []
  if (inventionTypes.some(type => /SOFTWARE|AI|DATA|COMPUT/.test(type))) {
    for (const claim of independents) {
      const category = claimCategory(claim)
      if (!['method', 'system', 'apparatus', 'medium', 'program'].includes(category)) continue
      if (HARDWARE_ANCHOR.test(String(claim.text || ''))) continue
      out.push({ code: 'ELIGIBILITY_TECHNICAL_ANCHOR', severity: 'warn', fix: 'llm', claimNumber: Number(claim.number), excerpt: claimPreamble(claim.text).slice(0, 60), message: `Claim ${claim.number} recites data processing with no hardware or technical means; before the ${rules.office} the claim must show the technical effect and the technical means that produce it, or it reads as an abstract or excluded method.`, basis: basis('ELIGIBILITY_TECHNICAL_ANCHOR', rules) })
    }
  }

  return out
}

const TAUTOLOGY = /\b(?:to|so\s+as\s+to|thereby\s+to)\s+(?:form|forming|constitute|constituting|provide|providing|define|defining|produce|producing|yield|yielding)\s+(?:a|an|the|said)\s+([a-z][a-z\s-]{2,40}?)\s*\.?\s*$/i

/** An independent claim whose last clause merely restates its own preamble. */
function checkTautology(claims: DraftClaim[], rules: ClaimRuleProfile): Draft[] {
  const out: Draft[] = []
  for (const claim of claims) {
    if (!isIndependent(claim)) continue
    const text = String(claim.text || '')
    const match = TAUTOLOGY.exec(text)
    if (!match) continue
    const noun = preambleNounPhrase(text)
    if (!noun || !nounMatches(match[1], noun)) continue
    out.push({
      code: 'TAUTOLOGY',
      severity: 'warn',
      fix: 'llm',
      claimNumber: Number(claim.number),
      excerpt: excerptAround(text, match[0].trim().slice(0, 40)),
      message: `Claim ${claim.number} ends by restating its own preamble ("${match[0].trim()}"); the clause adds no limitation. Recite the structural relationship between the elements, or delete it.`,
      basis: ({ US: '35 USC 112(b); MPEP 2173.05(g)', EP: 'Article 84 EPC (conciseness)' } as Record<string, string>)[rules.jurisdiction] || 'Clarity and conciseness',
    })
  }
  return out
}

function checkNumbersAgainstSource(claims: DraftClaim[], rules: ClaimRuleProfile, context: OfficeFormLintContext): Draft[] {
  const out: Draft[] = []
  const source = normaliseSource(String(context.sourceText || ''))
  if (!source) return out
  for (const claim of claims) {
    for (const value of extractNumbers(claim.text)) {
      if (source.includes(value.toLowerCase())) continue
      out.push({ code: 'UNSUPPORTED_NUMBER', severity: 'warn', fix: 'llm', claimNumber: Number(claim.number), excerpt: excerptAround(claim.text, value), message: `Claim ${claim.number} recites the value "${value}", which does not appear in the disclosure.`, basis: basis('UNSUPPORTED_NUMBER', rules) })
    }
  }
  return out
}

function checkCounts(claims: DraftClaim[], rules: ClaimRuleProfile): Draft[] {
  const out: Draft[] = []
  const independents = claims.filter(isIndependent).length
  if (typeof rules.freeTotalClaims === 'number' && rules.freeTotalClaims > 0 && claims.length > rules.freeTotalClaims) {
    out.push({ code: 'CLAIM_COUNT_OVER_FREE', severity: 'info', fix: 'manual', claimNumber: null, excerpt: `${claims.length} claims`, message: `The set has ${claims.length} claims; ${rules.freeTotalClaims} are covered by the basic fee before the ${rules.office}, so ${claims.length - rules.freeTotalClaims} attract excess-claim fees.`, basis: basis('CLAIM_COUNT_OVER_FREE', rules) })
  }
  if (typeof rules.freeIndependentClaims === 'number' && rules.freeIndependentClaims > 0 && independents > rules.freeIndependentClaims) {
    out.push({ code: 'INDEPENDENT_COUNT_OVER_FREE', severity: 'info', fix: 'manual', claimNumber: null, excerpt: `${independents} independent claims`, message: `The set has ${independents} independent claims; ${rules.freeIndependentClaims} are covered by the basic fee before the ${rules.office}.`, basis: basis('INDEPENDENT_COUNT_OVER_FREE', rules) })
  }
  if (rules.referenceNumerals === 'recommended_if_drawings' && claims.length && !claims.some(claim => REFERENCE_SIGN.test(String(claim.text || '')))) {
    out.push({ code: 'REFERENCE_NUMERAL_FORM', severity: 'info', fix: 'manual', claimNumber: null, excerpt: '', message: `No reference signs appear in the claims; once the drawings exist, add the reference sign of each claimed feature in parentheses (they do not limit the claim).`, basis: basis('REFERENCE_NUMERAL_FORM', rules) })
  }
  return out
}

/** Runs every office-form check; returns findings ordered block → warn → info, then by claim. */
export function runOfficeFormLint(
  claims: DraftClaim[] | null | undefined,
  params: { rules: ClaimRuleProfile; context?: OfficeFormLintContext }
): OfficeFormFinding[] {
  const list = Array.isArray(claims) ? claims.filter(claim => claim && Number.isFinite(Number(claim.number))) : []
  if (!list.length) return []
  const { rules } = params
  const context = params.context || {}

  const reused: ChallengeLintFinding[] = [
    ...findIndefiniteModifiers(list),
    ...findSourceJargon(list, { components: context.components }),
    ...findPictureClaim1(list),
    ...findSequenceConflation(list),
    ...findFunctionalResultStatic(list),
    ...findOptionalLanguage(list),
    ...findTrademarks(list),
    ...findOmnibusReferences(list),
    ...findMultiSentenceClaims(list),
    ...findAndOr(list),
    ...findMeansPlusFunction(list),
    ...findImproperDependencies(list),
    ...findDuplicateClaims(list),
    ...findNegativeLimitations(list),
  ]

  const drafts: Draft[] = [
    ...checkNumbering(list),
    ...checkDependencyForm(list, rules),
    ...checkAntecedentBasis(list, rules),
    ...checkForbiddenPhrases(list, rules),
    ...checkOmnibusExpected(list, rules),
    ...checkCategories(list, rules, context),
    ...checkNumbersAgainstSource(list, rules, context),
    ...checkCounts(list, rules),
    ...fromChallengeLint(reused, rules, list),
    ...checkTautology(list, rules),
  ]

  const seen = new Set<string>()
  const unique = drafts.filter((draft) => {
    const key = `${draft.code}:${draft.claimNumber ?? 'set'}:${draft.excerpt.slice(0, 24)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  unique.sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (severity !== 0) return severity
    return (a.claimNumber ?? 0) - (b.claimNumber ?? 0)
  })

  return unique.map((draft, index) => ({ ...draft, id: `F${index + 1}`, jurisdiction: rules.jurisdiction }))
}

/** True when a finding must be cured before the set is shown as final. */
export function isBlockingFinding(finding: OfficeFormFinding): boolean {
  return finding.severity === 'block'
}
