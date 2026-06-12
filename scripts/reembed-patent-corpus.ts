import './load-env'
import { PrismaClient } from '@prisma/client'
import {
  buildEmbeddingText,
  buildRagText,
  type ParsedApplicant,
} from '../src/lib/patent-corpus-extractor'
import { queueEmbeddingForPatent } from '../src/lib/patent-corpus-service'

const prisma = new PrismaClient()

function argValue(name: string) {
  const prefix = `${name}=`
  const found = process.argv.find(arg => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function normalizeApplicants(value: unknown): ParsedApplicant[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): ParsedApplicant | null => {
      if (typeof item === 'string') {
        const name = item.trim()
        return name ? { sequence: index + 1, name, raw: name } : null
      }
      if (item && typeof item === 'object') {
        const raw = item as Record<string, unknown>
        const name = String(raw.name || '').trim()
        if (!name) return null
        return {
          sequence: Number(raw.sequence || index + 1),
          name,
          address: typeof raw.address === 'string' ? raw.address : undefined,
          commonAddress: typeof raw.commonAddress === 'string' ? raw.commonAddress : undefined,
          raw: typeof raw.raw === 'string' ? raw.raw : name,
        }
      }
      return null
    })
    .filter((item): item is ParsedApplicant => Boolean(item))
}

function normalizeWarnings(value: unknown, abstractText: string | null) {
  const warnings = Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
  if (!abstractText && !warnings.includes('Title-only embedding')) {
    warnings.push('Title-only embedding')
  }
  return warnings
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const batchSize = Math.max(1, Number(argValue('--batch') || '500') || 500)
  const limit = Math.max(0, Number(argValue('--limit') || '0') || 0)

  let cursor = 0
  let scanned = 0
  let changed = 0
  let queued = 0

  while (true) {
    const take = limit ? Math.min(batchSize, Math.max(0, limit - scanned)) : batchSize
    if (take <= 0) break

    const patents = await prisma.localPatent.findMany({
      where: {
        id: { gt: cursor },
        ipIndiaCapturedAt: null,
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        title: true,
        abstract: true,
        applicants: true,
        inventors: true,
        classifications: true,
        ragText: true,
        embeddingText: true,
        extractionWarnings: true,
      },
    })
    if (!patents.length) break

    for (const patent of patents) {
      cursor = patent.id
      scanned += 1

      const record = {
        title: patent.title,
        abstract: patent.abstract,
        classifications: patent.classifications || [],
        applicants: normalizeApplicants(patent.applicants),
        inventors: patent.inventors || [],
      }
      const ragText = buildRagText(record)
      const embeddingText = buildEmbeddingText(record)
      const extractionWarnings = normalizeWarnings(patent.extractionWarnings, patent.abstract)

      if (ragText === patent.ragText && embeddingText === patent.embeddingText) continue
      changed += 1

      if (!dryRun) {
        await prisma.localPatent.update({
          where: { id: patent.id },
          data: {
            ragText,
            embeddingText,
            extractionWarnings,
          },
        })
        await queueEmbeddingForPatent(patent.id, embeddingText, prisma)
        queued += 1
      }
    }

    if (limit && scanned >= limit) break
  }

  console.log(JSON.stringify({
    dryRun,
    scanned,
    changed,
    queued,
  }, null, 2))
}

main()
  .catch(error => {
    console.error('[ReembedPatentCorpus] Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
