export const DRAWING_SECTION_KEYS = new Set([
  'briefdescriptionofdrawings',
  'briefdescriptionofthedrawings',
  'briefdrawings',
  'briefdescriptiondrawings',
  'drawings',
  'drawing',
  'figures',
  'figuredescriptions'
])

export function normalizeFigureSectionKey(key: unknown): string {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function isDrawingSectionKey(key: unknown): boolean {
  return DRAWING_SECTION_KEYS.has(normalizeFigureSectionKey(key))
}

export function areFiguresSkipped(session: unknown): boolean {
  return !!(session && typeof session === 'object' && (session as any).figuresSkipped === true)
}

export function shouldSuppressFigureContext(session: unknown): boolean {
  return areFiguresSkipped(session)
}

export function shouldOmitDrawingSections(session: unknown): boolean {
  return areFiguresSkipped(session)
}

export function getEffectiveFigures<T>(session: unknown, figures: T[] | null | undefined): T[] {
  if (areFiguresSkipped(session)) return []
  return Array.isArray(figures) ? figures : []
}

export function filterDrawingSections<T>(
  session: unknown,
  sections: T[] | null | undefined,
  getKey: (section: T) => unknown
): T[] {
  const list = Array.isArray(sections) ? sections : []
  if (!shouldOmitDrawingSections(session)) return list
  return list.filter(section => !isDrawingSectionKey(getKey(section)))
}

export function filterDrawingSectionKeys<T extends string>(
  session: unknown,
  sectionKeys: T[] | null | undefined
): T[] {
  const list = Array.isArray(sectionKeys) ? sectionKeys : []
  if (!shouldOmitDrawingSections(session)) return list
  return list.filter(key => !isDrawingSectionKey(key))
}

export function buildFigurelessDraftGuard(): string {
  return [
    'The user intentionally chose to draft this patent without figures, drawings, diagrams, or sketches.',
    'Do NOT create, request, mention, or reference figure numbers, drawing sheets, diagrams, sketches, or FIG. X citations.',
    'Do NOT generate a Brief Description of Drawings section or any substitute "not applicable" drawing text.',
    'Draft the specification as a figureless text-only patent draft.'
  ].join('\n')
}
