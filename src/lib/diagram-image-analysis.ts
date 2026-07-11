export const IMPORTED_IMAGE_PENDING_DESCRIPTION =
  'Image imported from uploaded disclosure file. AI diagram reading is queued and will update this figure description when analysis completes.'

export function isPendingImportedImageDescription(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === IMPORTED_IMAGE_PENDING_DESCRIPTION
}

export function cleanFigureDescriptionForDrafting(value: unknown): string {
  if (isPendingImportedImageDescription(value)) return ''
  return typeof value === 'string' ? value : ''
}
