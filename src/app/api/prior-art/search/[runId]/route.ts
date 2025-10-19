import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
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

    const run = await prisma.priorArtRun.findUnique({
      where: { id: runId },
      include: {
        bundle: {
          select: {
            inventionBrief: true,
            bundleData: true,
          },
        },
        queryVariants: true,
        user: {
          include: {
            credits: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Query unified results separately
    const unifiedResults = await prisma.priorArtUnifiedResult.findMany({
      where: { runId: runId },
      include: {
        // No patent relationship anymore, but we can still get patent details via joins
      },
      orderBy: [
        { score: 'desc' },
        { publicationNumber: 'asc' },
      ],
    });

    // For each unified result, fetch patent details if it's a patent
    const resultsWithDetails = await Promise.all(
      unifiedResults.map(async (result) => {
        if (result.contentType === 'PATENT') {
          const patent = await prisma.priorArtPatent.findUnique({
            where: { publicationNumber: result.publicationNumber },
            include: { details: true },
          });
          return { ...result, patent };
        }
        return { ...result, patent: null };
      })
    );

    // Include Level 0 results if available (regardless of Level 1 results)
    let level0Results = [];
    if (run.level0Checked && run.level0Results) {
      try {
        const level0Data = run.level0Results as any;
        if (level0Data && level0Data.patent_assessments) {
          level0Results = await Promise.all(
            level0Data.patent_assessments.map(async (assessment: any) => {
              // Try to fetch patent details from LocalPatent table
              const localPatent = await prisma.localPatent.findUnique({
                where: { publicationNumber: assessment.publication_number },
              });

              return {
                identifier: assessment.publication_number,
                contentType: 'PATENT' as const,
                score: 0, // Level 0 doesn't have relevance scores
                intersectionType: 'NONE',
                foundInVariants: ['level0_local'],
                ranks: { broad: null, baseline: null, narrow: null },
                shortlisted: false,
                patent: localPatent ? {
                  publicationNumber: localPatent.publicationNumber,
                  title: localPatent.title,
                  abstract: localPatent.abstract,
                  publicationDate: null,
                  assignees: [],
                  inventors: [],
                  cpcs: [],
                  pdfLink: null,
                } : null,
                details: null,
                level0Relevance: assessment.relevance,
                level0Reasoning: assessment.reasoning,
              };
            })
          );
        }
      } catch (error) {
        console.warn('Failed to load Level 0 results:', error);
      }
    }

    if (run.userId !== payload.sub) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fetch scholar content separately
    const scholarIdentifiers = resultsWithDetails
      .filter((result: any) => result.contentType === 'SCHOLAR' && result.scholarIdentifier)
      .map((result: any) => result.scholarIdentifier);

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

    // Format response
    const response = {
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      creditsConsumed: run.creditsConsumed,
      apiCallsMade: run.apiCallsMade,
      level0: {
        checked: run.level0Checked,
        determination: run.level0Determination,
        results: run.level0Results,
        reportUrl: run.level0ReportUrl,
      },

      bundle: {
        inventionBrief: run.bundle.inventionBrief,
        queryVariants: run.queryVariants.map((v: any) => ({
          label: v.label,
          query: v.query,
          resultsCount: v.resultsCount,
          apiCalls: v.apiCalls,
          executedAt: v.executedAt,
        })),
      },

      results: [...resultsWithDetails, ...level0Results].map((result: any) => ({
        identifier: result.contentType === 'SCHOLAR' ? result.scholarIdentifier : result.publicationNumber,
        contentType: result.contentType,
        score: result.score,
        intersectionType: result.intersectionType,
        foundInVariants: result.foundInVariants,
        ranks: {
          broad: result.rankBroad,
          baseline: result.rankBaseline,
          narrow: result.rankNarrow,
        },
        shortlisted: result.shortlisted,
        // Include patent data if it's a patent
        ...(result.contentType === 'PATENT' && result.patent ? {
          patent: {
            publicationNumber: result.identifier,
            title: result.patent.title,
            abstract: result.patent.abstract,
            publicationDate: result.patent.publicationDate,
            assignees: result.patent.assignees,
            inventors: result.patent.inventors,
            cpcs: result.patent.cpcs,
            pdfLink: result.patent.pdfLink,
          },
          details: result.patent.details ? {
            description: result.patent.details.description,
            claims: result.patent.details.claims,
            classifications: result.patent.details.classifications,
            worldwide_applications: result.patent.details.worldwideApplications,
            events: result.patent.details.events,
            patent_citations: result.patent.details.citationsPatent,
            non_patent_citations: result.patent.details.citationsNPL,
            pdf: result.patent.details.pdfLink,
            fetchedAt: result.patent.details.fetchedAt,
            status: 'completed',
          } : null,
        } : {}),
        // Include scholar data if it's scholarly content
        ...(result.contentType === 'SCHOLAR' && result.scholarIdentifier && scholarContentMap[result.scholarIdentifier] ? {
          scholar: {
            title: scholarContentMap[result.scholarIdentifier].title,
            authors: scholarContentMap[result.scholarIdentifier].authors,
            publication: scholarContentMap[result.scholarIdentifier].publication,
            year: scholarContentMap[result.scholarIdentifier].year,
            abstract: scholarContentMap[result.scholarIdentifier].abstract,
            citationCount: scholarContentMap[result.scholarIdentifier].citationCount,
            link: scholarContentMap[result.scholarIdentifier].link,
            pdfLink: scholarContentMap[result.scholarIdentifier].pdfLink,
            doi: scholarContentMap[result.scholarIdentifier].doi,
            source: scholarContentMap[result.scholarIdentifier].source,
          }
        } : {}),
      })),

      credits: run.user.credits ? {
        total: run.user.credits.totalCredits,
        used: run.user.credits.usedCredits,
        remaining: run.user.credits.totalCredits - run.user.credits.usedCredits,
        monthlyReset: run.user.credits.monthlyReset,
      } : null,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Get search results error:', error);
    return NextResponse.json({
      error: 'Failed to retrieve search results',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
