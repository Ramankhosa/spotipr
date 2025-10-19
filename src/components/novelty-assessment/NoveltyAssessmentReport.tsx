'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle,
  AlertTriangle,
  FileText,
  Download,
  ExternalLink,
  Lightbulb,
  TrendingUp,
  BookOpen,
  Search,
  Brain,
  Target
} from 'lucide-react';

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
  runId?: string;
}

interface Level0Result {
  patent_assessments: Array<{
    publication_number: string;
    relevance: 'HIGH' | 'MEDIUM' | 'LOW';
    reasoning: string;
  }>;
  overall_determination: string | null;
  summary_remarks: string;
}

interface PriorArtRun {
  id: string;
  level0Results?: Level0Result;
  level0Determination?: string;
  level0Checked?: boolean;
  bundle?: {
    patentId: string;
  };
}

interface NoveltyAssessmentReportProps {
  assessment: AssessmentStatus;
  patentId: string;
}

interface PatentDetails {
  publicationNumber: string;
  title: string;
  abstract: string;
  relevance?: string;
  llmRemarks?: string;
  determination?: string;
  novelAspects?: string[];
  nonNovelAspects?: string[];
  technicalReasoning?: string;
  confidenceLevel?: string;
}

export function NoveltyAssessmentReport({ assessment, patentId }: NoveltyAssessmentReportProps) {
  const [level0Data, setLevel0Data] = useState<PriorArtRun | null>(null);
  const [isLoadingLevel0, setIsLoadingLevel0] = useState(false);
  const [patentDetails, setPatentDetails] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState('overview');

  // Fetch level 0 results if runId is available
  useEffect(() => {
    if (assessment.runId) {
      fetchLevel0Results();
    }
  }, [assessment.runId]);

  // For now, we'll work with the patent data available in the level 0 results
  // Patent details are typically included in the search results

  const fetchLevel0Results = async () => {
    if (!assessment.runId) return;

    setIsLoadingLevel0(true);
    try {
      const response = await fetch(`/api/prior-art/runs/${assessment.runId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setLevel0Data(data);
      }
    } catch (error) {
      console.error('Failed to fetch level 0 results:', error);
    } finally {
      setIsLoadingLevel0(false);
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

  const getRelevanceColor = (relevance: string) => {
    switch (relevance.toLowerCase()) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const renderLevel0Results = () => {
    if (isLoadingLevel0) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-sm text-gray-600">Loading local search results...</span>
        </div>
      );
    }

    if (!level0Data?.level0Results) {
      return (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Level 0 Results</AlertTitle>
          <AlertDescription>
            No local patent search results were found for this assessment.
          </AlertDescription>
        </Alert>
      );
    }

    const level0Results = level0Data.level0Results as Level0Result;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold">Level 0: Local Patent Database Search</h3>
          <Badge variant="outline" className="ml-auto">
            {level0Results.patent_assessments?.length || 0} patents found
          </Badge>
        </div>

        {level0Results.summary_remarks && (
          <Alert>
            <BookOpen className="h-4 w-4" />
            <AlertTitle>Local Search Summary</AlertTitle>
            <AlertDescription>{level0Results.summary_remarks}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {level0Results.patent_assessments?.map((patent, idx) => (
            <Card key={idx} className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    Patent {patent.publication_number}
                  </CardTitle>
                  <Badge className={getRelevanceColor(patent.relevance)}>
                    {patent.relevance} Relevance
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">AI Assessment:</h4>
                    <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded border-l-4 border-l-blue-300">
                      {patent.reasoning}
                    </p>
                  </div>

                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Full patent details (title, abstract) will be displayed once the patent data is fully loaded from the database.
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const renderLevel1Results = () => {
    // Check if Level 0 short-circuited with a determination
    if (level0Data?.level0Determination && level0Data.level0Determination !== 'DOUBT') {
      return (
        <Alert>
          <BookOpen className="h-4 w-4" />
          <AlertTitle>Level 1 Not Executed</AlertTitle>
          <AlertDescription>
            Level 0 local search determined the invention was <strong>{level0Data.level0Determination.toLowerCase()}</strong>,
            so Level 1 AI screening was not performed.
          </AlertDescription>
        </Alert>
      );
    }

    if (!assessment.stage1Results || assessment.stage1Results.length === 0) {
      return (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Level 1 Results</AlertTitle>
          <AlertDescription>
            Level 1 screening results are not available for this assessment.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold">Level 1: AI Patent Screening</h3>
          <Badge variant="outline" className="ml-auto">
            {assessment.stage1Results.length} patents analyzed
          </Badge>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="font-medium text-purple-900 mb-2">Assessment Methodology</h4>
          <p className="text-sm text-purple-800">
            AI analyzed patent titles and abstracts to determine relevance levels:
            <br />• <strong>HIGH:</strong> Patent teaches invention elements
            <br />• <strong>MEDIUM:</strong> Patent relates but doesn't teach all elements
            <br />• <strong>LOW:</strong> Patent is unrelated
          </p>
        </div>

        <div className="space-y-4">
          {assessment.stage1Results.map((result: any, idx: number) => (
            <Card key={idx} className="border-l-4 border-l-purple-500">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    Patent {result.publication_number}
                  </CardTitle>
                  <Badge className={getRelevanceColor(result.relevance)}>
                    {result.relevance} Relevance
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Patent Details */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Patent Information:</h4>
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-medium text-gray-500">Publication Number:</span>
                        <p className="text-sm text-gray-900">{result.publication_number}</p>
                      </div>
                      {result.title && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">Title:</span>
                          <p className="text-sm text-gray-900">{result.title}</p>
                        </div>
                      )}
                      {result.abstract && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">Abstract:</span>
                          <p className="text-sm text-gray-700 line-clamp-3 mt-1">{result.abstract}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI Analysis */}
                  {result.reasoning && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">AI Relevance Assessment:</h4>
                      <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg">
                        <p className="text-sm text-purple-800">{result.reasoning}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const renderLevel2Results = () => {
    // Check if Level 1 determined NOVEL or NOT_NOVEL (not DOUBT)
    const level1Determination = assessment.stage1Results?.[0]?.relevance;
    const hasLevel1Results = assessment.stage1Results && assessment.stage1Results.length > 0;

    if (hasLevel1Results) {
      const allLow = assessment.stage1Results.every(r => r.relevance === 'LOW');
      const anyHigh = assessment.stage1Results.some(r => r.relevance === 'HIGH');

      if (allLow || anyHigh) {
        const determination = allLow ? 'NOVEL' : 'NOT_NOVEL';
        return (
          <Alert>
            <BookOpen className="h-4 w-4" />
            <AlertTitle>Level 2 Not Executed</AlertTitle>
            <AlertDescription>
              Level 1 AI screening determined the invention was <strong>{determination.toLowerCase()}</strong>
              {allLow ? ' (all patents showed LOW relevance)' : ' (HIGH relevance patents found)'},
              so Level 2 detailed analysis was not necessary.
            </AlertDescription>
          </Alert>
        );
      }
    }

    if (!assessment.stage2Results || assessment.stage2Results.length === 0) {
      return (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Level 2 Results</AlertTitle>
          <AlertDescription>
            Level 2 detailed analysis was not performed or results are not available.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-orange-600" />
          <h3 className="text-lg font-semibold">Level 2: Detailed Technical Analysis</h3>
          <Badge variant="outline" className="ml-auto">
            {assessment.stage2Results.length} patents analyzed
          </Badge>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h4 className="font-medium text-orange-900 mb-2">Detailed Assessment Methodology</h4>
          <p className="text-sm text-orange-800">
            AI performed comprehensive comparison of invention claims against full patent specifications:
            <br />• <strong>NOVEL:</strong> Fully novel invention
            <br />• <strong>NOT_NOVEL:</strong> Anticipated by patent
            <br />• <strong>PARTIALLY_NOVEL:</strong> Some novel elements
          </p>
        </div>

        <div className="space-y-6">
          {assessment.stage2Results.map((result: any, idx: number) => (
            <Card key={idx} className={`border-l-4 ${
              result.determination === 'NOT_NOVEL' ? 'border-l-red-500' :
              result.determination === 'PARTIALLY_NOVEL' ? 'border-l-yellow-500' :
              'border-l-green-500'
            }`}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-medium">
                      Patent {result.publicationNumber}
                    </CardTitle>
                    <p className="text-sm text-gray-600 mt-1">
                      Detailed Technical Comparison & Novelty Analysis
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.confidence_level && (
                      <Badge variant="outline" className="text-xs">
                        {result.confidence_level} Confidence
                      </Badge>
                    )}
                    <Badge variant={
                      result.determination === 'NOT_NOVEL' ? 'destructive' :
                      result.determination === 'PARTIALLY_NOVEL' ? 'default' : 'secondary'
                    } className="text-xs">
                      {result.determination?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Executive Summary */}
                  {result.overall_assessment && (
                    <div className="bg-gray-50 border-l-4 border-l-orange-400 p-4 rounded-r-lg">
                      <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Executive Summary
                      </h4>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {result.overall_assessment}
                      </p>
                    </div>
                  )}

                  {/* Technical Analysis */}
                  {result.technical_reasoning && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <Brain className="w-4 h-4" />
                        Detailed Technical Analysis
                      </h4>
                      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                        <p className="text-sm text-blue-800 leading-relaxed">
                          {result.technical_reasoning}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Novelty Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {result.novel_aspects && result.novel_aspects.length > 0 && (
                      <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                        <h4 className="text-sm font-semibold text-green-800 mb-3 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Novel Aspects ({result.novel_aspects.length})
                        </h4>
                        <ul className="space-y-2">
                          {result.novel_aspects.map((aspect: string, aspectIdx: number) => (
                            <li key={aspectIdx} className="flex items-start gap-3">
                              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-sm text-green-800 leading-relaxed">{aspect}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {result.non_novel_aspects && result.non_novel_aspects.length > 0 && (
                      <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                        <h4 className="text-sm font-semibold text-red-800 mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Anticipated Aspects ({result.non_novel_aspects.length})
                        </h4>
                        <ul className="space-y-2">
                          {result.non_novel_aspects.map((aspect: string, aspectIdx: number) => (
                            <li key={aspectIdx} className="flex items-start gap-3">
                              <div className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-sm text-red-800 leading-relaxed">{aspect}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Suggestions */}
                  {result.suggestions && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4" />
                        Recommendations
                      </h4>
                      <p className="text-sm text-amber-800">{result.suggestions}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const renderImprovementSuggestions = () => {
    const suggestions = [];

    // Add assessment-specific suggestions
    if (assessment.suggestions) {
      suggestions.push({
        type: 'general',
        title: 'Assessment Recommendations',
        content: assessment.suggestions
      });
    }

    // Add determination-specific guidance
    if (assessment.determination === 'NOVEL') {
      suggestions.push({
        type: 'success',
        title: 'Excellent Novelty Position',
        content: 'Your invention appears novel. Consider conducting a full patent search and preparing claims that clearly distinguish from any related art.'
      });
    } else if (assessment.determination === 'NOT_NOVEL') {
      suggestions.push({
        type: 'critical',
        title: 'Novelty Concerns Identified',
        content: 'Consider amending claims to focus on novel combinations or unexpected results. You may also explore design patents or utility patents with narrower scopes.'
      });
      suggestions.push({
        type: 'strategy',
        title: 'Alternative Protection Strategies',
        content: 'Consider divisional applications, continuation applications, or protecting specific implementations rather than broad concepts.'
      });
    } else if (assessment.determination === 'PARTIALLY_NOVEL') {
      suggestions.push({
        type: 'improvement',
        title: 'Strengthen Novel Aspects',
        content: 'Focus on broadening the novel elements identified and narrowing claims around anticipated aspects to improve patentability.'
      });
    }

    // Add technical improvement suggestions
    if (assessment.nonNovelAspects && assessment.nonNovelAspects.length > 0) {
      suggestions.push({
        type: 'technical',
        title: 'Address Anticipated Aspects',
        content: `Consider differentiating from these elements: ${assessment.nonNovelAspects.slice(0, 3).join(', ')}${assessment.nonNovelAspects.length > 3 ? '...' : ''}`
      });
    }

    // Add general improvement strategies
    suggestions.push({
      type: 'general',
      title: 'General Novelty Enhancement Strategies',
      content: 'Consider adding technical limitations, combining features in novel ways, or focusing on unexpected technical advantages over the prior art.'
    });

    if (suggestions.length === 0) {
      return null;
    }

    const getSuggestionIcon = (type: string) => {
      switch (type) {
        case 'success': return <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />;
        case 'critical': return <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />;
        case 'improvement': return <TrendingUp className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />;
        case 'technical': return <Target className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />;
        default: return <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />;
      }
    };

    const getSuggestionColor = (type: string) => {
      switch (type) {
        case 'success': return 'border-green-200 bg-green-50';
        case 'critical': return 'border-red-200 bg-red-50';
        case 'improvement': return 'border-blue-200 bg-blue-50';
        case 'technical': return 'border-purple-200 bg-purple-50';
        default: return 'border-amber-200 bg-amber-50';
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-6 h-6 text-amber-600" />
          <h3 className="text-xl font-semibold">Novelty Improvement Recommendations</h3>
        </div>

        <div className="grid gap-4">
          {suggestions.map((suggestion, idx) => (
            <Card key={idx} className={`border-l-4 ${getSuggestionColor(suggestion.type)}`}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  {getSuggestionIcon(suggestion.type)}
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 mb-1">{suggestion.title}</h4>
                    <p className="text-sm text-gray-700 leading-relaxed">{suggestion.content}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Additional Resources */}
        <Card className="bg-gray-50">
          <CardContent className="pt-4">
            <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Additional Resources
            </h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Consult with a patent attorney for detailed claim drafting</li>
              <li>• Review USPTO guidelines on novelty and non-obviousness</li>
              <li>• Consider international patent protection strategies</li>
              <li>• Explore patent landscaping to identify white spaces</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderOverview = () => {
    return (
      <div className="space-y-6">
        {/* Assessment Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Novelty Assessment Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`grid grid-cols-1 gap-4 mb-6 ${
              level0Data?.level0Results ? 'md:grid-cols-3' : 'md:grid-cols-2'
            }`}>
              {level0Data?.level0Results && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {level0Data.level0Results.patent_assessments?.length || 0}
                  </div>
                  <div className="text-sm text-gray-600">Local Patents Found</div>
                </div>
              )}
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {assessment.stage1Results?.length || 0}
                </div>
                <div className="text-sm text-gray-600">Level 1 Analyzed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {assessment.stage2Results?.length || 0}
                </div>
                <div className="text-sm text-gray-600">Level 2 Analyzed</div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge
                  className={`${getDeterminationColor(assessment.determination)} text-white`}
                >
                  {assessment.determination?.replace(/_/g, ' ') || 'Unknown'}
                </Badge>
                {assessment.confidenceLevel && (
                  <Badge variant="outline">
                    {assessment.confidenceLevel} Confidence
                  </Badge>
                )}
              </div>

              {assessment.finalRemarks && (
                <Alert>
                  <AlertTitle>Final Assessment</AlertTitle>
                  <AlertDescription>{assessment.finalRemarks}</AlertDescription>
                </Alert>
              )}

              {/* Assessment Workflow Summary */}
              <div className="mt-6 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Assessment Workflow</h4>
                <div className="space-y-2 text-xs text-gray-600">
                  {level0Data?.level0Results && (
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        level0Data.level0Determination ? 'bg-green-500' : 'bg-gray-300'
                      }`}></div>
                      <span>Level 0: Local database search - {level0Data.level0Determination || 'Completed'}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      assessment.stage1Results?.length ? 'bg-green-500' : 'bg-gray-300'
                    }`}></div>
                    <span>Level 1: AI patent screening - {assessment.stage1Results?.length ? 'Completed' : 'Skipped'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      assessment.stage2Results?.length ? 'bg-green-500' : 'bg-gray-300'
                    }`}></div>
                    <span>Level 2: Detailed technical analysis - {assessment.stage2Results?.length ? 'Completed' : 'Skipped'}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        {(assessment.novelAspects?.length || assessment.nonNovelAspects?.length) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assessment.novelAspects && assessment.novelAspects.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-green-700 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Novel Aspects ({assessment.novelAspects.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {assessment.novelAspects.slice(0, 3).map((aspect, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                        <span className="text-gray-600">{aspect}</span>
                      </li>
                    ))}
                    {assessment.novelAspects.length > 3 && (
                      <li className="text-xs text-gray-500 mt-2">
                        +{assessment.novelAspects.length - 3} more aspects...
                      </li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}

            {assessment.nonNovelAspects && assessment.nonNovelAspects.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Anticipated Aspects ({assessment.nonNovelAspects.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {assessment.nonNovelAspects.slice(0, 3).map((aspect, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                        <span className="text-gray-600">{aspect}</span>
                      </li>
                    ))}
                    {assessment.nonNovelAspects.length > 3 && (
                      <li className="text-xs text-gray-500 mt-2">
                        +{assessment.nonNovelAspects.length - 3} more aspects...
                      </li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Comprehensive Novelty Assessment Report
        </CardTitle>
        <CardDescription>
          Detailed analysis across all assessment levels with patent comparisons and AI insights
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full ${
            level0Data?.level0Results ? 'grid-cols-4' : 'grid-cols-3'
          }`}>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {level0Data?.level0Results && (
              <TabsTrigger value="level0">Level 0: Local Search</TabsTrigger>
            )}
            <TabsTrigger value="level1">Level 1: AI Screening</TabsTrigger>
            <TabsTrigger value="level2">Level 2: Deep Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            {renderOverview()}
          </TabsContent>

          {level0Data?.level0Results && (
            <TabsContent value="level0" className="mt-6">
              {renderLevel0Results()}
            </TabsContent>
          )}

          <TabsContent value="level1" className="mt-6">
            {renderLevel1Results()}
          </TabsContent>

          <TabsContent value="level2" className="mt-6">
            {renderLevel2Results()}
          </TabsContent>
        </Tabs>

        {/* Improvement Suggestions */}
        {renderImprovementSuggestions()}

        {/* Download Report */}
        {assessment.reportUrl && (
          <div className="mt-6 flex justify-center">
            <Button
              onClick={() => window.open(assessment.reportUrl, '_blank')}
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download Full PDF Report
              <ExternalLink className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
