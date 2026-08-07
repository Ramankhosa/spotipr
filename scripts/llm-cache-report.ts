/**
 * Prompt-cache hit report.
 *
 * Every provider prices cached input below fresh input but only reports the cached
 * portion per call, so eligibility is not the same as a discount. The gateway records
 * `cachedInputTokens` into usage_logs.meta; this reads it back per stage so a caching
 * change can be judged on real traffic instead of on intent.
 *
 * Usage: npx tsx scripts/llm-cache-report.ts [days]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const days = Math.max(1, Number(process.argv[2] || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT
       COALESCE(meta->>'stageCode', '(unknown)')            AS stage,
       COUNT(*)::int                                        AS calls,
       SUM("inputTokens")::bigint                           AS input_tokens,
       SUM(COALESCE((meta->>'cachedInputTokens')::numeric, 0))::bigint AS cached_tokens,
       SUM(CASE WHEN COALESCE((meta->>'cachedInputTokens')::numeric, 0) > 0 THEN 1 ELSE 0 END)::int AS calls_with_hit
     FROM usage_logs
     WHERE "completedAt" >= $1 AND status = 'COMPLETED'
     GROUP BY 1
     ORDER BY input_tokens DESC NULLS LAST`,
    since
  );

  if (rows.length === 0) {
    console.log(`No completed usage logs in the last ${days} day(s).`);
    await prisma.$disconnect();
    return;
  }

  const pad = (v: unknown, n: number) => String(v).padStart(n);
  console.log(`Prompt-cache hit rate, last ${days} day(s)\n`);
  console.log('stage                            calls   hits   input tokens   cached tokens   cached %');
  console.log('-'.repeat(88));

  let totalIn = 0n;
  let totalCached = 0n;
  for (const r of rows) {
    const input = BigInt(r.input_tokens ?? 0);
    const cached = BigInt(r.cached_tokens ?? 0);
    totalIn += input;
    totalCached += cached;
    const pct = input > 0n ? Number((cached * 1000n) / input) / 10 : 0;
    console.log(
      `${String(r.stage).slice(0, 31).padEnd(32)}${pad(r.calls, 5)}${pad(r.calls_with_hit, 7)}` +
      `${pad(input.toString(), 15)}${pad(cached.toString(), 16)}${pad(pct.toFixed(1), 10)}`
    );
  }
  console.log('-'.repeat(88));
  const overall = totalIn > 0n ? Number((totalCached * 1000n) / totalIn) / 10 : 0;
  console.log(`${'TOTAL'.padEnd(32)}${' '.repeat(12)}${pad(totalIn.toString(), 15)}${pad(totalCached.toString(), 16)}${pad(overall.toFixed(1), 10)}`);
  console.log(
    '\nA stage showing 0.0% either has no stable prompt prefix, sits under the provider' +
    '\nminimum (~1,024 tokens), or is routed to a model without prompt caching.'
  );

  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
