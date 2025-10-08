import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PriorArtLLMService } from '@/lib/prior-art-llm';

export async function POST(request: NextRequest) {
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

    const { patentId, brief } = await request.json();

    if (!patentId || !brief) {
      return NextResponse.json({ error: 'Patent ID and brief required' }, { status: 400 });
    }

    // Use the JWT token we already extracted for the LLM gateway
    const result = await PriorArtLLMService.generateBundle({
      patentId,
      inventionBrief: brief,
      jwtToken: token,
    });

    if (!result.success) {
      return NextResponse.json({
        error: 'Bundle generation failed',
        details: result.error
      }, { status: 500 });
    }

    return NextResponse.json({
      bundle: result.bundle,
      usage: result.usage,
      message: "Bundle generated successfully"
    });

  } catch (error) {
    console.error('Bundle generation error:', error);
    return NextResponse.json({
      error: 'Bundle generation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

