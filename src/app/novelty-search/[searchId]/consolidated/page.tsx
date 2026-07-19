'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ConsolidatedNoveltyReport from '@/components/novelty-search/ConsolidatedNoveltyReport';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function ConsolidatedNoveltyReportPage() {
  const params = useParams();
  const searchId = params?.searchId as string;
  const { user, isLoading: isAuthLoading, authFetch } = useAuth();
  const [searchData, setSearchData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchId || isAuthLoading) return;

    if (!user) {
      setError('Please sign in to view this report.');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetchSearchData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await authFetch(`/api/novelty-search/${searchId}`, {
          cache: 'no-store'
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || data?.message || 'Failed to fetch search data');
        }

        if (data.success && data.search) {
          if (!cancelled) setSearchData(data.search);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load report');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchSearchData();

    return () => {
      cancelled = true;
    };
  }, [authFetch, isAuthLoading, searchId, user]);

  if (isLoading || isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-ai-graphite-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error: {error}</p>
          {!user ? (
            <a href={`/login?redirect=${encodeURIComponent(`/novelty-search/${searchId}/consolidated`)}`} className="text-ai-blue-600 hover:underline">Sign in to view report</a>
          ) : (
            <a href="/dashboard" className="text-ai-blue-600 hover:underline">Return to Dashboard</a>
          )}
        </div>
      </div>
    );
  }

  if (!searchData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-ai-graphite-600">No search data found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper-100 py-6 px-4">
      <div className="max-w-[1800px] mx-auto">
        <ConsolidatedNoveltyReport
          searchId={searchId}
          searchData={searchData.results || searchData}
        />
      </div>
    </div>
  );
}
