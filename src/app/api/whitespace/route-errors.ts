/**
 * Whitespace Studio — one error boundary for the route handlers.
 *
 * Every whitespace catch-all used to return `error.message` verbatim with 400,
 * which leaked database and gateway internals to clients and made every outage
 * read as a client mistake. The mapping now runs the other way: only errors we
 * KNOW are curated refusals keep their message and a 4xx status, and everything
 * unrecognised becomes a generic 500 with the real error logged server-side.
 */

import { NextResponse } from 'next/server'
import { isPermanentFailure } from '@/lib/whitespace/run-lease'

/** A curated refusal thrown by a route handler itself, with its status attached. */
export class WhitespaceHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'WhitespaceHttpError'
    this.status = status
  }
}

/**
 * User-facing refusals the service layer throws as bare Error, by exact
 * message. Deliberately an allowlist: a message not listed here (and not typed
 * as permanent) is treated as internal no matter how readable it looks.
 */
const EXPECTED_STATUS = new Map<string, number>([
  // convert.ts
  ['That hypothesis no longer exists.', 404],
  ['A refuted hypothesis cannot be promoted — the record shows why it was refuted.', 400],
  // service.ts — startWhitespaceRun / compileScope
  ['Scope is not runnable.', 400],
  ['Scope compiler produced no usable concepts.', 400],
  // service.ts — the executor's own param refusals, surfaced early by the runs route
  ['A deep dive needs the area to read (clusterId).', 400],
  ['Validation needs the hypothesis to attack (hypothesisId).', 400],
  // hypothesize.ts
  ['Break the field into areas first — hypotheses are proposed against measured area signals.', 400],
  ['Run signals first — the generator is only allowed to reason from measured numbers.', 400],
  ['The generator returned nothing testable. Run it again, or run deep dives first to give it rarity signals.', 400],
])

/**
 * The catch-all response for a whitespace route handler. `context` names the
 * operation in the server log, e.g. 'Run start'.
 */
export function whitespaceErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof WhitespaceHttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (error instanceof Error) {
    // Permanent errors are curated, user-facing refusals by contract: the same
    // request will refuse the same way every time, so the client caused it.
    if (isPermanentFailure(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const status = EXPECTED_STATUS.get(error.message)
    if (status) {
      return NextResponse.json({ error: error.message }, { status })
    }
  }

  console.error(`[Whitespace] ${context} failed:`, error)
  return NextResponse.json(
    { error: 'Something went wrong on our side. Try again, and contact support if it keeps happening.' },
    { status: 500 }
  )
}
