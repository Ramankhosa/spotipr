/**
 * Inventor extraction from pasted text.
 *
 * The attorney pastes whatever they were sent — an email, a disclosure form, a table copied
 * out of Excel — and gets back structured, prefilled inventor rows. This is the difference
 * between the Filing tab being useful and being a data-entry chore.
 *
 * Two call sites share this: stage 0 (where the idea text often already carries the
 * inventor list) and the Filing tab. Same parser, same output shape, so what stage 0
 * extracted is exactly what the filing forms later render.
 *
 * The model NEVER decides what lands on a legal document. It proposes rows; the attorney
 * reviews every field in the editable table and saves. Everything the model returns is
 * re-validated and re-normalised locally, and any field it could not find comes back empty
 * rather than invented.
 */

import { llmGateway } from '../metering/gateway'
import { parseLlmJsonObject } from '../llm-json-parser'
import {
  INDIAN_PIN_RE,
  deriveNationality,
  parseAddressBlob,
  parsePersonName,
  sanitizeField,
  sanitizeText,
} from './formatting'
import type { StructuredAddress } from './types'

export interface ParsedInventor {
  honorific: string
  nameBody: string
  nationality: string
  countryOfResidence: string
  addressLine1: string
  street: string
  city: string
  state: string
  country: string
  pinCode: string
  /** Fields the model left empty or that failed local validation — highlighted for review. */
  needsReview: string[]
}

export interface InventorParseResult {
  inventors: ParsedInventor[]
  /** Model-reported notes, e.g. "two entries shared one address". Advisory only. */
  notes: string[]
}

const MAX_INPUT_CHARS = 20000

const SYSTEM_PROMPT = `You extract inventor details from text an Indian patent attorney has pasted.

The text may be an email, a disclosure form, a pasted table, or a rough list. It may also
contain unrelated content (invention descriptions, signatures, email footers) — ignore
anything that is not an inventor's personal details.

Return STRICT JSON only, no prose, no markdown fences:
{
  "inventors": [
    {
      "honorific": "Dr.",
      "nameBody": "Krishan Arora",
      "nationality": "Indian",
      "countryOfResidence": "India",
      "addressLine1": "Lovely Professional University, Jalandhar-Delhi G.T. Road",
      "street": "",
      "city": "Phagwara",
      "state": "Punjab",
      "country": "India",
      "pinCode": "144411"
    }
  ],
  "notes": ["short observations, or an empty array"]
}

Rules:
- Extract EVERY distinct person presented as an inventor. Preserve the order they appear in.
- NEVER invent a value. If the text does not state a field, return "" for it. An empty
  string is always better than a guess — the attorney will fill the gap.
- "honorific" holds only a title (Dr., Prof., Mr., Ms., Shri, Smt.). Keep the rest in
  "nameBody". Do not reorder the name; keep it exactly as written.
- "nationality" is the demonym ("Indian"), "countryOfResidence" is the country ("India").
  Infer nationality from an explicit statement or from an Indian address; otherwise "".
- Split addresses into the fields shown. Put the building/institution/house and road into
  "addressLine1" unless a separate street line is clearly given. "pinCode" is the 6-digit
  Indian PIN when present.
- If several inventors share one address stated once, copy it to each of them and say so in
  "notes".
- Applicants, assignees, attorneys, signatories and witnesses are NOT inventors. If the text
  names an organisation as the applicant, leave it out of "inventors" and note it.`

/**
 * Ask the model for structured rows, then re-normalise and re-validate everything locally.
 * Returns rows even when the model's output is partial — a half-filled row the attorney can
 * correct beats an error message.
 */
export async function parseInventorsFromText(
  request: { headers: Record<string, string> },
  rawText: string,
  options: { defaultCountry?: string } = {}
): Promise<{ success: true; data: InventorParseResult } | { success: false; error: string }> {
  const text = sanitizeText(rawText).slice(0, MAX_INPUT_CHARS)
  if (text.length < 5) {
    return { success: false, error: 'Paste the inventor details first.' }
  }

  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'FILING_INVENTOR_PARSE',
    stageCode: 'FILING_INVENTOR_PARSE',
    prompt: `${SYSTEM_PROMPT}\n\n---\nTEXT TO EXTRACT FROM:\n${text}`,
    idempotencyKey: crypto.randomUUID(),
    metadata: { feature: 'FILING_FORMS', operation: 'inventor-parse' },
  } as Parameters<typeof llmGateway.executeLLMOperation>[1])

  if (!result.success || !result.response) {
    return { success: false, error: result.error?.message || 'The extraction service is unavailable right now.' }
  }

  const parsed = parseLlmJsonObject({
    output: result.response.output,
    metadata: result.response.metadata,
  })
  if (!parsed.ok) {
    // Truncation means the paste was too long for one pass — say so, rather than a generic
    // failure the attorney cannot act on.
    return {
      success: false,
      error: parsed.truncated
        ? 'That was too much text to read in one go. Paste the inventors in smaller batches.'
        : 'Could not read the extracted details. Try pasting a smaller section.',
    }
  }

  const payload = parsed.data as { inventors?: unknown; notes?: unknown }
  const rows = Array.isArray(payload.inventors) ? payload.inventors : []
  const notes = Array.isArray(payload.notes)
    ? payload.notes.filter((n): n is string => typeof n === 'string').slice(0, 6)
    : []

  const inventors = rows
    .slice(0, 50)
    .map(row => normaliseRow(row, options.defaultCountry || 'India'))
    .filter(inv => inv.nameBody.length > 0)

  if (!inventors.length) {
    return { success: false, error: 'No inventor names were found in that text.' }
  }

  return { success: true, data: { inventors, notes } }
}

/**
 * Re-derive every field locally rather than trusting the model's formatting. The honorific
 * split, the address decomposition and the nationality demonym all go through the same
 * functions the manual path uses, so a pasted inventor and a typed one are byte-identical
 * on the form.
 */
function normaliseRow(raw: unknown, defaultCountry: string): ParsedInventor {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (key: string) => sanitizeField(typeof row[key] === 'string' ? row[key] as string : '')

  // Re-split the name so "Dr." typed into nameBody still lands in honorific.
  const name = parsePersonName([str('honorific'), str('nameBody')].filter(Boolean).join(' '))

  let address: StructuredAddress = {
    addressLine1: str('addressLine1'),
    street: str('street'),
    city: str('city'),
    state: str('state'),
    country: str('country') || defaultCountry,
    pinCode: str('pinCode'),
  }

  // If the model returned the address as one blob in addressLine1, decompose it here with
  // the same parser the paste-an-address flow uses.
  if (address.addressLine1 && !address.city && !address.pinCode) {
    const reparsed = parseAddressBlob(address.addressLine1)
    if (reparsed.address.city || reparsed.address.pinCode) {
      address = { ...reparsed.address, street: address.street || reparsed.address.street }
    }
  }

  const country = address.country || defaultCountry
  const nationality = str('nationality') || deriveNationality(country)
  const countryOfResidence = str('countryOfResidence') || country

  const needsReview: string[] = []
  if (!name.nameBody) needsReview.push('nameBody')
  if (!nationality) needsReview.push('nationality')
  if (!address.addressLine1) needsReview.push('addressLine1')
  if (!address.city) needsReview.push('city')
  if (!address.state) needsReview.push('state')
  // A PIN the model produced that is not a valid Indian PIN is worse than none — flag it
  // rather than letting a plausible-looking wrong number through.
  if (!address.pinCode) {
    needsReview.push('pinCode')
  } else if (country.toLowerCase() === 'india' && !INDIAN_PIN_RE.test(address.pinCode)) {
    needsReview.push('pinCode')
  }

  return {
    honorific: name.honorific || '',
    nameBody: name.nameBody,
    nationality,
    countryOfResidence,
    addressLine1: address.addressLine1,
    street: address.street || '',
    city: address.city,
    state: address.state,
    country,
    pinCode: address.pinCode,
    needsReview,
  }
}
