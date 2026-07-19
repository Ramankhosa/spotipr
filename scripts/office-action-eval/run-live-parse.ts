/**
 * Office Action Studio — LIVE parse+classify against a real FER.
 *
 * Runs the actual OA_INTAKE_PARSE + OA_OBJECTION_CLASSIFY pipeline stages
 * through a REAL OpenAI model (bypassing the metering/tenant HTTP stack via a
 * direct provider adapter — for evaluation only; the app path still uses the
 * metering gateway). Prints a comparison-friendly report to check against the
 * PDF visually.
 *
 * Usage: npx tsx scripts/office-action-eval/run-live-parse.ts [fixtureFile] [model]
 *   e.g. npx tsx scripts/office-action-eval/run-live-parse.ts fer-in-01.txt gpt-4o
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { officeActionProfileSchema, type OfficeActionProfile } from '../../src/lib/office-action/oa-profile-schema'
import { parseOfficeActionDocument, cleanOfficeActionText } from '../../src/lib/office-action/oa-parser'
import { classifyObjections } from '../../src/lib/office-action/objection-classifier'
import { computeDeadlines, mostUrgentDeadline } from '../../src/lib/office-action/deadline-engine'
import type { OaGateway } from '../../src/lib/office-action/oa-llm-service'
import { OpenAIProvider } from '../../src/lib/metering/providers/openai-provider'

// --- minimal .env loader (tsx doesn't auto-load it) ---
function loadEnv() {
  try {
    const env = readFileSync(join(__dirname, '..', '..', '.env'), 'utf-8')
    for (const line of env.split('\n')) {
      const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv()

const fixture = process.argv[2] || 'fer-in-01.txt'
const model = process.argv[3] || process.env.OA_EVAL_MODEL || 'gpt-4o'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) { console.error('OPENAI_API_KEY not found in env/.env'); process.exit(1) }

const provider = new OpenAIProvider({
  apiKey,
  baseURL: 'https://api.openai.com/v1',
  model,
  timeout: 120_000
} as any)

// Adapt the provider to the OaGateway interface the pipeline expects.
const evalGateway: OaGateway = {
  async executeLLMOperation(_req, llmRequest) {
    try {
      const resp = await provider.execute(
        { prompt: llmRequest.prompt, modelClass: model, parameters: { temperature: 0 } } as any,
        { maxTokensOut: 16000 } as any
      )
      return { success: true, response: { output: resp.output } }
    } catch (e: any) {
      return { success: false, error: { message: e?.message || String(e) } }
    }
  }
}

const inProfile = JSON.parse(readFileSync(join(__dirname, '..', '..', 'Countries', 'IN.json'), 'utf-8'))
const profile: OfficeActionProfile = officeActionProfileSchema.parse(inProfile.officeActionProfile)
const rawText = readFileSync(join(__dirname, 'fixtures', fixture), 'utf-8')
const text = cleanOfficeActionText(rawText)  // strip page furniture, like ingest does

function truncate(s: string, n = 140): string {
  const one = (s || '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

async function main() {
  console.log(`\n${'='.repeat(70)}\nLIVE PARSE — ${fixture} via ${model}\n${'='.repeat(70)}`)

  console.log('\n[1] Parsing (OA_INTAKE_PARSE)…')
  const parse = await parseOfficeActionDocument(profile, text, {}, evalGateway)
  console.log(`  Instrument: ${parse.instrument.instrumentId} (confidence ${parse.instrument.confidence.toFixed(2)})`)
  if (!parse.parsed) { console.error('  PARSE FAILED:', parse.error); process.exit(1) }
  const p = parse.parsed
  console.log('\n  METADATA extracted:')
  console.log(`    Application No : ${p.applicationNumber}`)
  console.log(`    Date of dispatch/report : ${p.dateOfDispatch || p.dateOfReport}`)
  console.log(`    Date of filing : ${p.dateOfFiling}`)
  console.log(`    Applicant : ${p.applicantName}`)
  console.log(`    Examiner : ${p.examinerName}`)
  console.log(`    Controller : ${p.controllerName} <${p.controllerEmail || ''}>`)
  console.log(`    Stated due date : ${p.statedDueDate}`)

  console.log(`\n  CITATIONS (${p.citedDocuments.length}):`)
  for (const c of p.citedDocuments) {
    console.log(`    ${c.label} [${c.kind}] ${truncate(c.docNumber || '', 90)}`)
    if (c.relevantDescription) console.log(`        pinpoint: ${truncate(c.relevantDescription, 80)} | vs claims ${JSON.stringify(c.claimsOfAllegedInvention || [])}`)
  }

  console.log('\n[2] Deadlines (deterministic, from dispatch date)…')
  const deadlines = computeDeadlines(profile, 'FER', parse.triggerDates, (p.dateOfDispatch || p.dateOfReport || '').slice(0, 10) || '2026-01-01')
  for (const d of deadlines) console.log(`    ${d.id}: due ${d.dueDate}${d.extension ? ` (ext ${d.extension.extendedDueDate})` : ''} — ${d.what}${d.consequence ? ` [${d.consequence.type}]` : ''}`)
  const urgent = mostUrgentDeadline(deadlines)
  console.log(`    most urgent: ${urgent?.id} @ ${urgent?.dueDate}`)
  console.log(`    >>> cross-check: computed fer_reply == FER's stated due date? ${deadlines.find(d => d.id === 'fer_reply')?.dueDate === p.statedDueDate ? 'YES ✓' : 'NO ✗ (' + deadlines.find(d => d.id === 'fer_reply')?.dueDate + ' vs stated ' + p.statedDueDate + ')'}`)

  console.log('\n[3] Classifying objections (OA_OBJECTION_CLASSIFY)…')
  const cls = await classifyObjections(profile, p.objections, text, {}, evalGateway)
  if (!cls.success) { console.error('  CLASSIFY FAILED:', cls.error) }
  console.log(`  ${cls.objections.length} objection cards:\n`)
  for (const o of cls.objections) {
    const flag = o.quoteVerified ? 'verified ✓' : 'UNVERIFIED ✗'
    console.log(`  #${o.sortOrder} ${o.canonicalCode}${o.subTypeId ? `/${o.subTypeId}` : ''}  [${o.localBasis || '—'}]  quote:${flag}  claims:${JSON.stringify(o.claimsAffected || [])}  cites:${JSON.stringify(o.citationLabels || [])}`)
    console.log(`      “${truncate(o.examinerText, 160)}”`)
  }

  const codes = cls.objections.map(o => o.canonicalCode)
  console.log(`\n  SUMMARY: ${cls.objections.length} objections — ${Array.from(new Set(codes)).join(', ')}`)
  console.log(`  unverified quotes: ${cls.objections.filter(o => !o.quoteVerified).length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
