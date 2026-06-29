'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageLoadingBird } from '@/components/ui/loading-bird';

export default function NoveltySearchPipelineViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchId = params?.searchId as string;

  useEffect(() => {
    if (searchId) router.replace(`/novelty-search/${searchId}/consolidated`);
  }, [router, searchId]);

  return <PageLoadingBird message="Opening novelty report..." />;
}
