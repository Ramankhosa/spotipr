'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, Clock, AlertTriangle, FileText, Download, RefreshCw, Brain, Target, Zap, Play } from 'lucide-react';

interface NoveltyAssessmentProgressProps {
  runId: string;
  onAssessmentComplete?: (result: any) => void;
  onRefresh?: () => void;
  onManualTrigger?: () => void;
}

interface AssessmentStatus {
  id: string;
  status: 'PENDING' | 'STAGE1_SCREENING' | 'STAGE1_COMPLETED' | 'STAGE2_ASSESSMENT' | 'STAGE2_COMPLETED' | 'NOVEL' | 'NOT_NOVEL' | 'DOUBT_RESOLVED' | 'FAILED';
  determination?: 'NOVEL' | 'NOT_NOVEL' | 'PARTIALLY_NOVEL' | 'DOUBT';
  stage1Results?: any[];
  stage2Results?: any[];
  finalRemarks?: string;
  novelAspects?: string[];
  nonNovelAspects?: string[];
  confidenceLevel?: number;
  createdAt: string;
  reportUrl?: string;
}

export function NoveltyAssessmentProgress({ runId, onAssessmentComplete, onRefresh, onManualTrigger }: NoveltyAssessmentProgressProps) {
  const [assessment, setAssessment] = useState<AssessmentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const fetchAssessment = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await fetch(`/api/prior-art/runs`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const runData = data.runs.find((r: any) => r.id === runId);

        if (runData?.noveltyAssessment) {
          setAssessment(runData.noveltyAssessment);
          setError(null);
        } else {
          setAssessment(null);
        }
      }
    } catch (err) {
      console.error('Error fetching assessment:', err);
      setError('Failed to load assessment status');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadNoveltyReport = async (reportUrl: string) => {
    try {
      console.log('📄 Downloading novelty report:', reportUrl);

      const response = await fetch(reportUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `novelty_assessment_report.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        console.log('✅ Report downloaded successfully');
      } else {
        const errorData = await response.json();
        console.error('❌ Report download failed:', errorData);
        alert(`Failed to download report: ${errorData.error}`);
      }
    } catch (error) {
      console.error('❌ Report download error:', error);
      alert('Failed to download report. Please try again.');
    }
  };

  useEffect(() => {
    fetchAssessment();
  }, [runId]);

  // Start polling for active assessments
  useEffect(() => {
    if (assessment &&
        ['PENDING', 'STAGE1_SCREENING', 'STAGE1_COMPLETED', 'STAGE2_ASSESSMENT'].includes(assessment.status)) {
      const interval = setInterval(fetchAssessment, 3000); // Poll every 3 seconds
      setPollingInterval(interval);

      return () => clearInterval(interval);
    } else if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);

      // Notify parent component when assessment is complete
      if (assessment && onAssessmentComplete) {
        onAssessmentComplete(assessment);
      }
    }
  }, [assessment?.status]);

  const getStatusDisplay = (status: string) => {
    const statusConfig = {
      'PENDING': { label: 'Preparing Assessment', color: 'bg-gray-500', icon: Clock },
      'STAGE1_SCREENING': { label: 'Level 1 Analysis', color: 'bg-blue-500', icon: Brain },
      'STAGE1_COMPLETED': { label: 'Level 1 Complete', color: 'bg-yellow-500', icon: Target },
      'STAGE2_ASSESSMENT': { label: 'Level 2 Analysis', color: 'bg-purple-500', icon: Zap },
      'STAGE2_COMPLETED': { label: 'Analysis Complete', color: 'bg-green-500', icon: CheckCircle },
      'NOVEL': { label: 'Novel Invention', color: 'bg-green-500', icon: CheckCircle },
      'NOT_NOVEL': { label: 'Not Novel', color: 'bg-red-500', icon: AlertTriangle },
      'DOUBT_RESOLVED': { label: 'Assessment Complete', color: 'bg-blue-500', icon: CheckCircle },
      'FAILED': { label: 'Assessment Failed', color: 'bg-red-500', icon: AlertTriangle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.PENDING;
    const IconComponent = config.icon;

    return {
      ...config,
      icon: <IconComponent className="w-4 h-4" />
    };
  };

  const getDeterminationBadge = (determination?: string) => {
    if (!determination) return null;

    const variants = {
      'NOVEL': { variant: 'default' as const, label: 'Novel' },
      'NOT_NOVEL': { variant: 'destructive' as const, label: 'Not Novel' },
      'PARTIALLY_NOVEL': { variant: 'secondary' as const, label: 'Partially Novel' },
      'DOUBT': { variant: 'outline' as const, label: 'Under Review' },
    };

    const config = variants[determination as keyof typeof variants];
    if (!config) return null;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading assessment status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!assessment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Novelty Assessment
          </CardTitle>
          <CardDescription>
            AI-powered patent novelty analysis using search results
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">
              No assessment has been run yet for this search.
            </p>
            {onManualTrigger && (
              <Button onClick={onManualTrigger} className="bg-blue-600 hover:bg-blue-700">
                <Play className="w-4 h-4 mr-2" />
                Start Novelty Assessment
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusDisplay = getStatusDisplay(assessment.status);
  const isActive = ['PENDING', 'STAGE1_SCREENING', 'STAGE1_COMPLETED', 'STAGE2_ASSESSMENT'].includes(assessment.status);

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${statusDisplay.color} text-white`}>
              {statusDisplay.icon}
            </div>
            <div>
              <CardTitle className="text-lg">{statusDisplay.label}</CardTitle>
              <CardDescription>
                {assessment.determination && getDeterminationBadge(assessment.determination)}
                {assessment.confidenceLevel && (
                  <Badge variant="outline" className="ml-2">
                    {assessment.confidenceLevel}% Confidence
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>

          {isActive && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">Analyzing...</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Bar for Active Assessments */}
        {isActive && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Analysis Progress</span>
              <span>{assessment.status.replace(/_/g, ' ')}</span>
            </div>
            <Progress value={
              assessment.status === 'PENDING' ? 10 :
              assessment.status === 'STAGE1_SCREENING' ? 30 :
              assessment.status === 'STAGE1_COMPLETED' ? 60 :
              assessment.status === 'STAGE2_ASSESSMENT' ? 80 : 100
            } className="h-2" />
          </div>
        )}

        {/* Stage 1 Results */}
        {assessment.stage1Results && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Target className="w-4 h-4" />
              Level 1 Screening Results
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-green-600">
                  {Array.isArray(assessment.stage1Results) ? assessment.stage1Results.filter((p: any) => p.relevance === 'LOW').length : 0}
                </div>
                <div className="text-xs text-gray-600">Low Relevance</div>
              </div>

              <div className="text-center p-3 bg-yellow-50 rounded">
                <div className="text-2xl font-bold text-yellow-600">
                  {Array.isArray(assessment.stage1Results) ? assessment.stage1Results.filter((p: any) => p.relevance === 'MEDIUM').length : 0}
                </div>
                <div className="text-xs text-gray-600">Medium Relevance</div>
              </div>

              <div className="text-center p-3 bg-red-50 rounded">
                <div className="text-2xl font-bold text-red-600">
                  {Array.isArray(assessment.stage1Results) ? assessment.stage1Results.filter((p: any) => p.relevance === 'HIGH').length : 0}
                </div>
                <div className="text-xs text-gray-600">High Relevance</div>
              </div>
            </div>

            {Array.isArray(assessment.stage1Results) && assessment.stage1Results[0]?.summary_remarks && (
              <Alert>
                <AlertDescription>{assessment.stage1Results[0].summary_remarks}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Stage 2 Results */}
        {assessment.stage2Results && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Level 2 Detailed Analysis
            </h4>

            <div className="space-y-2">
              {assessment.stage2Results.map((result: any, index: number) => (
                <div key={index} className="p-3 border rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">
                      Patent {result.publicationNumber || result.patent_number}
                    </span>
                    <Badge variant={
                      result.determination === 'NOT_NOVEL' ? 'destructive' :
                      result.determination === 'PARTIALLY_NOVEL' ? 'secondary' : 'default'
                    }>
                      {result.determination?.replace(/_/g, ' ') || 'Analyzed'}
                    </Badge>
                  </div>

                  {result.overall_assessment && (
                    <p className="text-sm text-gray-600">{result.overall_assessment}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Final Remarks */}
        {assessment.finalRemarks && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Assessment Summary</h4>
            <Alert>
              <AlertDescription>{assessment.finalRemarks}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Novel/Non-Novel Aspects */}
        {(assessment.novelAspects?.length || assessment.nonNovelAspects?.length) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assessment.novelAspects && assessment.novelAspects.length > 0 && (
              <div>
                <h4 className="font-medium text-sm text-green-700 mb-2 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" />
                  Novel Aspects
                </h4>
                <ul className="text-xs space-y-1">
                  {assessment.novelAspects.map((aspect, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <span className="text-green-500 mt-1">•</span>
                      {aspect}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {assessment.nonNovelAspects && assessment.nonNovelAspects.length > 0 && (
              <div>
                <h4 className="font-medium text-sm text-red-700 mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  Non-Novel Aspects
                </h4>
                <ul className="text-xs space-y-1">
                  {assessment.nonNovelAspects.map((aspect, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <span className="text-red-500 mt-1">•</span>
                      {aspect}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Report Download */}
        {assessment.reportUrl && (
          <div className="flex justify-center pt-4">
            <Button
              className="bg-purple-600 hover:bg-purple-700"
              onClick={() => downloadNoveltyReport(assessment.reportUrl!)}
            >
              <FileText className="w-4 h-4 mr-2" />
              Download Novelty Report (PDF)
            </Button>
          </div>
        )}

        {/* Manual Actions */}
        <div className="flex justify-center gap-2 pt-4">
          {/* Manual Trigger for Failed Assessments */}
          {assessment.status === 'FAILED' && onManualTrigger && (
            <Button onClick={onManualTrigger} variant="default">
              <Play className="w-4 h-4 mr-2" />
              Retry Assessment
            </Button>
          )}

          {/* Manual Refresh */}
          {!isActive && onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Status
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
