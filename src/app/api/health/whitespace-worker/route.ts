import { NextResponse } from 'next/server'
import { readWhitespaceWorkerHealth } from '@/lib/whitespace/worker-health'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const health = await readWhitespaceWorkerHealth()
    return NextResponse.json(health, { status: health.healthy ? 200 : 503 })
  } catch (error) {
    console.error('[WhitespaceWorker] Health check failed:', error)
    return NextResponse.json({ healthy: false, error: 'Worker health is unavailable.' }, { status: 503 })
  }
}
