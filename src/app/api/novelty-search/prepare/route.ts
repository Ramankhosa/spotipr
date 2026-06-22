import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService, type NoveltySearchRequest } from '@/lib/novelty-search-service';

const noveltySearchService = new NoveltySearchService();

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }

    const body = await request.json();
    const title = String(body.title || '').trim();
    const inventionDescription = String(body.inventionDescription || '').trim();
    if (!title || !inventionDescription) {
      return NextResponse.json({ error: 'Invention title and description are required' }, { status: 400 });
    }

    const searchRequest: NoveltySearchRequest = {
      jwtToken: authHeader.slice(7),
      title,
      inventionDescription,
      jurisdiction: body.jurisdiction || 'IN',
      config: body.config,
    };
    const result = await noveltySearchService.prepareNoveltySearch(searchRequest);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to generate search terms' }, { status: 500 });
    }

    return NextResponse.json({ success: true, stage0: result.results });
  } catch (error) {
    console.error('Novelty search preparation API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
