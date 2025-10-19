'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NoveltyAssessmentWorkflow } from './NoveltyAssessmentWorkflow';
import { NoveltyAssessmentForm } from './NoveltyAssessmentForm';
import { FileText, Plus, History } from 'lucide-react';

interface AssessmentStatus {
  id: string;
  status: 'PENDING' | 'STAGE1_SCREENING' | 'STAGE1_COMPLETED' | 'STAGE2_ASSESSMENT' | 'STAGE2_COMPLETED' | 'NOVEL' | 'NOT_NOVEL' | 'DOUBT_RESOLVED' | 'FAILED';
  determination?: 'NOVEL' | 'NOT_NOVEL' | 'PARTIALLY_NOVEL' | 'DOUBT';
  stage1Results?: any[];
  stage2Results?: any[];
  finalRemarks?: string;
  suggestions?: string;
  novelAspects?: string[];
  nonNovelAspects?: string[];
  confidenceLevel?: string;
  createdAt: string;
  reportUrl?: string;
}

interface NoveltyAssessmentManagerProps {
  patentId: string;
}

export function NoveltyAssessmentManager({ patentId }: NoveltyAssessmentManagerProps) {
  const [assessments, setAssessments] = useState<AssessmentStatus[]>([]);
  const [currentAssessment, setCurrentAssessment] = useState<AssessmentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('workflow');
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Fetch assessments for this patent
  const fetchAssessments = async () => {
    try {
      const response = await fetch(`/api/patents/${patentId}/novelty-assessment`);
      if (!response.ok) {
        throw new Error('Failed to fetch assessments');
      }
      const data = await response.json();
      setAssessments(data.assessments || []);

      // Set current assessment (latest one or active one)
      const activeAssessment = data.assessments?.find((a: AssessmentStatus) =>
        ['PENDING', 'STAGE1_SCREENING', 'STAGE1_COMPLETED', 'STAGE2_ASSESSMENT'].includes(a.status)
      ) || data.assessments?.[0] || null;

      setCurrentAssessment(activeAssessment);
    } catch (err) {
      console.error('Error fetching assessments:', err);
      setError('Failed to load assessments');
    }
  };

  useEffect(() => {
    fetchAssessments();
  }, [patentId]);

  // Start/stop polling based on assessment status
  useEffect(() => {
    // Clear existing interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }

    // Start polling if there's an active assessment
    if (currentAssessment &&
        ['PENDING', 'STAGE1_SCREENING', 'STAGE1_COMPLETED', 'STAGE2_ASSESSMENT'].includes(currentAssessment.status)) {
      const interval = setInterval(async () => {
        try {
          await fetchAssessments();
        } catch (error) {
          console.error('Polling error:', error);
        }
      }, 5000); // Poll every 5 seconds

      setPollingInterval(interval);
    }

    // Cleanup on unmount
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [currentAssessment?.status, patentId]);

  // Start new assessment
  const handleStartAssessment = async (data: {
    inventionSummary: { title: string; problem: string; solution: string };
    intersectingPatents: any[];
  }) => {
    setIsLoading(true);
    setError(null);

    try {
      // Get JWT token
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`/api/patents/${patentId}/novelty-assessment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start assessment');
      }

      const result = await response.json();

      // Refresh assessments
      await fetchAssessments();

      // Switch to workflow tab to show progress
      setActiveTab('workflow');

    } catch (err) {
      console.error('Error starting assessment:', err);
      setError(err instanceof Error ? err.message : 'Failed to start assessment');
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh current assessment
  const handleRefreshAssessment = async () => {
    if (!currentAssessment) return;

    try {
      const response = await fetch(`/api/patents/${patentId}/novelty-assessment/${currentAssessment.id}`);
      if (!response.ok) {
        throw new Error('Failed to refresh assessment');
      }

      const data = await response.json();
      if (data.success) {
        setCurrentAssessment(data);
        // Update in assessments list
        setAssessments(prev =>
          prev.map(a => a.id === data.assessmentId ? { ...a, ...data } : a)
        );
      }
    } catch (err) {
      console.error('Error refreshing assessment:', err);
      setError('Failed to refresh assessment status');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'PENDING': { variant: 'secondary' as const, label: 'Pending' },
      'STAGE1_SCREENING': { variant: 'default' as const, label: 'Level 1 Screening' },
      'STAGE1_COMPLETED': { variant: 'default' as const, label: 'Level 1 Complete' },
      'STAGE2_ASSESSMENT': { variant: 'default' as const, label: 'Level 2 Analysis' },
      'STAGE2_COMPLETED': { variant: 'default' as const, label: 'Level 2 Complete' },
      'NOVEL': { variant: 'default' as const, label: 'Novel' },
      'NOT_NOVEL': { variant: 'destructive' as const, label: 'Not Novel' },
      'DOUBT_RESOLVED': { variant: 'secondary' as const, label: 'Resolved' },
      'FAILED': { variant: 'destructive' as const, label: 'Failed' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.PENDING;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-6 h-6" />
            Patent Novelty Assessment
          </CardTitle>
          <CardDescription>
            AI-powered patent novelty analysis with real-time progress tracking
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Assessment History */}
      {assessments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5" />
              Assessment History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {assessments.slice(0, 5).map((assessment) => (
                <div
                  key={assessment.id}
                  className={`flex items-center justify-between p-3 rounded border cursor-pointer transition-colors ${
                    currentAssessment?.id === assessment.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setCurrentAssessment(assessment)}
                >
                  <div className="flex items-center gap-3">
                    {getStatusBadge(assessment.status)}
                    <div>
                      <p className="font-medium text-sm">
                        Assessment #{assessment.id.slice(-8)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(assessment.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {assessment.determination && (
                    <Badge variant="outline">
                      {assessment.determination.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="workflow" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Current Assessment
          </TabsTrigger>
          <TabsTrigger value="new" className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Assessment
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflow" className="mt-6">
          {currentAssessment ? (
            <NoveltyAssessmentWorkflow
              patentId={patentId}
              assessment={currentAssessment}
              onRefresh={handleRefreshAssessment}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="w-12 h-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No Active Assessment
                </h3>
                <p className="text-gray-600 text-center mb-6">
                  Start a new novelty assessment to analyze your patent's novelty against existing patents.
                </p>
                <Button onClick={() => setActiveTab('new')}>
                  <Plus className="w-4 h-4 mr-2" />
                  Start Assessment
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="new" className="mt-6">
          <NoveltyAssessmentForm
            patentId={patentId}
            onSubmit={handleStartAssessment}
            isLoading={isLoading}
          />
        </TabsContent>
      </Tabs>

      {/* Auto-refresh for active assessments */}
      {currentAssessment &&
       ['PENDING', 'STAGE1_SCREENING', 'STAGE1_COMPLETED', 'STAGE2_ASSESSMENT'].includes(currentAssessment.status) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              Assessment in progress - page will auto-refresh to show updates
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
