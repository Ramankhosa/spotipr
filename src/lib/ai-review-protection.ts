type ReviewIssueLike = {
  sectionKey?: unknown
  s?: unknown
  sectionLabel?: unknown
  title?: unknown
  description?: unknown
  suggestion?: unknown
  fixPrompt?: unknown
  fix?: unknown
  message?: unknown
  suggestedFix?: unknown
  category?: unknown
  metadata?: Record<string, unknown>
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeAIReviewSectionKey(sectionKey: unknown): string {
  return textOf(sectionKey).trim().replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function isProtectedAIReviewSection(sectionKey: unknown): boolean {
  return normalizeAIReviewSectionKey(sectionKey) === 'claims'
}

function issueText(issue: ReviewIssueLike): string {
  const metadata = issue.metadata || {}
  return [
    issue.sectionKey,
    issue.s,
    issue.sectionLabel,
    issue.title,
    issue.description,
    issue.suggestion,
    issue.fixPrompt,
    issue.fix,
    issue.message,
    issue.suggestedFix,
    issue.category,
    metadata.sectionKey,
    metadata.sectionLabel,
    metadata.title,
    metadata.description,
    metadata.suggestion,
    metadata.fixPrompt,
  ].map(textOf).filter(Boolean).join(' ').toLowerCase()
}

export function isClaimMutationSuggestion(issue: ReviewIssueLike): boolean {
  const sectionKey = issue.sectionKey || issue.s || issue.metadata?.sectionKey
  if (isProtectedAIReviewSection(sectionKey)) return true

  const text = issueText(issue)
  if (!/\bclaims?\b/.test(text)) return false

  return (
    /\bin\s+claims?\s*\d*\b.{0,100}\b(?:change|amend|rewrite|renumber|re-number|revise|modify|edit|delete|remove|narrow|broaden|replace|correct|fix)\b/.test(text) ||
    /\b(?:change|amend|rewrite|renumber|re-number|revise|modify|edit|delete|remove|narrow|broaden|replace|correct|fix)\b.{0,70}\bclaims?\s*\d*\b/.test(text) ||
    /\bclaims?\s*\d+\b.{0,100}\b(?:changed|amended|rewritten|renumbered|re-numbered|revised|modified|edited|deleted|removed|narrowed|broadened|replaced|corrected|fixed)\b/.test(text) ||
    /\badd\b.{0,50}\b(?:new\s+)?(?:independent\s+|dependent\s+)?claim\b/.test(text) ||
    /\badd\b.{0,80}\b(?:limitation|element|feature)\b.{0,40}\b(?:to|into)\b.{0,20}\bclaims?\b/.test(text)
  )
}

export function isDiagramAssetMutationSuggestion(issue: ReviewIssueLike): boolean {
  let text = issueText(issue)
  if (!/\b(?:plantuml|diagram|figure|fig\.?|drawing|sketch)\b/.test(text)) return false

  text = text
    .replace(/\bbrief\s*description\s*of\s*(?:the\s*)?drawings\b/g, '')
    .replace(/\bbriefdescriptionofdrawings\b/g, '')

  return (
    /\bplantuml\b.{0,80}\b(?:change|update|modify|edit|revise|regenerate|replace|delete|remove)\b/.test(text) ||
    /\b(?:change|update|modify|edit|revise|redraw|regenerate|replace|delete|remove|add|create)\b.{0,80}\bplantuml\b/.test(text) ||
    /\b(?:change|update|modify|edit|revise|redraw|regenerate|replace|delete|remove|add|create)\b.{0,60}\b(?:figure\s*\d+\s+diagram|fig\.?\s*\d+\s+diagram|diagram\s+structure|figure\s+sequence|figure\s+content|figure\s+asset|diagram\s+asset|sketch|drawing\s+sheet)\b/.test(text) ||
    /\b(?:figure\s*\d+\s+diagram|fig\.?\s*\d+\s+diagram|diagram\s+structure|figure\s+sequence|figure\s+content|figure\s+asset|diagram\s+asset|sketch|drawing\s+sheet)\b.{0,80}\b(?:changed|updated|modified|edited|revised|redrawn|regenerated|replaced|deleted|removed|added|created)\b/.test(text)
  )
}

export function isProtectedAIReviewIssue(issue: ReviewIssueLike): boolean {
  return isClaimMutationSuggestion(issue) || isDiagramAssetMutationSuggestion(issue)
}

export function filterProtectedAIReviewIssues<T extends ReviewIssueLike>(issues: T[]): T[] {
  return issues.filter(issue => !isProtectedAIReviewIssue(issue))
}
