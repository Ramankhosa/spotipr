/**
 * Whitespace Studio — prompts.
 *
 * Kept apart from the service because this module accumulates one prompt per
 * pipeline stage and they are reviewed as a set. Two rules apply to all of them:
 *
 *   1. No prompt may ask a model to produce a measurement. Counts, ratios,
 *      densities and distances are computed in SQL or TypeScript. Models name,
 *      extract, synthesise and criticise — nothing else.
 *   2. No prompt may invite a legal conclusion. "Patentable", "novel",
 *      "non-obvious" and "freedom to operate" are out of scope for this product
 *      and the prompts say so explicitly rather than hoping the model abstains.
 */

import { CORPUS_FIRST_YEAR } from './types'

export const WS_SCOPE_STAGE_CODE = 'WHITESPACE_SCOPE_COMPILE'

/**
 * Turns a plain-language brief into a reviewable research scope.
 *
 * The assumptions block is the point of this prompt. Scope errors are the
 * dominant source of wrong answers in patent analytics and they are invisible
 * unless written down, so the model is required to state its interpretations
 * where a reasonable reader could have read the brief differently.
 */
export function buildScopeCompilePrompt(input: { brief: string; existingTitle?: string }): string {
  const currentYear = new Date().getFullYear()
  return `You are a patent search strategist preparing the scope for a technology landscape study.

The user described a field in their own words. Convert it into a structured, reviewable research scope. The user will read and correct this before any analysis runs, so favour making your reasoning visible over making it look complete.

USER BRIEF
"""
${input.brief.slice(0, 12000)}
"""
${input.existingTitle ? `\nWorking title: ${input.existingTitle}\n` : ''}
WHAT TO PRODUCE

1. concepts — the 3 to 6 core technical concepts. For each, give the alternative phrasings that actually appear in patent text: functional language, scientific terminology, industry jargon, common acronyms, and the phrasing a patent attorney would use to broaden a claim. This vocabulary determines what the search can see, so be generous and concrete rather than abstract. Mark a concept "required" only if a document that lacks it is certainly irrelevant.

2. classifications — 3 to 8 candidate CPC codes, each with a plain-language definition a non-specialist can check. Where a code is broad enough to pull in an adjacent unrelated field, say so in "caution". Prefer subclass or main-group level over very specific subgroups.

3. exclusions — subject matter the brief implies should be kept out, each with a short reason.

4. assumptions — THE MOST IMPORTANT FIELD. Every interpretation you made where the brief was genuinely ambiguous, written as a plain sentence the user can accept or correct. Use kind "interpretation" for these. If the brief was unambiguous throughout, return an empty list rather than inventing doubt.

5. summary — one paragraph restating the field as you understood it.

6. filters — yearFrom (never earlier than ${CORPUS_FIRST_YEAR}), yearTo (never later than ${currentYear}), and jurisdictions as two-letter country codes if and only if the brief names specific territories.

RULES
- Do not assess novelty, patentability or infringement. You are defining a search scope, not evaluating an invention.
- Do not invent CPC codes. If unsure of the exact code, give the closest one you are confident in and note the uncertainty in "caution".
- Prefer the terminology of the field over the user's terminology where they differ, and capture BOTH as synonyms.

Return ONLY a JSON object of this exact shape, with no commentary:

{
  "title": "short field title, max 12 words",
  "summary": "one paragraph",
  "concepts": [
    { "label": "concept name", "synonyms": ["alt phrasing", "..."], "required": true }
  ],
  "classifications": [
    { "code": "A61B5/1455", "definition": "plain language", "caution": "optional warning" }
  ],
  "exclusions": [ { "term": "excluded subject", "reason": "why" } ],
  "assumptions": [ { "text": "I assumed ...", "kind": "interpretation" } ],
  "filters": { "yearFrom": ${CORPUS_FIRST_YEAR}, "yearTo": ${currentYear}, "jurisdictions": [] }
}`
}

/**
 * Narrates the census into the field verdict shown at the top of the overview.
 *
 * Every number is supplied; the model's only job is to read them into prose. It
 * is told not to introduce figures precisely because a plausible invented
 * percentage is the easiest way for this screen to become untrustworthy.
 */
export function buildFieldNarrationPrompt(input: {
  title: string
  familyCount: number
  firstYear: number
  lastYear: number
  peakYear: number | null
  recentTrendPct: number | null
  topAssignees: Array<{ label: string; families: number }>
  topSharePct: number | null
  jurisdictions: Array<{ label: string; families: number }>
  claimsCoveragePct: number
}): string {
  return `You are summarising a patent landscape census for a technically literate reader.

FIELD: ${input.title}

MEASURED FACTS (these are exact; do not restate them as approximations)
- Families in scope: ${input.familyCount.toLocaleString()}
- Filing years covered: ${input.firstYear}-${input.lastYear}
- Peak filing year: ${input.peakYear ?? 'not determinable'}
- Change in filing volume over the last 5 complete years: ${
    input.recentTrendPct === null ? 'not determinable' : `${input.recentTrendPct > 0 ? '+' : ''}${input.recentTrendPct}%`
  }
- Leading assignees: ${input.topAssignees.map(a => `${a.label} (${a.families})`).join(', ') || 'not determinable'}
- Share held by the top 3 assignees: ${input.topSharePct === null ? 'not determinable' : `${input.topSharePct}%`}
- Jurisdictions: ${input.jurisdictions.map(j => `${j.label} ${j.families}`).join(', ') || 'not determinable'}
- Claim text readable for: ${input.claimsCoveragePct}% of families

WRITE
One paragraph, 3 to 5 sentences, describing what this field looks like and what a reader should notice. Lead with the most decision-relevant observation.

RULES
- Use ONLY the figures above. Do not introduce any number that is not listed, and do not round them into vagueness.
- Describe filing activity as filing activity. It is not the same as innovation: propensity to patent varies enormously by industry and firm, and a decline in filings does not establish a decline in inventive work.
- Do not identify opportunities, gaps or whitespace. That is a later stage with its own evidence. This paragraph describes what exists.
- Do not speculate about causes beyond what the figures support.
- No preamble, no headings. Return the paragraph only.`
}
