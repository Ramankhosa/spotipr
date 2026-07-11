// Per-provider HTTP timeouts (milliseconds).
//
// These bound a single provider HTTP call so a hung/stalled connection cannot pin a
// worker forever (there is no retry/fallback once a call hangs). They are sized
// GENEROUSLY for the heaviest stages — full patent-section drafting, multi-jurisdiction
// generation, and extended-thinking / high-reasoning-effort calls — so a legitimately
// slow response is never cut off. Reasoning-capable providers (Claude extended thinking,
// GPT-5 / o-series reasoning) get the longest ceilings.
//
// Safe to exceed the worker's base job-lock window: long-running jobs refresh their lock
// via a 60s heartbeat (withHeartbeat), so the job is not reclaimed while a call is in flight.
//
// Resolution order (highest priority first):
//   1. Explicit ProviderConfig.timeout (if a caller sets it)
//   2. Provider-specific env var (e.g. ANTHROPIC_TIMEOUT_MS)
//   3. Global override env var LLM_PROVIDER_TIMEOUT_MS (applies to all providers)
//   4. The provider default below

const MINUTES = 60_000

function resolve(specificEnvName: string, fallbackMs: number): number {
  const specific = Number(process.env[specificEnvName])
  if (Number.isFinite(specific) && specific > 0) return specific
  const global = Number(process.env.LLM_PROVIDER_TIMEOUT_MS)
  if (Number.isFinite(global) && global > 0) return global
  return fallbackMs
}

export const PROVIDER_TIMEOUTS = {
  // Claude Opus with extended thinking — heaviest drafting stages.
  anthropic: () => resolve('ANTHROPIC_TIMEOUT_MS', 15 * MINUTES),
  // OpenAI GPT-5 / o-series reasoning (Responses API, high reasoning effort).
  openaiReasoning: () => resolve('OPENAI_REASONING_TIMEOUT_MS', 15 * MINUTES),
  // Standard OpenAI chat completions.
  openai: () => resolve('OPENAI_TIMEOUT_MS', 10 * MINUTES),
  // Gemini 2.x/3 Pro, large context + thinking.
  gemini: () => resolve('GEMINI_TIMEOUT_MS', 10 * MINUTES),
  // DeepSeek (deepseek-reasoner can be slow).
  deepseek: () => resolve('DEEPSEEK_TIMEOUT_MS', 10 * MINUTES),
  // xAI Grok.
  grok: () => resolve('GROK_TIMEOUT_MS', 10 * MINUTES),
  // Z.AI / GLM.
  zai: () => resolve('ZAI_TIMEOUT_MS', 10 * MINUTES),
  // Groq is ultra-fast; a shorter ceiling still leaves ample headroom.
  groq: () => resolve('GROQ_TIMEOUT_MS', 3 * MINUTES),
  // Health/capability probes must fail fast.
  health: () => 10_000,
}
