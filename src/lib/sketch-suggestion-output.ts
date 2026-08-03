export type ParsedSketchSuggestionOutput = {
  suggestions: Array<{ title: string; description: string }>
  parsedCleanly: boolean
  droppedForMissingFields: number
}

/** Parse the strict JSON format, with a small legacy structured-text fallback. */
export function parseSketchSuggestionOutput(output: string): ParsedSketchSuggestionOutput {
  const suggestionText = String(output || '').trim()
  let parsedCleanly = false
  let droppedForMissingFields = 0
  let suggestions: Array<{ title: string; description: string }> = []

  try {
    const start = suggestionText.indexOf('[')
    const end = suggestionText.lastIndexOf(']')
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(suggestionText.substring(start, end + 1))
      if (Array.isArray(parsed)) {
        parsedCleanly = true
        suggestions = parsed
          .filter(item =>
            item && typeof item.title === 'string' && item.title.trim()
            && typeof item.description === 'string' && item.description.trim()
          )
          .map(item => ({
            title: item.title.trim(),
            description: item.description.trim()
          }))
        droppedForMissingFields = parsed.length - suggestions.length
      }
    }
  } catch {
    // A structured-text fallback below can still recover a useful response.
  }

  if (!parsedCleanly) {
    const regex = /(?:TITLE|Title):\s*(.+?)(?:\n|$)[\s\S]*?(?:DESCRIPTION|Description):\s*([\s\S]+?)(?=(?:TITLE|Title):|$)/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(suggestionText)) !== null) {
      if (match[1]?.trim() && match[2]?.trim()) {
        suggestions.push({
          title: match[1].trim(),
          description: match[2].trim().split('\n')[0]
        })
      }
    }
  }

  return { suggestions, parsedCleanly, droppedForMissingFields }
}

export function buildSketchSuggestionCorrectionPrompt(originalPrompt: string, malformedOutput: string): string {
  return `${originalPrompt}

CORRECTION PASS
The previous reply could not be accepted because it was malformed or omitted required fields.
Return ONLY a valid JSON array. Every item must contain non-empty string fields "title" and "description".
Do not include Markdown fences, commentary, or text before or after the array.
If no physical sketch is appropriate, return exactly [].

PREVIOUS INVALID REPLY
${malformedOutput.slice(0, 12000)}`
}
