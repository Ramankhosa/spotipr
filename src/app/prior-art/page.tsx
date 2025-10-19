'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { SearchHistory } from '@/components/prior-art/SearchHistory';
import { CreditsDisplay } from '@/components/prior-art/CreditsDisplay';

interface Bundle {
  id: string;
  patentId: string;
  mode: string;
  status: string;
  inventionBrief: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  latestRun?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
  };
}

export default function PriorArtPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('bundles');
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [includeScholar, setIncludeScholar] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    fetchBundles();
  }, [user, authLoading, router]);

  const fetchBundles = async () => {
    try {
      const response = await fetch('/api/prior-art/bundles', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        // Only show approved bundles
        setBundles(data.bundles.filter((bundle: Bundle) => bundle.status === 'APPROVED'));
      }
    } catch (error) {
      console.error('Failed to fetch bundles:', error);
    } finally {
      setLoading(false);
    }
  };

  const openSearchDialog = (bundleId: string) => {
    setSelectedBundleId(bundleId);
    setSearchDialogOpen(true);
  };

  const confirmStartSearch = async () => {
    if (!selectedBundleId) return;

    try {
      const response = await fetch('/api/prior-art/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          bundleId: selectedBundleId,
          includeScholar
        }),
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Search started successfully! Run ID: ${data.runId}\n\nThe search will run in the background. Status will update automatically in the Search History tab.`);
        // Refresh bundles to show updated run count
        fetchBundles();
        setSearchDialogOpen(false);
        setSelectedBundleId(null);
        setIncludeScholar(false);
      } else {
        const error = await response.json();
        alert(`Search failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to start search:', error);
      alert('Failed to start search');
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: { [key: string]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
      DRAFT: 'secondary',
      READY_FOR_REVIEW: 'outline',
      APPROVED: 'default',
      ARCHIVED: 'secondary',
    };

    return (
      <Badge variant={variants[status] || 'secondary'}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const getRunStatusBadge = (status: string) => {
    const variants: { [key: string]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
      RUNNING: 'outline',
      COMPLETED: 'default',
      COMPLETED_WITH_WARNINGS: 'secondary',
      FAILED: 'destructive',
      CREDIT_EXHAUSTED: 'destructive',
    };

    return (
      <Badge variant={variants[status] || 'secondary'} className="text-xs">
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Prior Art Search</h1>
          <p className="text-gray-600 mt-1">
            Generate and execute patent prior art searches using AI-powered analysis
          </p>
        </div>
        <CreditsDisplay />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="bundles">Approved Bundles</TabsTrigger>
          <TabsTrigger value="history">Search History</TabsTrigger>
        </TabsList>

        <TabsContent value="bundles" className="mt-6">
          <div className="grid gap-4">
            {bundles.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold mb-2">No approved bundles</h3>
                    <p className="text-gray-600 mb-4">
                      Create and approve search bundles from your patent pages to start searching for prior art.
                    </p>
                    <p className="text-sm text-gray-500">
                      Go to a patent's "Actions" tab → "Prior Art Search" to create bundles.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              bundles.map((bundle) => (
                <Card key={bundle.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">
                          Bundle {bundle.id.slice(-8)}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {bundle.inventionBrief.slice(0, 100)}...
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {getStatusBadge(bundle.status)}
                        {bundle.latestRun && getRunStatusBadge(bundle.latestRun.status)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between items-center">
                      <div className="text-sm text-gray-600">
                        Created {new Date(bundle.createdAt).toLocaleDateString()}
                        {bundle.runCount > 0 && ` • ${bundle.runCount} searches`}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/prior-art/bundle/${bundle.id}`)}
                        >
                          Edit
                        </Button>
                        {bundle.status === 'APPROVED' && (
                          <Button
                            size="sm"
                            onClick={() => openSearchDialog(bundle.id)}
                          >
                            Start Search
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>


        <TabsContent value="history" className="mt-6">
          <SearchHistory />
        </TabsContent>
      </Tabs>

      {/* Search Configuration Dialog */}
      <Dialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Search</DialogTitle>
            <DialogDescription>
              Choose which search sources to include in your prior art search.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-scholar"
                checked={includeScholar}
                onCheckedChange={(checked) => setIncludeScholar(checked as boolean)}
              />
              <label
                htmlFor="include-scholar"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Include Google Scholar results
              </label>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Google Scholar provides academic papers and articles. This may add relevant scholarly prior art but could also include less patent-focused results.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSearchDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmStartSearch}>
              Start Search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
