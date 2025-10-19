'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Plus, X, FileText, Loader2 } from 'lucide-react';

interface IntersectingPatent {
  publicationNumber: string;
  title: string;
  abstract: string;
  relevance?: number;
}

interface NoveltyAssessmentFormProps {
  patentId: string;
  intersectingPatents?: IntersectingPatent[];
  onSubmit: (data: {
    inventionSummary: {
      title: string;
      problem: string;
      solution: string;
    };
    intersectingPatents: IntersectingPatent[];
  }) => Promise<void>;
  isLoading?: boolean;
}

export function NoveltyAssessmentForm({
  patentId,
  intersectingPatents = [],
  onSubmit,
  isLoading = false
}: NoveltyAssessmentFormProps) {
  const [inventionTitle, setInventionTitle] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [solution, setSolution] = useState('');
  const [patents, setPatents] = useState<IntersectingPatent[]>(intersectingPatents);
  const [errors, setErrors] = useState<string[]>([]);

  const addPatent = () => {
    setPatents([...patents, {
      publicationNumber: '',
      title: '',
      abstract: '',
    }]);
  };

  const removePatent = (index: number) => {
    setPatents(patents.filter((_, i) => i !== index));
  };

  const updatePatent = (index: number, field: keyof IntersectingPatent, value: string) => {
    const updatedPatents = [...patents];
    updatedPatents[index] = { ...updatedPatents[index], [field]: value };
    setPatents(updatedPatents);
  };

  const validateForm = () => {
    const newErrors: string[] = [];

    if (!inventionTitle.trim()) {
      newErrors.push('Invention title is required');
    }

    if (!problemStatement.trim()) {
      newErrors.push('Problem statement is required');
    }

    if (!solution.trim()) {
      newErrors.push('Solution description is required');
    }

    // Check word limits
    const titleWords = inventionTitle.trim().split(/\s+/).length;
    const problemWords = problemStatement.trim().split(/\s+/).length;
    const solutionWords = solution.trim().split(/\s+/).length;

    if (titleWords > 50) {
      newErrors.push('Invention title should be under 50 words');
    }

    if (problemWords > 100) {
      newErrors.push('Problem statement should be under 100 words');
    }

    if (solutionWords > 100) {
      newErrors.push('Solution description should be under 100 words');
    }

    if (patents.length === 0) {
      newErrors.push('At least one intersecting patent is required');
    }

    // Validate patents
    patents.forEach((patent, index) => {
      if (!patent.publicationNumber.trim()) {
        newErrors.push(`Patent ${index + 1}: Publication number is required`);
      }
      if (!patent.title.trim()) {
        newErrors.push(`Patent ${index + 1}: Title is required`);
      }
      if (!patent.abstract.trim()) {
        newErrors.push(`Patent ${index + 1}: Abstract is required`);
      }
    });

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await onSubmit({
        inventionSummary: {
          title: inventionTitle.trim(),
          problem: problemStatement.trim(),
          solution: solution.trim(),
        },
        intersectingPatents: patents,
      });
    } catch (error) {
      console.error('Form submission error:', error);
      setErrors(['Failed to start assessment. Please try again.']);
    }
  };

  const getWordCount = (text: string) => {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  const getWordCountColor = (count: number, limit: number) => {
    if (count > limit) return 'text-red-600';
    if (count > limit * 0.8) return 'text-yellow-600';
    return 'text-gray-500';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Start Novelty Assessment
          </CardTitle>
          <CardDescription>
            Provide your invention details and intersecting patents for AI-powered novelty analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invention Summary */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Invention Summary</h3>

            <div>
              <Label htmlFor="title">Invention Title *</Label>
              <Textarea
                id="title"
                placeholder="Brief title describing your invention"
                      value={inventionTitle}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInventionTitle(e.target.value)}
                className="mt-1"
                rows={2}
              />
              <div className={`text-xs mt-1 ${getWordCountColor(getWordCount(inventionTitle), 50)}`}>
                {getWordCount(inventionTitle)}/50 words
              </div>
            </div>

            <div>
              <Label htmlFor="problem">Problem Statement *</Label>
              <Textarea
                id="problem"
                placeholder="What problem does your invention solve?"
                      value={problemStatement}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setProblemStatement(e.target.value)}
                className="mt-1"
                rows={3}
              />
              <div className={`text-xs mt-1 ${getWordCountColor(getWordCount(problemStatement), 100)}`}>
                {getWordCount(problemStatement)}/100 words
              </div>
            </div>

            <div>
              <Label htmlFor="solution">Solution Description *</Label>
              <Textarea
                id="solution"
                placeholder="How does your invention solve the problem?"
                      value={solution}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSolution(e.target.value)}
                className="mt-1"
                rows={3}
              />
              <div className={`text-xs mt-1 ${getWordCountColor(getWordCount(solution), 100)}`}>
                {getWordCount(solution)}/100 words
              </div>
            </div>
          </div>

          {/* Intersecting Patents */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Intersecting Patents</h3>
              <Button type="button" variant="outline" onClick={addPatent}>
                <Plus className="w-4 h-4 mr-2" />
                Add Patent
              </Button>
            </div>

            <p className="text-sm text-gray-600">
              Add patents that appear relevant to your invention for comprehensive analysis.
            </p>

            {patents.length === 0 && (
              <Alert>
                <AlertDescription>
                  No intersecting patents added. Click "Add Patent" to include patents for analysis.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              {patents.map((patent, index) => (
                <Card key={index} className="relative">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        Patent {index + 1}
                      </CardTitle>
                      {patents.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removePatent(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label htmlFor={`patent-${index}-number`}>Publication Number *</Label>
                      <Input
                        id={`patent-${index}-number`}
                        placeholder="e.g., US20210012345A1"
                        value={patent.publicationNumber}
                        onChange={(e) => updatePatent(index, 'publicationNumber', e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`patent-${index}-title`}>Title *</Label>
                      <Input
                        id={`patent-${index}-title`}
                        placeholder="Patent title"
                        value={patent.title}
                        onChange={(e) => updatePatent(index, 'title', e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`patent-${index}-abstract`}>Abstract *</Label>
                      <Textarea
                        id={`patent-${index}-abstract`}
                        placeholder="Patent abstract (key technical details)"
                        value={patent.abstract}
                        onChange={(e) => updatePatent(index, 'abstract', e.target.value)}
                        className="mt-1"
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSubmit}
              disabled={isLoading}
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting Assessment...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Start Novelty Assessment
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Information */}
      <Card>
        <CardHeader>
          <CardTitle>What Happens Next?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-bold">1</span>
              </div>
              <div>
                <h4 className="font-medium">Level 1 Screening</h4>
                <p className="text-sm text-gray-600">
                  AI analyzes patent titles and abstracts to determine relevance levels.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-green-600 font-bold">2</span>
              </div>
              <div>
                <h4 className="font-medium">Decision Point</h4>
                <p className="text-sm text-gray-600">
                  Based on relevance, determines if invention is novel or needs deeper analysis.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <span className="text-yellow-600 font-bold">3</span>
              </div>
              <div>
                <h4 className="font-medium">Level 2 Analysis</h4>
                <p className="text-sm text-gray-600">
                  If needed, fetches full patent claims for detailed technical comparison.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                <span className="text-purple-600 font-bold">4</span>
              </div>
              <div>
                <h4 className="font-medium">Final Report</h4>
                <p className="text-sm text-gray-600">
                  Comprehensive PDF report with findings and recommendations.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
