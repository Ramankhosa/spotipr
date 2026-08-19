import { describe, expect, it } from 'vitest'
import { describeLaneError } from '../embedding'

/**
 * The lane's `reason` is printed in the study's coverage notes and the report.
 * These pin that a driver error never reaches the page as a driver error.
 */
describe('describeLaneError', () => {
  it('turns a Prisma statement-timeout blob into one sentence with the budget', () => {
    const error = Object.assign(
      new Error(
        '\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `57014`. Message: `ERROR: canceling statement due to statement timeout`'
      ),
      { meta: { code: '57014' } }
    )
    expect(describeLaneError(error, 25_000)).toBe('the corpus did not answer within the 25s budget')
    expect(describeLaneError(error)).toBe('the corpus did not answer within the time budget')
  })

  it('names unreachable, rate-limited and rejected providers', () => {
    expect(describeLaneError(new Error('fetch failed: ECONNREFUSED'))).toBe('the embedding service could not be reached')
    expect(describeLaneError(new Error('Request failed with status 429 rate limit'))).toBe(
      'the embedding service rate-limited the request'
    )
    expect(describeLaneError(new Error('401 Unauthorized: invalid api key'))).toBe(
      'the embedding service rejected the API key'
    )
  })

  it('falls back to the first informative line, stripped of driver decoration', () => {
    const error = new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `42883`. Message: `ERROR: function md5(integer) does not exist`')
    // Neither the "Invalid `prisma…" nor the "Raw query failed" line is shown;
    // the first remaining line is, without the driver's "Message:" prefix.
    expect(describeLaneError(error)).not.toMatch(/prisma/)
    expect(describeLaneError(new Error('Something else went wrong'))).toBe('Something else went wrong')
    expect(describeLaneError('plain string')).toBe('plain string')
  })
})
