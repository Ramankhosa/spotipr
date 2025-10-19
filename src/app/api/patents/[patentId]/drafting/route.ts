import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { DraftingService } from '@/lib/drafting-service';
import { llmGateway } from '@/lib/metering/gateway';
import crypto from 'crypto';

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { patentId } = params;

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      );
    }

    // Get drafting sessions for this patent
    const sessions = await prisma.draftingSession.findMany({
      where: {
        patentId,
        userId: authResult.user.id,
        tenantId: authResult.user.tenantId
      },
      include: {
        ideaRecord: true,
        referenceMap: true,
        figurePlans: true,
        diagramSources: true,
        annexureDrafts: {
          orderBy: { version: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ sessions });

  } catch (error) {
    console.error('GET /api/patents/[patentId]/drafting error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { patentId } = params;
    const body = await request.json();
    const { action, ...data } = body;

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      );
    }

    // Extract request headers for LLM calls
    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    // Route to appropriate handler based on action
    switch (action) {
      case 'start_session':
        return await handleStartSession(authResult.user, patentId, data);

      case 'normalize_idea':
        return await handleNormalizeIdea(authResult.user, patentId, data, requestHeaders);

      case 'proceed_to_components':
        return await handleProceedToComponents(authResult.user, patentId, data);

      case 'update_component_map':
        return await handleUpdateComponentMap(authResult.user, patentId, data);

      case 'update_figure_plan':
        return await handleUpdateFigurePlan(authResult.user, patentId, data);

      case 'generate_plantuml':
        return await handleGeneratePlantUML(authResult.user, patentId, data);

      case 'upload_diagram':
        return await handleUploadDiagram(authResult.user, patentId, data);

      case 'generate_draft':
        return await handleGenerateDraft(authResult.user, patentId, data, requestHeaders);

      case 'generate_diagrams_llm':
        return await handleGenerateDiagramsLLM(authResult.user, patentId, data, requestHeaders);

      case 'save_plantuml':
        return await handleSavePlantUML(authResult.user, patentId, data);

      case 'regenerate_diagram_llm':
        return await handleRegenerateDiagramLLM(authResult.user, patentId, data, requestHeaders);

      case 'add_figure_llm':
        return await handleAddFigureLLM(authResult.user, patentId, data, requestHeaders);

      case 'add_figures_llm':
        return await handleAddFiguresLLM(authResult.user, patentId, data, requestHeaders);

      case 'delete_figure':
        return await handleDeleteFigure(authResult.user, patentId, data);

      // New actions for Stage 1 editing, navigation, and resume
      case 'update_idea_record':
        return await handleUpdateIdeaRecord(authResult.user, patentId, data);

      case 'set_stage':
        return await handleSetStage(authResult.user, patentId, data);

      case 'resume':
        return await handleResume(authResult.user, patentId);

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('POST /api/patents/[patentId]/drafting error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function sanitizePlantUML(input: string): string {
  const match = input.match(/@startuml[\s\S]*?@enduml/)
  const block = match ? match[0] : input
  const lines = block.split(/\r?\n/).filter(line => {
    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(line)) return false
    if (/^\s*skinparam\b/i.test(line)) return false
    if (/^\s*(title|caption)\b/i.test(line)) return false
    return true
  })
  return lines.join('\n')
}

async function handleStartSession(user: any, patentId: string, data: any) {
  // Check if a session already exists
  const existingSession = await prisma.draftingSession.findFirst({
    where: {
      patentId,
      userId: user.id,
      status: { not: 'COMPLETED' }
    }
  });

  if (existingSession) {
    return NextResponse.json({
      session: existingSession,
      message: 'Existing session found'
    });
  }

  // Create new drafting session
  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId,
      status: 'IDEA_ENTRY'
    }
  });

  return NextResponse.json({ session }, { status: 201 });
}

async function handleUpdateIdeaRecord(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data

  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json(
      { error: 'Session ID and patch object are required' },
      { status: 400 }
    )
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Build safe update payload (partial updates allowed)
  const allowedKeys = [
    'problem','objectives','components','logic','inputs','outputs','variants','bestMethod','normalizedData',
    'fieldOfRelevance','subfield','recommendedFocus','complianceNotes','drawingsFocus','claimStrategy','riskFlags','title',
    'rawInput'
  ] as const

  const updateData: Record<string, any> = {}
  for (const key of allowedKeys) {
    if (key in patch) updateData[key] = patch[key]
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update' },
      { status: 400 }
    )
  }

  // Fetch existing to preserve required fields and normalized JSON
  const existing = await prisma.ideaRecord.findUnique({ where: { sessionId } })

  // Merge edits into normalizedData to keep a single source of truth
  const normalizedMergeKeys = [
    'problem','objectives','components','logic','inputs','outputs','variants','bestMethod',
    'fieldOfRelevance','subfield','recommendedFocus','complianceNotes','drawingsFocus','claimStrategy','riskFlags'
  ] as const

  const baseNormalized = (existing?.normalizedData as any) || {}
  const normalizedPatch: Record<string, any> = {}
  normalizedMergeKeys.forEach((k) => {
    if (k in patch) normalizedPatch[k] = (patch as any)[k]
  })
  const mergedNormalized = { ...baseNormalized, ...normalizedPatch }

  const ideaRecord = await prisma.ideaRecord.upsert({
    where: { sessionId },
    update: { ...updateData, normalizedData: mergedNormalized },
    create: {
      sessionId,
      title: updateData.title || 'Untitled',
      rawInput: '',
      normalizedData: Object.keys(mergedNormalized).length ? mergedNormalized : {},
      ...updateData
    }
  })

  // Persist raw input to disk if provided
  try {
    if (typeof updateData.rawInput === 'string') {
      const fs = await import('fs/promises')
      const path = await import('path')
      const baseDir = path.join(process.cwd(), 'uploads', 'patents', patentId)
      await fs.mkdir(baseDir, { recursive: true })
      const filePath = path.join(baseDir, 'raw-idea.txt')
      await fs.writeFile(filePath, updateData.rawInput, 'utf8')
    }
  } catch (e) {
    console.warn('Failed to persist raw idea to disk:', e)
  }

  return NextResponse.json({ ideaRecord })
}

async function handleSetStage(user: any, patentId: string, data: any) {
  const { sessionId, stage } = data

  const allowedStages = [
    'IDEA_ENTRY','COMPONENT_PLANNER','FIGURE_PLANNER','DIAGRAM_GENERATOR','ANNEXURE_DRAFT','REVIEW_FIX','COMPLETED'
  ]

  if (!sessionId || !allowedStages.includes(stage)) {
    return NextResponse.json(
      { error: 'Valid sessionId and stage are required' },
      { status: 400 }
    )
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: stage }
  })

  return NextResponse.json({ session: updated })
}

async function handleResume(user: any, patentId: string) {
  // Try to find most recent session for this patent
  const existing = await prisma.draftingSession.findFirst({
    where: { patentId, userId: user.id },
    orderBy: { createdAt: 'desc' }
  })

  if (existing) {
    return NextResponse.json({ session: existing })
  }

  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId,
      status: 'IDEA_ENTRY'
    }
  })

  return NextResponse.json({ session }, { status: 201 })
}

async function handleProceedToComponents(user: any, patentId: string, data: any) {
  const { sessionId } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Update session status to COMPONENT_PLANNER
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'COMPONENT_PLANNER' }
  });

  return NextResponse.json({ message: 'Proceeded to component planning' });
}

async function handleNormalizeIdea(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, rawIdea, title, areaOfInvention } = data;

  if (!sessionId || !rawIdea || !title) {
    return NextResponse.json(
      { error: 'Session ID, raw idea, and title are required' },
      { status: 400 }
    );
  }

  // Validate title length (≤ 15 words)
  const titleWords = title.trim().split(/\s+/).length;
  if (titleWords > 15) {
    return NextResponse.json(
      { error: 'Title must be 15 words or less' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Use LLM to normalize the idea
  console.log('Starting idea normalization for patent:', patentId, 'session:', sessionId);

  const result = await DraftingService.normalizeIdea(rawIdea, title, user.tenantId, requestHeaders, areaOfInvention);

  if (!result.success) {
    console.error('Idea normalization failed:', result.error);
    return NextResponse.json(
      { error: `Failed to normalize idea: ${result.error}` },
      { status: 400 }
    );
  }

  console.log('Idea normalization successful');

  // Create or update idea record
  const ideaRecord = await prisma.ideaRecord.upsert({
    where: { sessionId },
    update: {
      title,
      rawInput: rawIdea,
      normalizedData: result.normalizedData,
      problem: result.extractedFields.problem,
      objectives: result.extractedFields.objectives,
      components: result.extractedFields.components,
      logic: result.extractedFields.logic,
      inputs: result.extractedFields.inputs,
      outputs: result.extractedFields.outputs,
      variants: result.extractedFields.variants,
      bestMethod: result.extractedFields.bestMethod,
      llmPromptUsed: result.llmPrompt,
      llmResponse: result.llmResponse,
      tokensUsed: result.tokensUsed
    },
    create: {
      sessionId,
      title,
      rawInput: rawIdea,
      normalizedData: result.normalizedData,
      problem: result.extractedFields.problem,
      objectives: result.extractedFields.objectives,
      components: result.extractedFields.components,
      logic: result.extractedFields.logic,
      inputs: result.extractedFields.inputs,
      outputs: result.extractedFields.outputs,
      variants: result.extractedFields.variants,
      bestMethod: result.extractedFields.bestMethod,
      llmPromptUsed: result.llmPrompt,
      llmResponse: result.llmResponse,
      tokensUsed: result.tokensUsed
    }
  });

  // Keep session status as IDEA_ENTRY so user sees Stage 1 first
  // Status will be updated to COMPONENT_PLANNER when they proceed from Stage 1
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'IDEA_ENTRY' }
  });

  return NextResponse.json({
    ideaRecord,
    normalizedData: result.normalizedData,
    extractedFields: result.extractedFields
  });
}

async function handleUpdateComponentMap(user: any, patentId: string, data: any) {
  const { sessionId, components } = data;

  if (!sessionId || !components) {
    return NextResponse.json(
      { error: 'Session ID and components are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Validate components and assign numerals
  const validation = DraftingService.validateComponentMap(components);

  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Invalid component map', details: validation.errors },
      { status: 400 }
    );
  }

  // Create or update reference map
  const referenceMap = await prisma.referenceMap.upsert({
    where: { sessionId },
    update: {
      components: validation.components,
      isValid: true,
      validationErrors: null
    },
    create: {
      sessionId,
      components: validation.components,
      isValid: true
    }
  });

  // Update session status
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'FIGURE_PLANNER' }
  });

  return NextResponse.json({ referenceMap });
}

async function handleUpdateFigurePlan(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, nodes, edges, description } = data;

  if (!sessionId || !figureNo || !title) {
    return NextResponse.json(
      { error: 'Session ID, figure number, and title are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Create or update figure plan
  const figurePlan = await prisma.figurePlan.upsert({
    where: {
      sessionId_figureNo: {
        sessionId,
        figureNo
      }
    },
    update: {
      title,
      nodes,
      edges,
      description
    },
    create: {
      sessionId,
      figureNo,
      title,
      nodes,
      edges,
      description
    }
  });

  // Update session status if this is the first figure
  const figureCount = await prisma.figurePlan.count({ where: { sessionId } });
  if (figureCount === 1) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { status: 'DIAGRAM_GENERATOR' }
    });
  }

  return NextResponse.json({ figurePlan });
}

async function handleGeneratePlantUML(user: any, patentId: string, data: any) {
  const { sessionId, figureNo } = data;

  if (!sessionId || !figureNo) {
    return NextResponse.json(
      { error: 'Session ID and figure number are required' },
      { status: 400 }
    );
  }

  // Verify session ownership and get figure plan
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    },
    include: {
      figurePlans: {
        where: { figureNo }
      },
      referenceMap: true
    }
  });

  if (!session || !session.figurePlans[0]) {
    return NextResponse.json(
      { error: 'Session or figure plan not found' },
      { status: 404 }
    );
  }

  // Generate PlantUML code
  const result = await DraftingService.generatePlantUML(
    session.figurePlans[0],
    session.referenceMap
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Create or update diagram source
  const diagramSource = await prisma.diagramSource.upsert({
    where: {
      sessionId_figureNo: {
        sessionId,
        figureNo
      }
    },
    update: {
      plantumlCode: result.plantumlCode,
      checksum: result.checksum
    },
    create: {
      sessionId,
      figureNo,
      plantumlCode: result.plantumlCode,
      checksum: result.checksum
    }
  });

  return NextResponse.json({ diagramSource });
}

async function handleGenerateDiagramsLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, prompt } = data

  if (!sessionId || !prompt) {
    return NextResponse.json({ error: 'Session ID and prompt are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(prompt.length / 4) })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  // Parse JSON array of figures
  let figures: any[] = []
  try {
    const text = (result.response.output || '').trim()
    // First try: parse JSON array
    try {
      const start = text.indexOf('[')
      const end = text.lastIndexOf(']')
      const json = start !== -1 && end !== -1 ? text.substring(start, end + 1) : text
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) figures = parsed
    } catch {}
    // Second try: extract PlantUML code blocks directly
    if (!Array.isArray(figures) || figures.length === 0) {
  const blocks = Array.from(text.matchAll(/@startuml[\s\S]*?@enduml/g)).map(m => sanitizePlantUML(m[0]))
      if (blocks.length > 0) {
        figures = blocks.map((code, i) => ({ title: `Fig.${i + 1}`, purpose: 'Auto-extracted diagram', plantuml: code }))
      }
    }
    // Third try: if response is object with figures key
    if ((!Array.isArray(figures) || figures.length === 0)) {
      try {
        const obj = JSON.parse(text)
        if (Array.isArray(obj?.figures)) figures = obj.figures
      } catch {}
    }
  } catch (e) {
    return NextResponse.json({ error: 'Invalid LLM response format' }, { status: 400 })
  }

  // Persist immediately: assign figure numbers and save PlantUML + titles
  try {
    const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
    const occupied = new Set(existingPlans.map(fp => fp.figureNo))
    const saved: Array<{ figureNo: number; title: string }> = []

    let candidate = 1
    const nextNo = () => {
      while (occupied.has(candidate)) candidate++
      const n = candidate
      occupied.add(n)
      candidate++
      return n
    }

    for (const fig of figures) {
      const title = typeof fig?.title === 'string' ? fig.title : 'Figure'
      const codeRaw = typeof fig?.plantuml === 'string' ? fig.plantuml : ''
      const code = sanitizePlantUML(codeRaw)
      if (!code.includes('@startuml')) continue

      const figureNo = nextNo()
      const checksum = crypto.createHash('sha256').update(code).digest('hex')

      await prisma.figurePlan.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { title },
        create: { sessionId, figureNo, title, nodes: [], edges: [] }
      })

      await prisma.diagramSource.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { plantumlCode: code, checksum },
        create: { sessionId, figureNo, plantumlCode: code, checksum }
      })

      saved.push({ figureNo, title })
    }

    return NextResponse.json({ figures, saved })
  } catch (persistErr) {
    console.error('Persist diagrams error:', persistErr)
    // Even if persistence fails, return figures so UI shows codes
    return NextResponse.json({ figures, warning: 'Figures generated but could not be saved.' })
  }
}

async function handleSavePlantUML(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, plantumlCode } = data
  if (!sessionId || !figureNo || !plantumlCode) {
    return NextResponse.json({ error: 'Session ID, figure number and code are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Upsert diagram source and figure plan title
  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { plantumlCode, checksum: crypto.createHash('sha256').update(plantumlCode).digest('hex') },
    create: { sessionId, figureNo, plantumlCode, checksum: crypto.createHash('sha256').update(plantumlCode).digest('hex') }
  })

  await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { title: title || `Figure ${figureNo}` },
    create: { sessionId, figureNo, title: title || `Figure ${figureNo}`, nodes: [], edges: [] }
  })

  return NextResponse.json({ diagramSource })
}

async function handleRegenerateDiagramLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, figureNo, instructions } = data
  if (!sessionId || !figureNo) return NextResponse.json({ error: 'Session ID and figure number required' }, { status: 400 })

  // Verify session and pull numerals
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true, diagramSources: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const components = session.referenceMap?.components || []
  const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const title = session.figurePlans?.find((f: any) => f.figureNo === figureNo)?.title || `Figure ${figureNo}`

  const prompt = `You are refining a PlantUML diagram for a patent figure.
Keep the diagram simple and valid. Use only these components/numerals: ${numeralsPreview}.
Existing title: ${title}
User instructions: ${instructions || 'none'}
Output ONLY the PlantUML code (@startuml..@enduml).`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(prompt.length / 4) })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  if (!match) return NextResponse.json({ error: 'No PlantUML code found in LLM response' }, { status: 400 })

  const code = sanitizePlantUML(match[0])
  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { plantumlCode: code, checksum },
    create: { sessionId, figureNo, plantumlCode: code, checksum }
  })

  return NextResponse.json({ diagramSource })
}

async function handleAddFigureLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructions } = data
  if (!sessionId) return NextResponse.json({ error: 'Session ID required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const components = session.referenceMap?.components || []
  const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const prompt = `Add one new simple PlantUML figure for a patent.
Use only numerals: ${numeralsPreview}.
User instructions: ${instructions || 'none'}
Return ONLY PlantUML code.`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(prompt.length / 4) })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  if (!match) return NextResponse.json({ error: 'No PlantUML code found in LLM response' }, { status: 400 })

  // Assign next figure number
  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNo = 1
  while (used.has(figureNo)) figureNo++

  const title = `Figure ${figureNo}`
  const code = sanitizePlantUML(match[0])
  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo } }, update: { title }, create: { sessionId, figureNo, title, nodes: [], edges: [] } })
  const diagramSource = await prisma.diagramSource.upsert({ where: { sessionId_figureNo: { sessionId, figureNo } }, update: { plantumlCode: code, checksum }, create: { sessionId, figureNo, plantumlCode: code, checksum } })

  return NextResponse.json({ diagramSource })
}

async function handleAddFiguresLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructionsList } = data
  if (!sessionId || !Array.isArray(instructionsList) || instructionsList.length === 0) return NextResponse.json({ error: 'Session ID and instructions list required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, figurePlans: true, diagramSources: true, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const components = session.referenceMap?.components || []
  const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const existingNames = session.figurePlans?.map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join('; ')
  const inventionTitle = session.ideaRecord?.title || ''

  const aggregatePrompt = `You are adding ${instructionsList.length} new simple PlantUML figures to a patent.
Invention: ${inventionTitle}
Use only components/numerals: ${numeralsPreview}
Existing figures: ${existingNames || 'none'}
For each item below, return ONLY PlantUML (@startuml..@enduml), one block per item, in the same order.
Items:\n- ${instructionsList.join('\n- ')}`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt: aggregatePrompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(aggregatePrompt.length / 4) })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  let blocks = Array.from(text.matchAll(/@startuml[\s\S]*?@enduml/g)).map(m => m[0])
  if (blocks.length === 0) {
    // Try JSON array
    try {
      const json = JSON.parse(text)
      const arr = Array.isArray(json?.figures) ? json.figures : (Array.isArray(json) ? json : [])
      blocks = arr
        .map((it: any) => (typeof it?.plantuml === 'string' ? it.plantuml : null))
        .filter((it: any) => typeof it === 'string' && it.includes('@startuml'))
    } catch {}
  }
  if (blocks.length === 0) return NextResponse.json({ error: 'No PlantUML blocks found' }, { status: 400 })

  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNo = 1
  const nextNo = () => { while (used.has(figureNo)) figureNo++; used.add(figureNo); return figureNo++ }

  const created: any[] = []
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i]
    const no = nextNo()
    const title = `Figure ${no}`
    const checksum = crypto.createHash('sha256').update(code).digest('hex')
    await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo: no } }, update: { title }, create: { sessionId, figureNo: no, title, nodes: [], edges: [] } })
    const diagramSource = await prisma.diagramSource.upsert({ where: { sessionId_figureNo: { sessionId, figureNo: no } }, update: { plantumlCode: code, checksum }, create: { sessionId, figureNo: no, plantumlCode: code, checksum } })
    created.push({ figureNo: no, diagramSource })
  }

  return NextResponse.json({ created })
}

async function handleDeleteFigure(user: any, patentId: string, data: any) {
  const { sessionId, figureNo } = data
  if (!sessionId || !figureNo) return NextResponse.json({ error: 'Session ID and figure number required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  await prisma.diagramSource.deleteMany({ where: { sessionId, figureNo } })
  await prisma.figurePlan.deleteMany({ where: { sessionId, figureNo } })

  return NextResponse.json({ deleted: true })
}
async function handleUploadDiagram(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, filename, checksum } = data;

  if (!sessionId || !figureNo || !filename || !checksum) {
    return NextResponse.json(
      { error: 'Session ID, figure number, filename, and checksum are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Update diagram source with uploaded file info
  const diagramSource = await prisma.diagramSource.updateMany({
    where: {
      sessionId,
      figureNo
    },
    data: {
      imageFilename: filename,
      imageChecksum: checksum,
      imageUploadedAt: new Date()
    }
  });

  // Return success with counts; do not auto-advance stage
  const totalFigures = await prisma.figurePlan.count({ where: { sessionId } });
  const uploadedFigures = await prisma.diagramSource.count({
    where: { sessionId, imageUploadedAt: { not: null } }
  });

  return NextResponse.json({
    message: 'Diagram uploaded successfully',
    uploadedFigures,
    totalFigures,
    allUploaded: uploadedFigures === totalFigures
  });
}

async function handleGenerateDraft(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, jurisdiction = 'IN', filingType = 'utility' } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership and get all required data
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Generate draft
  const result = await DraftingService.generateAnnexureDraft(
    session,
    jurisdiction,
    filingType,
    user.tenantId,
    requestHeaders
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Create new draft version
  const version = (session.annexureDrafts[0]?.version || 0) + 1;
  const draft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      title: result.draft.title,
      fieldOfInvention: result.draft.fieldOfInvention,
      background: result.draft.background,
      summary: result.draft.summary,
      briefDescriptionOfDrawings: result.draft.briefDescriptionOfDrawings,
      detailedDescription: result.draft.detailedDescription,
      bestMethod: result.draft.bestMethod,
      claims: result.draft.claims,
      abstract: result.draft.abstract,
      listOfNumerals: result.draft.listOfNumerals,
      fullDraftText: result.draft.fullText,
      isValid: result.isValid,
      validationReport: result.validationReport,
      llmPromptUsed: result.llmPrompt,
      llmResponse: result.llmResponse,
      tokensUsed: result.tokensUsed
    }
  });

  // Update session status
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'REVIEW_FIX' }
  });

  return NextResponse.json({ draft });
}
