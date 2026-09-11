// Whether the Claim Challenger is part of the application flow.
//
// The challenger is the opt-in adversarial review of a drafted claim set: an
// LLM raises examiner-style objections, the attorney accepts or dismisses each
// one, and a second call amends the claims. It is complete and tested, but it
// is not in use, so it is switched off rather than deleted.
//
// OFF by default. Set NEXT_PUBLIC_CLAIM_CHALLENGE_ENABLED=true to bring it
// back. The NEXT_PUBLIC_ prefix is deliberate: the same constant has to gate
// both the API handlers and the button that calls them, and Next.js only
// inlines prefixed variables into the client bundle. It is read at build time,
// so enabling it requires a rebuild, not just a restart.
//
// While this is false:
//   - the three challenge actions return 503 FEATURE_DISABLED;
//   - the Challenge button and its panel do not render;
//   - no claim-challenge code runs in any normal drafting path.
//
// Nothing else changes. `normalizedData.claimsChallenge` written by earlier
// runs stays where it is and is simply not read, and the reset path still
// clears it, so re-enabling picks up exactly where it left off.
export const CLAIM_CHALLENGE_ENABLED = process.env.NEXT_PUBLIC_CLAIM_CHALLENGE_ENABLED === 'true'
