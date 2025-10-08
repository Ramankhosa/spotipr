'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, Clock, CheckCircle, XCircle, AlertTriangle, Eye, FileText, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface SearchRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  creditsConsumed: number;
  apiCallsMade: number;
  resultsCount: number;
  bundle: {
    inventionBrief: string;
    bundleData: any;
  };
}

interface SearchResult {
  identifier: string;
  contentType: 'PATENT' | 'SCHOLAR';
  score: number | string;
  intersectionType: string;
  foundInVariants: string[];
  ranks: {
    broad: number | null;
    baseline: number | null;
    narrow: number | null;
  };
  shortlisted: boolean;
  manuallyAdded?: boolean;
  // Patent-specific fields
  patent?: {
    publicationNumber: string;
    title: string;
    abstract: string;
    publicationDate: string;
    assignees: string[];
    inventors: string[];
    cpcs: string[];
    pdfLink: string;
  };
  // Scholar-specific fields
  scholar?: {
    title: string;
    authors: string[];
    publication: string;
    year: number;
    abstract: string;
    citationCount: number;
    link: string;
    pdfLink: string;
    doi: string;
    source: string;
  };
  details?: {
    title?: string;
    abstract?: string;
    description?: string;
    claims?: any;
    classifications?: any;
    publication_date?: string;
    priority_date?: string;
    worldwide_applications?: any;
    events?: any;
    patent_citations?: any;
    non_patent_citations?: any;
    pdf?: string;
    inventors?: string[];
    assignees?: string[];
    fetchedAt?: string;
    status?: 'pending' | 'fetching' | 'completed' | 'failed';
  };
}

interface VariantResults {
  broadPatents: SearchResult[];
  baselinePatents: SearchResult[];
  narrowPatents: SearchResult[];
  broadScholars: SearchResult[];
  baselineScholars: SearchResult[];
  narrowScholars: SearchResult[];
  intersection: SearchResult[];
}

const PatentDetailCard = ({ result }: { result: SearchResult }) => {
  const getStatusBadge = () => {
    if (!result.details) return <Badge variant="secondary">Not Fetched</Badge>;
    switch (result.details.status) {
      case 'fetching': return <Badge variant="default" className="animate-pulse">Fetching...</Badge>;
      case 'completed': return <Badge variant="default" className="bg-green-500">Complete</Badge>;
      case 'failed': return <Badge variant="destructive">Failed</Badge>;
      default: return <Badge variant="secondary">Pending</Badge>;
    }
  };

  return (
    <Card className="w-full">
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-bold text-gray-900">{result.identifier}</h3>
              <Badge variant="outline" className={`text-xs ${
                result.contentType === 'PATENT'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-orange-50 text-orange-700 border-orange-200'
              }`}>
                {result.contentType === 'PATENT' ? 'Patent' : 'Scholar'}
              </Badge>
            </div>
            <p className="text-sm text-gray-600">
              Score: {typeof result.score === 'number' ? result.score.toFixed(3) : (result.score || 'N/A')}
              {result.manuallyAdded && ' • Manually Added'}
            </p>
          </div>
          {result.contentType === 'PATENT' && getStatusBadge()}
          {result.contentType === 'SCHOLAR' && <Badge variant="default" className="bg-green-500">Available</Badge>}
        </div>

        {/* Basic Info */}
        {result.contentType === 'PATENT' && result.patent && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Title</h4>
              <p className="text-sm text-gray-700">{result.patent.title || 'N/A'}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Publication Date</h4>
              <p className="text-sm text-gray-700">{result.patent.publicationDate || 'N/A'}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Inventors</h4>
              <p className="text-sm text-gray-700">{result.patent.inventors?.join(', ') || 'N/A'}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Assignees</h4>
              <p className="text-sm text-gray-700">{result.patent.assignees?.join(', ') || 'N/A'}</p>
            </div>
          </div>
        )}

        {result.contentType === 'SCHOLAR' && result.scholar && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Title</h4>
              <p className="text-sm text-gray-700">{result.scholar.title || 'N/A'}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Year</h4>
              <p className="text-sm text-gray-700">{result.scholar.year || 'N/A'}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Authors</h4>
              <p className="text-sm text-gray-700">{result.scholar.authors?.join(', ') || 'N/A'}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Publication</h4>
              <p className="text-sm text-gray-700">{result.scholar.publication || 'N/A'}</p>
            </div>
          </div>
        )}

        {/* Scholar-specific detailed info */}
        {result.contentType === 'SCHOLAR' && result.scholar && (
          <div className="border-t pt-6 space-y-6">
            {/* Abstract */}
            {result.scholar.abstract && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Abstract</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{result.scholar.abstract}</p>
              </div>
            )}

            {/* Citation Count */}
            {result.scholar.citationCount > 0 && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Citation Information</h4>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">Citations:</span> {result.scholar.citationCount}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    This article has been cited {result.scholar.citationCount} times according to Google Scholar
                  </p>
                </div>
              </div>
            )}

            {/* DOI and Links */}
            {(result.scholar.doi || result.scholar.link || result.scholar.pdfLink) && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Links & Identifiers</h4>
                <div className="space-y-2">
                  {result.scholar.doi && (
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">DOI:</span> {result.scholar.doi}
                    </p>
                  )}
                  {result.scholar.link && (
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">Link:</span>
                      <a href={result.scholar.link} target="_blank" rel="noopener noreferrer"
                         className="text-blue-600 hover:text-blue-800 underline ml-1">
                        View Article
                      </a>
                    </p>
                  )}
                  {result.scholar.pdfLink && (
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">PDF:</span>
                      <a href={result.scholar.pdfLink} target="_blank" rel="noopener noreferrer"
                         className="text-blue-600 hover:text-blue-800 underline ml-1">
                        Download PDF
                      </a>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Source */}
            {result.scholar.source && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Source</h4>
                <p className="text-sm text-gray-700">{result.scholar.source}</p>
              </div>
            )}
          </div>
        )}

        {/* Detailed Info - Only show for patents when details are available */}
        {result.contentType === 'PATENT' && result.details && result.details.status === 'completed' && (
          <div className="border-t pt-6 space-y-6">
            {/* Description */}
            {result.details.description && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Full Description</h4>
                <div className="text-sm text-gray-700 leading-relaxed max-h-40 overflow-y-auto border rounded p-3 bg-gray-50">
                  {result.details.description}
                </div>
              </div>
            )}

            {/* Claims */}
            {result.details.claims && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Claims</h4>
                <div className="text-sm text-gray-700 leading-relaxed max-h-40 overflow-y-auto border rounded p-3 bg-gray-50">
                  <pre className="whitespace-pre-wrap font-mono text-xs">
                    {typeof result.details.claims === 'string'
                      ? result.details.claims
                      : JSON.stringify(result.details.claims, null, 2)
                    }
                  </pre>
                </div>
              </div>
            )}

            {/* Classifications */}
            {result.details.classifications && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Classifications</h4>
                <div className="flex flex-wrap gap-2">
                  {Array.isArray(result.details.classifications)
                    ? result.details.classifications.map((cls: any, idx: number) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {typeof cls === 'string' ? cls : JSON.stringify(cls)}
                        </Badge>
                      ))
                    : <p className="text-sm text-gray-700">{JSON.stringify(result.details.classifications)}</p>
                  }
                </div>
              </div>
            )}

            {/* Worldwide Applications */}
            {result.details.worldwide_applications && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Worldwide Applications</h4>
                <div className="text-sm text-gray-700 max-h-32 overflow-y-auto border rounded p-3 bg-gray-50">
                  {Array.isArray(result.details.worldwide_applications)
                    ? result.details.worldwide_applications.slice(0, 3).map((app: any, idx: number) => (
                        <div key={idx} className="mb-1">
                          {app.country || app.application_number || JSON.stringify(app)}
                        </div>
                      ))
                    : <pre className="whitespace-pre-wrap font-mono text-xs">
                        {JSON.stringify(result.details.worldwide_applications, null, 2)}
                      </pre>
                  }
                  {Array.isArray(result.details.worldwide_applications) && result.details.worldwide_applications.length > 3 && (
                    <p className="text-gray-500 mt-2">... and {result.details.worldwide_applications.length - 3} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Citations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {result.details.patent_citations && (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">Patent Citations ({Array.isArray(result.details.patent_citations) ? result.details.patent_citations.length : 'N/A'})</h4>
                  <div className="text-sm text-gray-700 max-h-32 overflow-y-auto border rounded p-3 bg-gray-50">
                    {Array.isArray(result.details.patent_citations)
                      ? result.details.patent_citations.slice(0, 5).map((citation: any, idx: number) => (
                          <div key={idx} className="mb-1">
                            {typeof citation === 'string' ? citation : citation.publication_number || citation.title || JSON.stringify(citation)}
                          </div>
                        ))
                      : <pre className="whitespace-pre-wrap font-mono text-xs">
                          {JSON.stringify(result.details.patent_citations, null, 2)}
                        </pre>
                    }
                    {Array.isArray(result.details.patent_citations) && result.details.patent_citations.length > 5 && (
                      <p className="text-gray-500 mt-2">... and {result.details.patent_citations.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}

              {result.details.non_patent_citations && (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">Non-Patent Citations ({Array.isArray(result.details.non_patent_citations) ? result.details.non_patent_citations.length : 'N/A'})</h4>
                  <div className="text-sm text-gray-700 max-h-32 overflow-y-auto border rounded p-3 bg-gray-50">
                    {Array.isArray(result.details.non_patent_citations)
                      ? result.details.non_patent_citations.slice(0, 5).map((citation: any, idx: number) => (
                          <div key={idx} className="mb-1">
                            {typeof citation === 'string' ? citation : citation.title || citation.citation || JSON.stringify(citation)}
                          </div>
                        ))
                      : <pre className="whitespace-pre-wrap font-mono text-xs">
                          {JSON.stringify(result.details.non_patent_citations, null, 2)}
                        </pre>
                    }
                    {Array.isArray(result.details.non_patent_citations) && result.details.non_patent_citations.length > 5 && (
                      <p className="text-gray-500 mt-2">... and {result.details.non_patent_citations.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Events */}
            {result.details.events && (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Legal Events</h4>
                <div className="text-sm text-gray-700 max-h-32 overflow-y-auto border rounded p-3 bg-gray-50">
                  {Array.isArray(result.details.events)
                    ? result.details.events.slice(0, 3).map((event: any, idx: number) => (
                        <div key={idx} className="mb-1">
                          {event.date || event.title || JSON.stringify(event)}
                        </div>
                      ))
                    : <pre className="whitespace-pre-wrap font-mono text-xs">
                        {JSON.stringify(result.details.events, null, 2)}
                      </pre>
                  }
                  {Array.isArray(result.details.events) && result.details.events.length > 3 && (
                    <p className="text-gray-500 mt-2">... and {result.details.events.length - 3} more</p>
                  )}
                </div>
              </div>
            )}

            {/* PDF Link */}
            {(() => {
              const details = result.details;
              if (!details || !details.pdf) return null;
              return (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(details.pdf, '_blank')}
                    className="flex items-center gap-2"
                  >
                    📄 View Full Patent PDF
                  </Button>
                </div>
              );
            })()}

            {/* Fetched At */}
            <div className="text-xs text-gray-500 border-t pt-3">
              Detailed data fetched at: {result.details?.fetchedAt ? new Date(result.details.fetchedAt).toLocaleString() : 'Unknown'}
            </div>
          </div>
        )}

        {/* Placeholder for pending/fetching states */}
        {(!result.details || result.details.status === 'pending') && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500 italic">
              Click "Fetch Level 2 Data" above to retrieve detailed patent information including claims, citations, and full description.
            </p>
          </div>
        )}

        {/* Error state */}
        {result.details?.status === 'failed' && (
          <div className="border-t pt-4">
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm text-red-700">
                ❌ Failed to fetch detailed information. The patent may not be available or there was a network error.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export function SearchHistory() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<SearchRun | null>(null);
  const [variantResults, setVariantResults] = useState<VariantResults>({
    broadPatents: [],
    baselinePatents: [],
    narrowPatents: [],
    broadScholars: [],
    baselineScholars: [],
    narrowScholars: [],
    intersection: []
  });
  const [resultsLoading, setResultsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('level1');
  const [level1Tab, setLevel1Tab] = useState('broadPatents');
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (user) {
    fetchRuns();
    }
  }, [user]);

  // Polling effect to refresh runs when there are active searches
  useEffect(() => {
    const hasRunningSearches = runs.some(run => run.status === 'RUNNING');

    if (hasRunningSearches && !pollingIntervalRef.current) {
      // Start polling every 5 seconds when there are running searches
      pollingIntervalRef.current = setInterval(() => {
        fetchRuns();
      }, 5000);
    } else if (!hasRunningSearches && pollingIntervalRef.current) {
      // Stop polling when no searches are running
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [runs.some(run => run.status === 'RUNNING')]); // Only depend on whether there are running searches

  const fetchRuns = async () => {
    try {
      const response = await fetch('/api/prior-art/runs', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setRuns(data.runs);
      }
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSearchResults = async (runId: string) => {
    setResultsLoading(true);
    try {
      const response = await fetch(`/api/prior-art/search/${runId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const results = data.results || [];

        // Organize results by variants and content type
        const organizedResults: VariantResults = {
          broadPatents: [],
          baselinePatents: [],
          narrowPatents: [],
          broadScholars: [],
          baselineScholars: [],
          narrowScholars: [],
          intersection: []
        };

        // First, create a map of all results by identifier
        const resultMap = new Map<string, SearchResult>();
        results.forEach((result: SearchResult) => {
          resultMap.set(result.identifier, result);
        });

        // For each variant, collect results that were found in that variant
        // The foundInVariants contains strings like "broad_patents", "baseline_scholar", etc.
        results.forEach((result: SearchResult) => {
          const isPatent = result.contentType === 'PATENT';
          const isScholar = result.contentType === 'SCHOLAR';

          // Check for broad variant results
          if (result.foundInVariants.some(variant => variant === 'broad_patents')) {
            if (isPatent) organizedResults.broadPatents.push(result);
          }
          if (result.foundInVariants.some(variant => variant === 'broad_scholar')) {
            if (isScholar) organizedResults.broadScholars.push(result);
          }

          // Check for baseline variant results
          if (result.foundInVariants.some(variant => variant === 'baseline_patents')) {
            if (isPatent) organizedResults.baselinePatents.push(result);
          }
          if (result.foundInVariants.some(variant => variant === 'baseline_scholar')) {
            if (isScholar) organizedResults.baselineScholars.push(result);
          }

          // Check for narrow variant results
          if (result.foundInVariants.some(variant => variant === 'narrow_patents')) {
            if (isPatent) organizedResults.narrowPatents.push(result);
          }
          if (result.foundInVariants.some(variant => variant === 'narrow_scholar')) {
            if (isScholar) organizedResults.narrowScholars.push(result);
          }

          // Intersection results are those that appear in multiple variants or are manually added
          if (result.foundInVariants.length >= 2 || result.manuallyAdded) {
            organizedResults.intersection.push(result);
          }
        });

        setVariantResults(organizedResults);
      }
    } catch (error) {
      console.error('Failed to fetch search results:', error);
    } finally {
      setResultsLoading(false);
    }
  };

  const addToIntersection = (identifier: string, variant: string) => {
    setVariantResults(prev => {
      // Find the result in any of the variant arrays
      let result: SearchResult | undefined;
      let sourceArray = '';

      // Check all variant arrays
      for (const [key, array] of Object.entries(prev)) {
        if (Array.isArray(array)) {
          const found = array.find(r => r.identifier === identifier);
          if (found) {
            result = found;
            sourceArray = key;
            break;
          }
        }
      }

      if (!result) return prev;

      const updatedResult = { ...result, manuallyAdded: true };

      // Add to intersection if not already there
      const isInIntersection = prev.intersection.some(r => r.identifier === identifier);
      if (!isInIntersection) {
        console.log(`✅ Added ${identifier} to intersection from ${sourceArray}`);
        return {
          ...prev,
          intersection: [...prev.intersection, updatedResult]
        };
      } else {
        console.log(`ℹ️ ${identifier} is already in intersection`);
      }

      return prev;
    });
  };

  const removeFromIntersection = (identifier: string) => {
    setVariantResults(prev => ({
      ...prev,
      intersection: prev.intersection.filter(r => {
        if (r.identifier === identifier) {
          // Only remove if it was manually added
          return !r.manuallyAdded;
        }
        return true;
      })
    }));
  };

  const fetchDetailedAnalysis = async (runId: string) => {
    console.log('🚀 Starting detailed analysis fetch for run:', runId);

    // Update status to fetching
    setVariantResults(prev => ({
      ...prev,
      intersection: prev.intersection.map(result => ({
        ...result,
        details: {
          ...result.details,
          status: 'fetching' as const
        }
      }))
    }));

    try {
      const response = await fetch(`/api/prior-art/search/${runId}/details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Detailed analysis completed:', data);

        // Refresh the results to get updated details
        await fetchSearchResults(runId);
      } else {
        const errorData = await response.json();
        console.error('❌ Detailed analysis failed:', errorData);

        // Update status to failed
        setVariantResults(prev => ({
          ...prev,
          intersection: prev.intersection.map(result => ({
            ...result,
            details: {
              ...result.details,
              status: 'failed' as const
            }
          }))
        }));
      }
    } catch (error) {
      console.error('❌ Network error during detailed analysis:', error);

      // Update status to failed
      setVariantResults(prev => ({
        ...prev,
        intersection: prev.intersection.map(result => ({
          ...result,
          details: {
            ...result.details,
            status: 'failed' as const
          }
        }))
      }));
    }
  };

  const handleViewResults = async (run: SearchRun) => {
    setSelectedRun(run);
    setActiveTab('level1');
    await fetchSearchResults(run.id);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'RUNNING':
        return <Clock className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: { [key: string]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
      COMPLETED: 'default',
      COMPLETED_WITH_WARNINGS: 'secondary',
      FAILED: 'destructive',
      RUNNING: 'outline',
      CREDIT_EXHAUSTED: 'destructive',
    };

    return (
      <Badge variant={variants[status] || 'secondary'}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </CardContent>
      </Card>
    );
  }

  const renderSearchResults = () => {
    if (!selectedRun) return null;

    const renderPatentCard = (result: SearchResult, variant?: string) => (
      <Card key={result.identifier}>
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h4 className="font-medium text-lg">{result.identifier}</h4>
              <p className="text-sm text-gray-600">
                Score: {typeof result.score === 'number' ? result.score.toFixed(3) : (result.score || 'N/A')}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline">
                {result.intersectionType.replace('_', ' ')}
              </Badge>
              <Badge variant="secondary">
                {result.foundInVariants.join(', ')}
              </Badge>
              {!resultsLoading && variant && variant !== 'intersection' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // Map variant names to the correct format for addToIntersection
                    let intersectionVariant = variant;
                    if (variant === 'broadPatents' || variant === 'broadScholars') {
                      intersectionVariant = 'broad';
                    } else if (variant === 'baselinePatents' || variant === 'baselineScholars') {
                      intersectionVariant = 'baseline';
                    } else if (variant === 'narrowPatents' || variant === 'narrowScholars') {
                      intersectionVariant = 'narrow';
                    }
                    addToIntersection(result.identifier, intersectionVariant as 'broad' | 'baseline' | 'narrow');
                  }}
                >
                  Add to Intersection
                </Button>
              )}
              {!resultsLoading && variant === 'intersection' && result.manuallyAdded && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => removeFromIntersection(result.identifier)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-3">
            <div className="text-center">
              <div className="text-sm text-gray-600">Broad Relevance</div>
              <div className="font-medium">{result.ranks.broad ? `${result.ranks.broad}%` : 'N/A'}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-600">Baseline Relevance</div>
              <div className="font-medium">{result.ranks.baseline ? `${result.ranks.baseline}%` : 'N/A'}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-600">Narrow Relevance</div>
              <div className="font-medium">{result.ranks.narrow ? `${result.ranks.narrow}%` : 'N/A'}</div>
            </div>
          </div>

          {/* Content based on type */}
          {result.contentType === 'PATENT' && result.patent && (
            <div className="border-t pt-3">
              <div className="flex items-center gap-2 mb-2">
                <h5 className="font-medium">{result.patent.title}</h5>
                <Badge variant="outline" className="text-xs">Patent</Badge>
              </div>
              {result.patent.abstract && (
                <div className="mb-3">
                  <h6 className="text-xs font-medium text-gray-500 mb-1">Abstract</h6>
                  <div className="text-sm text-gray-700 leading-relaxed max-h-32 overflow-y-auto border rounded p-3 bg-gray-50">
                    {result.patent.abstract}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  Published: {new Date(result.patent.publicationDate).toLocaleDateString()}
                </span>
                {result.patent.assignees?.length > 0 && (
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                    Assignee: {result.patent.assignees[0]}
                  </span>
                )}
                {result.patent.cpcs?.length > 0 && (
                  <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                    CPC: {result.patent.cpcs[0]}
                  </span>
                )}
              </div>
            </div>
          )}

          {result.contentType === 'SCHOLAR' && result.scholar && (
            <div className="border-t pt-3">
              <div className="flex items-center gap-2 mb-2">
                <h5 className="font-medium">{result.scholar.title}</h5>
                <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">Scholar</Badge>
              </div>
              {result.scholar.abstract && (
                <div className="mb-3">
                  <h6 className="text-xs font-medium text-gray-500 mb-1">Abstract</h6>
                  <div className="text-sm text-gray-700 leading-relaxed max-h-32 overflow-y-auto border rounded p-3 bg-gray-50">
                    {result.scholar.abstract}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                {result.scholar.year && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Year: {result.scholar.year}
                  </span>
                )}
                {result.scholar.authors?.length > 0 && (
                  <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                    Author: {result.scholar.authors[0]}
                  </span>
                )}
                {result.scholar.publication && (
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                    Journal: {result.scholar.publication}
                  </span>
                )}
                {result.scholar.citationCount > 0 && (
                  <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                    Citations: {result.scholar.citationCount}
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );

    return (
      <DialogContent className="max-w-7xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Results - {selectedRun.id.slice(-8)}
          </DialogTitle>
          <div className="text-sm text-gray-600">
            <p><strong>Invention:</strong> {selectedRun.bundle.inventionBrief}</p>
            <p><strong>Status:</strong> {selectedRun.status} • <strong>Started:</strong> {new Date(selectedRun.startedAt).toLocaleString()}</p>
            {selectedRun.finishedAt && (
              <p><strong>Completed:</strong> {new Date(selectedRun.finishedAt).toLocaleString()}</p>
            )}
            <p><strong>Credits Used:</strong> {selectedRun.creditsConsumed} • <strong>API Calls:</strong> {selectedRun.apiCallsMade}</p>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="level1" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Level 1: Search Results ({variantResults.broadPatents.length + variantResults.baselinePatents.length + variantResults.narrowPatents.length + variantResults.broadScholars.length + variantResults.baselineScholars.length + variantResults.narrowScholars.length})
            </TabsTrigger>
            <TabsTrigger value="level2" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Level 2: Detailed Analysis ({variantResults.intersection.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="level1" className="space-y-4">
            {resultsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <Tabs value={level1Tab} onValueChange={setLevel1Tab} className="w-full">
                <TabsList className="grid w-full grid-cols-7">
                  <TabsTrigger value="broadPatents">
                    📄 Broad Patents ({variantResults.broadPatents.length})
                  </TabsTrigger>
                  <TabsTrigger value="baselinePatents">
                    📄 Baseline Patents ({variantResults.baselinePatents.length})
                  </TabsTrigger>
                  <TabsTrigger value="narrowPatents">
                    📄 Narrow Patents ({variantResults.narrowPatents.length})
                  </TabsTrigger>
                  <TabsTrigger value="broadScholars">
                    📚 Broad Scholars ({variantResults.broadScholars.length})
                  </TabsTrigger>
                  <TabsTrigger value="baselineScholars">
                    📚 Baseline Scholars ({variantResults.baselineScholars.length})
                  </TabsTrigger>
                  <TabsTrigger value="narrowScholars">
                    📚 Narrow Scholars ({variantResults.narrowScholars.length})
                  </TabsTrigger>
                  <TabsTrigger value="intersection">
                    🎯 Intersection ({variantResults.intersection.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="broadPatents" className="space-y-4 mt-4">
                  {variantResults.broadPatents.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-600">No broad patent search results</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {variantResults.broadPatents.map((result) => renderPatentCard(result, 'broadPatents'))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="baselinePatents" className="space-y-4 mt-4">
                  {variantResults.baselinePatents.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-600">No baseline patent search results</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {variantResults.baselinePatents.map((result) => renderPatentCard(result, 'baselinePatents'))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="narrowPatents" className="space-y-4 mt-4">
                  {variantResults.narrowPatents.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-600">No narrow patent search results</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {variantResults.narrowPatents.map((result) => renderPatentCard(result, 'narrowPatents'))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="broadScholars" className="space-y-4 mt-4">
                  {variantResults.broadScholars.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-600">No broad scholarly search results</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {variantResults.broadScholars.map((result) => renderPatentCard(result, 'broadScholars'))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="baselineScholars" className="space-y-4 mt-4">
                  {variantResults.baselineScholars.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-600">No baseline scholarly search results</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {variantResults.baselineScholars.map((result) => renderPatentCard(result, 'baselineScholars'))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="narrowScholars" className="space-y-4 mt-4">
                  {variantResults.narrowScholars.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-600">No narrow scholarly search results</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {variantResults.narrowScholars.map((result) => renderPatentCard(result, 'narrowScholars'))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="intersection" className="space-y-4 mt-4">
                  {variantResults.intersection.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-blue-900 mb-2">🔍 Intersection Patents</h3>
                        <p className="text-blue-700 mb-3">
                          This is where patents selected for detailed analysis appear.
                        </p>
                        <div className="text-sm text-blue-600">
                          <p className="mb-2">📋 <strong>How to add patents:</strong></p>
                          <ul className="list-disc list-inside space-y-1 text-left">
                            <li>Click <strong>"Add to Intersection"</strong> buttons in Broad/Baseline/Narrow tabs</li>
                            <li>Only patents appearing in multiple categories will be automatically included</li>
                            <li>Selected patents will receive comprehensive detailed analysis</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-6">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-bold text-purple-900 flex items-center gap-2">
                            <span className="text-xl">🎯</span>
                            Intersection Patents ({variantResults.intersection.length})
                          </h4>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveTab('level2')}
                            className="border-purple-300 text-purple-700 hover:bg-purple-100"
                          >
                            📄 View Level 2 Analysis →
                          </Button>
                        </div>
                        <p className="text-sm text-purple-700 mb-3">
                          These {variantResults.intersection.length} patent{variantResults.intersection.length !== 1 ? 's' : ''} will receive detailed analysis including full claims, citations, descriptions, and PDF links.
                        </p>
                        <div className="bg-white bg-opacity-50 rounded p-3">
                          <p className="text-xs text-purple-600">
                            💡 <strong>Next step:</strong> Switch to <strong>"Level 2: Final Analysis"</strong> tab above and click <strong>"Fetch Level 2 Data"</strong> to get comprehensive patent details.
                          </p>
                        </div>
                      </div>

                      {variantResults.intersection.map((result) => renderPatentCard(result, 'intersection'))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>

          <TabsContent value="level2" className="space-y-4">
            {variantResults.intersection.length === 0 ? (
              <div className="text-center py-8">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-4">
                  <h3 className="text-lg font-semibold text-yellow-800 mb-2">⚠️ No Intersection Patents Selected</h3>
                  <p className="text-yellow-700 mb-3">
                    To perform detailed analysis, you need to select patents for intersection first.
                  </p>
                  <div className="text-sm text-yellow-600">
                    <p className="mb-1">📋 <strong>How to proceed:</strong></p>
                    <ol className="list-decimal list-inside space-y-1 text-left">
                      <li>Go back to <strong>"Level 1: Search Results"</strong> tab</li>
                      <li>Review patents in Broad, Baseline, and Narrow categories</li>
                      <li>Click <strong>"Add to Intersection"</strong> on relevant patents</li>
                      <li>Return here to fetch detailed analysis</li>
                    </ol>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Instructions and Action Panel */}
                <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 mb-2">
                        🎯 Level 2: Detailed Patent Analysis
                      </h3>
                      <p className="text-gray-700">
                        Ready to fetch comprehensive details for <strong>{variantResults.intersection.length}</strong> selected patent{ variantResults.intersection.length !== 1 ? 's' : ''}.
                      </p>
                      <div className="mt-3 text-sm text-gray-600">
                        <p>📊 <strong>What you'll get:</strong> Full claims, citations, descriptions, classifications, and PDF links</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">{variantResults.intersection.length}</div>
                      <div className="text-sm text-gray-500">Patents Selected</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Button
                      onClick={() => fetchDetailedAnalysis(selectedRun?.id || '')}
                      disabled={variantResults.intersection.some(r => r.details?.status === 'fetching')}
                      size="lg"
                      className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 flex items-center gap-3 shadow-lg hover:shadow-xl transition-all duration-200"
                    >
                      {variantResults.intersection.some(r => r.details?.status === 'fetching') ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          <span>Fetching Detailed Data...</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg">📄</span>
                          <span>Fetch Level 2 Data</span>
                          <span className="text-xs bg-white bg-opacity-20 px-2 py-1 rounded">API Call</span>
                        </>
                      )}
                    </Button>

                    <div className="text-sm text-gray-500">
                      {variantResults.intersection.filter(r => r.details?.status === 'completed').length} of {variantResults.intersection.length} completed
                    </div>
                  </div>
                </div>

                {/* Status Overview */}
                {variantResults.intersection.some(r => r.details?.status) && (
                  <div className="bg-gray-50 border rounded-lg p-4">
                    <h4 className="font-semibold text-gray-800 mb-3">📈 Fetch Status</h4>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div className="text-center">
                        <div className="text-2xl">{variantResults.intersection.filter(r => !r.details?.status || r.details?.status === 'pending').length}</div>
                        <div className="text-gray-600">Pending</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl">{variantResults.intersection.filter(r => r.details?.status === 'fetching').length}</div>
                        <div className="text-gray-600">Fetching</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl text-green-600">{variantResults.intersection.filter(r => r.details?.status === 'completed').length}</div>
                        <div className="text-gray-600">Completed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl text-red-600">{variantResults.intersection.filter(r => r.details?.status === 'failed').length}</div>
                        <div className="text-gray-600">Failed</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Patent Detail Cards */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                    <span>📋</span>
                    Detailed Patent Information
                  </h4>

                  {variantResults.intersection.map((result) => (
                    <PatentDetailCard key={result.identifier} result={result} />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Search History</CardTitle>
          <CardDescription>
            View your past prior art search executions and detailed results
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600">No search history yet</p>
              <p className="text-sm text-gray-500 mt-1">
                Your search executions will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <Card key={run.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatusIcon(run.status)}
                          <h4 className="font-medium">Search {run.id.slice(-8)}</h4>
                          {getStatusBadge(run.status)}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {run.bundle.inventionBrief.slice(0, 100)}...
                        </p>
                        <div className="text-xs text-gray-500 space-y-1">
                          <div>Started {new Date(run.startedAt).toLocaleString()}</div>
                          {run.finishedAt && (
                            <div>Completed {new Date(run.finishedAt).toLocaleString()}</div>
                          )}
                          <div>Results: {run.resultsCount} • Credits: {run.creditsConsumed} • API Calls: {run.apiCallsMade}</div>
                        </div>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewResults(run)}
                            disabled={run.status !== 'COMPLETED'}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                        View Results
                      </Button>
                        </DialogTrigger>
                        {renderSearchResults()}
                      </Dialog>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
