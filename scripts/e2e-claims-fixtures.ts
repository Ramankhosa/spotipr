/**
 * End-to-end claim drafting over the real pipeline (real LLM calls).
 *
 * Drives a running dev server through the drafting API: Stage 0 normalisation,
 * the background claim strategy, then claim generation per jurisdiction, and
 * checks the office-form report and the claim text against each fixture's
 * expectations (src/lib/__tests__/fixtures/claims/*.json).
 *
 *   E2E_LLM=1 E2E_BASE_URL=http://localhost:3789 E2E_TOKEN=<jwt> E2E_PATENT_ID=<patentId> \
 *     npx tsx scripts/e2e-claims-fixtures.ts [--fixture software-scheduler] [--jurisdiction IN]
 *
 * E2E_PATENT_ID must be a patent the token's user owns (a throwaway is fine).
 * Each fixture creates its own drafting session on that patent; sessions are
 * left in place so the results can be inspected in the app, and their ids are
 * printed. Cost is printed per generation from the response's token count.
 */
import fs from 'fs'
import path from 'path'

type Expectation = {
  maxBlocking?: number
  noCodes?: string[]
  textMustContain?: string[]
  textMustNotContain?: string[]
  categories?: string[]
  verbatimTerms?: string[]
}

type Fixture = {
  id: string
  title: string
  rawIdea: string
  allowRefine?: boolean
  patentTypePrimary?: string
  jurisdictions: string[]
  expect: Record<string, Expectation>
}

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3789'
const TOKEN = process.env.E2E_TOKEN || ''
const PATENT_ID = process.env.E2E_PATENT_ID || ''

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function api(body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${BASE_URL}/api/patents/${PATENT_ID}/drafting`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${body.action} → HTTP ${response.status}: ${json?.error || JSON.stringify(json).slice(0, 300)}`)
  return json
}

async function createSession(): Promise<string> {
  // start_session returns the patent's open session or creates one; the
  // jurisdiction is passed per generate_claims call below.
  const created = await api({ action: 'start_session' })
  const id = created?.session?.id
  if (!id) throw new Error('could not start a drafting session; pass an existing one via E2E_SESSION_ID')
  return id
}

function check(label: string, ok: boolean, detail = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

async function runFixture(fixture: Fixture, only?: string): Promise<boolean> {
  console.log(`\n=== ${fixture.id}: ${fixture.title}`)
  const sessionId = process.env.E2E_SESSION_ID || await createSession()
  console.log(`session ${sessionId}`)

  await api({
    action: 'normalize_idea',
    sessionId,
    title: fixture.title,
    rawIdea: fixture.rawIdea,
    allowRefine: fixture.allowRefine !== false,
  })
  if (fixture.patentTypePrimary) {
    await api({ action: 'update_patent_type', sessionId, patentType: fixture.patentTypePrimary })
  }
  // Give the background strategy a head start; the claims stage falls back to
  // planning inline if it is not ready, which the progress log would show.
  await new Promise(resolve => setTimeout(resolve, 45_000))

  let allOk = true
  for (const jurisdiction of fixture.jurisdictions) {
    if (only && only !== jurisdiction) continue
    console.log(`\n--- ${jurisdiction}`)
    const started = Date.now()
    const result = await api({ action: 'generate_claims', sessionId, jurisdiction, userClaimRemarks: '' })
    const seconds = Math.round((Date.now() - started) / 1000)
    const claims: Array<{ number: number; text: string; category?: string; type?: string }> = result.claims || []
    const report = result.claimFormReport || { findings: [], repair: null }
    const text = claims.map(claim => claim.text).join('\n').toLowerCase()
    const codes = new Set((report.findings || []).map((finding: any) => finding.code))
    const blocking = (report.findings || []).filter((finding: any) => finding.severity === 'block')

    console.log(`${claims.length} claims in ${seconds}s, ${result.tokensUsed || '?'} tokens, jurisdiction used: ${result.jurisdiction}${result.warnings?.length ? ` (warnings: ${result.warnings.map((w: any) => w.code).join(',')})` : ''}`)
    console.log(`findings: ${(report.findings || []).length} (${blocking.length} blocking); repair: ${report.repair?.attempted ? `${report.repair.resolvedFindingIds.length} resolved / ${report.repair.unresolvedFindingIds.length} unresolved${report.repair.refusalReason ? `; refused: ${report.repair.refusalReason}` : ''}` : 'not needed'}`)
    for (const claim of claims) console.log(`  ${claim.number}. [${claim.category || '?'}] ${claim.text.slice(0, 160)}${claim.text.length > 160 ? '…' : ''}`)
    for (const finding of report.findings || []) console.log(`  • ${finding.severity.toUpperCase()} ${finding.code} claim ${finding.claimNumber ?? 'set'}: ${finding.message}`)

    const expectation = fixture.expect[jurisdiction] || {}
    let ok = true
    if (typeof expectation.maxBlocking === 'number') ok = check(`blocking findings ≤ ${expectation.maxBlocking}`, blocking.length <= expectation.maxBlocking, `${blocking.length}`) && ok
    for (const code of expectation.noCodes || []) ok = check(`no ${code}`, !codes.has(code)) && ok
    for (const needle of expectation.textMustContain || []) ok = check(`text contains "${needle}"`, text.includes(needle.toLowerCase())) && ok
    for (const needle of expectation.textMustNotContain || []) ok = check(`text lacks "${needle}"`, !text.includes(needle.toLowerCase())) && ok
    for (const category of expectation.categories || []) ok = check(`has a ${category} claim`, claims.some(claim => claim.category === category)) && ok
    for (const term of expectation.verbatimTerms || []) ok = check(`keeps "${term}" verbatim`, text.includes(term.toLowerCase())) && ok
    allOk = allOk && ok
  }
  return allOk
}

async function main() {
  if (process.env.E2E_LLM !== '1') {
    console.log('Set E2E_LLM=1 to run (real LLM calls). Nothing executed.')
    return
  }
  if (!TOKEN || !PATENT_ID) {
    console.error('E2E_TOKEN and E2E_PATENT_ID are required.')
    process.exit(1)
  }
  const dir = path.join(__dirname, '..', 'src', 'lib', '__tests__', 'fixtures', 'claims')
  const wanted = arg('fixture')
  const jurisdiction = arg('jurisdiction')
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json') && (!wanted || file === `${wanted}.json`))
  if (!files.length) {
    console.error(`No fixtures found in ${dir}${wanted ? ` matching ${wanted}` : ''}.`)
    process.exit(1)
  }
  let allOk = true
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Fixture
    allOk = (await runFixture(fixture, jurisdiction)) && allOk
  }
  console.log(`\n${allOk ? 'ALL FIXTURES PASSED' : 'SOME CHECKS FAILED'}`)
  process.exit(allOk ? 0 : 2)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
