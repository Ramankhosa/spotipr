// Studio log health — turns raw pm2 output into the internal picture.
//
// Parses the structured log lines the search stack already emits
// ([PatentSearch], [PatentEmbeddingSearch]) plus Studio's own telemetry
// ([StudioTelemetry], [StudioAlert]) and prints a health summary: run
// outcomes, probe failure rates, lane timeouts, durations, and every alert.
//
// Usage (on the VM):
//   pm2 logs patentnest --lines 5000 --nostream | npx tsx scripts/studio-log-health.ts
//   npx tsx scripts/studio-log-health.ts ~/.pm2/logs/patentnest-out.log ~/.pm2/logs/patentnest-error.log
//
// Exit code 1 when red flags are present, so it can gate a cron alert:
//   ... | npx tsx scripts/studio-log-health.ts || notify "Studio logs unhealthy"

import { createReadStream } from 'fs'
import { createInterface } from 'readline'

const TAGS = ['[StudioTelemetry]', '[StudioAlert]', '[PatentSearch]', '[PatentEmbeddingSearch]', '[PriorArtStudio]'] as const

/* eslint-disable-next-line no-control-regex */
const ANSI = /\x1b\[[0-9;]*m/g

function extractJson(line: string, from: number): Record<string, unknown> | null {
  const start = line.indexOf('{', from)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < line.length; i++) {
    const ch = line[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(line.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

interface Counters { [key: string]: number }
const inc = (c: Counters, k: string, by = 1) => { c[k] = (c[k] || 0) + by }
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)

async function* lines(sources: string[]): AsyncGenerator<string> {
  if (!sources.length) {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
    for await (const line of rl) yield line
    return
  }
  for (const src of sources) {
    const rl = createInterface({ input: createReadStream(src, { encoding: 'utf-8' }), crlfDelay: Infinity })
    for await (const line of rl) yield line
  }
}

async function main() {
  const sources = process.argv.slice(2).filter(a => a !== '-')

  // studio runs
  const runs: Array<Record<string, unknown>> = []
  const alerts: Array<Record<string, unknown>> = []
  // provider/vector layer
  const probeEvents: Counters = {}
  const probeByProvider: Record<string, { ok: number; failed: number }> = {}
  const laneTimeouts: Counters = {}
  const searchDurations: number[] = []
  const providerResults: Record<string, { searches: number; results: number; textRank: number; vectorRank: number }> = {}
  let rerankCount = 0
  const otherEvents: Counters = {}
  let parsed = 0

  for await (const raw of lines(sources)) {
    const line = raw.replace(ANSI, '')
    let tag: string | null = null
    let at = -1
    for (const t of TAGS) {
      const i = line.indexOf(t)
      if (i !== -1 && (at === -1 || i < at)) { tag = t; at = i }
    }
    if (!tag) continue
    const payload = extractJson(line, at + tag.length)
    if (!payload) continue
    parsed++
    const event = String(payload.event || '')

    if (tag === '[StudioTelemetry]' && event === 'studio_run_completed') { runs.push(payload); continue }
    if (tag === '[StudioAlert]') { alerts.push(payload); continue }

    if (event === 'vector_probe_timed_out' || event === 'vector_query_completed') {
      inc(probeEvents, event)
      continue
    }
    if (event === 'vector_probes_completed') {
      const provider = String(payload.providerId || payload.traceId || 'unknown')
      const bucket = (probeByProvider[provider] ||= { ok: 0, failed: 0 })
      bucket.ok += Number(payload.succeeded || 0)
      bucket.failed += Number(payload.failed || 0)
      continue
    }
    if (event.endsWith('_timed_out')) { inc(laneTimeouts, event); continue }
    if (event === 'search_completed') {
      const provider = String(payload.providerId || 'unknown')
      const bucket = (providerResults[provider] ||= { searches: 0, results: 0, textRank: 0, vectorRank: 0 })
      bucket.searches++
      bucket.results += Number(payload.resultCount || 0)
      bucket.textRank += Number(payload.resultsWithTextRank || 0)
      bucket.vectorRank += Number(payload.resultsWithVectorRank || 0)
      if (typeof payload.durationMs === 'number') searchDurations.push(payload.durationMs)
      continue
    }
    if (event === 'rerank_completed') { rerankCount++; continue }
    if (event) inc(otherEvents, event)
  }

  // ---------------------------------------------------------------- report
  const flags: string[] = []
  console.log('\n══════════ STUDIO LOG HEALTH ══════════')
  console.log(`parsed ${parsed} structured events${sources.length ? ` from ${sources.join(', ')}` : ' from stdin'}\n`)

  console.log('— Studio runs —')
  if (!runs.length) {
    console.log('  none found (telemetry ships with the next deploy; provider events below still apply)')
  } else {
    const zero = runs.filter(r => Number(r.shown) === 0 && Number(r.retrieved) > 0)
    const noSem = runs.filter(r => r.semanticLaneRan === false)
    const durations = runs.map(r => Number(r.durationMs || 0)).sort((a, b) => a - b)
    const median = durations[Math.floor(durations.length / 2)] || 0
    console.log(`  runs: ${runs.length} · zero-shown-after-retrieval: ${zero.length} · semantic lane skipped: ${noSem.length}`)
    console.log(`  duration: median ${ms(median)} · max ${ms(durations[durations.length - 1] || 0)}`)
    const last = runs[runs.length - 1]
    console.log(
      `  last run: v${last.planVersion} (${last.planHash}) retrieved ${last.retrieved} → shown ${last.shown}` +
        ` · matchRemoved ${last.matchRemoved} · lanes ${JSON.stringify(last.lanes)} · ${ms(Number(last.durationMs || 0))}`
    )
    if (zero.length) flags.push(`${zero.length} run(s) filtered every retrieved document`)
    if (noSem.length) flags.push(`${noSem.length} run(s) executed without the semantic lane`)
  }

  console.log('\n— Vector probes —')
  const ok = probeEvents['vector_query_completed'] || 0
  const dead = probeEvents['vector_probe_timed_out'] || 0
  console.log(`  completed: ${ok} · timed out: ${dead} (${pct(dead, ok + dead)} failure)`)
  for (const [provider, b] of Object.entries(probeByProvider)) {
    console.log(`    ${provider}: ${b.ok} ok / ${b.failed} failed (${pct(b.failed, b.ok + b.failed)})`)
  }
  if (ok + dead > 0 && dead / (ok + dead) > 0.25) flags.push(`vector probe failure rate ${pct(dead, ok + dead)} (>25%)`)

  console.log('\n— Lane timeouts —')
  if (!Object.keys(laneTimeouts).length) console.log('  none')
  for (const [event, count] of Object.entries(laneTimeouts)) {
    console.log(`  ${event}: ${count}`)
    if (count >= 3) flags.push(`${event} × ${count}`)
  }

  console.log('\n— Providers —')
  for (const [provider, b] of Object.entries(providerResults)) {
    console.log(
      `  ${provider}: ${b.searches} searches · ${b.results} results · textRank ${b.textRank} · vectorRank ${b.vectorRank}`
    )
    if (b.searches >= 2 && b.results > 0 && b.textRank === 0) {
      flags.push(`${provider}: keyword lane contributed 0 across ${b.searches} searches`)
    }
  }
  if (searchDurations.length) {
    const sorted = [...searchDurations].sort((a, b) => a - b)
    console.log(`  provider search duration: median ${ms(sorted[Math.floor(sorted.length / 2)])} · max ${ms(sorted[sorted.length - 1])}`)
    if (sorted[Math.floor(sorted.length / 2)] > 15000) flags.push('median provider search > 15s (a lane is timing out)')
  }
  console.log(`  reranks: ${rerankCount}`)

  console.log('\n— Alerts —')
  if (!alerts.length) console.log('  none')
  for (const alert of alerts.slice(-10)) {
    console.log(`  ⚠ ${alert.event} (session ${String(alert.sessionId || '').slice(-8)}, plan ${alert.planHash})`)
  }
  const alertCounts: Counters = {}
  for (const alert of alerts) inc(alertCounts, String(alert.event))
  for (const [event, count] of Object.entries(alertCounts)) flags.push(`alert ${event} × ${count}`)

  console.log('\n═════════════ VERDICT ═════════════')
  if (!flags.length) {
    console.log('  ✅ healthy — no red flags in this window')
  } else {
    for (const flag of flags) console.log(`  🔴 ${flag}`)
  }
  console.log('')
  process.exit(flags.length ? 1 : 0)
}

main().catch(err => {
  console.error('log-health failed:', err)
  process.exit(2)
})
