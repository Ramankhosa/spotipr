import { NextRequest, NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import crypto from 'crypto'
import plantumlEncoder from 'plantuml-encoder'

// Whitelist of allowed single-line skinparam keys (same as main route.ts)
const ALLOWED_SKINPARAM_KEYS = /^skinparam\s+(backgroundColor|rectangleBackgroundColor|componentBackgroundColor|packageBackgroundColor|activityBackgroundColor|participantBackgroundColor|actorBackgroundColor|monochrome|shadowing|roundcorner|defaultFontName|defaultFontSize|ArrowColor|BorderColor|linetype|nodesep|ranksep|BorderThickness|PackageBorderThickness|PackageTitleFontStyle|RectanglePadding|PackagePadding|ArrowThickness)\b/i

// Explicitly banned skinparam patterns
const BANNED_SKINPARAM_PATTERNS = /^skinparam\s+(FontColor|.*Style(?!.*PackageTitleFontStyle))\b/i

// ═══════════════════════════════════════════════════════════════════════════════
// SKINPARAM BLOCK HANDLING - ATOMIC BLOCK PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════
// CRITICAL: Skinparam blocks MUST be processed atomically.
// If a block header is removed, the ENTIRE block body must be removed.
// Partial block survival (orphan BorderStyle/BorderThickness lines) is a hard error.
//
// ONLY THREE BLOCK TYPES ARE EVER ALLOWED:
//   1. skinparam rectangle<<optional>> { ... }  (REQUIRES stereotype)
//   2. skinparam sequence { ... }
//   3. skinparam activity { ... }
// ═══════════════════════════════════════════════════════════════════════════════

// Allowed skinparam block types (STRICT):
// - rectangle REQUIRES <<optional>> or other stereotype (plain rectangle NOT allowed)
// - sequence and activity are allowed standalone
const ALLOWED_SKINPARAM_BLOCKS = /^skinparam\s+(sequence|activity)\s*\{|^skinparam\s+rectangle\s*<<\w+>>\s*\{/i

// Detection pattern for ANY skinparam block start
const SKINPARAM_BLOCK_START = /^skinparam\s+\w+\s*(<<\w+>>)?\s*\{/i

// Helper to count brace depth change for a line
function countBraceDepthChange(line: string): number {
  let delta = 0
  for (const char of line) {
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

// ORPHAN LINE PATTERNS - These lines MUST NOT appear outside a valid skinparam block
const ORPHAN_SKINPARAM_BODY_PATTERNS = /^\s*(BorderStyle|BorderThickness|BorderColor|BackgroundColor|FontColor|FontSize|FontStyle|FontName|RoundCorner|Shadowing)\b/i

// Final safety validator
function validateNoOrphanSkinparamLines(code: string): { valid: boolean; orphanLines: string[] } {
  const lines = code.split(/\r?\n/)
  const orphans: string[] = []
  
  let inValidBlock = false
  let braceDepth = 0
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
      inValidBlock = true
      braceDepth = countBraceDepthChange(trimmed)
      continue
    }
    
    if (inValidBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        inValidBlock = false
        braceDepth = 0
      }
      continue
    }
    
    if (ORPHAN_SKINPARAM_BODY_PATTERNS.test(trimmed)) {
      orphans.push(trimmed)
    }
  }
  
  return { valid: orphans.length === 0, orphanLines: orphans }
}

// ═══════════════════════════════════════════════════════════════════════════════
// cleanForRendering - Pre-render cleaning with ATOMIC block processing
// ═══════════════════════════════════════════════════════════════════════════════
function cleanForRendering(code: string): string {
  const lines = code.split(/\r?\n/)
  const result: string[] = []
  
  // Block tracking state
  let inAllowedBlock = false
  let skipBlock = false           // SKIP MODE: Inside a forbidden block - drop ALL lines
  let braceDepth = 0
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // ───────────────────────────────────────────────────────────────────────────
    // PRIORITY 1: If we're in SKIP MODE, drop everything until block closes
    // ───────────────────────────────────────────────────────────────────────────
    if (skipBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        skipBlock = false
        braceDepth = 0
      }
      continue // DROP this line
    }
    
    // ───────────────────────────────────────────────────────────────────────────
    // PRIORITY 2: Handle allowed block content
    // ───────────────────────────────────────────────────────────────────────────
    if (inAllowedBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      
      // Filter banned properties even inside allowed blocks
      if (!BANNED_SKINPARAM_PATTERNS.test(trimmed) && 
          !/^\s*FontColor\b/i.test(trimmed)) {
        result.push(line)
      }
      
      if (braceDepth <= 0) {
        inAllowedBlock = false
        braceDepth = 0
      }
      continue
    }
    
    // ───────────────────────────────────────────────────────────────────────────
    // Not inside any block - process line normally
    // ───────────────────────────────────────────────────────────────────────────
    
    // Remove title/caption
    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    
    // Remove forbidden directives
    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(trimmed)) continue
    
    // Drop incomplete connection lines
    if (/^\s*\d+\s*--\s*$/.test(trimmed)) continue
    
    // ───────────────────────────────────────────────────────────────────────────
    // Handle skinparam block START - ATOMIC processing decision
    // ───────────────────────────────────────────────────────────────────────────
    if (SKINPARAM_BLOCK_START.test(trimmed)) {
      const headerBraceChange = countBraceDepthChange(trimmed)
      
      if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
        inAllowedBlock = true
        braceDepth = headerBraceChange
        result.push(line)
        
        if (braceDepth <= 0) {
          inAllowedBlock = false
          braceDepth = 0
        }
      } else {
        // FORBIDDEN - enter skip mode and drop ENTIRE block
        skipBlock = true
        braceDepth = headerBraceChange
        
        if (braceDepth <= 0) {
          skipBlock = false
          braceDepth = 0
        }
      }
      continue
    }
    
    // Handle single-line skinparam
    if (/^\s*skinparam\b/i.test(trimmed)) {
      if (BANNED_SKINPARAM_PATTERNS.test(trimmed)) {
        continue
      }
      if (ALLOWED_SKINPARAM_KEYS.test(trimmed)) {
        result.push(line)
      }
      continue
    }
    
    // Keep all other lines
    result.push(line)
  }
  
  // ───────────────────────────────────────────────────────────────────────────
  // FINAL SAFETY CHECK
  // ───────────────────────────────────────────────────────────────────────────
  const sanitizedOutput = result.join('\n')
  const validation = validateNoOrphanSkinparamLines(sanitizedOutput)
  
  if (!validation.valid) {
    console.error('[cleanForRendering] CRITICAL: Orphan skinparam body lines detected:', validation.orphanLines)
    return result.filter(line => !ORPHAN_SKINPARAM_BODY_PATTERNS.test(line.trim())).join('\n')
  }
  
  return sanitizedOutput
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, format = 'svg', figureNo, patentId, sessionId } = body || {}
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (format !== 'svg' && format !== 'png') {
      return NextResponse.json({ error: 'format must be svg or png' }, { status: 400 })
    }

    // Clean the PlantUML code while preserving allowed skinparams
    const cleaned = cleanForRendering(code)

    const encoded = plantumlEncoder.encode(cleaned)
    const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
    const url = `${base}/${format}/${encoded}`

    const resp = await fetch(url, { cache: 'no-store', method: 'GET', headers: { 'Accept': format === 'svg' ? 'image/svg+xml' : 'image/png' } })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      const snippet = cleaned.slice(0, 400)
      console.warn('[PlantUML proxy] Upstream render failed', {
        upstreamStatus: resp.status,
        format,
        figureNo,
        patentId,
        sessionId,
        snippet
      })
      return NextResponse.json(
        { error: 'Upstream render failed', upstreamStatus: resp.status, details: text?.slice(0, 300) },
        { status: 502 }
      )
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const checksum = crypto.createHash('sha256').update(buf).digest('hex')

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': format === 'svg' ? 'image/svg+xml' : 'image/png',
        'Cache-Control': 'private, max-age=0',
        'X-Checksum': checksum
      }
    })
  } catch (e) {
    console.warn('[PlantUML proxy] Bad request', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
