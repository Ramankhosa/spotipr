/**
 * Throwaway probe: is OpenAI's priority service tier available on this account,
 * and what does it actually buy for a payload shaped like a figure-detail call?
 *
 * Alternates tiers so network/load drift hits both equally.
 */
import 'dotenv/config'

const KEY = process.env.OPENAI_API_KEY!
const MODEL = process.argv[2] || 'gpt-5.5'
const ROUNDS = Number(process.argv[3] || 3)

// Roughly mimics a detail prompt: a few thousand tokens of context in, a
// structured JSON reply of a couple of thousand tokens out.
const FILLER = Array.from({ length: 120 }, (_, i) =>
  `- comp-${i}: Technical Component ${i}; type=MODULE; ref=${(i + 1) * 10}; performs disclosed technical function ${i} within the irrigation control system and reports state to the controller.`,
).join('\n')

const PROMPT = `You are a patent figure detailer. Return JSON only.

COMPONENT REGISTRY:
${FILLER}

Return a JSON object {"components":[...]} listing exactly 40 entries, each
{"componentId":"comp-N","displayLabel":"three word label","role":"one sentence describing the disclosed technical role"}.
Use registry IDs comp-0 through comp-39 in order.`

async function call(tier: string | null): Promise<{ ms: number; ok: boolean; detail: string; out?: number; cached?: number }> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [{ role: 'user', content: PROMPT }],
    max_completion_tokens: 4000,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
  }
  if (tier) body.service_tier = tier
  const started = Date.now()
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - started
  if (!response.ok) return { ms, ok: false, detail: (await response.text()).slice(0, 300).replace(/\s+/g, ' ') }
  const data: any = await response.json()
  return {
    ms,
    ok: true,
    detail: `served_tier=${data.service_tier ?? 'unreported'}`,
    out: data.usage?.completion_tokens,
    cached: data.usage?.prompt_tokens_details?.cached_tokens,
  }
}

async function main() {
  console.log(`model=${MODEL} rounds=${ROUNDS}\n`)

  console.log('-- availability probe --')
  for (const tier of ['default', 'priority', 'flex']) {
    const result = await call(tier)
    console.log(`  service_tier=${tier.padEnd(8)} ${result.ok ? `OK ${result.ms}ms ${result.detail}` : `REJECTED ${result.detail}`}`)
  }

  console.log('\n-- alternating latency comparison --')
  const times: Record<string, number[]> = { default: [], priority: [] }
  for (let round = 0; round < ROUNDS; round++) {
    for (const tier of ['default', 'priority']) {
      const result = await call(tier)
      if (result.ok) {
        times[tier].push(result.ms)
        console.log(`  round ${round + 1} ${tier.padEnd(8)} ${String(result.ms).padStart(6)}ms out=${result.out} cached=${result.cached ?? 0} ${result.detail}`)
      } else {
        console.log(`  round ${round + 1} ${tier.padEnd(8)} FAILED ${result.detail}`)
      }
    }
  }

  console.log('\n-- summary --')
  for (const [tier, values] of Object.entries(times)) {
    if (!values.length) { console.log(`  ${tier}: no successful calls`); continue }
    const mean = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    console.log(`  ${tier.padEnd(8)} n=${values.length} mean=${mean}ms min=${Math.min(...values)}ms max=${Math.max(...values)}ms`)
  }
}
main().catch(e => console.error('probe failed:', e))
