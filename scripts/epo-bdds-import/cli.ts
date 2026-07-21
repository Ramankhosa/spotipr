#!/usr/bin/env tsx
/**
 * EPO BDDS ingestion CLI.
 *
 * Phase 0 (this file's `catalog` command) is the gate for everything else: it
 * probes the live API and reports the facts we deliberately refused to hardcode
 * — the EP full-text back-file product id, the INPADOC product id, the checksum
 * algorithm, real byte volumes, and whether delivery filenames carry enough
 * information to slice by year without downloading.
 *
 * Usage:
 *   EPO_USERNAME=... EPO_PASSWORD=... npx tsx scripts/epo-bdds-import/cli.ts catalog
 *   ... catalog --lane ep-fulltext --no-probe
 *
 * Secrets come from EPO_USERNAME / EPO_PASSWORD only. Never pass them as flags.
 */

// Loads .env / .env.local without overriding anything already in the
// environment, matching the other scripts in this repo. Keeps EPO_USERNAME /
// EPO_PASSWORD out of command lines, shell history and process args.
import '../load-env'

import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getAccessToken } from '../../src/lib/epo-bdds/auth'
import {
  KNOWN_PRODUCT_IDS,
  formatBytes,
  getProduct,
  listProducts,
  parseFileSize,
  productsForLane,
  resolveProducts,
  summarizeProduct,
  type ResolvedProduct,
} from '../../src/lib/epo-bdds/catalog'
import { createReadStream } from 'node:fs'
import { prisma } from '../../src/lib/prisma'
import { listEntries, readEntryText, streamEntries, summarizeComposition } from '../../src/lib/epo-bdds/archive'
import { DiskGuard, describeSnapshot } from '../../src/lib/epo-bdds/disk-guard'
import { downloadFile } from '../../src/lib/epo-bdds/downloader'
import { BddsAuthError } from '../../src/lib/epo-bdds/http'
import {
  ledgerSummary, markDownloaded, markFailed, markLoaded, markStarted, markVerified,
  pendingFiles, syncCatalog,
} from '../../src/lib/epo-bdds/ledger'
import { DocdbLoader, EpFullTextLoader, type EpTextPolicy } from '../../src/lib/epo-bdds/loader'
import { parseDocdbStream } from '../../src/lib/epo-bdds/parsers/docdb'
import { isEpPublicationXml, parseEpFullText } from '../../src/lib/epo-bdds/parsers/epft'
import { assertPipelineHeadroom, runOverlappedPipeline } from '../../src/lib/epo-bdds/pipeline'
import { selectFiles, summarizeSelection } from '../../src/lib/epo-bdds/selector'
// (selectFiles is used by both the catalog report and the dry-run work list)
import type { BddsFile, BddsLane, BddsProductWithDeliveries } from '../../src/lib/epo-bdds/types'
import { detectChecksumAlgorithm, verifyFile } from '../../src/lib/epo-bdds/verifier'

const LANES: BddsLane[] = ['ep-fulltext', 'docdb', 'inpadoc']

/** EP full-text, confirmed from the live catalogue on 21 Jul 2026. There is no
 *  front/back split for this product — id 4 from the reference clients is gone. */
const EP_FULLTEXT_PRODUCT_ID = 32

/** "Samples of bulk data sets" — small representative archives of every product.
 *  The cheap way to get real XML structure without a 10 GB weekly delivery. */
const SAMPLES_PRODUCT_ID = 20

interface Args {
  command: string
  lane?: BddsLane
  probe: boolean
  dataDir: string
  json: boolean
  productId?: number
  deliveryId?: number
  fileId?: number
  keep: boolean
  fromYear?: number | null
  toYear?: number | null
  authorities?: string[] | null
  createMissingRows: boolean
  /** EP lane only: explicit opt-in to create local_patents rows. */
  createMissingRowsExplicit?: boolean
  onlyDated: boolean
  textPolicy?: EpTextPolicy
  dryRun: boolean
  limit?: number
}

/**
 * Where archives are staged.
 *
 * NOT os.tmpdir(): on the production VM /tmp is a tmpfs (RAM-backed, 7.8 GB), so
 * staging a 10 GB archive there would consume memory and fail. Defaults to a
 * directory beside the app, which sits on the main data disk. Override with
 * EPO_DATA_DIR or --data-dir.
 */
function defaultDataDir(): string {
  const configured = process.env.EPO_DATA_DIR?.trim()
  return configured || join(process.cwd(), '.epo-cache')
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] || 'help',
    probe: true,
    dataDir: defaultDataDir(),
    json: false,
    keep: false,
    // Honours "if a patent does not exist in our database, add it" — but only
    // when DOCDB supplies a title AND abstract, so the row is actually searchable.
    createMissingRows: true,
    onlyDated: false,
    dryRun: false,
  }
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--lane') {
      const value = argv[++i] as BddsLane
      if (!LANES.includes(value)) throw new Error(`--lane must be one of ${LANES.join(' | ')}`)
      args.lane = value
    } else if (flag === '--no-probe') {
      args.probe = false
    } else if (flag === '--data-dir') {
      args.dataDir = argv[++i]
    } else if (flag === '--json') {
      args.json = true
    } else if (flag === '--product') {
      args.productId = Number(argv[++i])
    } else if (flag === '--delivery') {
      args.deliveryId = Number(argv[++i])
    } else if (flag === '--file') {
      args.fileId = Number(argv[++i])
    } else if (flag === '--keep') {
      args.keep = true
    } else if (flag === '--year') {
      args.fromYear = args.toYear = Number(argv[++i])
    } else if (flag === '--from-year') {
      args.fromYear = Number(argv[++i])
    } else if (flag === '--to-year') {
      args.toYear = Number(argv[++i])
    } else if (flag === '--authority') {
      args.authorities = String(argv[++i]).split(',').map(a => a.trim()).filter(Boolean)
    } else if (flag === '--no-create-missing') {
      args.createMissingRows = false
    } else if (flag === '--create-missing') {
      args.createMissingRowsExplicit = true
    } else if (flag === '--text-policy') {
      const value = argv[++i] as EpTextPolicy
      const allowed: EpTextPolicy[] = [
        'claims-full+description-full', 'claims-full+description-5k',
        'claims-full', 'first-claim-only',
      ]
      if (!allowed.includes(value)) throw new Error(`--text-policy must be one of ${allowed.join(' | ')}`)
      args.textPolicy = value
    } else if (flag === '--only-dated') {
      args.onlyDated = true
    } else if (flag === '--dry-run') {
      args.dryRun = true
    } else if (flag === '--limit') {
      args.limit = Number(argv[++i])
    } else if (flag === '--help' || flag === '-h') {
      args.command = 'help'
    } else {
      throw new Error(`Unknown flag: ${flag}`)
    }
  }
  return args
}

function heading(title: string) {
  console.log(`\n${'='.repeat(72)}\n ${title}\n${'='.repeat(72)}`)
}

/** Smallest file across a product's deliveries — cheapest checksum probe. */
function smallestFile(product: BddsProductWithDeliveries) {
  let best: { file: BddsFile; deliveryId: number; bytes: number } | null = null
  for (const delivery of product.deliveries ?? []) {
    for (const file of delivery.files ?? []) {
      const bytes = parseFileSize(file.fileSize)
      if (bytes === null) continue
      if (!best || bytes < best.bytes) best = { file, deliveryId: delivery.deliveryId, bytes }
    }
  }
  return best
}

/**
 * Credentials are documented as "optional for free/public products", and all
 * three lanes are in the free area. So: use an account when one is configured,
 * otherwise try anonymously and let a 401 prove an account is required.
 */
async function acquireToken(): Promise<{ token: string; mode: string }> {
  if (!process.env.EPO_USERNAME || !process.env.EPO_PASSWORD) {
    return { token: '', mode: 'anonymous (no EPO_USERNAME/EPO_PASSWORD set)' }
  }
  const token = await getAccessToken()
  return { token, mode: 'authenticated (OAuth2 password grant via login.epo.org)' }
}

async function runCatalog(args: Args) {
  const { token, mode } = await acquireToken()
  console.log(`→ access mode: ${mode}`)

  const products = await listProducts(token)
  heading(`ALL PRODUCTS VISIBLE TO THESE CREDENTIALS (${products.length})`)
  for (const product of products) {
    console.log(`  ${String(product.id).padStart(4)}  ${product.name}`)
  }

  const resolved = resolveProducts(products)
  heading('LANE RESOLUTION — resolved by NAME at runtime, not hardcoded')
  const lanes = args.lane ? [args.lane] : LANES
  const selected: ResolvedProduct[] = []
  for (const lane of lanes) {
    const matches = productsForLane(resolved, lane)
    if (!matches.length) {
      console.log(`  ${lane.padEnd(12)} → NO MATCH (check the product list above)`)
      continue
    }
    for (const match of matches) {
      console.log(`  ${lane.padEnd(12)} → id=${String(match.id).padStart(4)}  [${match.fileSet}]  ${match.name}`)
      selected.push(match)
    }
  }

  heading('UNKNOWNS THIS PROBE EXISTS TO RESOLVE')
  const epBack = selected.find(p => p.lane === 'ep-fulltext' && p.fileSet === 'back')
  const inpadoc = selected.filter(p => p.lane === 'inpadoc')
  console.log(`  1. EP full-text BACK file id : ${epBack ? epBack.id : 'NOT FOUND'}`)
  console.log(`  2. INPADOC product id(s)     : ${inpadoc.length ? inpadoc.map(p => `${p.id} [${p.fileSet}]`).join(', ') : 'NOT FOUND'}`)

  // Sanity-assert the published ids still mean what the reference clients say.
  const assertions: Array<[string, number, string | undefined]> = [
    ['DocDB front', KNOWN_PRODUCT_IDS.docdbFront, products.find(p => p.id === KNOWN_PRODUCT_IDS.docdbFront)?.name],
    ['DocDB back', KNOWN_PRODUCT_IDS.docdbBack, products.find(p => p.id === KNOWN_PRODUCT_IDS.docdbBack)?.name],
    ['EP full-text front', KNOWN_PRODUCT_IDS.epFullTextFront, products.find(p => p.id === KNOWN_PRODUCT_IDS.epFullTextFront)?.name],
  ]
  console.log('\n  Sanity check against the ids published by the reference clients:')
  for (const [label, id, actualName] of assertions) {
    console.log(`    id=${String(id).padStart(3)} expected ${label.padEnd(20)} actual: ${actualName ?? 'ABSENT'}`)
  }

  heading('VOLUMES AND DELIVERY CHUNKING')
  let probeTarget: { product: ResolvedProduct; file: BddsFile; deliveryId: number; bytes: number } | null = null

  for (const product of selected) {
    const detail = await getProduct(token, product.id)
    const summary = summarizeProduct(detail)
    const decisions = selectFiles(detail.deliveries ?? [], {})
    const slices = summarizeSelection(decisions)

    console.log(`\n  [${product.id}] ${product.name}`)
    console.log(`    deliveries      : ${summary.deliveryCount}`)
    console.log(`    files           : ${summary.fileCount}`)
    console.log(`    advertised size : ${formatBytes(summary.totalBytes)}` +
      (summary.unparsedSizes ? `  (${summary.unparsedSizes} sizes unparsed)` : ''))
    console.log(`    delivery range  : ${summary.earliestDelivery ?? '?'} → ${summary.latestDelivery ?? '?'}`)
    console.log(`    filenames with a parseable YEAR      : ${slices.withParsedYear}/${slices.total}`)
    console.log(`    filenames with a parseable AUTHORITY : ${slices.withParsedAuthority}/${slices.total}`)

    const yearCoverage = slices.total ? slices.withParsedYear / slices.total : 0
    console.log(`    → --year can skip downloads for ${(yearCoverage * 100).toFixed(1)}% of files` +
      (yearCoverage < 1 ? '; the remainder needs record-level filtering' : ''))

    const samples = (detail.deliveries ?? []).flatMap(d => (d.files ?? []).map(f => f.fileName)).slice(0, 3)
    for (const sample of samples) console.log(`    sample filename : ${sample}`)

    const candidate = smallestFile(detail)
    if (candidate && (!probeTarget || candidate.bytes < probeTarget.bytes)) {
      probeTarget = { product, file: candidate.file, deliveryId: candidate.deliveryId, bytes: candidate.bytes }
    }
  }

  heading('CHECKSUM ALGORITHM')
  if (!args.probe) {
    console.log('  skipped (--no-probe)')
  } else if (!probeTarget) {
    console.log('  no file with a parseable size found; cannot probe')
  } else {
    const { product, file, deliveryId, bytes } = probeTarget
    console.log(`  downloading smallest file: ${file.fileName} (${formatBytes(bytes)})`)
    const destination = join(args.dataDir, file.fileName)
    try {
      const result = await downloadFile(token, { productId: product.id, deliveryId, fileId: file.fileId }, destination)
      console.log(`  downloaded ${formatBytes(result.bytesWritten)}` +
        (result.contentLength ? ` (Content-Length ${formatBytes(result.contentLength)})` : ' (no Content-Length header)'))
      const detected = await detectChecksumAlgorithm(destination, file.fileChecksum)
      if (detected) {
        console.log(`  ✓ fileChecksum is ${detected.algorithm.toUpperCase()}`)
        console.log(`    advertised: ${file.fileChecksum}`)
      } else {
        console.log('  ✗ NONE of md5/sha1/sha256 matched the advertised checksum.')
        console.log(`    advertised: ${file.fileChecksum}`)
        console.log('    Investigate before trusting verification (encoding? different algorithm?).')
      }
    } finally {
      await rm(args.dataDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  heading('NEXT STEP')
  console.log('  Review the numbers above against the plan\'s estimates BEFORE any bulk download.')
  console.log('  If they differ materially, re-scope rather than proceeding.\n')
}

/** Read-only checks. Never writes; safe to run any time. */
async function runPreflight(args: Args) {
  let failures = 0
  const ok = (msg: string) => console.log(`  ✓ ${msg}`)
  const bad = (msg: string) => { failures++; console.log(`  ✗ ${msg}`) }

  heading('PREFLIGHT (read-only)')

  const guard = new DiskGuard(args.dataDir)
  const snapshot = await guard.snapshot().catch(() => null)
  if (!snapshot) bad(`cannot stat ${args.dataDir}`)
  else if (snapshot.headroomBytes <= 0) bad(describeSnapshot(snapshot))
  else ok(describeSnapshot(snapshot))

  try {
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "epo_bdds_file"`
    ok(`ledger reachable (${count} files recorded)`)
  } catch {
    bad('epo_bdds_file missing — run: npx prisma migrate deploy')
  }

  try {
    await prisma.$queryRaw`SELECT "claimsSource" FROM "local_patents" LIMIT 1`
    ok('local_patents provenance columns present')
  } catch {
    bad('local_patents marker columns missing — run: npx prisma migrate deploy')
  }

  try {
    await acquireToken()
    ok('EPO credentials accepted')
  } catch (error) {
    bad(`EPO auth failed — ${error instanceof Error ? error.message : error}`)
  }

  console.log(failures ? `\n  ${failures} check(s) failed — fix before running backfill.\n`
                       : '\n  All checks passed.\n')
  if (failures) process.exitCode = 1
}

/** Extract and load one DOCDB archive. Handles both bare .xml and zipped deliveries. */
async function loadDocdbArchive(path: string, loader: DocdbLoader): Promise<void> {
  if (/\.xml$/i.test(path)) {
    await parseDocdbStream(createReadStream(path), record => loader.add(record))
    return
  }
  for await (const entry of streamEntries(path, e => e.extension === 'xml')) {
    // Index files describe the package rather than carrying documents.
    if (/index/i.test(entry.path)) { entry.stream.resume(); continue }
    await parseDocdbStream(entry.stream, record => loader.add(record))
  }
}

/**
 * Extract and load one EP full-text archive.
 *
 * The predicate is what keeps this affordable: ~95% of the archive is PDF/A and
 * TIFF page images, and they are never decompressed — only the per-publication
 * XML is read.
 */
async function loadEpFullTextArchive(path: string, loader: EpFullTextLoader): Promise<void> {
  for await (const entry of streamEntries(path, e => isEpPublicationXml(e.path))) {
    const record = parseEpFullText(await readEntryText(entry.stream))
    if (record) await loader.add(record)
  }
}

/**
 * The real import. Downloads file N+1 while extracting and loading file N, with
 * the disk floor enforced throughout. Safe to kill and re-run: the ledger skips
 * anything already LOADED.
 */
async function runBackfill(args: Args) {
  const lane: BddsLane = args.lane ?? 'docdb'
  if (lane === 'inpadoc') throw new Error('the inpadoc lane has no loader yet (deferred)')

  const { token } = await acquireToken()
  const guard = new DiskGuard(args.dataDir)
  console.log(`→ ${describeSnapshot(await guard.snapshot())}`)

  const resolved = productsForLane(resolveProducts(await listProducts(token)), lane)
  if (!resolved.length) throw new Error(`no products matched lane ${lane}`)
  const selected = resolved.filter(p => !args.productId || p.id === args.productId)

  // --dry-run must not write ANYTHING, including the ledger, so it reads the
  // live catalogue directly instead of syncing it first. That also means a dry
  // run works before `migrate deploy` has been applied.
  if (args.dryRun) {
    heading('WORK LIST (dry run — no writes, no downloads)')
    let files = 0
    let bytes = 0
    for (const product of selected) {
      const detail = await getProduct(token, product.id)
      const decisions = selectFiles(detail.deliveries ?? [], {
        fromYear: args.fromYear, toYear: args.toYear,
        authorities: args.authorities, onlyDated: args.onlyDated,
      })
      const included = decisions.filter(d => d.include)
      const unsliceable = included.filter(d => d.requiresRecordLevelFilter).length
      const productBytes = included.reduce((sum, d) => sum + (parseFileSize(d.file.fileSize) ?? 0), 0)
      files += included.length
      bytes += productBytes

      console.log(`\n  [${product.id}] ${product.name}`)
      console.log(`    ${included.length} of ${decisions.length} files selected, ${formatBytes(productBytes)}`)
      if (unsliceable) {
        console.log(`    ⚠ ${unsliceable} have no year in the filename — they must be ` +
          `downloaded and filtered at record level`)
      }
      for (const decision of included.slice(0, 10)) {
        console.log(`       ${String(decision.slice.pubYearTo ?? '?').padStart(4)}  ` +
          `${formatBytes(parseFileSize(decision.file.fileSize) ?? 0).padStart(10)}  ${decision.file.fileName}`)
      }
      if (included.length > 10) console.log(`       … and ${included.length - 10} more`)
    }
    console.log(`\n  TOTAL: ${files} files, ${formatBytes(bytes)} to transfer.`)
    console.log('  Nothing was written or downloaded.\n')
    return
  }

  heading('CATALOG SYNC')
  for (const product of selected) {
    const detail = await getProduct(token, product.id)
    const synced = await syncCatalog(product.id, product.name, lane, detail.deliveries ?? [])
    console.log(`  [${product.id}] ${product.name} — ${synced.deliveries} deliveries, ${synced.files} files`)
  }

  const pending = await pendingFiles({
    lane,
    productId: args.productId,
    fromYear: args.fromYear,
    toYear: args.toYear,
    authorities: args.authorities,
    limit: args.limit,
  })

  heading('WORK LIST')
  const totalBytes = pending.reduce((sum, f) => sum + Number(f.sizeBytes ?? 0), 0)
  console.log(`  ${pending.length} files to process, ${formatBytes(totalBytes)} to transfer`)
  if (!pending.length) { console.log('  nothing to do.\n'); return }

  heading('IMPORT')
  const totals = {
    parsed: 0, enriched: 0, created: 0, fulltext: 0,
    filled: 0, hadText: 0, notInCorpus: 0, skippedNoAbstract: 0,
  }

  const result = await runOverlappedPipeline(
    pending.map(file => ({ id: file.fileName, payload: file, sizeBytes: Number(file.sizeBytes ?? 0) })),
    {
      download: async (item, reservedBytes) => {
        const file = item.payload
        // Account for the archive still being processed alongside this one.
        await assertPipelineHeadroom(guard, item.sizeBytes, reservedBytes, `before ${file.fileName}`)
        await markStarted(file.id)
        const destination = join(args.dataDir, file.fileName)
        const downloaded = await downloadFile(
          token,
          { productId: file.productId, deliveryId: file.deliveryId, fileId: file.fileId },
          destination,
          { diskGuard: guard, expectedBytes: item.sizeBytes }
        )
        await markDownloaded(file.id, downloaded.bytesWritten)
        return destination
      },

      process: async (destination, item) => {
        const file = item.payload
        const verification = await verifyFile(destination, file.checksum ?? '', file.checksumAlgo as any)
        if (!verification.ok) {
          // A corrupt archive is never parsed and never loaded.
          throw new Error(`checksum mismatch (expected ${file.checksum}, got ${verification.actual})`)
        }
        await markVerified(file.id, verification.algorithm!)

        if (lane === 'ep-fulltext') {
          const loader = new EpFullTextLoader({
            productId: file.productId,
            deliveryId: file.deliveryId,
            textPolicy: args.textPolicy,
            // EP row creation is opt-in: granted specs carry no abstract, so a
            // new row would need a substitute vector text. Fills are always on.
            createMissingRows: args.createMissingRowsExplicit === true,
            fromYear: args.fromYear,
            toYear: args.toYear,
          })
          await loadEpFullTextArchive(destination, loader)
          await loader.flush()
          totals.parsed += loader.stats.parsed
          totals.fulltext += loader.stats.loaded
          totals.filled += loader.stats.filledExisting
          totals.created += loader.stats.createdNew
          totals.hadText += loader.stats.skippedHasText
          totals.notInCorpus += loader.stats.notInCorpus
          await markLoaded(file.id, loader.stats.loaded)
          console.log(`  ${file.fileName}: parsed ${loader.stats.parsed}, ` +
            `full text ${loader.stats.loaded}, filled ${loader.stats.filledExisting}, ` +
            `already had text ${loader.stats.skippedHasText}, ` +
            `not in corpus ${loader.stats.notInCorpus}` +
            (loader.stats.createdNew ? `, created ${loader.stats.createdNew}` : ''))
          return
        }

        const loader = new DocdbLoader({
          productId: file.productId,
          deliveryId: file.deliveryId,
          createMissingRows: args.createMissingRows,
          fromYear: args.fromYear,
          toYear: args.toYear,
        })
        await loadDocdbArchive(destination, loader)
        await loader.flush()

        totals.parsed += loader.stats.parsed
        totals.enriched += loader.stats.enriched
        totals.created += loader.stats.created
        totals.skippedNoAbstract += loader.stats.skippedNoAbstract
        await markLoaded(file.id, loader.stats.enriched + loader.stats.created)
        console.log(`  ${file.fileName}: parsed ${loader.stats.parsed}, ` +
          `enriched ${loader.stats.enriched}, created ${loader.stats.created}, ` +
          `skipped ${loader.stats.skippedNoAbstract} (no abstract)`)
      },

      cleanup: async destination => { await rm(destination, { force: true }).catch(() => {}) },

      onError: async (item, phase, error) => {
        await markFailed(item.payload.id, `${phase}: ${error instanceof Error ? error.message : error}`)
      },
    }
  )

  heading('RUN SUMMARY')
  console.log(`  files processed : ${result.processed}`)
  console.log(`  files failed    : ${result.failed}`)
  console.log(`  records parsed  : ${totals.parsed}`)
  console.log(`  rows enriched   : ${totals.enriched}`)
  console.log(`  rows created    : ${totals.created}`)
  if (totals.fulltext) {
    console.log(`  full-text rows  : ${totals.fulltext}`)
    console.log(`  claims filled   : ${totals.filled}   (local_patents rows that had none)`)
    console.log(`  already had text: ${totals.hadText}   (left untouched)`)
    console.log(`  not in corpus   : ${totals.notInCorpus}   (text kept in epo_ep_fulltext)`)
  }
  console.log(`  skipped (no abstract, unsearchable) : ${totals.skippedNoAbstract}`)
  for (const failure of result.failures.slice(0, 10)) {
    console.log(`    ✗ ${failure.id} [${failure.phase}] ${failure.message}`)
  }
  if (result.abortedEarly) {
    console.log('\n  ⚠ RUN ABORTED EARLY (disk floor or auth). Fix, then re-run the same')
    console.log('    command — the ledger resumes from here and re-does nothing.\n')
  }
  console.log(`\n  ${describeSnapshot(await guard.snapshot())}\n`)
  for (const row of await ledgerSummary(lane)) {
    console.log(`  ledger ${row.status.padEnd(11)} ${String(row.files).padStart(6)} files, ${row.records} records`)
  }
  console.log()
}

/** List a product's deliveries and files with sizes. Metadata only — downloads nothing. */
async function runInspect(args: Args) {
  const { token } = await acquireToken()
  const productId = args.productId ?? SAMPLES_PRODUCT_ID
  const product = await getProduct(token, productId)

  heading(`[${product.id}] ${product.name}`)
  if (product.description) console.log(`  ${product.description}\n`)

  for (const delivery of product.deliveries ?? []) {
    console.log(`\n  delivery ${delivery.deliveryId} — "${delivery.deliveryName}"` +
      `  (${delivery.deliveryPublicationDatetime ?? '?'})`)
    for (const file of delivery.files ?? []) {
      const bytes = parseFileSize(file.fileSize)
      console.log(`     file ${String(file.fileId).padStart(6)}  ` +
        `${(bytes === null ? String(file.fileSize) : formatBytes(bytes)).padStart(10)}  ${file.fileName}`)
    }
  }
  console.log('\n  Download one with:  fetch --product <id> --delivery <id> --file <id>\n')
}

/** Download a single named file and report what is inside it. Nothing is loaded to the DB. */
async function runFetch(args: Args) {
  if (!args.productId || !args.deliveryId || !args.fileId) {
    throw new Error('fetch requires --product, --delivery and --file (see `inspect`)')
  }
  const { token } = await acquireToken()
  const product = await getProduct(token, args.productId)
  const delivery = (product.deliveries ?? []).find(d => d.deliveryId === args.deliveryId)
  const file = (delivery?.files ?? []).find(f => f.fileId === args.fileId)
  if (!file || !delivery) throw new Error('no such delivery/file — run `inspect` first')

  const destination = join(args.dataDir, file.fileName)
  console.log(`→ ${file.fileName} (${file.fileSize})`)
  await downloadFile(
    token,
    { productId: product.id, deliveryId: delivery.deliveryId, fileId: file.fileId },
    destination
  )

  const verification = await verifyFile(destination, file.fileChecksum)
  console.log(verification.ok
    ? `✓ verified — checksum is ${verification.algorithm!.toUpperCase()}`
    : `✗ checksum did not match (advertised ${file.fileChecksum})`)

  if (/\.zip$/i.test(file.fileName)) {
    const entries = await listEntries(destination, { recurse: true })
    heading('CONTENTS')
    for (const row of summarizeComposition(entries)) {
      console.log(`  .${row.extension.padEnd(8)} ${String(row.count).padStart(6)} files  ` +
        `${formatBytes(row.uncompressedBytes).padStart(11)} uncompressed`)
    }
    console.log('\n  first 15 entries:')
    for (const entry of entries.slice(0, 15)) {
      console.log(`     ${formatBytes(entry.uncompressedSize).padStart(10)}  ${entry.path}`)
    }
  }
  console.log(`\n  saved to ${destination}`)
}

/**
 * Download ONE weekly EP full-text delivery and report what is actually inside
 * it: how much is XML text versus PDF/A page images, and therefore what a year
 * of coverage would really cost in storage.
 *
 * This exists because the advertised 4.5 TB says nothing about the text volume —
 * the images dominate and we never keep them. It also settles the checksum
 * algorithm, since it verifies a real file.
 */
async function runMeasure(args: Args) {
  const { token, mode } = await acquireToken()
  console.log(`→ access mode: ${mode}`)

  const product = await getProduct(token, args.productId ?? EP_FULLTEXT_PRODUCT_ID)
  console.log(`→ product [${product.id}] ${product.name}`)

  // Prefer a recent weekly delivery: exactly one sizeable archive, no README noise.
  const candidates = (product.deliveries ?? [])
    .map(delivery => {
      const archives = (delivery.files ?? []).filter(file => /\.(zip|tar)$/i.test(file.fileName))
      const bytes = archives.reduce((sum, file) => sum + (parseFileSize(file.fileSize) ?? 0), 0)
      return { delivery, archives, bytes }
    })
    .filter(c => c.archives.length === 1 && c.bytes > 100 * 1024 ** 2)
    .sort((a, b) => (b.delivery.deliveryPublicationDatetime ?? '').localeCompare(a.delivery.deliveryPublicationDatetime ?? ''))

  const chosen = args.deliveryId
    ? candidates.find(c => c.delivery.deliveryId === args.deliveryId)
    : candidates[0]

  if (!chosen) {
    console.log('  no single-archive delivery found to measure')
    return
  }

  const file = chosen.archives[0]
  console.log(`→ delivery ${chosen.delivery.deliveryId} "${chosen.delivery.deliveryName}"`)
  console.log(`→ file ${file.fileName} (${formatBytes(chosen.bytes)})`)

  const destination = join(args.dataDir, file.fileName)
  try {
    heading('DOWNLOAD')
    let lastReport = 0
    const result = await downloadFile(
      token,
      { productId: product.id, deliveryId: chosen.delivery.deliveryId, fileId: file.fileId },
      destination,
      {
        onProgress: (written, total) => {
          if (written - lastReport < 500 * 1024 ** 2) return
          lastReport = written
          const pct = total ? ` (${((written / total) * 100).toFixed(0)}%)` : ''
          console.log(`  ${formatBytes(written)}${pct}`)
        },
      }
    )
    console.log(`  done: ${formatBytes(result.bytesWritten)}`)

    heading('CHECKSUM ALGORITHM')
    const verification = await verifyFile(destination, file.fileChecksum)
    if (verification.ok) {
      console.log(`  ✓ verified — fileChecksum is ${verification.algorithm!.toUpperCase()}`)
    } else {
      console.log('  ✗ no algorithm matched the advertised checksum')
      console.log(`    advertised: ${file.fileChecksum}`)
      console.log(`    computed (md5): ${verification.actual}`)
    }

    heading('ARCHIVE COMPOSITION')
    console.log('  reading central directory (nothing decompressed except nested zips)…')
    const entries = await listEntries(destination, { recurse: true })
    const composition = summarizeComposition(entries)

    const totalCompressed = composition.reduce((sum, row) => sum + row.compressedBytes, 0)
    console.log(`\n  ${entries.length} entries\n`)
    console.log(`  ${'ext'.padEnd(10)} ${'files'.padStart(7)} ${'compressed'.padStart(12)} ${'uncompressed'.padStart(13)}   share`)
    for (const row of composition) {
      const share = totalCompressed ? (row.compressedBytes / totalCompressed) * 100 : 0
      console.log(
        `  ${row.extension.padEnd(10)} ${String(row.count).padStart(7)} ` +
        `${formatBytes(row.compressedBytes).padStart(12)} ${formatBytes(row.uncompressedBytes).padStart(13)}   ${share.toFixed(1)}%`
      )
    }

    heading('WHAT THIS MEANS FOR STORAGE')
    const xml = composition.filter(row => row.extension === 'xml')
    const xmlUncompressed = xml.reduce((sum, row) => sum + row.uncompressedBytes, 0)
    const xmlCount = xml.reduce((sum, row) => sum + row.count, 0)
    const imageExts = new Set(['pdf', 'tif', 'tiff', 'jpg', 'jpeg', 'png'])
    const imageBytes = composition
      .filter(row => imageExts.has(row.extension))
      .reduce((sum, row) => sum + row.compressedBytes, 0)

    console.log(`  XML documents          : ${xmlCount}`)
    console.log(`  XML uncompressed text  : ${formatBytes(xmlUncompressed)}`)
    console.log(`  image bytes skipped    : ${formatBytes(imageBytes)} ` +
      `(${totalCompressed ? ((imageBytes / totalCompressed) * 100).toFixed(1) : '0'}% of the archive)`)

    // Postgres stores long text TOASTed with LZ4/pglz; patent prose compresses
    // ~3.5x. Reported as a range so it reads as an estimate, not a measurement.
    const low = xmlUncompressed / 4
    const high = xmlUncompressed / 3
    console.log(`\n  → this week in Postgres : ~${formatBytes(low)}–${formatBytes(high)} (TOAST-compressed)`)
    console.log(`  → extrapolated per year : ~${formatBytes(low * 52)}–${formatBytes(high * 52)}`)
    console.log(`  → transfer per year     : ~${formatBytes(chosen.bytes * 52)}`)
    console.log('\n  Compare against your ~150 GB budget before choosing how many years to load.')
  } finally {
    if (!args.keep) {
      await rm(args.dataDir, { recursive: true, force: true }).catch(() => {})
      console.log('\n  (archive deleted; disk usage returns to baseline)')
    } else {
      console.log(`\n  (kept at ${destination})`)
    }
  }
}

function printHelp() {
  console.log(`
EPO BDDS ingestion CLI

Commands:
  catalog     Probe the live API: products, lane resolution, volumes, delivery
              chunking, and the checksum algorithm. Downloads only the single
              smallest file (unless --no-probe). This is the Phase 0 gate.

  measure     Download ONE weekly delivery (EP full-text by default, ~10 GB) and
              report how much of it is XML text versus PDF/A page images, and
              therefore what a year of coverage really costs to store. Deletes
              the archive afterwards unless --keep.

  preflight   Read-only checks: disk headroom, ledger tables, provenance columns,
              EPO credentials. Writes nothing. Run before any import.

  backfill    The real import. Downloads file N+1 while extracting and loading
              file N, enforcing the free-disk floor throughout. Safe to kill and
              re-run — the ledger skips anything already LOADED.

  incremental Same engine, for the weekly cron: applies only what is not yet loaded.

Flags:
  --lane <ep-fulltext|docdb|inpadoc>   Restrict to one lane (catalog)
  --year <YYYY>                        Import a single publication year
  --from-year / --to-year <YYYY>       Import a year range
  --authority <XX,YY>                  Restrict to authorities, e.g. IN,EP
  --no-create-missing                  DOCDB: enrich only, add no new rows
  --create-missing                     EP: also create rows for publications not
                                       in the corpus (off by default — granted EP
                                       specs have no abstract to embed)
  --text-policy <p>                    EP text to keep:
                                         claims-full+description-5k  (DEFAULT, ~1.8 GB/yr)
                                         claims-full+description-full (~9.2 GB/yr)
                                         claims-full                  (~1.3 GB/yr)
                                         first-claim-only             (~0.2 GB/yr)
  --only-dated                         Skip files with no year in the name (bounds
                                       the transfer; may miss undated coverage)
  --dry-run                            Print the work list, download nothing
  --limit <n>                          Cap the number of files this run
  --no-probe                           Skip the checksum download (catalog)
  --product <id>                       Product to measure (default 32, EP full-text)
  --delivery <id>                      Specific delivery to measure
  --keep                               Keep the downloaded archive
  --data-dir <path>                    Scratch dir for downloads
  --help                               This message

Environment:
  EPO_USERNAME, EPO_PASSWORD           Required. Free EPO account.
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  switch (args.command) {
    case 'catalog':
      await runCatalog(args)
      break
    case 'preflight':
      await runPreflight(args)
      break
    case 'backfill':
    case 'incremental':
      await runBackfill(args)
      break
    case 'inspect':
      await runInspect(args)
      break
    case 'fetch':
      await runFetch(args)
      break
    case 'measure':
      await runMeasure(args)
      break
    case 'help':
    default:
      printHelp()
      break
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n✗ ${message}`)
  if (error instanceof BddsAuthError && !process.env.EPO_USERNAME) {
    console.error(`
  The anonymous attempt was rejected, so this endpoint does require an account.
  Get one (free) at:

    1. Open  https://publication-bdds.apps.epo.org/
       It redirects to login.epo.org — use "create account" there if you have
       no EPO account yet. Registration is free; the datasets we need are in
       the free/public area, so no paid subscription is required.
    2. Re-run with those same credentials:

       EPO_USERNAME='you@example.com' EPO_PASSWORD='...' \\
         npx tsx scripts/epo-bdds-import/cli.ts catalog
`)
  }
  process.exitCode = 1
})
