import jsPDF from 'jspdf';
import { NoveltyAssessmentRun, NoveltyDetermination } from '@prisma/client';
import { prisma } from './prisma';
import fs from 'fs';
import path from 'path';

interface NoveltyReportData {
  assessment: NoveltyAssessmentRun & {
    patent: { title: string };
    user: { name: string; email: string };
    llmCalls?: any[];
    intersectingPatents?: any[];
  };
  priorArtRun?: {
    bundle: {
      bundleData: {
        source_summary?: {
          title?: string;
          problem_statement?: string;
          solution_summary?: string;
        };
        core_concepts?: string[];
        technical_features?: string[];
        query_variants?: Array<{
          label: 'BROAD' | 'BASELINE' | 'NARROW';
          q: string;
        }>;
      };
    };
  };
  companyName?: string;
  companyLogo?: string; // Base64 encoded logo
}

export class PDFReportService {

  /**
   * Generate PDF report for novelty assessment
   */
  static async generateNoveltyReport(assessmentId: string, companyName?: string, companyLogo?: string): Promise<string> {
    try {
      // Fetch assessment data with relations
      const assessment = await prisma.noveltyAssessmentRun.findUnique({
        where: { id: assessmentId },
        include: {
          patent: { select: { title: true } },
          user: { select: { name: true, email: true } },
          llmCalls: {
            orderBy: { calledAt: 'asc' },
          },
        },
      });

      if (!assessment) {
        throw new Error('Assessment not found');
      }

      // Fetch prior art run data if available
      let priorArtRun = null;
      if (assessment.runId) {
        priorArtRun = await prisma.priorArtRun.findUnique({
          where: { id: assessment.runId },
          select: {
            bundle: {
              select: {
                bundleData: true,
              },
            },
          },
        });
      }

      const reportData: NoveltyReportData = {
        assessment: assessment as any,
        priorArtRun: priorArtRun as any,
        companyName,
        companyLogo,
      };

      // Generate PDF
      const pdfPath = await this.createPDF(reportData);

      // Update assessment with report URL
      await prisma.noveltyAssessmentRun.update({
        where: { id: assessmentId },
        data: {
          // You might want to add a reportUrl field to the schema
          // For now, we'll just return the path
        },
      });

      return pdfPath;

    } catch (error) {
      console.error('PDF report generation error:', error);
      throw error;
    }
  }

  /**
   * Create PDF document with novelty assessment data
   */
  private static async createPDF(data: NoveltyReportData): Promise<string> {
    try {
      // Create jsPDF document (A4 size)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Set document properties
      doc.setProperties({
        title: `Novelty Assessment Report - ${data.assessment.patent.title}`,
        author: 'Patent Analysis System',
        subject: 'Patent Novelty Assessment',
      });

      // Create uploads directory if it doesn't exist
      const reportsDir = path.join(process.cwd(), 'uploads', 'reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filename = `novelty_report_${data.assessment.id}_${Date.now()}.pdf`;
      const filepath = path.join(reportsDir, filename);

      // Set initial position and styling
      let yPosition = 20; // mm from top

      // Header
      yPosition = this.addHeader(doc, data, yPosition);

      // Invention Summary
      yPosition = this.addInventionSummary(doc, data, yPosition);

      // Search Strategy
      yPosition = this.addSearchStrategy(doc, data, yPosition);

      // Assessment Overview
      yPosition = this.addAssessmentOverview(doc, data, yPosition);

      // Detailed Findings
      yPosition = this.addDetailedFindings(doc, data, yPosition);

      // Recommendations
      yPosition = this.addRecommendations(doc, data, yPosition);

      // Footer
      this.addFooter(doc, data);

      // Save the PDF
      const pdfBuffer = doc.output('arraybuffer');
      fs.writeFileSync(filepath, Buffer.from(pdfBuffer));

      return `/uploads/reports/${filename}`;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Add report header with company logo and title
   */
  private static addHeader(doc: jsPDF, data: NoveltyReportData, yPosition: number): number {
    // Company logo (if provided)
    if (data.companyLogo) {
      // Note: In a real implementation, you'd decode the base64 logo
      // For now, we'll skip the logo rendering
      yPosition += 10;
    }

    // Company name
    if (data.companyName) {
      doc.setFontSize(16);
      doc.text(data.companyName, 20, yPosition);
      yPosition += 15;
    }

    // Report title
    doc.setFontSize(20);
    doc.text('PATENT NOVELTY ASSESSMENT REPORT', 20, yPosition);
    yPosition += 20;

    // Report metadata
    doc.setFontSize(10);
    doc.text(`Report ID: ${data.assessment.id}`, 20, yPosition);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 140, yPosition);
    yPosition += 8;
    doc.text(`Patent: ${data.assessment.patent.title}`, 20, yPosition);
    doc.text(`Analyst: ${data.assessment.user.name || data.assessment.user.email}`, 140, yPosition);
    yPosition += 8;
    doc.text(`Assessment Date: ${data.assessment.createdAt.toLocaleDateString()}`, 20, yPosition);

    // Add horizontal line
    yPosition += 10;
    doc.line(20, yPosition, 190, yPosition);

    return yPosition + 10;
  }

  /**
   * Add invention summary section
   */
  private static addInventionSummary(doc: jsPDF, data: NoveltyReportData, yPosition: number): number {
    // Add new page if needed
    if (yPosition > 250) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(16);
    doc.text('1. INVENTION SUMMARY', 20, yPosition);
    yPosition += 15;

    doc.setFontSize(12);
    doc.text('Title:', 20, yPosition);
    yPosition += 10;

    const inventionSummary = data.assessment.inventionSummary as { title: string; problem: string; solution: string };
    doc.setFontSize(11);
    const titleLines = doc.splitTextToSize(inventionSummary.title, 160);
    doc.text(titleLines, 30, yPosition);
    yPosition += titleLines.length * 5 + 5;

    doc.setFontSize(12);
    doc.text('Problem Statement:', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(11);
    const problemLines = doc.splitTextToSize(inventionSummary.problem, 160);
    doc.text(problemLines, 30, yPosition);
    yPosition += problemLines.length * 5 + 5;

    doc.setFontSize(12);
    doc.text('Solution:', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(11);
    const solutionLines = doc.splitTextToSize(inventionSummary.solution, 160);
    doc.text(solutionLines, 30, yPosition);
    yPosition += solutionLines.length * 5 + 10;

    return yPosition;
  }

  /**
   * Add search strategy section
   */
  private static addSearchStrategy(doc: jsPDF, data: NoveltyReportData, yPosition: number): number {
    // Add new page if needed
    if (yPosition > 200) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(16);
    doc.text('2. SEARCH STRATEGY & FEATURES', 20, yPosition);
    yPosition += 15;

    const bundleData = data.priorArtRun?.bundle?.bundleData;
    if (bundleData) {
      // Invention Summary for Search
      if (bundleData.source_summary) {
        doc.setFontSize(12);
        doc.text('Invention Summary Used for Search:', 20, yPosition);
        yPosition += 10;

        const summary = bundleData.source_summary;
        if (summary.title) {
          doc.setFontSize(11);
          doc.text('Title:', 30, yPosition);
          yPosition += 8;
          doc.setFontSize(10);
          const titleLines = doc.splitTextToSize(summary.title, 140);
          doc.text(titleLines, 40, yPosition);
          yPosition += titleLines.length * 4 + 3;
        }

        if (summary.problem_statement) {
          doc.setFontSize(11);
          doc.text('Problem:', 30, yPosition);
          yPosition += 8;
          doc.setFontSize(10);
          const problemLines = doc.splitTextToSize(summary.problem_statement, 140);
          doc.text(problemLines, 40, yPosition);
          yPosition += problemLines.length * 4 + 3;
        }

        if (summary.solution_summary) {
          doc.setFontSize(11);
          doc.text('Solution:', 30, yPosition);
          yPosition += 8;
          doc.setFontSize(10);
          const solutionLines = doc.splitTextToSize(summary.solution_summary, 140);
          doc.text(solutionLines, 40, yPosition);
          yPosition += solutionLines.length * 4 + 6;
        }
      }

      // Core Concepts and Technical Features
      if (bundleData.core_concepts && bundleData.core_concepts.length > 0) {
        doc.setFontSize(12);
        doc.text('Core Concepts Searched:', 20, yPosition);
        yPosition += 10;
        doc.setFontSize(10);
        bundleData.core_concepts.forEach((concept: string) => {
          if (yPosition > 270) {
            doc.addPage();
            yPosition = 20;
          }
          doc.text(`• ${concept}`, 30, yPosition);
          yPosition += 6;
        });
        yPosition += 3;
      }

      if (bundleData.technical_features && bundleData.technical_features.length > 0) {
        doc.setFontSize(12);
        doc.text('Technical Features Considered:', 20, yPosition);
        yPosition += 10;
        doc.setFontSize(10);
        bundleData.technical_features.forEach((feature: string) => {
          if (yPosition > 270) {
            doc.addPage();
            yPosition = 20;
          }
          doc.text(`• ${feature}`, 30, yPosition);
          yPosition += 6;
        });
        yPosition += 6;
      }

      // Search Queries
      if (bundleData.query_variants && bundleData.query_variants.length > 0) {
        doc.setFontSize(12);
        doc.text('Generated Search Queries:', 20, yPosition);
        yPosition += 12;

        const variants = bundleData.query_variants;
        variants.forEach((variant: any, index: number) => {
          if (yPosition > 250) {
            doc.addPage();
            yPosition = 20;
          }

          doc.setFontSize(11);
          doc.text(`${index + 1}. ${variant.label.toUpperCase()} Query:`, 20, yPosition);
          yPosition += 10;

          doc.setFontSize(10);
          const queryLines = doc.splitTextToSize(variant.q, 160);
          doc.text(queryLines, 30, yPosition);
          yPosition += queryLines.length * 4 + 8;
        });
      }
    } else {
      doc.setFontSize(11);
      doc.text('No prior art search data available for this assessment.', 20, yPosition);
    }

    return yPosition;
  }

  /**
   * Add assessment overview section
   */
  private static addAssessmentOverview(doc: jsPDF, data: NoveltyReportData, yPosition: number): number {
    // Add new page if needed
    if (yPosition > 200) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(16);
    doc.text('3. LLM ASSESSMENT OVERVIEW', 20, yPosition);
    yPosition += 15;

    // Final determination with visual indicator
    const determination = this.getDeterminationText(data.assessment.finalDetermination);
    doc.setFontSize(14);
    doc.text(`Overall Novelty Determination: ${determination}`, 20, yPosition);
    yPosition += 15;

    // Status indicator
    const statusColor = this.getStatusColor(data.assessment.finalDetermination);
    // Draw colored circle (approximated with filled circle)
    doc.setFillColor(statusColor);
    doc.circle(35, yPosition - 2, 2, 'F');
    doc.setFontSize(12);
    doc.text(`Assessment Status: ${data.assessment.status.replace(/_/g, ' ')}`, 42, yPosition - 3);
    yPosition += 15;

    // LLM Analysis Summary
    doc.setFontSize(12);
    doc.text('LLM Analysis Summary:', 20, yPosition);
    yPosition += 10;

    // Show LLM call count and processing info
    const llmCalls = data.assessment.llmCalls || [];
    const stage1Calls = llmCalls.filter(call => call.stage === 'STAGE1_SCREENING');
    const stage2Calls = llmCalls.filter(call => call.stage === 'STAGE2_ASSESSMENT');

    doc.setFontSize(11);
    doc.text(`• Stage 1 (Initial Screening): ${stage1Calls.length} LLM analysis call(s)`, 30, yPosition);
    yPosition += 8;

    doc.text(`• Stage 2 (Detailed Analysis): ${stage2Calls.length} LLM analysis call(s)`, 30, yPosition);
    yPosition += 8;

    doc.text(`• Patents Analyzed: ${data.assessment.intersectingPatents?.length || 0} total`, 30, yPosition);
    yPosition += 12;

    // Key LLM Remarks
    if (data.assessment.finalRemarks) {
      doc.setFontSize(12);
      doc.text('Key LLM Remarks:', 20, yPosition);
      yPosition += 10;
      doc.setFontSize(11);
      const remarksLines = doc.splitTextToSize(data.assessment.finalRemarks, 160);
      doc.text(remarksLines, 30, yPosition);
      yPosition += remarksLines.length * 5 + 6;
    }

    // Final suggestions preview
    if (data.assessment.finalSuggestions) {
      doc.setFontSize(12);
      doc.text('LLM Recommendations Preview:', 20, yPosition);
      yPosition += 10;
      const preview = data.assessment.finalSuggestions.length > 200 ?
        data.assessment.finalSuggestions.substring(0, 200) + '...' :
        data.assessment.finalSuggestions;
      doc.setFontSize(11);
      const previewLines = doc.splitTextToSize(preview, 160);
      doc.text(previewLines, 30, yPosition);
      yPosition += previewLines.length * 5 + 6;
    }

    return yPosition;
  }

  /**
   * Add detailed findings section
   */
  private static addDetailedFindings(doc: jsPDF, data: NoveltyReportData, yPosition: number): number {
    // Add new page if needed
    if (yPosition > 200) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(16);
    doc.text('4. DETAILED FINDINGS', 20, yPosition);
    yPosition += 15;

    doc.setFontSize(11);
    doc.text('Detailed patent analysis results are available in the web interface.', 20, yPosition);
    yPosition += 10;
    doc.text('This PDF contains the assessment summary and recommendations.', 20, yPosition);
    yPosition += 20;

    return yPosition;
  }

  /**
   * Add recommendations section
   */
  private static addRecommendations(doc: jsPDF, data: NoveltyReportData, yPosition: number): number {
    // Add new page if needed
    if (yPosition > 200) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(16);
    doc.text('5. RECOMMENDATIONS', 20, yPosition);
    yPosition += 15;

    if (data.assessment.finalSuggestions) {
      doc.setFontSize(12);
      const suggestionsLines = doc.splitTextToSize(data.assessment.finalSuggestions, 160);
      doc.text(suggestionsLines, 20, yPosition);
      yPosition += suggestionsLines.length * 5 + 10;
    } else {
      doc.setFontSize(12);
      doc.text('No specific recommendations available based on the assessment results.', 20, yPosition);
      yPosition += 15;
    }

    // Next steps based on determination
    doc.setFontSize(14);
    doc.text('Next Steps:', 20, yPosition);
    yPosition += 12;

    const nextSteps = this.getNextSteps(data.assessment.finalDetermination);
    doc.setFontSize(11);
    const nextStepsLines = doc.splitTextToSize(nextSteps, 160);
    doc.text(nextStepsLines, 30, yPosition);
    yPosition += nextStepsLines.length * 5 + 15;

    return yPosition;
  }

  /**
   * Add footer with generation info
   */
  private static addFooter(doc: jsPDF, data: NoveltyReportData): void {
    const pageCount = doc.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      // Footer line
      doc.line(20, 280, 190, 280);

      // Footer text
      doc.setFontSize(8);
      doc.text(
        `Generated by Patent Analysis System on ${new Date().toLocaleString()} | Page ${i} of ${pageCount}`,
        105, 290,
        { align: 'center' }
      );
    }
  }

  /**
   * Helper methods
   */
  private static getDeterminationText(determination: NoveltyDetermination | null): string {
    switch (determination) {
      case NoveltyDetermination.NOVEL: return 'NOVEL';
      case NoveltyDetermination.NOT_NOVEL: return 'NOT NOVEL';
      case 'PARTIALLY_NOVEL' as NoveltyDetermination: return 'PARTIALLY NOVEL';
      default: return 'UNDER REVIEW';
    }
  }

  private static getStatusColor(determination: NoveltyDetermination | null): string {
    switch (determination) {
      case NoveltyDetermination.NOVEL: return '#28a745'; // Green
      case NoveltyDetermination.NOT_NOVEL: return '#dc3545'; // Red
      case 'PARTIALLY_NOVEL' as NoveltyDetermination: return '#ffc107'; // Yellow
      default: return '#6c757d'; // Gray
    }
  }

  private static getNextSteps(determination: NoveltyDetermination | null): string {
    switch (determination) {
      case NoveltyDetermination.NOVEL:
        return 'Proceed with patent drafting. The invention appears to be novel and patentable. Consider preparing detailed claims and specifications for filing.';

      case NoveltyDetermination.NOT_NOVEL:
        return 'Reconsider patent strategy. The invention lacks novelty relative to existing patents. Consider:\n' +
               '• Developing alternative technical approaches\n' +
               '• Focusing on different applications or use cases\n' +
               '• Exploring design patents instead of utility patents\n' +
               '• Consulting with patent attorneys for infringement analysis';

      case 'PARTIALLY_NOVEL' as NoveltyDetermination:
        return 'Refine patent strategy. Some aspects are novel while others are not. Consider:\n' +
               '• Narrowing claims to focus on novel elements only\n' +
               '• Developing combination claims that distinguish from prior art\n' +
               '• Pursuing divisional applications for novel aspects\n' +
               '• Consulting with patent attorneys for claim drafting assistance';

      default:
        return 'Assessment is still in progress. Please check back later for complete recommendations.';
    }
  }

}
