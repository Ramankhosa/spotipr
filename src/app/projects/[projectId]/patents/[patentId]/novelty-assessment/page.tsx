import { Suspense } from 'react';
import { NoveltyAssessmentManager } from '@/components/novelty-assessment/NoveltyAssessmentManager';

interface NoveltyAssessmentPageProps {
  params: {
    projectId: string;
    patentId: string;
  };
}

export default function NoveltyAssessmentPage({ params }: NoveltyAssessmentPageProps) {
  const { patentId } = params;

  return (
    <div className="container mx-auto py-8 px-4">
      <Suspense fallback={<div>Loading...</div>}>
        <NoveltyAssessmentManager patentId={patentId} />
      </Suspense>
    </div>
  );
}

export const metadata = {
  title: 'Patent Novelty Assessment',
  description: 'AI-powered patent novelty analysis with real-time progress tracking',
};
