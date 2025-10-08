'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wand2, Edit3, CheckCircle } from 'lucide-react';

interface BundleBuilderProps {
  onBundleCreated: () => void;
}

interface Patent {
  id: string;
  title: string;
  createdAt: string;
}

export function BundleBuilder({ onBundleCreated }: BundleBuilderProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'LLM' | 'MANUAL'>('LLM');
  const [patentId, setPatentId] = useState('');
  const [brief, setBrief] = useState('');
  const [patents, setPatents] = useState<Patent[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [bundleData, setBundleData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPatents();
  }, []);

  const fetchPatents = async () => {
    try {
      const response = await fetch('/api/patents');
      if (response.ok) {
        const data = await response.json();
        setPatents(data.patents || []);
      }
    } catch (error) {
      console.error('Failed to fetch patents:', error);
    }
  };

  const generateBundle = async () => {
    if (!patentId || !brief.trim()) return;

    setGenerating(true);
    setError('');

    try {
      const response = await fetch('/api/prior-art/generate-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId, brief }),
      });

      if (response.ok) {
        const data = await response.json();
        setBundleData(data.bundle);
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to generate bundle');
      }
    } catch (error) {
      setError('Network error occurred');
    } finally {
      setGenerating(false);
    }
  };

  const createBundle = async () => {
    if (!patentId) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/prior-art/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patentId,
          mode,
          brief,
          bundleData,
        }),
      });

      if (response.ok) {
        onBundleCreated();
        // Reset form
        setPatentId('');
        setBrief('');
        setBundleData(null);
        setMode('LLM');
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to create bundle');
      }
    } catch (error) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const canCreateBundle = () => {
    if (mode === 'LLM') {
      return patentId && brief.trim() && bundleData;
    } else {
      return patentId && brief.trim();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Search Bundle</CardTitle>
          <CardDescription>
            Generate a structured search bundle for prior art analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Patent Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Select Patent</label>
            <Select value={patentId} onValueChange={setPatentId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a patent..." />
              </SelectTrigger>
              <SelectContent>
                {patents.map((patent) => (
                  <SelectItem key={patent.id} value={patent.id}>
                    {patent.title} (Created {new Date(patent.createdAt).toLocaleDateString()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mode Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Bundle Creation Mode</label>
            <div className="flex gap-4">
              <Button
                type="button"
                variant={mode === 'LLM' ? 'default' : 'outline'}
                onClick={() => setMode('LLM')}
                className="flex items-center gap-2"
              >
                <Wand2 className="h-4 w-4" />
                LLM Generated
              </Button>
              <Button
                type="button"
                variant={mode === 'MANUAL' ? 'default' : 'outline'}
                onClick={() => setMode('MANUAL')}
                className="flex items-center gap-2"
              >
                <Edit3 className="h-4 w-4" />
                Manual Entry
              </Button>
            </div>
          </div>

          {/* Brief Input */}
          <div>
            <label className="block text-sm font-medium mb-2">
              {mode === 'LLM' ? 'Invention Brief' : 'Manual Description'}
            </label>
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={
                mode === 'LLM'
                  ? "Describe your invention in detail (problem, solution, key features, etc.)..."
                  : "Enter your search criteria manually..."
              }
              rows={6}
              className="resize-none"
            />
          </div>

          {/* LLM Mode: Generate Bundle */}
          {mode === 'LLM' && patentId && brief.trim() && (
            <div className="space-y-4">
              <Button
                onClick={generateBundle}
                disabled={generating}
                className="w-full"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating Bundle...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate Search Bundle
                  </>
                )}
              </Button>

              {/* Generated Bundle Preview */}
              {bundleData && (
                <Card className="bg-green-50 border-green-200">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <CardTitle className="text-green-800">Bundle Generated</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <strong>Title:</strong> {bundleData.source_summary?.title}
                    </div>
                    <div>
                      <strong>Core Concepts:</strong>{' '}
                      {bundleData.core_concepts?.map((concept: string, i: number) => (
                        <Badge key={i} variant="secondary" className="mr-1">
                          {concept}
                        </Badge>
                      ))}
                    </div>
                    <div>
                      <strong>Query Variants:</strong> {bundleData.query_variants?.length || 0} generated
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Create Bundle Button */}
          <Button
            onClick={createBundle}
            disabled={loading || !canCreateBundle()}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating Bundle...
              </>
            ) : (
              'Create Search Bundle'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
