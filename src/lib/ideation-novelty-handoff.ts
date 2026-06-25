import { prisma } from '@/lib/prisma';

export async function recordIdeationNoveltyHandoff(input: {
  config: any;
  searchId?: string;
  userId?: string;
}) {
  const sourceMetadata = input.config?.sourceMetadata;
  if (
    !input.searchId ||
    sourceMetadata?.source !== 'ideation' ||
    !sourceMetadata?.sessionId ||
    !sourceMetadata?.ideaFrameId ||
    !input.userId
  ) {
    return;
  }

  const ideaFrame = await prisma.ideaFrame.findFirst({
    where: {
      id: String(sourceMetadata.ideaFrameId),
      sessionId: String(sourceMetadata.sessionId),
      session: { userId: input.userId },
    },
    select: { id: true, noveltySummaryJson: true },
  });

  if (!ideaFrame) return;

  const existing =
    ideaFrame.noveltySummaryJson && typeof ideaFrame.noveltySummaryJson === 'object'
      ? (ideaFrame.noveltySummaryJson as Record<string, unknown>)
      : {};

  await prisma.ideaFrame.update({
    where: { id: ideaFrame.id },
    data: {
      noveltySummaryJson: {
        ...existing,
        pipeline: {
          searchId: input.searchId,
          status: 'QUEUED',
          queuedAt: new Date().toISOString(),
        },
      } as any,
    },
  });
}
