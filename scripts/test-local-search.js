// Test the local search functionality
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function searchLocal(query, limit) {
  // Basic local search: simple ILIKE matches over title and abstract
  // Extract simple keywords by splitting on spaces and removing quotes
  const q = query.replace(/"/g, ' ').toLowerCase();
  const tokens = Array.from(new Set(q.split(/\s+/).filter(t => t && t.length > 2))).slice(0, 8);

  if (tokens.length === 0) return [];

  // Fetch a window of candidates, then score in JS similar to calculateContentRelevance
  const candidates = await prisma.localPatent.findMany({
    take: Math.max(limit * 10, 100),
  });

  const scored = candidates.map((p) => {
    const title = (p.title || '').toLowerCase();
    const abstract = (p.abstract || p.abstractOriginal || '').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      const occurrences = (abstract.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
      score += occurrences;
    }
    return { patent: p, score };
  }).filter(s => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  // Map to SerpAPI-like organic_results entries so downstream processing works
  return top.map(({ patent }, idx) => ({
    position: idx + 1,
    title: patent.title,
    snippet: (patent.abstract || patent.abstractOriginal || '').slice(0, 500),
    publication_number: patent.publicationNumber,
    link: undefined,
  }));
}

async function main() {
  try {
    console.log('Testing local search for "gas sensing device"...');
    const results = await searchLocal('gas sensing device', 5);

    console.log(`Found ${results.length} local patents:`);
    results.forEach((result, i) => {
      console.log(`${i+1}. ${result.publication_number}: ${result.title}`);
    });

    console.log('\nTesting another query for "artificial intelligence"...');
    const aiResults = await searchLocal('artificial intelligence', 3);

    console.log(`Found ${aiResults.length} local patents:`);
    aiResults.forEach((result, i) => {
      console.log(`${i+1}. ${result.publication_number}: ${result.title}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
