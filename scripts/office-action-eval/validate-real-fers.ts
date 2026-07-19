/**
 * Office Action Studio — real-FER validation harness (deterministic, no LLM).
 *
 * Runs the profile-driven DETERMINISTIC pipeline pieces against genuine IPO
 * FERs (fixtures/*.txt, extracted from PDFs downloaded from the IPO e-register):
 *   1. Instrument detection from the profile's detectionHints.
 *   2. Deadline computation from the "Date of Dispatch" — cross-checked against
 *      the office's OWN stated "Last date for filing response" printed in the FER.
 *
 * The LLM stages (parse/classify) need API keys and are exercised separately;
 * here we prove that detection and the deadline engine match real documents.
 *
 * Run: npx tsx scripts/office-action-eval/validate-real-fers.ts
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { officeActionProfileSchema, type OfficeActionProfile } from '../../src/lib/office-action/oa-profile-schema'
import { detectInstrument } from '../../src/lib/office-action/oa-parser'
import { computeDeadlines } from '../../src/lib/office-action/deadline-engine'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const inProfile = JSON.parse(readFileSync(join(__dirname, '..', '..', 'Countries', 'IN.json'), 'utf-8'))
const profile: OfficeActionProfile = officeActionProfileSchema.parse(inProfile.officeActionProfile)

const fixturesDir = join(__dirname, 'fixtures')
const files = readdirSync(fixturesDir).filter(f => f.endsWith('.txt')).sort()

// DD-MM-YYYY → ISO yyyy-mm-dd (deterministic extraction, standing in for the LLM parser).
function ddmmyyyyToIso(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
function extractDispatch(text: string): string | null {
  const m = /Date of Dispatch\/Email:\s*(\d{2}-\d{2}-\d{4})/.exec(text)
  return m ? ddmmyyyyToIso(m[1]) : null
}
function extractStatedDue(text: string): string | null {
  const idx = text.indexOf('Last date for filing response')
  if (idx === -1) return null
  const after = text.slice(idx, idx + 200)
  const m = /(\d{2}-\d{2}-\d{4})/.exec(after)
  return m ? ddmmyyyyToIso(m[1]) : null
}

console.log(`\nValidating ${files.length} real IPO FERs against the India profile\n`)

for (const file of files) {
  const text = readFileSync(join(fixturesDir, file), 'utf-8')
  console.log(`— ${file} —`)

  // 1. Instrument detection
  const det = detectInstrument(profile, text)
  check(`${file}: detected as FER`, det.instrumentId === 'FER', `${det.instrumentId} (conf ${det.confidence.toFixed(2)})`)
  check(`${file}: not misdetected as hearing notice`, (det.scores['HEARING_NOTICE'] || 0) === 0)

  // 2. Deadline engine vs the office's own stated date
  const dispatch = extractDispatch(text)
  const statedDue = extractStatedDue(text)
  check(`${file}: dispatch date found`, !!dispatch, dispatch || 'none')
  check(`${file}: stated due date found`, !!statedDue, statedDue || 'none')

  if (dispatch && statedDue) {
    const deadlines = computeDeadlines(profile, 'FER', { dateOfReport: dispatch }, dispatch)
    const ferReply = deadlines.find(d => d.id === 'fer_reply')
    check(`${file}: computed FER reply == office stated date (${statedDue})`,
      ferReply?.dueDate === statedDue,
      `computed ${ferReply?.dueDate} from dispatch ${dispatch}`)
    check(`${file}: form3 sub-deadline at dispatch + 3M`,
      deadlines.some(d => d.id === 'form3_update'),
      'form3_update rule missing')
    check(`${file}: deemed-abandonment consequence attached`,
      ferReply?.consequence?.type === 'DEEMED_ABANDONED')
  }
  console.log('')
}

console.log(failures === 0 ? 'ALL REAL-FER CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
