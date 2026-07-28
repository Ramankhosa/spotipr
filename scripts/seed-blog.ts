/**
 * Seeds the journal: categories, the editorial byline, and the ten launch
 * articles from scripts/blog-seed/.
 *
 *   npx tsx scripts/seed-blog.ts            # publish (idempotent, upserts by slug)
 *   npx tsx scripts/seed-blog.ts --dry      # audit only, no writes
 *   npx tsx scripts/seed-blog.ts --drafts   # load them as drafts instead of live
 *
 * Derived fields (word count, reading time, SEO score) are computed with the
 * same functions the composer and the API use, so a seeded post is scored
 * exactly as a hand-written one would be. Re-running is safe: posts are matched
 * on slug and updated in place, which is also how you push a content revision.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { CATEGORIES, EDITORIAL_AUTHOR, POSTS } from './blog-seed'
import { countWords, readingMinutes } from '../src/lib/blog/content'
import { auditPost } from '../src/lib/blog/seo-audit'

const prisma = new PrismaClient()

const DRY = process.argv.includes('--dry')
const AS_DRAFTS = process.argv.includes('--drafts')

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(9, 30, 0, 0)
  return date
}

async function main() {
  console.log(`\n📝 Seeding the PatentNest Journal${DRY ? ' (dry run)' : ''}\n`)

  // --- Categories ---------------------------------------------------------
  const categoryIds = new Map<string, string>()
  for (const category of CATEGORIES) {
    if (DRY) {
      categoryIds.set(category.slug, 'dry-run')
      continue
    }
    const record = await prisma.blogCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: category,
    })
    categoryIds.set(category.slug, record.id)
  }
  console.log(`   ${CATEGORIES.length} topic hubs`)

  // --- Author -------------------------------------------------------------
  let authorId = 'dry-run'
  if (!DRY) {
    const author = await prisma.blogAuthor.upsert({
      where: { slug: EDITORIAL_AUTHOR.slug },
      create: EDITORIAL_AUTHOR,
      update: EDITORIAL_AUTHOR,
    })
    authorId = author.id
  }
  console.log(`   1 byline (${EDITORIAL_AUTHOR.name})\n`)

  // --- Posts --------------------------------------------------------------
  let totalScore = 0

  for (const seed of POSTS) {
    const categoryId = categoryIds.get(seed.categorySlug)
    if (!categoryId) throw new Error(`Unknown category "${seed.categorySlug}" for ${seed.slug}`)

    const audit = auditPost({ ...seed, authorId, categoryId, reviewerId: null })
    totalScore += audit.score

    const failing = audit.checks.filter((c) => c.status === 'fail').map((c) => c.id)
    const flag = audit.score >= 85 ? '✓' : audit.score >= 70 ? '·' : '!'
    console.log(
      `   ${flag} ${String(audit.score).padStart(3)}/100  ${seed.slug.padEnd(38)} ` +
        `${String(audit.stats.words).padStart(5)}w  ${audit.stats.internalLinks}→ ${audit.stats.externalLinks}↗` +
        (failing.length ? `  fails: ${failing.join(', ')}` : '')
    )

    if (DRY) continue

    const data = {
      title: seed.title,
      subtitle: seed.subtitle,
      excerpt: seed.excerpt,
      content: seed.content.trim(),
      answerSummary: seed.answerSummary,
      keyTakeaways: seed.keyTakeaways,
      // The column is JSON; the seed type is structured, so tell Prisma so.
      faqs: seed.faqs as unknown as Prisma.InputJsonValue,
      focusKeyword: seed.focusKeyword,
      secondaryKeywords: seed.secondaryKeywords,
      tags: seed.tags,
      jurisdictions: seed.jurisdictions,
      seoTitle: seed.seoTitle,
      seoDescription: seed.seoDescription,
      relatedSlugs: seed.relatedSlugs,
      featured: seed.featured ?? false,
      status: (AS_DRAFTS ? 'DRAFT' : 'PUBLISHED') as 'DRAFT' | 'PUBLISHED',
      publishedAt: AS_DRAFTS ? null : daysAgo(seed.publishedDaysAgo),
      wordCount: countWords(seed.content),
      readingMinutes: readingMinutes(seed.content),
      seoScore: audit.score,
      seoChecks: audit.checks as unknown as Prisma.InputJsonValue,
      categoryId,
      authorId,
      updatedBy: 'seed:scripts/seed-blog.ts',
    }

    await prisma.blogPost.upsert({
      where: { slug: seed.slug },
      create: { ...data, slug: seed.slug, createdBy: 'seed:scripts/seed-blog.ts' },
      update: data,
    })
  }

  const mean = Math.round(totalScore / POSTS.length)
  console.log(`\n   ${POSTS.length} articles · mean SEO score ${mean}/100`)

  if (!DRY) {
    console.log(`\n   Live at /blog${AS_DRAFTS ? ' (as drafts — publish from /super-admin/blog)' : ''}`)
    console.log(
      '   Note: every post is bylined to the editorial desk with no reviewer.\n' +
        '   Assign a real author and reviewer in the composer before launch — that is\n' +
        '   what the "byline" check is flagging.\n'
    )
  }
}

main()
  .catch((error) => {
    console.error('\n❌ Seed failed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
