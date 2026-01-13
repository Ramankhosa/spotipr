/**
 * Single Ideation Session API
 * 
 * GET    - Get session with all data
 * DELETE - Delete session
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const ideationSession = await IdeationService.getSession(sessionId);

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Check ownership
    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Transform nodes for React Flow format
    const nodes = ideationSession.nodes.map(node => ({
      id: node.nodeId,
      type: node.type,
      position: { x: node.positionX || 0, y: node.positionY || 0 },
      data: {
        dbId: node.id,
        title: node.title,
        description: node.description,
        family: node.family,
        tags: node.tags,
        state: node.state,
        selectable: node.selectable,
        depth: node.depth,
        parentId: node.parentNodeId,
        payload: node.payloadJson,
      },
    }));

    const edges = ideationSession.edges.map(edge => ({
      id: `${edge.fromNodeId}-${edge.toNodeId}`,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      label: edge.label,
      animated: edge.animated,
      data: { relation: edge.relation },
    }));

    // Map normalization/classification to SRS-compliant field names
    // per SRS Section 3.1 and 3.3
    const groundingContext = ideationSession.normalizationJson;
    const inventiveFraming = ideationSession.classificationJson;

    return NextResponse.json({
      success: true,
      session: {
        id: ideationSession.id,
        status: ideationSession.status,
        seedText: ideationSession.seedText,
        seedGoal: ideationSession.seedGoal,
        seedConstraints: ideationSession.seedConstraints,
        // SRS-compliant field names
        groundingContext,
        inventiveFraming,
        // Legacy field names for backward compatibility
        normalization: ideationSession.normalizationJson,
        classification: ideationSession.classificationJson,
        settings: ideationSession.settingsJson,
        budgetCap: ideationSession.budgetCap,
        activeTracks: ideationSession.activeTracks,
        createdAt: ideationSession.createdAt,
        updatedAt: ideationSession.updatedAt,
      },
      graph: { nodes, edges },
      combineTray: ideationSession.combineTray,
      ideaFrames: ideationSession.ideaFrames.map(frame => {
        // Flatten ideaFrameJson so frontend gets coreMechanism, inventiveLeap, etc. directly
        const ideaData = (frame.ideaFrameJson as any) || {};
        const noveltyData = (frame.noveltySummaryJson as any) || {};
        
        return {
          id: frame.id,
          title: frame.title || ideaData.title,
          problem: frame.problem || ideaData.problem,
          principle: frame.principle || ideaData.principle,
          technicalEffect: frame.technicalEffect,
          classLabels: frame.classLabels,
          status: frame.status,
          userRating: frame.userRating,
          userNotes: frame.userNotes,
          createdAt: frame.createdAt,
          // SRS Section 5: Flattened IdeaFrame fields for frontend
          coreMechanism: ideaData.coreMechanism || frame.technicalEffect || '',
          inventiveLeap: ideaData.inventiveLeap || '',
          eliminatedAssumption: ideaData.eliminatedAssumption || '',
          contradictionResolved: ideaData.contradictionResolved || '',
          whyNotObvious: ideaData.whyNotObvious || '',
          mechanismBoundaryTest: ideaData.mechanismBoundaryTest || null,
          // Novelty assessment (LLM-only, no prior art per SRS)
          noveltyAssessment: noveltyData.originalityStrength ? {
            originalityStrength: noveltyData.originalityStrength,
            noveltyRiskLevel: noveltyData.noveltyRiskLevel,
            likelyExaminerObjection: noveltyData.likelyExaminerObjection,
            redundancyRisk: noveltyData.redundancyRisk,
            strongestNovelAspect: noveltyData.strongestNovelAspect,
            weakestNovelAspect: noveltyData.weakestNovelAspect,
            improvementDirections: noveltyData.improvementDirections || [],
          } : null,
          // Legacy fields for backward compatibility
          data: frame.ideaFrameJson,
          noveltySummary: frame.noveltySummaryJson,
        };
      }),
    });
  } catch (error) {
    console.error('Failed to get ideation session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update session (supports clarification updates per SRS Section 3.2)
 * 
 * When clearDownstream: true is sent, this will:
 * 1. Update seedText with clarification answers
 * 2. Delete all downstream artifacts (inventive framing, dimensions, moves, ideas)
 * 3. Reset session status to SEED_INPUT for re-grounding
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const body = await request.json();
    const { seedText, clearDownstream } = body;

    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // If clearDownstream is true, delete all artifacts per SRS Section 3.2
    if (clearDownstream) {
      // Delete all downstream artifacts in a transaction
      await prisma.$transaction([
        // Delete idea frames
        prisma.ideaFrame.deleteMany({
          where: { sessionId },
        }),
        // Delete evidence results
        prisma.evidenceResult.deleteMany({
          where: { sessionId },
        }),
        // Delete mind map edges
        prisma.mindMapEdge.deleteMany({
          where: { sessionId },
        }),
        // Delete mind map nodes (except SEED)
        prisma.mindMapNode.deleteMany({
          where: { 
            sessionId,
            type: { not: 'SEED' },
          },
        }),
        // Reset session state
        prisma.ideationSession.update({
          where: { id: sessionId },
          data: {
            seedText: seedText || undefined,
            status: 'SEED_INPUT',
            classificationJson: undefined, // Clear inventive framing
            // Keep normalizationJson - it will be re-run by frontend
          },
        }),
      ]);

      return NextResponse.json({
        success: true,
        message: 'Session updated and downstream artifacts cleared',
        cleared: {
          ideaFrames: true,
          nodes: true,
          edges: true,
          inventiveFraming: true,
        },
      });
    }

    // Simple update without clearing
    await prisma.ideationSession.update({
      where: { id: sessionId },
      data: {
        seedText: seedText || undefined,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update ideation session:', error);
    return NextResponse.json(
      { error: 'Failed to update session' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await IdeationService.deleteSession(sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete ideation session:', error);
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}

