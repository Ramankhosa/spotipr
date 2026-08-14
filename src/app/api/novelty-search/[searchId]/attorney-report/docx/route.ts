import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildNoveltyAttorneyReportModel } from '@/lib/novelty-attorney-report';
import { buildNoveltyReportDocx } from '@/lib/novelty-report-docx';
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata';
import { loadFirmBranding } from '@/lib/firm-profile-service';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * The novelty report as an editable Word document.
 *
 * Same model, same auth and same tenant branding as the PDF route next door —
 * the two must never disagree about what the report says. Not metered: this is a
 * second rendering of work the tenant has already paid to compute.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }

    const payload = verifyJWT(authHeader.substring(7));
    if (!payload?.sub) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const searchRun = await prisma.noveltySearchRun.findFirst({
      where: { id: params.searchId, userId: payload.sub },
    });
    if (!searchRun) return NextResponse.json({ error: 'Novelty search not found' }, { status: 404 });

    const firm = await loadFirmBranding(payload.tenant_id);
    const enrichedSearchRun = await hydrateNoveltyReportPatentMetadata(searchRun);
    const report = buildNoveltyAttorneyReportModel(enrichedSearchRun, firm);
    const buffer = await buildNoveltyReportDocx(report);

    const filename = `${report.reportNumber}.docx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[AttorneyReportDOCX] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate attorney report DOCX' },
      { status: 500 }
    );
  }
}
