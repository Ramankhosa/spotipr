export function normalizePatentNumberKey(value: unknown) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim()
}

