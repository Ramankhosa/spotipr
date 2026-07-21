// OAuth2 authentication against the EPO Okta tenant that fronts BDDS.
//
// CONTRACT SOURCE — the endpoint, grant type and Basic header below were taken
// from two independent working implementations that agree:
//   - patent-dev/epo-bdds            (openapi.yaml, reverse-engineered from live BDDS)
//   - max-planck-innovation-competition/go-epo-bdds
//       pkg/epo_bbds/get_authorization_token.go
// They are NOT guessed. Do not "clean up" the Basic header — see below.

import { BddsAuthError, classifyStatus, withRetry, type RetryOptions } from './http'
import type { BddsTokenResponse } from './types'

export const EPO_TOKEN_URL = 'https://login.epo.org/oauth2/aus3up3nz0N133c0V417/v1/token'
export const EPO_BDDS_BASE_URL = 'https://publication-bdds.apps.epo.org/bdds/bdds-bff-service/prod/api'

/**
 * Okta PUBLIC client id for the BDDS front-end. It identifies the client; it
 * does not authenticate a user — the user's credentials travel in the form
 * body. A published constant, not a secret (unlike EPO_USERNAME/EPO_PASSWORD).
 *
 * ⚠️ THE TWO REFERENCE CLIENTS DISAGREE, AND ONE IS WRONG. Verified live on
 * 21 Jul 2026:
 *   max-planck go-epo-bdds : "0oa3updgn7an5pMI8"    -> invalid_client
 *                             (truncated, and carries a stray "g")
 *   patent-dev  epo-bdds   : "0oa3updn7an5pMI8O417" -> WORKS
 * Every genuine EPO Okta identifier ends in "417" (cf. the authorization server
 * id aus3up3nz0N133c0V417), which is the tell. Use the patent-dev value.
 *
 * The portal's own SPA client ("0oa3up94e542v9XIX417", visible in the
 * login.epo.org authorize redirect) is a DIFFERENT, browser-only client that
 * uses authorization_code + PKCE and rejects the password grant.
 *
 * If auth ever starts failing with `invalid_client`, set EPO_BDDS_CLIENT_ID
 * rather than editing this file.
 */
const DEFAULT_BDDS_CLIENT_ID = '0oa3updn7an5pMI8O417'

function bddsClientId(): string {
  return process.env.EPO_BDDS_CLIENT_ID?.trim() || DEFAULT_BDDS_CLIENT_ID
}

/** Refresh this long before the token actually expires. */
const EXPIRY_SKEW_MS = 60_000

interface CachedToken {
  value: string
  expiresAt: number
}

let cache: CachedToken | null = null

export interface EpoCredentials {
  username: string
  password: string
}

/** Read credentials from env. Throws with an actionable message if absent. */
export function credentialsFromEnv(): EpoCredentials {
  const username = process.env.EPO_USERNAME
  const password = process.env.EPO_PASSWORD
  if (!username || !password) {
    throw new BddsAuthError(
      'EPO_USERNAME and EPO_PASSWORD must be set. Register a free account at epo.org; ' +
      'the datasets are public but the OAuth password grant still needs one.'
    )
  }
  return { username, password }
}

/** Discard the cached token. Used by tests and by a forced re-auth after 401. */
export function resetTokenCache(): void {
  cache = null
}

/**
 * Fetch a fresh bearer token. Prefer getAccessToken() — this bypasses the cache.
 */
export async function requestAccessToken(
  credentials: EpoCredentials,
  retry: RetryOptions = {}
): Promise<{ token: string; expiresInSeconds: number }> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: credentials.username,
    password: credentials.password,
    scope: 'openid',
  })

  // The client id goes in a Basic header with no secret and no colon — this
  // client is public, so the header identifies it rather than authenticating
  // it. Matches the working patent-dev implementation.
  const clientAuth = `Basic ${Buffer.from(bddsClientId()).toString('base64')}`

  return withRetry(async () => {
    const response = await fetch(EPO_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: clientAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    if (!response.ok) {
      // Surface ONLY the diagnostic codes, never the raw body — it can echo the
      // submitted username. These distinguish the failure modes that otherwise
      // all look like a bare 401:
      //   invalid_client -> the Basic client id is wrong/stale
      //   invalid_grant  -> username or password rejected
      //   E0000004       -> Okta "Authentication failed"
      //   MFA-related    -> the account has MFA, which blocks the password grant
      const detail = await response.json().then(
        (body: any) => [body?.error, body?.error_description, body?.errorCode, body?.errorSummary]
          .filter(Boolean).join(' | '),
        () => ''
      )
      throw classifyStatus(
        response.status,
        detail || '<no diagnostic returned>',
        response.headers.get('retry-after')
      )
    }

    const json = (await response.json()) as BddsTokenResponse
    if (!json?.access_token) {
      throw new BddsAuthError('Token endpoint returned no access_token')
    }
    return {
      token: `${json.token_type || 'Bearer'} ${json.access_token}`,
      expiresInSeconds: json.expires_in ?? 3600,
    }
  }, retry)
}

/**
 * Cached access token, refreshed automatically shortly before expiry.
 * Returns the full header value, e.g. "Bearer eyJ...".
 */
export async function getAccessToken(
  credentials: EpoCredentials = credentialsFromEnv(),
  retry: RetryOptions = {}
): Promise<string> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  const { token, expiresInSeconds } = await requestAccessToken(credentials, retry)
  cache = { value: token, expiresAt: now + expiresInSeconds * 1000 - EXPIRY_SKEW_MS }
  return token
}
