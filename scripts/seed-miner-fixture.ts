/**
 * Invention Miner — local development fixture.
 *
 * ===========================================================================
 *  THESE ROWS ARE SYNTHETIC. THEY ARE NOT PATENTS. NEVER SEED PRODUCTION.
 * ===========================================================================
 *
 * Every row this script writes is prose I wrote by hand (or assembled from
 * hand-written patentese templates) to look like a specification. None of it is
 * a real publication, none of the publication numbers exist, and none of the
 * applicants are real companies. The numbers all sit in an impossible year
 * range (2097-2099 / EP4099) precisely so that nothing here can ever be
 * mistaken for, or collide with, a genuine corpus row.
 *
 * Every row carries `'miner-fixture'` in `corpusSources`. That tag is the only
 * handle `--remove` uses, and it is the only thing that makes this fixture
 * reversible. Do not strip it.
 *
 * WHY THIS EXISTS
 * The dev database holds ~38.7k Indian publications with abstracts only: zero
 * `descriptionText`, zero `claimsText`, no `familyId`. The miner reads admitted
 * problems out of BACKGROUND SECTIONS and reads scope out of claim sets, so on
 * this box it has literally nothing to read and every stage refuses — correctly,
 * and therefore uninformatively. This fixture creates one coherent field with
 * real full text so the whole pipeline can be exercised end to end locally:
 * gastroretentive / controlled-release oral drug delivery, a genuine s.3(d)
 * field that matches the study already present in this database.
 *
 * WHAT IT IS COMPOSED TO EXERCISE
 *   - full claim sets with 3+ dependent narrowings, and US-shaped stubs that
 *     carry only claim 1 (`FIRST_CLAIM_ONLY`) which the frontier engine must
 *     detect and skip on;
 *   - background sections with explicitly ADMITTED drawbacks, stated needs
 *     ("there remains a need for..."), and teaching-away sentences;
 *   - the description-5k tier and the >5,000-character full-description tier;
 *   - a 17-year expiry frontier;
 *   - out-of-field donors in B01J / A01N whose problem is analogous but whose
 *     mechanism is absent from drug delivery (the cross-domain transfer lane);
 *   - multi-publication families (representative pick) and NULL familyId rows
 *     (the publicationNumber fallback);
 *   - a genre-boilerplate drawback recited verbatim by 5 of the 8 rows in one
 *     CPC sub-group, so a >40% share exclusion can be tripped;
 *   - a same-word-different-sense decoy pair in F16L ("controlled release" of
 *     stored pressure, "burst" of a hose) for the bimodality guard;
 *   - non-English `abstractOriginal` with a NULL `abstract`;
 *   - OCR garbage for the unreadable-text filter.
 *
 * THE TWO CONSTRAINTS THAT DECIDE VISIBILITY (see --verify, which measures both)
 *   1. `buildScopeFilter`'s FIRST clause is `lp."filingDate" IS NOT NULL`, and
 *      its concept gate is ORed over `TEXT_CORPORA` = google-patents-corpus /
 *      indian-corpus with the tag as a LITERAL `@>` test. A row tagged only
 *      'miner-fixture' is outside EVERY field, whatever its text says. So every
 *      row here carries 'indian-corpus' FIRST and 'miner-fixture' second, and
 *      every row has a filingDate.
 *   2. The concept gate matches `ragText || title || abstract ||
 *      abstractOriginal` — NOT descriptionText and NOT claimsText. Field terms
 *      therefore have to appear in the title/abstract, or the richest
 *      description in the corpus is invisible to the census.
 *
 * USAGE
 *   npx tsx scripts/seed-miner-fixture.ts             # report only, changes nothing
 *   npm run im:seed-fixture                           # same
 *   npm run im:seed-fixture -- --apply                # upsert rows + embeddings
 *   npm run im:seed-fixture -- --verify               # every floor, pass/fail
 *   npm run im:seed-fixture -- --remove               # delete the fixture
 *
 * `--apply` is idempotent: rows are upserted on `publicationNumber` and skipped
 * when their content hash (stored in `sourceFileHash`) is unchanged, and an
 * embedding that is already COMPLETED is never re-requested.
 */

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE,
  PATENT_CORPUS_EMBEDDING_COLUMN,
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_EMBEDDING_PROVIDER,
  PATENT_CORPUS_SOURCE_INDIAN,
  hasCorpusEmbeddingApiKey,
  queueEmbeddingForPatent,
  requestCorpusEmbeddings,
  setEmbeddingVector,
} from '../src/lib/patent-corpus-service'
import { buildScopeFilter } from '../src/lib/whitespace/field-map'
import { resolveFieldBand } from '../src/lib/whitespace/field-definition'
import { CORPUS_FIRST_YEAR, emptyWhitespaceScope, type WhitespaceScope } from '../src/lib/whitespace/types'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The removal handle. Second tag, never first — see the header. */
const FIXTURE_TAG = 'miner-fixture'
/** The tag that puts a row inside TEXT_CORPORA, and therefore inside a field. */
const CORPUS_TAG = PATENT_CORPUS_SOURCE_INDIAN
/** Stamped on `extractionVersion`; bump it when the prose changes materially. */
const FIXTURE_VERSION = 'miner-fixture-v1'

/**
 * Mirrors of the miner's own floors.
 *
 * Deliberately RE-DERIVED here rather than imported from
 * src/lib/whitespace/miner/harvest-stage.ts: that module pulls in the LLM
 * client and the prompt set, and a fixture seeder must keep working while the
 * miner itself is being edited. If a default below stops matching the miner,
 * the miner is the authority — fix this file.
 */
const MIN_DESCRIPTION_SHARE = clampFraction(process.env.WHITESPACE_MINER_MIN_DESCRIPTION_SHARE, 0.2)
const MIN_SAMPLING_FRACTION = clampFraction(process.env.WHITESPACE_MINER_MIN_SAMPLING_FRACTION, 0.05)
const HARVEST_FAMILY_CAP = Math.max(50, Number(process.env.WHITESPACE_MINER_FAMILY_CAP) || 3_000)

/** A patent term is 20 years from filing; 17 is where the frontier engine starts looking. */
const EXPIRY_FRONTIER_YEARS = 17

function clampFraction(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value > 1) return fallback
  return value
}

// ---------------------------------------------------------------------------
// The composition targets. --verify checks the fixture against these, so the
// intended shape of the fixture is stated once, here, and never in prose only.
// ---------------------------------------------------------------------------

const TARGETS = {
  rows: 170,
  withClaims: 45,
  fullClaimSets: 30,
  firstClaimOnly: 10,
  withDescription: 50,
  statedNeed: 15,
  teachingAway: 10,
  descriptionFull: 3,
  expiryFrontier: 20,
  donors: 8,
  multiPublicationFamilies: 3,
  nullFamilyId: 2,
  boilerplateCohort: 5,
  bimodalityDecoys: 2,
  nonEnglish: 3,
  ocrGarbage: 2,
} as const

// ---------------------------------------------------------------------------
// Content pools
// ---------------------------------------------------------------------------

interface Active {
  name: string
  klass: string
  indication: string
  halfLife: string
  frequency: string
}

const ACTIVES: Active[] = [
  { name: 'ciprofloxacin hydrochloride', klass: 'fluoroquinolone antibacterial agent', indication: 'complicated urinary tract infection', halfLife: '3.5', frequency: 'twice' },
  { name: 'metformin hydrochloride', klass: 'biguanide antihyperglycaemic agent', indication: 'type 2 diabetes mellitus', halfLife: '4.5', frequency: 'three times' },
  { name: 'levodopa', klass: 'dopamine precursor', indication: 'idiopathic Parkinson disease', halfLife: '1.5', frequency: 'four times' },
  { name: 'baclofen', klass: 'gamma-aminobutyric acid derivative', indication: 'spasticity of spinal origin', halfLife: '3.5', frequency: 'three times' },
  { name: 'furosemide', klass: 'loop diuretic', indication: 'oedema associated with congestive cardiac failure', halfLife: '2.0', frequency: 'twice' },
  { name: 'riboflavin', klass: 'water soluble vitamin', indication: 'riboflavin deficiency and migraine prophylaxis', halfLife: '1.4', frequency: 'three times' },
  { name: 'acyclovir', klass: 'nucleoside analogue antiviral agent', indication: 'herpes zoster', halfLife: '2.9', frequency: 'five times' },
  { name: 'cefuroxime axetil', klass: 'second generation cephalosporin', indication: 'acute bacterial sinusitis', halfLife: '1.2', frequency: 'twice' },
  { name: 'gabapentin', klass: 'structural analogue of gamma-aminobutyric acid', indication: 'post-herpetic neuralgia', halfLife: '6.0', frequency: 'three times' },
  { name: 'captopril', klass: 'angiotensin converting enzyme inhibitor', indication: 'essential hypertension', halfLife: '2.0', frequency: 'three times' },
  { name: 'atenolol', klass: 'cardioselective beta adrenergic blocking agent', indication: 'angina pectoris', halfLife: '6.5', frequency: 'twice' },
  { name: 'ranitidine hydrochloride', klass: 'histamine H2 receptor antagonist', indication: 'duodenal ulcer', halfLife: '2.5', frequency: 'twice' },
  { name: 'verapamil hydrochloride', klass: 'phenylalkylamine calcium channel blocker', indication: 'supraventricular tachyarrhythmia', halfLife: '4.0', frequency: 'three times' },
  { name: 'allopurinol', klass: 'xanthine oxidase inhibitor', indication: 'chronic tophaceous gout', halfLife: '1.5', frequency: 'twice' },
  { name: 'amoxicillin trihydrate', klass: 'aminopenicillin antibacterial agent', indication: 'Helicobacter pylori associated gastric ulcer', halfLife: '1.3', frequency: 'three times' },
  { name: 'ofloxacin', klass: 'fluoroquinolone antibacterial agent', indication: 'bacterial gastroenteritis', halfLife: '6.0', frequency: 'twice' },
  { name: 'tramadol hydrochloride', klass: 'centrally acting opioid analgesic', indication: 'moderate to severe chronic pain', halfLife: '6.3', frequency: 'four times' },
  { name: 'alfuzosin hydrochloride', klass: 'selective alpha-1 adrenoceptor antagonist', indication: 'benign prostatic hyperplasia', halfLife: '5.0', frequency: 'three times' },
  { name: 'sitagliptin phosphate', klass: 'dipeptidyl peptidase-4 inhibitor', indication: 'type 2 diabetes mellitus', halfLife: '12.4', frequency: 'twice' },
  { name: 'pregabalin', klass: 'alpha-2-delta ligand', indication: 'diabetic peripheral neuropathy', halfLife: '6.3', frequency: 'three times' },
  { name: 'cinnarizine', klass: 'piperazine derivative antihistamine', indication: 'vestibular vertigo', halfLife: '4.0', frequency: 'three times' },
  { name: 'clarithromycin', klass: 'macrolide antibacterial agent', indication: 'Helicobacter pylori eradication', halfLife: '4.0', frequency: 'twice' },
]

const POLYMERS = [
  'hydroxypropyl methylcellulose K4M',
  'hydroxypropyl methylcellulose K100M',
  'hydroxypropyl methylcellulose K15M',
  'polyethylene oxide WSR 303',
  'sodium alginate',
  'carbomer 934P',
  'xanthan gum',
  'guar gum',
  'chitosan of medium molecular weight',
  'crosslinked sodium carboxymethylcellulose',
  'hydroxyethyl cellulose',
  'polyvinyl acetate and povidone in a ratio of 8:2',
]

const CO_POLYMERS = [
  'ethylcellulose N50',
  'Eudragit RS PO',
  'locust bean gum',
  'carrageenan',
  'glyceryl behenate',
  'stearyl alcohol',
  'hydrogenated castor oil',
  'polycarbophil',
]

const FORMS = [
  'floating matrix tablet',
  'swellable bilayer tablet',
  'raft-forming granulate',
  'gas-generating multiparticulate system',
  'mucoadhesive matrix tablet',
  'unfolding polymeric film device',
  'superporous hydrogel plug capsule',
  'low-density hollow microsphere preparation',
  'effervescent floating capsule',
  'expandable reticulated foam tablet',
]

const ACIDS = ['citric acid monohydrate', 'anhydrous citric acid', 'tartaric acid', 'fumaric acid', 'succinic acid']

const APPLICANTS = [
  'Sundara Therapeutics Private Limited',
  'Kaveri Formulations Limited',
  'Nirmaya Drug Delivery Systems Private Limited',
  'Trilokh Pharma Research Limited',
  'Veligandu Life Sciences Private Limited',
  'Chandrika Bioceuticals Limited',
  'Ashwatha Pharmaceutical Industries Limited',
  'Marudhar Controlled Delivery Private Limited',
  'Ganjam Institute of Pharmaceutical Sciences',
  'Prantik Speciality Excipients Limited',
]

const INVENTOR_POOL = [
  'RAO, Bhaskara Venkata',
  'IYENGAR, Meenakshi',
  'DESHMUKH, Anirudh Shripad',
  'QURESHI, Farhana Bano',
  'MUKHOPADHYAY, Debjani',
  'NAIR, Padmanabhan Sasidharan',
  'GREWAL, Harkirat Singh',
  'BORKAR, Sanchita Vilas',
  'THANGARAJ, Muthukumar',
  'SAIKIA, Pranjal Jyoti',
]

/**
 * Admitted drawbacks. Each is an EXPLICIT admission about the prior art — the
 * sentence the extraction model has to find. They are deliberately distinct
 * from one another, so that no single drawback dominates the field by accident
 * and the boilerplate cohort below stands out against them.
 */
const DRAWBACKS = [
  'It has been observed, however, that the buoyancy lag time of such systems commonly exceeds fifteen minutes, during which interval the dosage form is liable to be swept from the stomach by the housekeeper wave of the migrating motor complex, so that the intended prolongation of gastric residence is not in fact obtained.',
  'A limitation of these swellable systems is that the degree of swelling attained within the first hour is insufficient to exceed the diameter of the resting pylorus, and premature gastric emptying accordingly occurs in a substantial proportion of subjects dosed in the fasted state.',
  'The gas-generating systems hitherto described are dependent upon the presence of gastric acid for the liberation of carbon dioxide, and their performance is correspondingly erratic in achlorhydric subjects, in the elderly, and in patients concurrently receiving a proton pump inhibitor.',
  'These mucoadhesive preparations suffer from the disadvantage that the mucus layer to which they adhere is itself turned over continuously, so that adhesion is lost within about two hours irrespective of the strength of the polymer-mucin interaction.',
  'The polymer loading required in order to sustain liberation of the active agent over twelve hours renders the unit large and difficult to swallow, and such units have been reported to be poorly tolerated by geriatric patients and by patients with dysphagia.',
  'A known shortcoming of the unfolding devices of the prior art is that the folded geometry recovers only partially after storage in a gelatin capsule, the recovered span being some 40 per cent below the design span, so that retention is unreliable.',
  'It is a recognised difficulty with such multiparticulate systems that the individual particles empty from the stomach independently of one another, so that the dose is delivered as a broad and poorly reproducible distribution in time rather than as the intended constant input.',
  'The superporous hydrogels described above possess adequate swelling kinetics but insufficient mechanical strength, and are found to disintegrate under the peristaltic pressure of the antrum before the intended residence period has elapsed.',
  'A further difficulty is that the density of the hydrated matrix rises towards that of the gastric contents as the polymer erodes, with the result that buoyancy is lost after some three to four hours and the remaining dose is emptied as a bolus.',
  'The raft-forming compositions of the prior art require a substantial volume of co-administered water in order to form a coherent raft, and the raft formed in a partially filled stomach is fragmented and does not retain the active agent.',
  'It has further been found that the in vitro dissolution profiles obtained for these formulations correlate poorly with the plasma concentration profiles observed in vivo, so that formulation development proceeds substantially by trial and error.',
  'These coated systems are subject to a lag phase of variable duration before liberation commences, the duration of the lag being governed by the thickness of the coat and being difficult to control to better than plus or minus twenty per cent in routine manufacture.',
]

/**
 * The genre boilerplate. Recited VERBATIM by the cohort below and by nothing
 * else, so that a share-based exclusion has something unambiguous to catch.
 */
const BOILERPLATE_DRAWBACK =
  'A further disadvantage of the dosage forms of the prior art is that burst release from the surface of the matrix leads to plasma concentration spikes shortly after administration, followed by sub-therapeutic troughs before the next dose is due.'

/** Explicitly stated needs. Every one contains the phrase "there remains a need for". */
const NEEDS = [
  'There remains a need for a gastroretentive dosage form which attains buoyancy substantially without lag and which retains its integrity in the fed and the fasted state alike.',
  'There remains a need for an oral controlled release system whose gastric residence does not depend upon the secretion of acid by the subject.',
  'There remains a need for a dosage form which combines the reproducible residence of a single unit with the dispersed emptying behaviour of a multiparticulate.',
  'There remains a need for a matrix which retains its mechanical strength throughout the period of liberation rather than only during the first hours after hydration.',
  'There remains a need for a gastroretentive preparation of a size which can be swallowed comfortably by an elderly patient and which nevertheless resists passage through the pylorus.',
  'There remains a need for a formulation whose in vitro liberation profile is predictive of the plasma profile observed in man, so that development need not proceed empirically.',
]

/** Teaching-away sentences: an explicit statement that a direction is unsuitable. */
const TEACHING_AWAY = [
  'It should be noted that increasing the proportion of sodium bicarbonate beyond about 15 per cent by weight in order to accelerate flotation is unsuitable, since the porosity so produced weakens the matrix to the point at which dose dumping occurs within the first two hours; that approach is accordingly to be avoided.',
  'The use of a superdisintegrant to accelerate hydration of the outer layer is expressly not recommended, as the wicking so introduced propagates through the matrix and destroys the very diffusional barrier upon which the prolonged liberation depends.',
  'Attempts to secure retention by magnetic means, an external magnet being worn over the epigastrium, have been reported and are considered unsuitable for a product intended for chronic self-administration, the retention obtained being wholly dependent upon the position of the magnet.',
  'It is emphasised that raising the molecular weight of the cellulose ether above that of the K100M grade does not further prolong liberation, and is contraindicated, because the gel layer then formed is so tough that it is not eroded at all and the core is emptied intact.',
  'The incorporation of a low melting lipid in order to reduce the apparent density is to be discouraged, since such lipids soften at body temperature and the unit deforms and passes the pylorus prematurely.',
  'The person skilled in the art is taught away from the use of a swelling agent in a capsule-based device of this kind, the swelling pressure developed within the shell being sufficient to rupture it and to release the entire dose at once.',
]

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

type Category = 'in-field' | 'donor' | 'bimodality-decoy'

type Trait =
  | 'full-claims'
  | 'first-claim-only'
  | 'no-claims'
  | 'stated-need'
  | 'teaching-away'
  | 'description-5k'
  | 'description-full'
  | 'no-description'
  | 'expiry-frontier'
  | 'boilerplate'
  | 'multi-publication-family'
  | 'null-family-id'
  | 'non-english'
  | 'ocr-garbage'

interface FixtureRow {
  publicationNumber: string
  country: string
  kind: string | null
  familyId: string | null
  filingDate: Date
  publicationDate: Date
  title: string
  abstract: string | null
  abstractOriginal: string | null
  classifications: string[]
  applicant: string
  inventors: string[]
  claimsText: string | null
  claimsCompleteness: string | null
  numberOfClaims: number | null
  descriptionText: string | null
  descriptionCompleteness: string | null
  category: Category
  traits: Trait[]
}

// ---------------------------------------------------------------------------
// Prose assembly
// ---------------------------------------------------------------------------

/** Numbered-paragraph assembly, so every description reads like a real body. */
function numbered(paragraphs: string[], start = 1): string {
  return paragraphs
    .map((text, index) => `[${String(start + index).padStart(4, '0')}] ${text}`)
    .join('\n\n')
}

interface DescriptionSpec {
  active: Active
  form: string
  polymer: string
  coPolymer: string
  acid: string
  hours: number
  swell: number
  drawback: string
  need: string | null
  teachAway: string | null
  /** Adds the worked examples, taking the body past the 5,000-character tier boundary. */
  full: boolean
  shape: number
}

function buildDescription(spec: DescriptionSpec): string {
  const { active, form, polymer, coPolymer, acid, hours, swell } = spec
  const head =
    spec.shape % 2 === 0
      ? `The present invention relates to a gastroretentive controlled release oral dosage form of ${active.name}, and more particularly to ${a(form)} which is retained in the stomach for a prolonged period so that the active agent is presented continuously to its absorption window in the proximal small intestine.`
      : `This invention concerns oral pharmaceutical compositions for the controlled release of ${active.name}, and in particular ${a(form)} adapted to resist gastric emptying for a period of not less than ${hours} hours after administration.`

  const background: string[] = [
    `${sentenceCase(active.name)} is a ${active.klass} indicated in the management of ${active.indication}. Its oral bioavailability is limited by an absorption window confined substantially to the duodenum and the upper jejunum, and by an elimination half-life of about ${active.halfLife} hours. Conventional immediate release tablets of ${active.name} must therefore be administered ${active.frequency} daily, and compliance in chronic therapy is correspondingly poor.`,
    `It is known to prolong the residence of a dosage form in the stomach by dispersing the active agent in a hydrophilic matrix of ${polymer}, optionally together with a gas generating couple of sodium bicarbonate and ${acid}, so that the hydrated unit floats upon the gastric contents. Systems of this general type, and mucoadhesive and swellable variants of them, are described in the art.`,
    spec.drawback,
  ]
  if (spec.teachAway) background.push(spec.teachAway)
  if (spec.need) background.push(spec.need)

  const summary: string[] = [
    `It is an object of the present invention to provide a controlled release oral dosage form of ${active.name} which is retained in the stomach for at least ${hours} hours in the fed and in the fasted state, and which does not exhibit the disadvantages recited above.`,
    `According to one aspect of the present invention there is provided ${a(form)} comprising ${active.name}, or a pharmaceutically acceptable salt thereof, dispersed in a matrix comprising ${polymer} and ${coPolymer}, the matrix having a dry apparent density of less than 1.0 g/cm3 and being adapted to swell to at least ${swell} times its initial volume within thirty minutes of contact with 0.1 N hydrochloric acid at 37 degrees Celsius.`,
    `In a preferred embodiment the ${polymer} is present in an amount of from 20 to 45 per cent by weight of the total weight of the dosage form, and the gas generating couple is present in an amount of from 6 to 14 per cent by weight, the balance comprising microcrystalline cellulose, colloidal silicon dioxide and magnesium stearate.`,
  ]

  const detail: string[] = [
    `The dosage form of the invention is conveniently prepared by wet granulation. ${sentenceCase(active.name)} is blended with ${polymer} and ${coPolymer} in a rapid mixer granulator, granulated with a 5 per cent w/v aqueous dispersion of povidone K30, dried in a fluidised bed drier to a loss on drying of not more than 2.5 per cent, sized through a 20 mesh screen, lubricated and compressed on a rotary tablet press fitted with 12 mm round concave punches to a hardness of from 60 to 90 N.`,
    `Buoyancy is determined in 900 ml of 0.1 N hydrochloric acid maintained at 37 plus or minus 0.5 degrees Celsius. The dosage forms of the invention exhibit a buoyancy lag time of less than 60 seconds and remain buoyant for not less than ${hours} hours, whereas the comparative formulation prepared without ${coPolymer} sank after 195 minutes.`,
  ]

  const examples: string[] = spec.full
    ? [
        `EXAMPLE 1. A batch of 10,000 units was prepared according to the process described above at a strength of 500 mg of ${active.name} per unit. The granulate exhibited a Carr index of 13.2 and an angle of repose of 27 degrees. Compressed units showed a friability of 0.21 per cent and a content uniformity relative standard deviation of 1.8 per cent over 10 units, both within the limits of the pharmacopoeial monograph.`,
        `The dissolution of the units of Example 1 was determined in USP Apparatus II at 50 revolutions per minute in 900 ml of 0.1 N hydrochloric acid. The mean percentage of ${active.name} liberated was 17.4 per cent at one hour, 38.9 per cent at four hours, 61.2 per cent at eight hours and 94.6 per cent at ${hours} hours. The profile was fitted to the Korsmeyer-Peppas equation and gave a release exponent n of 0.68, indicating anomalous transport, that is to say a contribution from both diffusion and erosion of the matrix.`,
        `EXAMPLE 2. The procedure of Example 1 was repeated, save that the proportion of ${polymer} was reduced from 38 per cent to 24 per cent by weight and the difference was made up with ${coPolymer}. The units so obtained exhibited a comparable buoyancy lag time but liberated 31.8 per cent of the ${active.name} within the first hour, which is outside the specification and confirms the importance of the polymer proportion recited in claim 2.`,
        `COMPARATIVE EXAMPLE A. Units were prepared without the gas generating couple. Such units did not float at any time during the test, sank to the base of the vessel within 40 seconds and liberated the whole of the dose within four hours. In a cross-over study in six healthy volunteers, gamma-scintigraphic imaging of technetium-99m labelled units showed a mean gastric residence of 1.9 hours for the comparative units against 6.8 hours for the units of Example 1.`,
        `The foregoing description is given by way of illustration only and is not to be construed as limiting the invention, the scope of which is defined by the claims appended hereto. Modifications apparent to the person skilled in the art, including the substitution of an equivalent cellulose ether for the ${polymer} recited above, are within the contemplation of the invention.`,
      ]
    : []

  return [
    'FIELD OF THE INVENTION',
    '',
    numbered([head], 1),
    '',
    'BACKGROUND OF THE INVENTION',
    '',
    numbered(background, 2),
    '',
    'SUMMARY OF THE INVENTION',
    '',
    numbered(summary, 2 + background.length),
    '',
    'DETAILED DESCRIPTION OF THE INVENTION',
    '',
    numbered([...detail, ...examples], 2 + background.length + summary.length),
    '',
  ].join('\n')
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "a" / "an", so a generated noun phrase never reads as "a effervescent capsule". */
function a(noun: string): string {
  return `${/^[aeiou]/i.test(noun.trim()) ? 'an' : 'a'} ${noun}`
}

interface ClaimSpec {
  active: Active
  form: string
  polymer: string
  acid: string
  hours: number
  swell: number
  dependents: number
}

/**
 * Every dependent claim uses the phrase "as claimed in", which is what --verify
 * counts when it reports families carrying three or more dependent narrowings.
 */
function buildClaims(spec: ClaimSpec): { text: string; count: number } {
  const { active, form, polymer, acid, hours, swell, dependents } = spec
  const claims: string[] = [
    `1. A gastroretentive controlled release oral dosage form in the form of ${a(form)}, comprising ${active.name} or a pharmaceutically acceptable salt thereof dispersed in a hydrophilic matrix comprising ${polymer}, wherein the dosage form has a dry apparent density of less than 1.0 g/cm3, swells to at least ${swell} times its initial volume within thirty minutes of contact with 0.1 N hydrochloric acid at 37 degrees Celsius, and liberates not more than 20 per cent by weight of the ${active.name} within the first hour of such contact.`,
  ]
  const pool = [
    `The dosage form as claimed in claim 1, wherein the ${polymer} is present in an amount of from 20 to 45 per cent by weight of the total weight of the dosage form.`,
    `The dosage form as claimed in claim 1, further comprising a gas generating couple comprising sodium bicarbonate and ${acid} in a weight ratio of from 1:1 to 3:1.`,
    `The dosage form as claimed in any one of the preceding claims, wherein the buoyancy lag time measured in 0.1 N hydrochloric acid at 37 degrees Celsius is less than 60 seconds and buoyancy is maintained for not less than ${hours} hours.`,
    `The dosage form as claimed in any one of the preceding claims, wherein from 80 to 100 per cent by weight of the ${active.name} is liberated over a period of ${hours} hours.`,
    `The dosage form as claimed in any one of the preceding claims, wherein the ${active.name} is present in an amount of from 100 mg to 1000 mg per unit dosage form.`,
    `A process for the preparation of a dosage form as claimed in claim 1, comprising granulating the ${active.name} with the ${polymer} in the presence of an aqueous binder solution, drying the granulate to a loss on drying of not more than 2.5 per cent by weight, and compressing the dried granulate.`,
  ]
  for (let index = 0; index < dependents; index += 1) {
    claims.push(`${index + 2}. ${pool[index % pool.length]}`)
  }
  return { text: claims.join('\n\n'), count: claims.length }
}

function buildAbstract(spec: DescriptionSpec): string {
  const { active, form, polymer, hours, swell } = spec
  return (
    `A gastroretentive controlled release oral dosage form of ${active.name} is disclosed. ` +
    `The dosage form is ${a(form)} in which the active agent is dispersed in a hydrophilic matrix of ${polymer} ` +
    `having a dry apparent density below 1.0 g/cm3. The unit becomes buoyant upon the gastric contents in less than ` +
    `60 seconds, swells to at least ${swell} times its initial volume, resists passage through the pylorus, and ` +
    `provides sustained release of the ${active.name} to its upper intestinal absorption window over ${hours} hours, ` +
    `so permitting once daily oral administration.`
  )
}

function buildTitle(spec: DescriptionSpec): string {
  const { active, form } = spec
  switch (spec.shape % 4) {
    case 0:
      return `Gastroretentive controlled release ${form} of ${active.name}`
    case 1:
      return `Oral controlled release pharmaceutical composition comprising ${active.name} and process for the preparation thereof`
    case 2:
      return `${sentenceCase(a(form))} for the sustained release of ${active.name} with prolonged gastric residence`
    default:
      return `Controlled release gastroretentive drug delivery system of ${active.name}`
  }
}

// ---------------------------------------------------------------------------
// The out-of-field donors: an analogous problem, a mechanism drug delivery
// does not use. Written to AVOID the phrases the field's concept gate matches
// ("controlled release", "sustained release", "extended release", "prolonged
// release", "modified release") so that they sit demonstrably OUTSIDE the field
// and the transfer engine has to reach them semantically rather than lexically.
// ---------------------------------------------------------------------------

interface DonorSpec {
  cpc: string[]
  title: string
  abstract: string
  paragraphs: string[]
}

const DONORS: DonorSpec[] = [
  {
    cpc: ['B01J 20/28', 'B01J 20/32'],
    title: 'Magnetically anchored sorbent monolith for the treatment of a continuously flowing liquid stream',
    abstract:
      'A sorbent monolith for the treatment of a flowing liquid stream is described. The monolith carries a ferrimagnetic ferrite phase dispersed within its walls, and is held stationary against the drag of the stream by a static field applied from outside the vessel wall. Residence of the sorbent in the treatment zone is thereby decoupled from its density and from the velocity of the stream.',
    paragraphs: [
      'The present invention relates to sorbent bodies for the treatment of continuously flowing liquid streams, and in particular to means for retaining such a body within a defined treatment zone.',
      'A recurring difficulty in the treatment of flowing streams is that the functional body is carried out of the treatment zone by the drag of the stream before its capacity has been used. Ballasting the body so that it settles, or lightening it so that it rises, addresses the difficulty only for a narrow range of flow velocities, and any such body is displaced as soon as the flow departs from the design condition.',
      'It is a disadvantage of the ballasted bodies hitherto proposed that the retention obtained is a function of the stream velocity, which in service varies by a factor of five or more, so that a body designed to remain in the zone at the mean velocity is swept out at the peak.',
      'According to the invention the body is rendered ferrimagnetic by the incorporation of from 8 to 22 per cent by weight of a strontium ferrite powder in the wall structure, and is retained by a permanent magnet assembly disposed on the outer face of the vessel wall. The retention force is then independent of the velocity of the stream and of the density of the body, and is set by the field gradient alone.',
      'It is a particular advantage of the arrangement that retention may be terminated at will by withdrawal of the magnet assembly, whereupon the body is carried away and may be recovered downstream for regeneration.',
    ],
  },
  {
    cpc: ['B01J 35/10', 'B01J 8/24'],
    title: 'Density-trimmed catalyst carrier for fluidised bed operation using syntactic glass microballoons',
    abstract:
      'A catalyst carrier is disclosed whose apparent density is trimmed to a chosen value by the incorporation of hollow glass microballoons into the support matrix before firing. The carrier is thereby made to hover at a chosen elevation within a fluidised bed, and its residence in the reaction zone is set by density matching rather than by particle size.',
    paragraphs: [
      'This invention relates to catalyst carriers for fluidised bed reactors and to a method of setting the elevation at which such a carrier circulates.',
      'In a fluidised bed the elevation at which a particle circulates is governed by its terminal velocity, and hence by its size and its density. Since the size of a carrier is fixed by the requirements of pressure drop and of internal diffusion, the formulator in practice has only one variable, and the elevation of the carrier cannot be chosen independently of its geometry.',
      'The consequence is that carriers designed for an acceptable pressure drop segregate to the top of the bed, where the reactant concentration has already been depleted, and a substantial fraction of the active surface is thereby wasted.',
      'It has now been found that the apparent density of an alumina carrier may be trimmed over the range 0.55 to 1.35 g/cm3, independently of its external dimensions, by incorporating from 5 to 30 per cent by volume of soda-lime glass microballoons of 40 micrometre nominal diameter into the extrusion paste and firing below the softening point of the glass. The microballoons survive the firing intact and act as closed voids.',
      'Carriers so trimmed were observed to circulate at a chosen elevation within the bed, and the conversion obtained at constant space velocity was raised from 61 per cent to 88 per cent relative to an untrimmed carrier of identical geometry.',
    ],
  },
  {
    cpc: ['A01N 25/10', 'A01N 25/34'],
    title: 'Osmotically driven soil capsule for the metered delivery of a nematicidal agent',
    abstract:
      'A capsule for emplacement in the root zone is described in which a semipermeable membrane encloses an osmotic driving layer and a compartment containing a nematicidal agent. Water drawn through the membrane expands the driving layer and expels the agent through a laser-drilled orifice at a rate set by the membrane permeability, and therefore substantially independently of soil pH, ionic strength and organic matter content.',
    paragraphs: [
      'The invention relates to devices for the delivery of agrochemical actives into the root zone over an extended season.',
      'Agrochemical granules of the matrix type liberate their active by diffusion and by erosion, and the rate at which they do so is governed by the properties of the surrounding soil. Soil pH varies between about 4.5 and 8.5 across a single holding, the ionic strength of the soil solution varies by an order of magnitude with irrigation and rainfall, and the organic matter content varies with cultivation history.',
      'It is an admitted shortcoming of such granules that the delivery rate obtained in the field is not the rate measured in the laboratory, and that a granule which delivers over ninety days on a light sandy soil is exhausted in twenty-eight days on a heavy soil of high organic matter content.',
      'According to the present invention the active is expelled by an osmotic engine. A cellulose acetate membrane of 175 micrometre wall thickness encloses a driving layer of sodium chloride and polyethylene oxide of 7,000,000 molecular weight, and the delivery rate is fixed by the water flux through that membrane, which is a property of the membrane and not of the soil.',
      'Delivery from the device of the invention was measured on four soils of widely differing character and varied by less than 9 per cent between them, against 214 per cent for a matrix granule of the same loading.',
    ],
  },
  {
    cpc: ['A01N 25/26', 'A01N 25/04'],
    title: 'Shape-memory polymer stake which deploys anchoring barbs after emplacement in a substrate',
    abstract:
      'An emplaceable stake for the delivery of a soil active is formed from a shape-memory polyurethane. The stake is inserted in a compact temporary geometry and, on reaching the soil temperature, recovers a permanent geometry bearing radial barbs which anchor it against extraction by irrigation and by frost heave.',
    paragraphs: [
      'This invention relates to the retention of an emplaced device within a substrate against forces which tend to expel it.',
      'A device which must be inserted through a narrow aperture cannot bear, at the moment of insertion, the projections which would afterwards anchor it. Devices of the prior art therefore rely on friction against the wall of the aperture, and it is well documented that such friction is lost as the substrate is wetted and worked.',
      'The disadvantage of relying on interference alone is that the very act of irrigating the crop, which is when the device is required to be in place, is what loosens it.',
      'The present invention resolves that conflict by separating the insertion geometry from the service geometry in time. A shape-memory polyurethane of glass transition temperature 14 degrees Celsius is programmed into a slender temporary form for insertion and recovers, over some forty minutes at soil temperature, a permanent form bearing six radial barbs of 4 mm projection.',
      'Extraction force measured after recovery was 41 N against 6 N for a plain stake of the same shank diameter, and no device of the invention was displaced during a season of overhead irrigation.',
    ],
  },
  {
    cpc: ['B01J 20/30', 'B01J 20/28'],
    title: 'Sacrificial pore former giving a bimodal pore network in a shaped adsorbent body',
    abstract:
      'A shaped adsorbent body is prepared by incorporating a sacrificial starch pore former which is burnt out during calcination to leave a network of transport macropores superimposed upon the intrinsic micropore structure. The diffusional path length and the crush strength of the body are thereby set independently of one another.',
    paragraphs: [
      'The invention concerns shaped adsorbent bodies and the relationship between their mass transport properties and their mechanical strength.',
      'In a monomodal body the same porosity governs both the rate at which the adsorbate reaches the interior and the strength of the body. Raising the porosity to shorten the diffusional path necessarily weakens the body, and the formulator is obliged to accept a compromise between uptake rate and attrition resistance.',
      'It is acknowledged in the art that this compromise costs between 30 and 50 per cent of the theoretical uptake rate in any body which must survive handling in an industrial bed.',
      'It has now been found that the two properties may be separated by burning out from 12 to 25 per cent by volume of a rice starch pore former during calcination at 620 degrees Celsius. The macropores so formed carry the adsorbate to within a short distance of every micropore, while the load bearing skeleton, which is not perforated by the burn-out, retains its strength.',
      'Bodies of the invention exhibited a half-uptake time of 41 seconds against 176 seconds for a monomodal body of the same crush strength, a fourfold improvement obtained without any loss of mechanical integrity.',
    ],
  },
  {
    cpc: ['A01N 25/08', 'A01N 63/00'],
    title: 'Enzyme-triggered granule liberating an active only in the presence of a target organism',
    abstract:
      'A granule is described in which the active is enclosed within a chitin shell. The shell is degraded by the chitinase secreted by the target organism, so that the active is liberated in response to the presence of the pest rather than upon a predetermined schedule.',
    paragraphs: [
      'The present invention relates to the timing of the liberation of an agrochemical active.',
      'Delivery devices of the prior art liberate their payload upon a schedule fixed at manufacture, whether by diffusion, by erosion or by hydrolysis of a coat. The schedule cannot be informed by whether the payload is in fact required.',
      'It is a recognised drawback of scheduled devices that the greater part of the payload is delivered when no target is present, which represents both a loss of efficacy at the moment of infestation and an avoidable environmental burden throughout the remainder of the season.',
      'According to the invention the payload is enclosed within a shell of crustacean chitin cross-linked with glutaraldehyde. The shell is stable in soil for upwards of six months in the absence of the target, and is degraded within 30 to 70 hours in the presence of the chitinase secreted by the target nematode, whereupon the payload is liberated at the site of the infestation.',
      'The trigger is therefore a biological signal generated by the target itself, and not a property of the device or of the elapsed time.',
    ],
  },
  {
    cpc: ['B01J 19/24', 'B01J 8/22'],
    title: 'Ballasted floc carrying a gas bubble within a hydrophobic cage for on-demand buoyancy reversal',
    abstract:
      'A treatment floc is provided with a hydrophobic microcage which entrains a gas bubble. The floc rises while the bubble is entrained and settles when the bubble is displaced by a change in the applied pressure, so that its position in the vessel may be reversed on demand without any change to its composition.',
    paragraphs: [
      'The invention relates to the control of the vertical position of a dispersed solid within a treatment vessel.',
      'A floc rises or settles according to its bulk density, which is fixed once the floc has been formed. Where the process requires the solid to be at the surface during one phase and at the base during another, two populations of solid have hitherto been required, or the vessel has had to be drained between phases.',
      'The known expedient of adding a densifying agent between phases is unsatisfactory, since the agent cannot afterwards be removed and the floc is thereby committed to the settling condition for the remainder of its life.',
      'In accordance with the invention each floc bears a cage of hydrophobised silica of 30 micrometre aperture which entrains a bubble of some 12 nanolitres. At atmospheric pressure the entrained bubble carries the floc to the surface; on raising the vessel pressure to 2.6 bar the bubble is compressed, is expelled from the cage, and the floc settles. On venting, the cage re-entrains a bubble from the dissolved gas and the floc rises again.',
      'Twenty complete reversals were performed on a single population of floc without measurable loss of the cage structure.',
    ],
  },
  {
    cpc: ['A01N 25/12', 'A01N 25/10'],
    title: 'Temperature-compensated pheromone dispenser employing a eutectic phase change barrier',
    abstract:
      'A dispenser for a semiochemical is described in which the diffusion barrier is a eutectic mixture whose latent heat absorbs the diurnal temperature excursion. The emission rate is thereby held substantially constant across a temperature range over which an ordinary wax barrier would vary by a factor of four.',
    paragraphs: [
      'This invention relates to dispensers for volatile semiochemicals used in mating disruption.',
      'The emission rate of a diffusion-limited dispenser follows the vapour pressure of the payload, which is strongly dependent on temperature. Across a diurnal range of 12 to 34 degrees Celsius the emission rate of a conventional wax dispenser varies by a factor of about four, so that the payload is largely spent during the warm afternoons and the dispenser is exhausted well before the end of the flight period.',
      'It is admitted in the art that oversizing the dispenser to compensate for this loss is wasteful and produces emission rates far above the effective threshold during the early part of the season.',
      'The invention interposes a barrier layer comprising a eutectic of lauric acid and myristic acid melting at 32 degrees Celsius. As the ambient temperature rises through the melting point the latent heat of the eutectic is absorbed, the barrier temperature is pinned, and the vapour pressure of the payload behind it is correspondingly pinned.',
      'Emission from the dispenser of the invention varied by 22 per cent across the diurnal cycle against 297 per cent for a wax dispenser of the same loading, and the effective field life was extended from 46 to 118 days.',
    ],
  },
]

/**
 * The bimodality decoys. Both recite the exact phrase "controlled release" and
 * the word "burst" in a mechanical sense — release of stored pressure, burst of
 * a containment. They therefore enter the concept-defined field lexically while
 * meaning something entirely unrelated, which is what the bimodality guard is
 * for.
 */
const BIMODALITY_DECOYS: DonorSpec[] = [
  {
    cpc: ['F16L 55/04', 'F16L 55/10'],
    title: 'Manifold for the controlled release of stored energy on burst of a high pressure hydraulic hose',
    abstract:
      'A manifold for high pressure hydraulic hose assemblies is disclosed. On burst of a hose the manifold provides for the controlled release of the stored energy of the fluid column through a labyrinth of calibrated orifices, so that the whipping of the severed hose is arrested within 40 milliseconds.',
    paragraphs: [
      'The invention relates to the mitigation of the consequences of hose burst in high pressure hydraulic circuits.',
      'On burst of a hose operating at 350 bar the stored energy of the compressed fluid column is liberated within a few milliseconds, and the severed end of the hose whips with sufficient violence to cause serious injury. The uncontrolled release of that energy is the hazard which the present invention addresses.',
      'Restraining sleeves of the prior art contain the whip but do nothing to moderate the rate of release, and it is a recognised drawback of such sleeves that the sleeve itself is accelerated with the hose and becomes a projectile in its turn.',
      'According to the invention the burst is detected by a differential pressure sensor and the stored energy is vented through a labyrinth of eleven calibrated orifices, giving a controlled release of pressure over some 40 milliseconds instead of the 3 milliseconds of an unrestricted burst.',
      'The peak reaction force at the severed end was thereby reduced from 4.1 kN to 0.38 kN, which is below the threshold at which the hose is displaced from its clamp.',
    ],
  },
  {
    cpc: ['F16L 55/128', 'F16K 17/16'],
    title: 'Rupture disc assembly giving controlled release of process gas on burst of a containment vessel',
    abstract:
      'A rupture disc assembly is described in which a reverse-buckling disc is backed by a perforated support plate. On burst the disc inverts against the plate, and the resulting aperture opens progressively so that controlled release of the process gas is obtained rather than the abrupt discharge characteristic of a forward-acting disc.',
    paragraphs: [
      'This invention concerns pressure relief devices for gas containment vessels.',
      'A forward-acting rupture disc opens to its full area within about 1.5 milliseconds of burst. The resulting discharge is abrupt, the reaction on the vessel is severe, and the discharged gas entrains liquid from the vessel in quantities which the downstream knock-out drum is not sized to receive.',
      'It is admitted that attempts to moderate the discharge by fitting an orifice plate downstream of the disc are unsatisfactory, since the plate raises the set pressure of the assembly and is itself liable to fouling.',
      'In the assembly of the invention the disc buckles in reverse against a support plate perforated with a graded pattern of apertures, so that the discharge area develops over some 18 milliseconds. The controlled release so obtained reduces the peak reaction on the vessel nozzle by 71 per cent and eliminates liquid carry-over entirely at the design burst pressure.',
      'The assembly satisfies the burst tolerance requirements of the applicable pressure equipment standard over the range 2 to 40 bar.',
    ],
  },
]

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

/** Deterministic: the same fixture every run, so `--apply` twice is a no-op. */
let sequence = 0
function nextNumber(prefix: string, suffix: string): string {
  sequence += 1
  return `${prefix}${String(sequence).padStart(5, '0')}${suffix}`
}

function pick<T>(pool: readonly T[], index: number): T {
  return pool[index % pool.length]
}

function dateYearsAgo(years: number, dayOffset: number): Date {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, (dayOffset * 37) % 12, ((dayOffset * 11) % 27) + 1))
  return date
}

function buildFixtureRows(): FixtureRow[] {
  sequence = 0
  const rows: FixtureRow[] = []

  // ---- the in-field body -------------------------------------------------
  // 160 pharmaceutical rows. Traits are assigned by index so the composition is
  // fixed and auditable rather than random.
  const IN_FIELD = 160
  // Rows reserved out of the 160 for the special cohorts, taken from the tail.
  const BOILERPLATE_START = 140 // 140..144  five rows, one CPC sub-group
  const SUBGROUP_FILLERS = [145, 146, 147] // three more rows in the same sub-group
  const NON_ENGLISH = [150, 151, 152]
  const OCR = [155, 156]
  // Two families of two publications and two of three: ten rows, four families.
  const MULTI_FAMILY: Record<number, string> = {
    100: 'FAMFIX-A', 101: 'FAMFIX-A',
    102: 'FAMFIX-B', 103: 'FAMFIX-B',
    104: 'FAMFIX-C', 105: 'FAMFIX-C', 106: 'FAMFIX-C',
    107: 'FAMFIX-D', 108: 'FAMFIX-D', 109: 'FAMFIX-D',
  }
  const NULL_FAMILY = new Set([120, 121, 122, 123])

  for (let index = 0; index < IN_FIELD; index += 1) {
    const traits: Trait[] = []
    const active = pick(ACTIVES, index)
    const polymer = pick(POLYMERS, index * 3 + 1)
    const coPolymer = pick(CO_POLYMERS, index * 5 + 2)
    const form = pick(FORMS, index * 7 + 3)
    const acid = pick(ACIDS, index)
    const hours = 8 + (index % 5) * 2
    const swell = 2 + (index % 4)

    const boilerplate = index >= BOILERPLATE_START && index < BOILERPLATE_START + TARGETS.boilerplateCohort
    const nonEnglish = NON_ENGLISH.includes(index)
    const ocr = OCR.includes(index)

    // Stated needs on ~40 rows, teaching-away on ~24, both well clear of floor.
    const need = index % 4 === 0 ? pick(NEEDS, index / 4) : null
    const teachAway = index % 7 === 2 ? pick(TEACHING_AWAY, (index - 2) / 7) : null
    const full = index % 27 === 5 // six rows over the 5,000-character boundary

    const spec: DescriptionSpec = {
      active,
      form,
      polymer,
      coPolymer,
      acid,
      hours,
      swell,
      drawback: boilerplate ? BOILERPLATE_DRAWBACK : pick(DRAWBACKS, index * 5 + 1),
      need,
      teachAway,
      full,
      shape: index,
    }

    // --- text depth -------------------------------------------------------
    // 150 of the 160 carry a description; the ten that do not are the shape the
    // real corpus is full of (abstract, sometimes claims, nothing else).
    const hasDescription = index % 16 !== 9
    let descriptionText: string | null = null
    let descriptionCompleteness: string | null = null
    if (ocr) {
      descriptionText = OCR_GARBAGE[index === OCR[0] ? 0 : 1]
      descriptionCompleteness = 'TRUNCATED_5K'
      traits.push('ocr-garbage', 'description-5k')
    } else if (hasDescription) {
      descriptionText = buildDescription(spec)
      // Length wins over the label in resolveTextTier, but the label is what the
      // availability view reports, so keep the two honest with one another.
      descriptionCompleteness = descriptionText.length > 5000 ? 'FULL' : 'TRUNCATED_5K'
      traits.push(descriptionText.length > 5000 ? 'description-full' : 'description-5k')
    } else {
      traits.push('no-description')
    }

    // --- claims -----------------------------------------------------------
    // 12 US-shaped stubs carrying claim 1 only; 108 full sets; the rest none.
    const firstClaimOnly = index % 13 === 4 && index < 156
    const hasClaims = firstClaimOnly || index % 4 !== 3
    let claimsText: string | null = null
    let claimsCompleteness: string | null = null
    let numberOfClaims: number | null = null
    if (firstClaimOnly) {
      const built = buildClaims({ active, form, polymer, acid, hours, swell, dependents: 0 })
      claimsText = built.text
      claimsCompleteness = 'FIRST_CLAIM_ONLY'
      numberOfClaims = built.count
      traits.push('first-claim-only')
    } else if (hasClaims) {
      const dependents = index % 9 === 6 ? 2 : 3 + (index % 4)
      const built = buildClaims({ active, form, polymer, acid, hours, swell, dependents })
      claimsText = built.text
      claimsCompleteness = 'FULL'
      numberOfClaims = built.count
      traits.push('full-claims')
    } else {
      traits.push('no-claims')
    }

    if (need) traits.push('stated-need')
    if (teachAway) traits.push('teaching-away')
    if (boilerplate) traits.push('boilerplate')

    // --- dates ------------------------------------------------------------
    // 34 rows sit on the far side of the 17-year expiry frontier. The corpus
    // cannot see before CORPUS_FIRST_YEAR, so the oldest is clamped to it.
    const frontier = index % 5 === 1 && index < 170
    const age = frontier ? EXPIRY_FRONTIER_YEARS + 1 + (index % 6) : 2 + (index % 12)
    const filingDate = dateYearsAgo(age, index)
    if (frontier) traits.push('expiry-frontier')
    const publicationDate = new Date(filingDate.getTime() + 550 * 24 * 3600 * 1000)

    // --- family -----------------------------------------------------------
    let familyId: string | null = `FIXFAM-${String(index).padStart(4, '0')}`
    if (MULTI_FAMILY[index]) {
      familyId = MULTI_FAMILY[index]
      traits.push('multi-publication-family')
    } else if (NULL_FAMILY.has(index)) {
      familyId = null
      traits.push('null-family-id')
    }

    // --- classification ---------------------------------------------------
    // The boilerplate cohort and three companions share A61K 9/22, so the
    // cohort is 5 of 8 within that sub-group: a 62% share, over any sensible
    // >40% boilerplate-exclusion threshold.
    let classifications: string[]
    if (boilerplate || SUBGROUP_FILLERS.includes(index)) {
      classifications = ['A61K 9/22', 'A61K 9/20']
    } else {
      classifications = [pick(['A61K 9/00', 'A61K 9/20', 'A61K 9/24', 'A61K 9/48'], index), pick(['A61K 47/38', 'A61K 47/32', 'A61P 1/04', 'A61P 3/10'], index * 3)]
    }

    // --- jurisdiction and numbering --------------------------------------
    // FIRST_CLAIM_ONLY rows are US, because that is the shape that produces
    // them: the corpus holds a US first claim and a 5,000-character prefix.
    // Note the availability view's `country = 'US'` rule only fires when
    // claimsCompleteness is NULL, so the explicit marker still wins here.
    let country = 'IN'
    let kind: string | null = 'A'
    let publicationNumber = nextNumber('IN2099', 'A')
    if (firstClaimOnly) {
      country = 'US'
      kind = 'A1'
      publicationNumber = nextNumber('US2099', 'A1')
    } else if (MULTI_FAMILY[index]) {
      // Within a family, exactly one publication is a granted B document, so the
      // representative pick has its `kind LIKE 'B%'` branch to resolve on.
      const isRepresentative = index === 100 || index === 102 || index === 104 || index === 107
      country = 'EP'
      kind = isRepresentative ? 'B1' : 'A1'
      publicationNumber = nextNumber('EP4099', isRepresentative ? 'B1' : 'A1')
    } else if (nonEnglish) {
      country = index === NON_ENGLISH[2] ? 'JP' : 'DE'
      kind = 'A1'
      publicationNumber = nextNumber(country === 'JP' ? 'JP2099' : 'DE2099', 'A1')
    }

    // --- surface text -----------------------------------------------------
    const title = buildTitle(spec)
    let abstract: string | null = buildAbstract(spec)
    let abstractOriginal: string | null = null
    if (nonEnglish) {
      abstract = null
      abstractOriginal = pick(NON_ENGLISH_ABSTRACTS, NON_ENGLISH.indexOf(index))
      traits.push('non-english')
    }

    rows.push({
      publicationNumber,
      country,
      kind,
      familyId,
      filingDate,
      publicationDate,
      title,
      abstract,
      abstractOriginal,
      classifications,
      applicant: pick(APPLICANTS, index),
      inventors: [pick(INVENTOR_POOL, index), pick(INVENTOR_POOL, index * 3 + 1)],
      claimsText,
      claimsCompleteness,
      numberOfClaims,
      descriptionText,
      descriptionCompleteness,
      category: 'in-field',
      traits,
    })
  }

  // ---- out-of-field donors ----------------------------------------------
  DONORS.forEach((donor, index) => {
    const filingDate = dateYearsAgo(4 + index, index * 3)
    rows.push({
      publicationNumber: nextNumber('IN2098', 'A'),
      country: 'IN',
      kind: 'A',
      familyId: `FIXDON-${String(index).padStart(3, '0')}`,
      filingDate,
      publicationDate: new Date(filingDate.getTime() + 550 * 24 * 3600 * 1000),
      title: donor.title,
      abstract: donor.abstract,
      abstractOriginal: null,
      classifications: donor.cpc,
      applicant: pick(APPLICANTS, index + 4),
      inventors: [pick(INVENTOR_POOL, index + 2)],
      claimsText: null,
      claimsCompleteness: null,
      numberOfClaims: null,
      descriptionText: donorBody(donor),
      descriptionCompleteness: 'TRUNCATED_5K',
      category: 'donor',
      traits: ['description-5k', 'no-claims'],
    })
  })

  // ---- bimodality decoys -------------------------------------------------
  BIMODALITY_DECOYS.forEach((decoy, index) => {
    const filingDate = dateYearsAgo(6 + index, index * 5)
    rows.push({
      publicationNumber: nextNumber('IN2097', 'A'),
      country: 'IN',
      kind: 'A',
      familyId: `FIXBIM-${String(index).padStart(3, '0')}`,
      filingDate,
      publicationDate: new Date(filingDate.getTime() + 550 * 24 * 3600 * 1000),
      title: decoy.title,
      abstract: decoy.abstract,
      abstractOriginal: null,
      classifications: decoy.cpc,
      applicant: pick(APPLICANTS, index + 7),
      inventors: [pick(INVENTOR_POOL, index + 5)],
      claimsText: null,
      claimsCompleteness: null,
      numberOfClaims: null,
      descriptionText: donorBody(decoy),
      descriptionCompleteness: 'TRUNCATED_5K',
      category: 'bimodality-decoy',
      traits: ['description-5k', 'no-claims'],
    })
  })

  return rows
}

function donorBody(spec: DonorSpec): string {
  return [
    'FIELD OF THE INVENTION',
    '',
    numbered([spec.paragraphs[0]], 1),
    '',
    'BACKGROUND OF THE INVENTION',
    '',
    numbered(spec.paragraphs.slice(1, 4), 2),
    '',
    'DESCRIPTION OF THE INVENTION',
    '',
    numbered(spec.paragraphs.slice(4), 5),
    '',
  ].join('\n')
}

/**
 * Non-English abstracts with a NULL `abstract`. The titles of these rows stay
 * in English, as they do in the real corpus (the offices supply an English
 * title), which is also what keeps them inside a concept-defined field.
 */
const NON_ENGLISH_ABSTRACTS = [
  'Die Erfindung betrifft eine gastroretentive Arzneiform zur kontrollierten Freisetzung eines Wirkstoffs im Magen. Die Tablette enthaelt eine hydrophile Matrix aus Hydroxypropylmethylcellulose sowie ein gasbildendes Paar aus Natriumhydrogencarbonat und Zitronensaeure. Die Dichte der hydratisierten Tablette liegt unter 1,0 g/cm3, so dass die Arzneiform auf dem Mageninhalt schwimmt und der Wirkstoff ueber zwoelf Stunden gleichmaessig an das Resorptionsfenster im oberen Duenndarm abgegeben wird.',
  'Gegenstand der Erfindung ist eine quellbare Zweischichttablette mit verlaengerter Magenverweilzeit. Die Quellschicht besteht aus Polyethylenoxid hohen Molekulargewichts und erreicht innerhalb von dreissig Minuten das Dreifache ihres Ausgangsvolumens, wodurch ein vorzeitiger Durchtritt durch den Pylorus verhindert wird. Die Wirkstoffschicht gibt den Arzneistoff diffusionsgesteuert ab.',
  '本発明は、胃内滞留型の経口徐放性製剤に関する。当該製剤は、ヒドロキシプロピルメチルセルロースを主体とする親水性マトリックスと、炭酸水素ナトリウムおよびクエン酸からなるガス発生剤とを含有し、人工胃液中で六十秒以内に浮上し、十二時間にわたり薬物を放出する。これにより、上部小腸に存在する吸収窓を有する薬物の生物学的利用能が改善される。',
]

/**
 * Deliberate OCR garbage: glued tokens (mean token length far above 15) and
 * substituted glyphs (alphabetic-token ratio far below 0.6). Both of the cheap
 * tests in the miner's unreadable-text filter should fire on this.
 */
const OCR_GARBAGE = [
  'thecontro11edre1easeofthedrugfromthematr1xtab1etwasf0undt0bedependentup0nthepr0p0rt10n0fp01ymer\n' +
    '||| 1.n th3 f0r3g01ng d3scr1pt10n th3 t3rm ~~~ 5ha11 b3 c0n5tru3d @@@ 4cc0rd1ng1y\n' +
    'w#erein5aidc0mp05iti0nc0mpri5e5fr0m20t045percentbywe1ght0f5a1dp01ymer1cmatr1xmater1a1\n' +
    '0()()1 [][][] ,,,,, ..... ///// \\\\\\\\ 1llll 0OOO0 rn rn rn cl cl cl vv vv vv\n' +
    'th3d15501ut10npr0f11ew45d3t3rm1n3d1nU5P4pp4r4tu511@50rpm1n9OOm10f0.1Nhydr0ch10r1c4c1d',
  'BACKGR0UNDOFTHE1NVENT10Nthepre5entinventi0nre1ate5t0ga5tr0retentivec0ntr011edre1ea5e\n' +
    '~~~~ ¬¬¬¬ ‡‡‡‡ §§§§ ¶¶¶¶ ····· ­­­­­ ¦¦¦¦ ‰‰‰‰\n' +
    '1t145b33n0b53rv3dth4tth3bu0y4ncy14gt1m30f5uch5y5t3m5c0mm0n1y3xc33d5f1ft33nm1nut35\n' +
    'l1l1l1 0O0O0O rnrnrn clclcl vvvvvv nnnnnn uuuuuu iiiiii\n' +
    'wherein5aiddo5agef0rmha5adryapparentden51ty0f1e55than1.0gcm3andswe11st0at1ea5tthreetime5',
]

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function contentHash(row: FixtureRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        FIXTURE_VERSION,
        row.publicationNumber,
        row.country,
        row.kind,
        row.familyId,
        row.filingDate.toISOString(),
        row.publicationDate.toISOString(),
        row.title,
        row.abstract,
        row.abstractOriginal,
        row.classifications,
        row.applicant,
        row.inventors,
        row.claimsText,
        row.claimsCompleteness,
        row.numberOfClaims,
        row.descriptionText,
        row.descriptionCompleteness,
      ])
    )
    .digest('hex')
}

function embeddingTextFor(row: FixtureRow): string {
  return `${row.title}\n\n${row.abstract ?? row.abstractOriginal ?? ''}`.trim()
}

function ragTextFor(row: FixtureRow): string {
  return `${row.title}\n\n${row.abstract ?? row.abstractOriginal ?? ''}`.trim()
}

async function applyRows(rows: FixtureRow[]) {
  const existing = await prisma.localPatent.findMany({
    where: { publicationNumber: { in: rows.map(row => row.publicationNumber) } },
    select: { id: true, publicationNumber: true, sourceFileHash: true },
  })
  const byNumber = new Map(existing.map(row => [row.publicationNumber, row]))

  let created = 0
  let updated = 0
  let unchanged = 0

  for (const row of rows) {
    const hash = contentHash(row)
    const prior = byNumber.get(row.publicationNumber)
    if (prior && prior.sourceFileHash === hash) {
      unchanged += 1
      continue
    }
    const data = {
      country: row.country,
      kind: row.kind,
      familyId: row.familyId,
      filingDate: row.filingDate,
      publicationDate: row.publicationDate,
      title: row.title,
      abstract: row.abstract,
      abstractOriginal: row.abstractOriginal,
      classifications: row.classifications,
      applicants: [
        { raw: `1) ${row.applicant}`, name: row.applicant, address: 'SYNTHETIC FIXTURE ADDRESS, NOT A REAL ENTITY', sequence: 1 },
      ] as Prisma.InputJsonValue,
      inventors: row.inventors,
      claimsText: row.claimsText,
      claimsCompleteness: row.claimsCompleteness,
      claimsSource: row.claimsText ? FIXTURE_VERSION : null,
      descriptionText: row.descriptionText,
      descriptionCompleteness: row.descriptionCompleteness,
      descriptionSource: row.descriptionText ? FIXTURE_VERSION : null,
      numberOfClaims: row.numberOfClaims,
      textUpdatedAt: new Date(),
      ragText: ragTextFor(row),
      embeddingText: embeddingTextFor(row),
      embeddingTextSource: 'title+abstract',
      extractionVersion: FIXTURE_VERSION,
      sourcePdfName: 'scripts/seed-miner-fixture.ts',
      sourceFileHash: hash,
      // Order matters for readability only; `@>` is set containment. The corpus
      // tag is what makes the row visible to a field at all.
      corpusSources: [CORPUS_TAG, FIXTURE_TAG],
    }
    await prisma.localPatent.upsert({
      where: { publicationNumber: row.publicationNumber },
      create: { publicationNumber: row.publicationNumber, ...data },
      update: data,
    })
    if (prior) updated += 1
    else created += 1
  }

  return { created, updated, unchanged }
}

/**
 * Queue and fill embeddings.
 *
 * Goes through the corpus service so the model, the dimensionality, the text
 * hash and the physical column all match what the rest of the application
 * reads. Writing a vector into the wrong column is the exact failure that made
 * Office Action retrieval return nothing while reporting success.
 */
async function applyEmbeddings(rows: FixtureRow[]) {
  const stored = await prisma.localPatent.findMany({
    where: { publicationNumber: { in: rows.map(row => row.publicationNumber) } },
    select: { id: true, publicationNumber: true, embeddingText: true },
  })
  for (const row of stored) {
    if (!row.embeddingText) continue
    await queueEmbeddingForPatent(row.id, row.embeddingText)
  }

  if (!hasCorpusEmbeddingApiKey()) {
    return {
      embedded: 0,
      alreadyComplete: 0,
      pending: stored.length,
      skippedReason:
        `No embedding API key is configured for provider '${PATENT_CORPUS_EMBEDDING_PROVIDER}' `
        + `(${PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage' ? 'VOYAGE_API_KEY' : 'OPENAI_CORPUS_API_KEY or OPENAI_API_KEY'}). `
        + 'The text is seeded and every lexical lane works; the semantic lanes will report themselves unavailable.',
    }
  }

  const pending = await prisma.localPatentEmbedding.findMany({
    where: {
      model: PATENT_CORPUS_EMBEDDING_MODEL,
      status: { not: 'COMPLETED' },
      patent: { corpusSources: { has: FIXTURE_TAG } },
    },
    select: { id: true, localPatentId: true },
  })
  const alreadyComplete = stored.length - pending.length

  if (!pending.length) return { embedded: 0, alreadyComplete, pending: 0, skippedReason: null as string | null }

  const textById = new Map(stored.map(row => [row.id, row.embeddingText ?? '']))
  let embedded = 0
  for (let offset = 0; offset < pending.length; offset += PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE)
    const texts = batch.map(job => textById.get(job.localPatentId) ?? '')
    const vectors = await requestCorpusEmbeddings(texts, { purpose: 'corpus-indexing' })
    for (let index = 0; index < batch.length; index += 1) {
      const vector = vectors[index]
      if (!vector) continue
      await setEmbeddingVector(batch[index].id, vector as number[])
      embedded += 1
    }
    process.stdout.write(`  embedded ${Math.min(offset + batch.length, pending.length)}/${pending.length}\r`)
  }
  process.stdout.write('\n')
  return { embedded, alreadyComplete, pending: 0, skippedReason: null as string | null }
}

async function removeRows() {
  const patents = await prisma.localPatent.findMany({
    where: { corpusSources: { has: FIXTURE_TAG } },
    select: { id: true },
  })
  if (!patents.length) return { patents: 0, embeddings: 0 }
  const ids = patents.map(row => row.id)
  const embeddings = await prisma.localPatentEmbedding.count({ where: { localPatentId: { in: ids } } })
  // The embedding rows go with them: LocalPatentEmbedding.patent is onDelete Cascade.
  const deleted = await prisma.localPatent.deleteMany({ where: { id: { in: ids } } })
  return { patents: deleted.count, embeddings }
}

// ---------------------------------------------------------------------------
// The scope the fixture is designed to answer
// ---------------------------------------------------------------------------

/**
 * A concept-defined field with NO classification constraint, on purpose:
 *
 *   - the in-field rows and the two F16L bimodality decoys all recite the exact
 *     phrase "controlled release" in title or abstract, so all of them enter;
 *   - the eight B01J / A01N donors are written to avoid every phrase in the
 *     required concept, so they stay OUT and the transfer engine has to reach
 *     them semantically rather than by sharing a lexical field.
 *
 * A CPC-constrained scope would work too (A61K9 / A61K47 admits 84 ambient dev
 * families) but it would also exclude the decoys, which is the one thing the
 * bimodality guard needs.
 */
function fixtureScope(): WhitespaceScope {
  const scope = emptyWhitespaceScope()
  scope.title = 'Gastroretentive controlled-release oral drug delivery'
  scope.summary =
    'Oral dosage forms whose residence in the stomach is deliberately prolonged so that an active with a narrow '
    + 'upper-intestinal absorption window can be delivered over many hours from a single unit.'
  scope.concepts = [
    {
      id: 'concept-release',
      label: 'controlled release',
      synonyms: ['sustained release', 'extended release', 'prolonged release', 'modified release'],
      required: true,
      origin: 'user',
    },
    {
      id: 'concept-gastroretention',
      label: 'gastroretentive dosage form',
      synonyms: ['gastroretentive', 'gastric retention', 'gastric residence', 'floating tablet'],
      required: false,
      origin: 'user',
    },
    {
      id: 'concept-oral',
      label: 'oral dosage form',
      synonyms: ['oral administration', 'matrix tablet', 'oral capsule'],
      required: false,
      origin: 'user',
    },
    {
      // The ambiguous one, and it is in the scope for a real reason: burst
      // release is the failure mode this whole field exists to avoid. It is
      // also the door through which the two F16L decoys enter — "burst" of a
      // hose, "controlled release" of stored pressure — which is exactly the
      // same-word-different-sense situation the bimodality guard is for.
      id: 'concept-burst',
      label: 'burst release',
      synonyms: ['burst', 'dose dumping', 'plasma concentration spike'],
      required: false,
      origin: 'user',
    },
  ]
  scope.filters.yearFrom = CORPUS_FIRST_YEAR
  scope.filters.yearTo = new Date().getFullYear()
  return scope
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface Composition {
  total: number
  byCategory: Record<Category, number>
  byTrait: Record<string, number>
  families: number
  fullClaimSetsWithThreeDependents: number
}

function describeComposition(rows: FixtureRow[]): Composition {
  const byCategory = { 'in-field': 0, donor: 0, 'bimodality-decoy': 0 } as Record<Category, number>
  const byTrait: Record<string, number> = {}
  const families = new Set<string>()
  let fullClaimSetsWithThreeDependents = 0

  for (const row of rows) {
    byCategory[row.category] += 1
    for (const trait of row.traits) byTrait[trait] = (byTrait[trait] ?? 0) + 1
    families.add(row.familyId ?? row.publicationNumber)
    const dependents = (row.claimsText?.match(/as claimed in/g) ?? []).length
    if (row.claimsCompleteness === 'FULL' && dependents >= 3) fullClaimSetsWithThreeDependents += 1
  }

  return { total: rows.length, byCategory, byTrait, families: families.size, fullClaimSetsWithThreeDependents }
}

function line(label: string, value: string | number, target?: number) {
  const rendered = typeof value === 'number' ? value.toLocaleString() : value
  const verdict = target === undefined ? '' : Number(value) >= target ? `  PASS (need ${target})` : `  FAIL (need ${target})`
  console.log(`  ${label.padEnd(46)} ${String(rendered).padStart(8)}${verdict}`)
}

function printConfiguration() {
  const band = resolveFieldBand()
  console.log('Configuration in force on this box')
  console.log(`  embedding model                   ${PATENT_CORPUS_EMBEDDING_MODEL} (${PATENT_CORPUS_EMBEDDING_PROVIDER}, ${PATENT_CORPUS_EMBEDDING_DTYPE}, ${PATENT_CORPUS_EMBEDDING_DIMENSIONS}d)`)
  console.log(`  embedding column                  local_patent_embeddings."${PATENT_CORPUS_EMBEDDING_COLUMN}"`)
  console.log(`  embedding API key present         ${hasCorpusEmbeddingApiKey() ? 'yes' : 'NO'}`)
  console.log(`  WHITESPACE_FIELD_MIN_FAMILIES     ${process.env.WHITESPACE_FIELD_MIN_FAMILIES ?? '(unset)'}`)
  console.log(`  WHITESPACE_DIMENSION_MIN_FAMILIES ${process.env.WHITESPACE_DIMENSION_MIN_FAMILIES ?? '(unset)'}`)
  console.log(`  band floor in force               ${band.minFamilies.toLocaleString()} families`)
  console.log(`  band ceiling in force             ${band.maxPublications.toLocaleString()} publications`)
  console.log(`  MIN_DESCRIPTION_SHARE             ${Math.round(MIN_DESCRIPTION_SHARE * 100)}%`)
  console.log(`  MIN_SAMPLING_FRACTION             ${Math.round(MIN_SAMPLING_FRACTION * 100)}%`)
  console.log(`  HARVEST_FAMILY_CAP                ${HARVEST_FAMILY_CAP.toLocaleString()} families`)
  console.log('')
}

function printComposition(rows: FixtureRow[]) {
  const composition = describeComposition(rows)
  console.log('Fixture composition (what these rows are)')
  line('rows', composition.total, TARGETS.rows)
  line('distinct families', composition.families)
  line('in-field pharmaceutical rows', composition.byCategory['in-field'])
  line('out-of-field donors (B01J / A01N)', composition.byCategory.donor, TARGETS.donors)
  line('bimodality decoys (F16L)', composition.byCategory['bimodality-decoy'], TARGETS.bimodalityDecoys)
  line('rows with claims', (composition.byTrait['full-claims'] ?? 0) + (composition.byTrait['first-claim-only'] ?? 0), TARGETS.withClaims)
  line('full claim sets with 3+ dependents', composition.fullClaimSetsWithThreeDependents, TARGETS.fullClaimSets)
  line('FIRST_CLAIM_ONLY stubs (US shape)', composition.byTrait['first-claim-only'] ?? 0, TARGETS.firstClaimOnly)
  line('rows with a description', (composition.byTrait['description-5k'] ?? 0) + (composition.byTrait['description-full'] ?? 0), TARGETS.withDescription)
  line('  of those, over 5,000 chars (FULL)', composition.byTrait['description-full'] ?? 0, TARGETS.descriptionFull)
  line('backgrounds stating a need', composition.byTrait['stated-need'] ?? 0, TARGETS.statedNeed)
  line('backgrounds teaching away', composition.byTrait['teaching-away'] ?? 0, TARGETS.teachingAway)
  line(`filed ${EXPIRY_FRONTIER_YEARS}+ years ago`, composition.byTrait['expiry-frontier'] ?? 0, TARGETS.expiryFrontier)
  line('boilerplate cohort (identical drawback)', composition.byTrait.boilerplate ?? 0, TARGETS.boilerplateCohort)
  line('rows in multi-publication families', composition.byTrait['multi-publication-family'] ?? 0)
  line('rows with familyId NULL', composition.byTrait['null-family-id'] ?? 0, TARGETS.nullFamilyId)
  line('non-English abstractOriginal, NULL abstract', composition.byTrait['non-english'] ?? 0, TARGETS.nonEnglish)
  line('OCR garbage rows', composition.byTrait['ocr-garbage'] ?? 0, TARGETS.ocrGarbage)
  console.log('')
}

// ---------------------------------------------------------------------------
// --verify: measure the fixture against every floor the miner applies
// ---------------------------------------------------------------------------

const FAMILY_KEY = Prisma.sql`COALESCE(lp."familyId", lp."publicationNumber")`

async function verify() {
  printConfiguration()

  const band = resolveFieldBand()
  const scope = fixtureScope()
  // k = 1: at least one optional concept alongside the required one. Passed
  // explicitly so this measurement never depends on the ladder fit.
  const where = buildScopeFilter(scope, undefined, 1)

  const seeded = await prisma.localPatent.count({ where: { corpusSources: { has: FIXTURE_TAG } } })
  if (!seeded) {
    console.log('The fixture is NOT seeded (no row carries the miner-fixture tag). Run with --apply first.\n')
  }

  const [fieldTotals] = await prisma.$queryRaw<
    Array<{ families: bigint; publications: bigint; with_description: bigint; with_claims: bigint; fixture_families: bigint }>
  >(Prisma.sql`
    SELECT COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families,
           COUNT(*)::bigint AS publications,
           COUNT(DISTINCT ${FAMILY_KEY}) FILTER (
             WHERE v."descriptionAvailability" <> 'NONE'
           )::bigint AS with_description,
           COUNT(DISTINCT ${FAMILY_KEY}) FILTER (
             WHERE v."claimsAvailability" IN ('FULL_EPO', 'FULL', 'FIRST_CLAIM_ONLY')
           )::bigint AS with_claims,
           COUNT(DISTINCT ${FAMILY_KEY}) FILTER (
             WHERE lp."corpusSources" @> ARRAY['${Prisma.raw(FIXTURE_TAG)}']::TEXT[]
           )::bigint AS fixture_families
    FROM "local_patents" lp
    JOIN "patent_text_availability" v ON v."id" = lp."id"
    WHERE ${where}`)

  const families = Number(fieldTotals?.families ?? 0)
  const publications = Number(fieldTotals?.publications ?? 0)
  const withDescription = Number(fieldTotals?.with_description ?? 0)
  const withClaims = Number(fieldTotals?.with_claims ?? 0)
  const fixtureFamilies = Number(fieldTotals?.fixture_families ?? 0)
  const share = families > 0 ? withDescription / families : 0

  const [narrowings] = await prisma.$queryRaw<Array<{ families: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families
    FROM "local_patents" lp
    WHERE ${where}
      AND lp."claimsText" IS NOT NULL
      AND (array_length(regexp_split_to_array(lower(lp."claimsText"), 'as claimed in'), 1) - 1) >= 3`)

  const [stubs] = await prisma.$queryRaw<Array<{ families: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families
    FROM "local_patents" lp
    JOIN "patent_text_availability" v ON v."id" = lp."id"
    WHERE ${where} AND v."claimsAvailability" = 'FIRST_CLAIM_ONLY'`)

  const frontierCutoff = new Date(Date.UTC(new Date().getUTCFullYear() - EXPIRY_FRONTIER_YEARS, new Date().getUTCMonth(), new Date().getUTCDate()))
  const [frontier] = await prisma.$queryRaw<Array<{ families: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT ${FAMILY_KEY})::bigint AS families
    FROM "local_patents" lp
    WHERE ${where} AND lp."filingDate" <= ${frontierCutoff}`)

  // Donors are measured OUTSIDE the field on purpose: that is what makes them
  // donors. They only have to be in the corpus slice, dated, and embedded.
  const [donors] = await prisma.$queryRaw<Array<{ rows: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS rows
    FROM "local_patents" lp
    WHERE lp."corpusSources" @> ARRAY['${Prisma.raw(FIXTURE_TAG)}']::TEXT[]
      AND lp."filingDate" IS NOT NULL
      AND lp."descriptionText" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(lp."classifications") c
        WHERE regexp_replace(upper(c), '[[:space:]]+', '', 'g') LIKE 'B01J%'
           OR regexp_replace(upper(c), '[[:space:]]+', '', 'g') LIKE 'A01N%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "local_patents" f WHERE f."id" = lp."id" AND (${where})
      )`)

  const [decoys] = await prisma.$queryRaw<Array<{ rows: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS rows
    FROM "local_patents" lp
    WHERE ${where}
      AND lp."corpusSources" @> ARRAY['${Prisma.raw(FIXTURE_TAG)}']::TEXT[]
      AND EXISTS (
        SELECT 1 FROM unnest(lp."classifications") c
        WHERE regexp_replace(upper(c), '[[:space:]]+', '', 'g') LIKE 'F16L%'
      )`)

  const [embedded] = await prisma.$queryRaw<Array<{ embedded: bigint; total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) FILTER (
             WHERE e."status" = 'COMPLETED'
               AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
               AND e."${Prisma.raw(PATENT_CORPUS_EMBEDDING_COLUMN)}" IS NOT NULL
           )::bigint AS embedded,
           COUNT(DISTINCT lp."id")::bigint AS total
    FROM "local_patents" lp
    LEFT JOIN "local_patent_embeddings" e ON e."localPatentId" = lp."id"
    WHERE lp."corpusSources" @> ARRAY['${Prisma.raw(FIXTURE_TAG)}']::TEXT[]`)

  const [boilerplate] = await prisma.$queryRaw<Array<{ cohort: bigint; subgroup: bigint }>>(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE lp."descriptionText" LIKE ${'%' + BOILERPLATE_DRAWBACK.slice(0, 90) + '%'})::bigint AS cohort,
           COUNT(*)::bigint AS subgroup
    FROM "local_patents" lp
    WHERE lp."corpusSources" @> ARRAY['${Prisma.raw(FIXTURE_TAG)}']::TEXT[]
      AND EXISTS (
        SELECT 1 FROM unnest(lp."classifications") c
        WHERE regexp_replace(upper(c), '[[:space:]]+', '', 'g') = 'A61K9/22'
      )`)

  const cohort = Number(boilerplate?.cohort ?? 0)
  const subgroup = Number(boilerplate?.subgroup ?? 0)
  const boilerplateShare = subgroup > 0 ? cohort / subgroup : 0

  console.log('Floors the miner checks, measured against this database')
  console.log(`  field: "${scope.title}" — concept-defined, no CPC constraint, k=1`)
  console.log('')
  line('families in field (fixture + ambient corpus)', families, band.minFamilies)
  line('  of which are fixture families', fixtureFamilies, band.minFamilies)
  line('publications in field (must stay under band)', publications)
  line(`  band ceiling`, band.maxPublications)
  console.log(`  ${'description share'.padEnd(46)} ${`${Math.round(share * 100)}%`.padStart(8)}  ${share >= MIN_DESCRIPTION_SHARE ? 'PASS' : 'FAIL'} (need ${Math.round(MIN_DESCRIPTION_SHARE * 100)}%, ${withDescription}/${families})`)
  line('families with readable claims', withClaims)
  line('families with 3+ dependent narrowings', Number(narrowings?.families ?? 0), TARGETS.fullClaimSets)
  line('FIRST_CLAIM_ONLY families (skip case)', Number(stubs?.families ?? 0), TARGETS.firstClaimOnly)
  line(`families filed ${EXPIRY_FRONTIER_YEARS}+ years ago`, Number(frontier?.families ?? 0), TARGETS.expiryFrontier)
  line('out-of-field donors (outside this field)', Number(donors?.rows ?? 0), TARGETS.donors)
  line('bimodality decoys inside the field', Number(decoys?.rows ?? 0), TARGETS.bimodalityDecoys)
  line('fixture rows with a COMPLETED embedding', Number(embedded?.embedded ?? 0), Number(embedded?.total ?? 0))
  console.log(`  ${'boilerplate share within A61K 9/22'.padEnd(46)} ${`${Math.round(boilerplateShare * 100)}%`.padStart(8)}  ${boilerplateShare > 0.4 ? 'PASS' : 'FAIL'} (need >40%, ${cohort}/${subgroup})`)
  console.log('')

  if (!hasCorpusEmbeddingApiKey()) {
    console.log('NOTE: no embedding API key is configured, so no vector was written. Lexical lanes')
    console.log('      work; every semantic lane will correctly report itself unavailable.')
    console.log('')
  }
  console.log('Reminder: these rows are SYNTHETIC. `--remove` deletes everything tagged')
  console.log(`          '${FIXTURE_TAG}'. Never seed this into production.`)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const remove = argv.includes('--remove')
  const doVerify = argv.includes('--verify')

  console.log('')
  console.log('Invention Miner development fixture — SYNTHETIC ROWS, LOCAL TESTING ONLY')
  console.log(`Tagged '${FIXTURE_TAG}' in corpusSources; --remove deletes exactly those rows.`)
  console.log('')

  if (remove) {
    const removed = await removeRows()
    console.log(`Removed ${removed.patents.toLocaleString()} fixture publication(s) and ${removed.embeddings.toLocaleString()} embedding row(s).`)
    console.log('')
    return
  }

  const rows = buildFixtureRows()

  if (doVerify && !apply) {
    await verify()
    return
  }

  if (!apply) {
    printConfiguration()
    printComposition(rows)
    const band = resolveFieldBand()
    const composition = describeComposition(rows)
    console.log('Nothing has been written. This run would:')
    console.log(`  upsert ${rows.length} rows (${composition.families} families) tagged [${CORPUS_TAG}, ${FIXTURE_TAG}]`)
    console.log(`  queue and fill ${rows.length} ${PATENT_CORPUS_EMBEDDING_MODEL} embeddings into "${PATENT_CORPUS_EMBEDDING_COLUMN}"`)
    console.log(
      `  ${composition.families >= band.minFamilies ? 'CLEAR' : 'NOT clear'} the band floor of ${band.minFamilies} families on the fixture alone`
      + ` (${composition.families} fixture families)`
    )
    console.log('')
    console.log('Re-run with --apply to write, --verify to measure the seeded fixture.')
    console.log('')
    return
  }

  printConfiguration()
  printComposition(rows)

  const result = await applyRows(rows)
  console.log(`Rows: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`)

  const embeddings = await applyEmbeddings(rows)
  if (embeddings.skippedReason) console.log(`Embeddings: SKIPPED. ${embeddings.skippedReason}`)
  else console.log(`Embeddings: ${embeddings.embedded} written, ${embeddings.alreadyComplete} already complete.`)
  console.log('')

  if (doVerify) await verify()
  else console.log('Run with --verify to measure every floor the miner will check against this fixture.\n')
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
