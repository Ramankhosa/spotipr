'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, Clock, AlertTriangle, FileText, Download, RefreshCw } from 'lucide-react';
import { NoveltyAssessmentReport } from './NoveltyAssessmentReport';

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

interface WorkflowStage {
  id: 'pending' | 'stage1' | 'stage2' | 'completed';
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  progress: number;
  details?: string[];
}

interface NoveltyAssessmentWorkflowProps {
  patentId: string;
  assessment?: AssessmentStatus;
  onStartAssessment?: (inventionSummary: any, intersectingPatents: any[]) => void;
  onRefresh?: () => void;
}

export function NoveltyAssessmentWorkflow({
  patentId,
  assessment,
  onStartAssessment,
  onRefresh
}: NoveltyAssessmentWorkflowProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const getWorkflowStages = (assessment?: AssessmentStatus): WorkflowStage[] => {
    const stages: WorkflowStage[] = [
      {
        id: 'pending',
        title: 'Assessment Setup',
        description: 'Preparing invention details and intersecting patents',
        status: 'completed',
        progress: 100,
      },
      {
        id: 'stage1',
        title: 'Level 1: Initial Screening',
        description: 'LLM analysis of patent titles and abstracts',
        status: 'pending',
        progress: 0,
      },
      {
        id: 'stage2',
        title: 'Level 2: Detailed Analysis',
        description: 'In-depth claim comparison and technical assessment',
        status: 'pending',
        progress: 0,
      },
      {
        id: 'completed',
        title: 'Final Report',
        description: 'Comprehensive novelty assessment report',
        status: 'pending',
        progress: 0,
      },
    ];

    if (!assessment) return stages;

    // Update stage statuses based on current assessment status
    switch (assessment.status) {
      case 'PENDING':
        stages[1].status = 'pending';
        break;

      case 'STAGE1_SCREENING':
        stages[1].status = 'active';
        stages[1].progress = 50;
        stages[1].details = ['Analyzing intersecting patents...', 'Assessing relevance levels...'];
        break;

      case 'STAGE1_COMPLETED':
        stages[1].status = 'completed';
        stages[1].progress = 100;
        stages[1].details = [
          `Found ${assessment.stage1Results?.length || 0} patents analyzed`,
          'Initial screening complete'
        ];

        // Determine next stage based on determination
        if (assessment.determination === 'DOUBT') {
          stages[2].status = 'active';
          stages[2].progress = 25;
        } else {
          stages[3].status = 'active';
          stages[3].progress = 50;
        }
        break;

      case 'STAGE2_ASSESSMENT':
        stages[1].status = 'completed';
        stages[1].progress = 100;
        stages[2].status = 'active';
        stages[2].progress = 75;
        stages[2].details = ['Fetching detailed patent claims...', 'Performing technical comparison...'];
        break;

      case 'STAGE2_COMPLETED':
      case 'NOVEL':
      case 'NOT_NOVEL':
      case 'DOUBT_RESOLVED':
        stages[1].status = 'completed';
        stages[1].progress = 100;
        stages[2].status = 'completed';
        stages[2].progress = 100;
        stages[3].status = 'completed';
        stages[3].progress = 100;
        stages[3].details = [
          `Determination: ${getDeterminationText(assessment.determination)}`,
          'PDF report generated'
        ];
        break;

      case 'FAILED':
        stages[1].status = 'error';
        stages[1].progress = 0;
        break;
    }

    return stages;
  };

  const getDeterminationText = (determination?: string) => {
    switch (determination) {
      case 'NOVEL': return 'Novel';
      case 'NOT_NOVEL': return 'Not Novel';
      case 'PARTIALLY_NOVEL': return 'Partially Novel';
      case 'DOUBT': return 'Under Review';
      default: return 'Unknown';
    }
  };

  const getDeterminationColor = (determination?: string) => {
    switch (determination) {
      case 'NOVEL': return 'bg-green-500';
      case 'NOT_NOVEL': return 'bg-red-500';
      case 'PARTIALLY_NOVEL': return 'bg-yellow-500';
      case 'DOUBT': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'active': return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error': return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default: return <Clock className="w-5 h-5 text-gray-400" />;
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  const stages = getWorkflowStages(assessment);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Novelty Assessment
              </CardTitle>
              <CardDescription>
                Comprehensive patent novelty analysis using AI-powered assessment
              </CardDescription>
            </div>
            {assessment && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Current Status */}
      {assessment && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Assessment Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <Badge
                className={`${getDeterminationColor(assessment.determination)} text-white`}
              >
                {getDeterminationText(assessment.determination)}
              </Badge>
              <Badge variant="outline">
                {assessment.status.replace(/_/g, ' ')}
              </Badge>
              {assessment.confidenceLevel && (
                <Badge variant="secondary">
                  Confidence: {assessment.confidenceLevel}
                </Badge>
              )}
            </div>

            {assessment.finalRemarks && (
              <Alert className="mb-4">
                <AlertTitle>Assessment Summary</AlertTitle>
                <AlertDescription>{assessment.finalRemarks}</AlertDescription>
              </Alert>
            )}

            {assessment.reportUrl && (
              <div className="flex gap-2">
                <Button onClick={() => downloadNoveltyReport(assessment.reportUrl!)}>
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF Report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Workflow Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Assessment Progress</CardTitle>
          <CardDescription>
            Track the novelty assessment workflow through its stages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {stages.map((stage, index) => (
              <div key={stage.id} className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  {getStatusIcon(stage.status)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-sm">{stage.title}</h3>
                    <span className="text-xs text-gray-500">{stage.progress}%</span>
                  </div>

                  <p className="text-sm text-gray-600 mb-2">{stage.description}</p>

                  <Progress value={stage.progress} className="mb-2" />

                  {stage.details && (
                    <ul className="text-xs text-gray-500 space-y-1">
                      {stage.details.map((detail, idx) => (
                        <li key={idx} className="flex items-center gap-1">
                          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                          {detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Comprehensive Novelty Report */}
      {assessment && (
        <NoveltyAssessmentReport
          assessment={assessment}
          patentId={patentId}
        />
      )}

      {/* Instructions */}
      {!assessment && (
        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">1</div>
                <div>
                  <h4 className="font-medium">Level 1: Initial Screening</h4>
                  <p className="text-sm text-gray-600">
                    AI analyzes intersecting patents by title and abstract to determine HIGH/MEDIUM/LOW relevance.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">2</div>
                <div>
                  <h4 className="font-medium">Decision Point</h4>
                  <p className="text-sm text-gray-600">
                    If all patents are LOW relevance → NOVEL (complete).<br/>
                    If any HIGH relevance → NOT NOVEL (complete).<br/>
                    If MEDIUM relevance → proceed to Level 2.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">3</div>
                <div>
                  <h4 className="font-medium">Level 2: Detailed Analysis</h4>
                  <p className="text-sm text-gray-600">
                    Fetches full patent claims and performs detailed technical comparison.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">4</div>
                <div>
                  <h4 className="font-medium">Final Report</h4>
                  <p className="text-sm text-gray-600">
                    Comprehensive PDF report with findings, matches, and recommendations.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
