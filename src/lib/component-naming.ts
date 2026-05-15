const ACRONYM_WORDS = new Set([
  'AI',
  'API',
  'BLE',
  'CPU',
  'DNA',
  'GPS',
  'GPU',
  'ID',
  'IoT',
  'IP',
  'LED',
  'ML',
  'NFC',
  'PCM',
  'QR',
  'RFID',
  'RNA',
  'USB',
  'WiFi',
])

const LOWERCASE_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'to', 'in', 'on', 'at', 'by', 'with'])

function cleanComponentName(value: unknown) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripDescriptorClauses(value: string) {
  const withoutLeadIns = value
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/^(?:one\s+or\s+more|a\s+plurality\s+of|plurality\s+of|multiple)\s+/i, '')
    .replace(/\bphase[-\s]?change material\b/gi, 'PCM')

  return withoutLeadIns
    .split(/\s+(?:placed|configured|adapted|arranged|operative|operable|used|using|for|to|that|which|wherein|including|comprising|having|with|based)\b/i)[0]
    .split(/[;,]/)[0]
    .trim()
}

function titleCaseToken(token: string, index: number): string {
  if (!token) return token
  const slashParts = token.split('/')
  if (slashParts.length > 1) {
    return slashParts.map((part, partIndex) => titleCaseToken(part, index + partIndex)).join(' / ')
  }
  const hyphenParts = token.split('-')
  if (hyphenParts.length > 1) {
    return hyphenParts.map((part, partIndex) => titleCaseToken(part, index + partIndex)).join('-')
  }

  const upper = token.toUpperCase()
  const canonicalAcronym = Array.from(ACRONYM_WORDS).find(word => word.toUpperCase() === upper)
  if (canonicalAcronym) return canonicalAcronym

  const lower = token.toLowerCase()
  if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function titleCaseComponentName(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((token, index) => titleCaseToken(token, index))
    .join(' ')
    .replace(/\s+\/\s+/g, ' / ')
}

function inferGroupName(value: string) {
  const lower = value.toLowerCase()
  if (/^(?:multiple|plurality of|a plurality of|one or more)\s+/.test(lower) && /\bsensors?\b/.test(lower)) {
    const sensorMatch = lower.match(/(?:multiple|plurality of|a plurality of|one or more)\s+(.+?)\s+sensors?\b/)
    const qualifier = sensorMatch?.[1]?.trim()
    return qualifier ? `${qualifier} Sensor Array` : 'Sensor Array'
  }
  return ''
}

export function normalizeComponentDisplayName(rawName: unknown, type?: unknown) {
  const original = cleanComponentName(rawName)
  if (!original) return ''

  const inferred = inferGroupName(original)
  const stripped = stripDescriptorClauses(inferred || original)
  const words = stripped.split(/\s+/).filter(Boolean)
  const clipped = words.length > 6 ? words.slice(0, 6).join(' ') : stripped
  let normalized = titleCaseComponentName(clipped)
    .replace(/\bGps\b/g, 'GPS')
    .replace(/\bQr\b/g, 'QR')
    .replace(/\bRfid\b/g, 'RFID')
    .replace(/\bPcm\b/g, 'PCM')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const componentType = cleanComponentName(type).toUpperCase()
  if (
    componentType === 'SENSOR' &&
    normalized &&
    !/\b(?:sensor|detector|accelerometer|gyroscope|camera|microphone|array)\b/i.test(normalized)
  ) {
    normalized = `${normalized} Sensor`
  }

  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64).replace(/\s+\S*$/, '').trim()
  }

  return normalized || titleCaseComponentName(original)
}
