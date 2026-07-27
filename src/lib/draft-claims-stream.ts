// Incremental extraction of claims from a partially-streamed LLM response.
//
// The claims stage asks the model for one JSON object ({ claims, supportMatrix,
// qualityWarnings }). While that object is still arriving we cannot JSON.parse it, but we
// can still read the claims that have landed so far — including the one mid-sentence — so
// the UI can render claim text as it is written instead of after the whole call returns.
//
// This is a preview path only. The authoritative claim set is always the one produced by
// parseGeneratedClaimsPayloadFromLLMOutput() once the full response is in hand.

export type StreamingClaim = {
  number: number
  type?: 'independent' | 'dependent'
  dependsOn?: number
  category?: string
  text: string
  /** True once the claim's closing quote and object brace have both arrived. */
  complete: boolean
}

type ScannedObject = { body: string; complete: boolean }

/**
 * Walk the `claims` array from its opening bracket, returning each element's raw source.
 * The final element is returned incomplete when the buffer ends mid-object.
 */
function scanArrayObjects(source: string, bracketIndex: number): ScannedObject[] {
  const objects: ScannedObject[] = []
  let inString = false
  let escape = false
  let depth = 0
  let objectStart = -1

  for (let i = bracketIndex + 1; i < source.length; i++) {
    const ch = source[i]

    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') {
      if (depth === 0) objectStart = i
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0 && objectStart >= 0) {
        objects.push({ body: source.slice(objectStart, i + 1), complete: true })
        objectStart = -1
      }
      continue
    }
    if (ch === ']' && depth === 0) {
      return objects
    }
  }

  if (depth > 0 && objectStart >= 0) {
    objects.push({ body: source.slice(objectStart), complete: false })
  }
  return objects
}

/**
 * Decode a raw JSON string body (the bytes between the quotes), tolerating a trailing
 * half-written escape sequence at the buffer edge.
 */
function decodeJsonStringBody(body: string): string {
  const attempts = [body, body.replace(/\\u[0-9a-fA-F]{0,3}$/, ''), body.replace(/\\$/, '')]
  for (const attempt of attempts) {
    try {
      return JSON.parse(`"${attempt}"`)
    } catch {
      /* try the next repair */
    }
  }
  // Last resort: hand-decode the escapes we actually emit.
  return body
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\$/, '')
}

function tidyClaimText(text: string, number: number): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`^(?:claim\\s*)?${number}\\s*[.):\\-]\\s*`, 'i'), '')
    .trimStart()
}

function normalizeType(value: string | undefined): StreamingClaim['type'] {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('ind')) return 'independent'
  if (normalized.startsWith('dep')) return 'dependent'
  return undefined
}

function claimFromObjectBody(body: string, objectComplete: boolean, index: number): StreamingClaim | null {
  const numberMatch = body.match(/"(?:number|claimNumber)"\s*:\s*(\d+)/)
  const number = numberMatch ? Number(numberMatch[1]) : index + 1
  if (!Number.isFinite(number) || number <= 0) return null

  const typeMatch = body.match(/"(?:type|claimType)"\s*:\s*"([^"]*)"/)
  const dependsMatch = body.match(/"depends_?[Oo]n"\s*:\s*(\d+)/)
  const categoryMatch = body.match(/"category"\s*:\s*"([^"]*)"/)
  // Capture the text value whether or not its closing quote has arrived yet. The optional
  // trailing backslash absorbs an escape sequence cut in half at the buffer edge.
  const textMatch = body.match(/"(?:text|claimText)"\s*:\s*"((?:[^"\\]|\\.)*)(\\)?("|$)/)

  if (!textMatch && !numberMatch) return null

  const rawText = textMatch ? decodeJsonStringBody(textMatch[1]) : ''
  const textComplete = Boolean(textMatch && textMatch[3] === '"')
  const dependsOn = dependsMatch ? Number(dependsMatch[1]) : undefined
  const type = normalizeType(typeMatch?.[1]) || (number === 1 ? 'independent' : dependsOn ? 'dependent' : undefined)

  return {
    number,
    ...(type ? { type } : {}),
    ...(dependsOn && Number.isFinite(dependsOn) ? { dependsOn } : {}),
    ...(categoryMatch?.[1] ? { category: categoryMatch[1] } : {}),
    text: tidyClaimText(rawText, number),
    complete: objectComplete && textComplete,
  }
}

/**
 * Fallback for models that stream a numbered claim list instead of the JSON contract.
 * Only used when no `claims` array has appeared in the buffer.
 */
function claimsFromNumberedText(source: string): StreamingClaim[] {
  // Reject anything that looks like JSON so we do not mistake schema text for claims.
  if (/[{[]/.test(source.slice(0, 200))) return []

  const claims: StreamingClaim[] = []
  const regex = /(?:^|\n)\s*(?:Claim\s*)?(\d{1,3})\s*[.)]\s+([\s\S]*?)(?=(?:\n\s*(?:Claim\s*)?\d{1,3}\s*[.)]\s+)|$)/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(source)) !== null) {
    const number = Number(match[1])
    const text = (match[2] || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    claims.push({
      number,
      type: number === 1 ? 'independent' : 'dependent',
      text,
      // Everything but the trailing claim is settled; the last one is still being written.
      complete: false,
    })
  }

  return claims.map((claim, index) => ({
    ...claim,
    complete: index < claims.length - 1,
  }))
}

/**
 * Read every claim visible in a partial LLM response, newest one possibly mid-sentence.
 * Safe to call on any prefix of the response, including an empty string.
 */
export function extractStreamingClaims(raw: string): StreamingClaim[] {
  if (!raw || !raw.trim()) return []

  const keyMatch = raw.match(/"claims"\s*:\s*\[/)
  if (!keyMatch || keyMatch.index === undefined) {
    return claimsFromNumberedText(raw)
  }

  const bracketIndex = keyMatch.index + keyMatch[0].length - 1
  return scanArrayObjects(raw, bracketIndex)
    .map((object, index) => claimFromObjectBody(object.body, object.complete, index))
    .filter((claim): claim is StreamingClaim => Boolean(claim) && (claim!.text.length > 0 || claim!.complete))
}

/**
 * Diff a fresh snapshot against the previously emitted one so a stream only carries the
 * claims that actually changed.
 */
export function diffStreamingClaims(
  previous: StreamingClaim[],
  next: StreamingClaim[]
): StreamingClaim[] {
  const previousByNumber = new Map(previous.map(claim => [claim.number, claim]))
  return next.filter((claim) => {
    const before = previousByNumber.get(claim.number)
    return !before || before.text !== claim.text || before.complete !== claim.complete
  })
}
