import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serpApiProvider } from '@/lib/serpapi-provider';
import { z } from 'zod';

// Inline the necessary functions to avoid import issues
const SerpApiDetailsResponseSchema = z.object({
  search_metadata: z.object({
    id: z.string(),
    status: z.string(),
    created_at: z.string(),
    processed_at: z.string(),
  }).optional(),
  search_parameters: z.object({
    engine: z.string(),
    patent_id: z.string(),
  }).passthrough().optional(),
  title: z.string().optional(),
  abstract: z.string().optional(),
  claims: z.any().optional(),
  description: z.string().optional(),
  classifications: z.any().optional(),
  publication_date: z.string().optional(),
  priority_date: z.string().optional(),
  worldwide_applications: z.any().optional(),
  events: z.any().optional(),
  patent_citations: z.any().optional(),
  non_patent_citations: z.any().optional(),
  pdf: z.string().optional(),
  error: z.string().optional(),
});

function parseDate(dateStr: string): Date | undefined {
  try {
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateStr);
    }
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

function normalizePatentFromDetails(response: any, publicationNumber: string) {
  const publicationDate = response.publication_date ? parseDate(response.publication_date) : undefined;
  const priorityDate = response.priority_date ? parseDate(response.priority_date) : undefined;

  const cpcs: string[] = [];
  const ipcs: string[] = [];

  if (response.classifications && Array.isArray(response.classifications)) {
    response.classifications.forEach((cls: any) => {
      if (cls.code) {
        if (cls.is_cpc) {
          cpcs.push(cls.code);
        } else {
          ipcs.push(cls.code);
        }
      }
    });
  }

  let assignees: string[] = [];
  let inventors: string[] = [];

  if (response.worldwide_applications && Array.isArray(response.worldwide_applications)) {
    response.worldwide_applications.forEach((app: any) => {
      if (app.assignees && Array.isArray(app.assignees)) {
        assignees.push(...app.assignees);
      }
      if (app.inventors && Array.isArray(app.inventors)) {
        inventors.push(...app.inventors);
      }
    });
  }

  assignees = Array.from(new Set(assignees));
  inventors = Array.from(new Set(inventors));

  return {
    publicationNumber,
    title: response.title,
    abstract: response.abstract,
    publicationDate,
    priorityDate,
    assignees,
    inventors,
    cpcs,
    ipcs,
    pdfLink: response.pdf,
    extras: {
      claims_count: response.claims ? 1 : 0,
      has_citations: (response.patent_citations?.length || 0) > 0,
    },
  };
}

async function upsertPatent(patent: any): Promise<void> {
  await prisma.priorArtPatent.upsert({
    where: { publicationNumber: patent.publicationNumber },
    update: {
      title: patent.title || undefined,
      abstract: patent.abstract || undefined,
      publicationDate: patent.publicationDate || undefined,
      priorityDate: patent.priorityDate || undefined,
      assignees: patent.assignees,
      inventors: patent.inventors,
      cpcs: patent.cpcs,
      ipcs: patent.ipcs,
      pdfLink: patent.pdfLink || undefined,
      extras: patent.extras || {},
      lastSeenAt: new Date(),
    },
    create: {
      publicationNumber: patent.publicationNumber,
      title: patent.title,
      abstract: patent.abstract,
      publicationDate: patent.publicationDate,
      priorityDate: patent.priorityDate,
      assignees: patent.assignees,
      inventors: patent.inventors,
      cpcs: patent.cpcs,
      ipcs: patent.ipcs,
      pdfLink: patent.pdfLink,
      extras: patent.extras,
    },
  });
}

async function upsertPatentDetails(publicationNumber: string, details: any): Promise<void> {
  await prisma.priorArtPatentDetail.upsert({
    where: { publicationNumber },
    update: {
      claims: details.claims || undefined,
      description: details.description || undefined,
      classifications: details.classifications || undefined,
      worldwideApplications: details.worldwide_applications || undefined,
      events: details.events || undefined,
      citationsPatent: details.patent_citations || undefined,
      citationsNPL: details.non_patent_citations || undefined,
      pdfLink: details.pdf || undefined,
      fetchedAt: new Date(),
    },
    create: {
      publicationNumber,
      claims: details.claims || undefined,
      description: details.description || undefined,
      classifications: details.classifications || undefined,
      worldwideApplications: details.worldwide_applications || undefined,
      events: details.events || undefined,
      citationsPatent: details.patent_citations || undefined,
      citationsNPL: details.non_patent_citations || undefined,
      pdfLink: details.pdf || undefined,
      fetchedAt: new Date(),
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const payload = verifyJWT(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { runId } = params;

    // Verify run ownership and get shortlisted results
    const run = await prisma.priorArtRun.findUnique({
      where: { id: runId },
      include: {
        bundle: true
      }
    });

    const shortlistedResults = await prisma.priorArtUnifiedResult.findMany({
      where: {
        runId: runId,
        shortlisted: true
      },
      select: {
        publicationNumber: true,
        scholarIdentifier: true,
        contentType: true,
        intersectionType: true
      }
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.userId !== payload.sub) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Only fetch details for intersection items (patents and scholar) (I2 and I3)
    const shortlistedItems = shortlistedResults.filter((result: any) =>
      result.intersectionType === 'I2' || result.intersectionType === 'I3'
    );
    console.log(`📋 Fetching details for ${shortlistedItems.length} intersection items`);

    // Fetch scholar content for scholar items
    const scholarIdentifiers = shortlistedItems
      .filter((item: any) => item.contentType === 'SCHOLAR' && item.scholarIdentifier)
      .map((item: any) => item.scholarIdentifier);

    let scholarContentMap: { [key: string]: any } = {};
    if (scholarIdentifiers.length > 0) {
      const scholarContents = await prisma.priorArtScholarContent.findMany({
        where: {
          identifier: {
            in: scholarIdentifiers,
          },
        },
      });

      scholarContentMap = scholarContents.reduce((map, content) => {
        map[content.identifier] = content;
        return map;
      }, {} as { [key: string]: any });
    }

    const results = [];

    for (const item of shortlistedItems) {
      try {
        if (item.contentType === 'PATENT') {
          console.log(`🔍 Fetching patent details for ${item.publicationNumber}`);

          // Try different patent ID formats
          const patentIds = [
            `patent/${item.publicationNumber}/en`,
            item.publicationNumber,
          ];

        let details = null;
        for (const patentId of patentIds) {
          try {
            details = await serpApiProvider.getPatentDetails({
              patentId,
              fields: [
                'title', 'abstract', 'claims', 'classifications', 'publication_date',
                'priority_date', 'worldwide_applications', 'events',
                'patent_citations', 'non_patent_citations', 'pdf', 'description'
              ],
              hl: 'en'
            });

            // Validate the response
            details = SerpApiDetailsResponseSchema.parse(details);
            break;
          } catch (error) {
            console.warn(`Failed to fetch details for ${patentId}:`, error);
          }
        }

          if (details) {
            // Store raw details
            await prisma.priorArtRawDetail.create({
              data: {
                publicationNumber: item.publicationNumber,
                patentId: details.search_parameters?.patent_id || item.publicationNumber,
                payload: details as any,
              },
            });

            // Normalize and upsert
            const normalized = normalizePatentFromDetails(details, item.publicationNumber);
            await upsertPatent(normalized);
            await upsertPatentDetails(item.publicationNumber, details);

            results.push({
              identifier: item.publicationNumber,
              contentType: 'PATENT',
              status: 'completed',
              details: {
                ...details,
                fetchedAt: new Date().toISOString()
              }
            });

            console.log(`✅ Successfully fetched patent details for ${item.publicationNumber}`);
          } else {
            results.push({
              identifier: item.publicationNumber,
              contentType: 'PATENT',
              status: 'failed',
              error: 'Could not fetch patent details from any source'
            });
            console.log(`❌ Failed to fetch patent details for ${item.publicationNumber}`);
          }

          // Rate limiting - wait 2 seconds between patent API requests
          await new Promise(resolve => setTimeout(resolve, 2000));

        } else if (item.contentType === 'SCHOLAR') {
          console.log(`📚 Processing scholar details for ${item.scholarIdentifier}`);

          // Scholar details are already comprehensive from Level 1
          results.push({
            identifier: item.scholarIdentifier,
            contentType: 'SCHOLAR',
            status: 'completed',
            scholar: item.scholarIdentifier ? scholarContentMap[item.scholarIdentifier] || null : null
          });

          // Option 2: Could enhance with additional API calls (future enhancement)
          // This would require additional APIs like Semantic Scholar, CrossRef, etc.
          // For now, Level 1 information is sufficient for scholarly prior art analysis
        }

      } catch (error) {
        const identifier = item.contentType === 'SCHOLAR' ? item.scholarIdentifier : item.publicationNumber;
        console.error(`❌ Error fetching details for ${identifier}:`, error);
        results.push({
          identifier: identifier,
          contentType: item.contentType,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Fetched details for ${results.filter(r => r.status === 'completed').length}/${shortlistedItems.length} items`,
      results
    });

  } catch (error) {
    console.error('Detailed analysis error:', error);
    return NextResponse.json({
      error: 'Failed to fetch detailed analysis',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
