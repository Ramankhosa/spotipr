import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildNoveltyAttorneyReportModel, type AttorneyReportCitation, type AttorneyReportFeatureRow } from '@/lib/novelty-attorney-report';
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata';

export const runtime = 'nodejs';

const PDFDocument = require('pdfkit/js/pdfkit.standalone');

type PdfDoc = InstanceType<typeof PDFDocument>;
type PdfTextAlign = 'left' | 'center' | 'right' | 'justify';

const FONTS = {
  regular: 'Helvetica',
  medium: 'Helvetica',
  semibold: 'Helvetica-Bold',
  bold: 'Helvetica-Bold',
};

const TYPE = {
  display: 28,
  h1: 20,
  h2: 14,
  h3: 11,
  body: 9.5,
  small: 8.5,
  caption: 7.5,
  micro: 7,
} as const;

const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  section: 32,
} as const;

const COLORS = {
  navy: '#0B1220',
  navy2: '#0F1B33',
  blue: '#2563EB',
  blue2: '#1D4ED8',
  cyan: '#38BDF8',
  paleBlue: '#EFF6FF',
  text: '#0F172A',
  muted: '#64748B',
  border: '#CBD5E1',
  tableHeader: '#2563EB',
  tableAlt: '#F8FAFC',
  green: '#047857',
  red: '#BE123C',
  amber: '#D97706',
  slate: '#475569',
  white: '#FFFFFF',
  surface: '#F8FAFC',
  success: '#16A34A',
  warning: '#F59E0B',
};

const STATUS = {
  Present: { fill: '#ECFDF5', text: '#047857', stroke: '#A7F3D0' },
  Partial: { fill: '#FFFBEB', text: '#A16207', stroke: '#FDE68A' },
  Absent: { fill: '#FEF2F2', text: '#B91C1C', stroke: '#FECACA' },
  Review: { fill: '#EFF6FF', text: '#1D4ED8', stroke: '#BFDBFE' },
} as const;

const PAGE = {
  left: 60,
  right: 60,
  top: 64,
  bottom: 64,
};

function registerReportFonts(doc: PdfDoc) {
  try {
    const fontDir = path.join(process.cwd(), 'src', 'fonts', 'inter');
    doc.registerFont('Inter-Regular', readFileSync(path.join(fontDir, 'Inter-Regular.ttf')));
    doc.registerFont('Inter-Medium', readFileSync(path.join(fontDir, 'Inter-Medium.ttf')));
    doc.registerFont('Inter-SemiBold', readFileSync(path.join(fontDir, 'Inter-SemiBold.ttf')));
    doc.registerFont('Inter-Bold', readFileSync(path.join(fontDir, 'Inter-Bold.ttf')));
    FONTS.regular = 'Inter-Regular';
    FONTS.medium = 'Inter-Medium';
    FONTS.semibold = 'Inter-SemiBold';
    FONTS.bold = 'Inter-Bold';
  } catch (error) {
    console.warn('[AttorneyReportPDF] Inter fonts unavailable; using PDF-safe fallback fonts.', error);
  }
}

function contentWidth(doc: PdfDoc) {
  return doc.page.width - PAGE.left - PAGE.right;
}

function cleanText(value: unknown, fallback = '-') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function truncate(value: unknown, max = 900) {
  const text = cleanText(value, '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function pct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function statusColor(status: string) {
  return statusPalette(status).text;
}

function statusPalette(status: string) {
  if (status === 'Present') return STATUS.Present;
  if (status === 'Partial') return STATUS.Partial;
  if (status === 'Absent') return STATUS.Absent;
  return STATUS.Review;
}

function overlapDescriptor(score: number | null | undefined) {
  const value = typeof score === 'number' ? score : 0;
  if (value >= 0.7) return 'Broad mapped overlap';
  if (value >= 0.35) return 'Moderate mapped overlap';
  if (value > 0) return 'Limited mapped overlap';
  return 'No mapped overlap';
}

function addPage(doc: PdfDoc) {
  doc.addPage();
  doc.y = PAGE.top;
}

function ensureSpace(doc: PdfDoc, needed: number) {
  if (doc.y + needed > doc.page.height - PAGE.bottom) {
    addPage(doc);
    return true;
  }
  return false;
}

function pageBottom(doc: PdfDoc) {
  return doc.page.height - PAGE.bottom;
}

function firstSentence(value: unknown) {
  const text = cleanText(value, 'Review the detailed findings and mapped evidence.');
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return match?.[0]?.trim() || text;
}

function verdictPalette(decision: string) {
  const normalized = decision.toLowerCase();
  if (/high mapped-overlap|not novel|anticipat|obvious/.test(normalized)) {
    return { fill: '#FFF1F2', text: '#9F1239', stroke: '#FECDD3', accent: COLORS.red };
  }
  if (/with mapped overlap|partial|moderate/.test(normalized)) {
    return { fill: '#FFFBEB', text: '#92400E', stroke: '#FDE68A', accent: COLORS.amber };
  }
  if (/potential novelty space|novel/.test(normalized)) {
    return { fill: '#ECFDF5', text: '#065F46', stroke: '#A7F3D0', accent: COLORS.green };
  }
  return { fill: '#EFF6FF', text: '#1E40AF', stroke: '#BFDBFE', accent: COLORS.blue };
}

function riskAssessmentFor(report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  return report.riskAssessment || {
    noveltyRisk: 'Needs Review',
    noveltyRiskLabel: 'Novelty / anticipation risk: Needs Review',
    noveltyRiskExplanation: 'Risk assessment requires the deterministic report model.',
    combinationRisk: 'Needs Review',
    combinationRiskLabel: 'Component-combination risk: Needs Review',
    combinationRiskExplanation: 'Distributed feature coverage requires the deterministic report model.',
    headline: cleanText(report.finalAssessment?.decision, 'Review required'),
    coreFeatureCount: 0,
    strongestSingleReferenceCoreCoverage: 0,
    distributedCoreCoverage: 0,
  };
}

function fitTextToHeight(doc: PdfDoc, value: string, width: number, height: number, lineGap: number) {
  if (doc.heightOfString(value, { width, lineGap }) <= height) return [value, ''] as const;

  let low = 1;
  let high = value.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = value.slice(0, mid);
    if (doc.heightOfString(candidate, { width, lineGap }) <= height) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const whitespace = value.lastIndexOf(' ', best);
  const splitAt = whitespace > Math.max(0, best - 80) ? whitespace : best;
  return [value.slice(0, splitAt).trimEnd(), value.slice(splitAt).trimStart()] as const;
}

function proseAlign(value: unknown): PdfTextAlign {
  const text = cleanText(value, '');
  return text.split(/\s+/).filter(Boolean).length >= 8 ? 'justify' : 'left';
}

function drawFlowingLabeledText(
  doc: PdfDoc,
  label: string,
  value: string,
  options: { indent?: number; color?: string; labelColor?: string; fontSize?: number } = {},
) {
  let remaining = cleanText(value);
  let continued = false;
  const indent = options.indent ?? 0;
  const x = PAGE.left + indent;
  const width = contentWidth(doc) - indent;
  const fontSize = options.fontSize ?? TYPE.body;
  const lineGap = 2;

  while (remaining) {
    ensureSpace(doc, 56);
    doc.fillColor(options.labelColor || COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.caption)
      .text(`${label}${continued ? ' (continued)' : ''}`.toUpperCase(), x, doc.y, { width, lineBreak: false });
    doc.y += SPACE.sm;
    doc.fillColor(options.color || '#334155').font(FONTS.regular).fontSize(fontSize);
    const available = Math.max(24, pageBottom(doc) - doc.y);
    const [chunk, rest] = fitTextToHeight(doc, remaining, width, available, lineGap);
    doc.text(chunk, x, doc.y, { width, align: proseAlign(chunk), lineGap });
    remaining = rest;
    if (remaining) {
      addPage(doc);
      continued = true;
    }
  }
  doc.y += SPACE.md;
}

function drawHeaderFooter(doc: PdfDoc, reportNumber: string, title: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNo = i + 1;
    if (pageNo === 1) continue;

    const width = doc.page.width;
    const height = doc.page.height;
    const headerY = 24;
    const footerY = height - 35;
    doc.font(FONTS.regular).fontSize(TYPE.small).fillColor(COLORS.muted)
      .text(reportNumber, PAGE.left, headerY, { width: 210, height: 10, lineBreak: false })
      .text(truncate(title, 86), width - PAGE.right - 240, headerY, { width: 240, height: 10, align: 'right', lineBreak: false });
    doc.moveTo(PAGE.left, 41).lineTo(width - PAGE.right, 41).lineWidth(0.6).strokeColor(COLORS.border).stroke();
    doc.moveTo(PAGE.left, height - 46).lineTo(width - PAGE.right, height - 46).lineWidth(0.6).strokeColor(COLORS.border).stroke();
    doc.font(FONTS.regular).fontSize(TYPE.small).fillColor(COLORS.muted)
      .text('PatentNest.ai - Confidential review draft', PAGE.left, footerY, { width: 330, height: 10, lineBreak: false })
      .text(`Page ${pageNo}`, width - PAGE.right - 70, footerY, { width: 70, height: 10, align: 'right', lineBreak: false });
  }
}

function isNoOpPdfCommand(line: string): boolean {
  return (
    /^1 0 0 -1 0 [\d.]+ cm$/.test(line) ||
    line === 'q' ||
    line === 'Q'
  );
}

function isInitialBlankPage(page: any): boolean {
  const chunks = page?.content?.buffer;
  if (!Array.isArray(chunks) || chunks.length === 0) return true;
  const content = Buffer.concat(chunks.map((chunk: Buffer | Uint8Array | string) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('latin1');
  const lines = content
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return lines.length === 0 || lines.every(isNoOpPdfCommand);
}

function trimTrailingBlankPages(doc: PdfDoc) {
  const internalDoc = doc as any;
  const pageBuffer = internalDoc._pageBuffer;
  const pagesNode = internalDoc._root?.data?.Pages?.data;

  if (!Array.isArray(pageBuffer) || pageBuffer.length <= 1 || !pagesNode) return;

  while (pageBuffer.length > 1 && isInitialBlankPage(pageBuffer[pageBuffer.length - 1])) {
    const blankPage = pageBuffer.pop();
    const kidIndex = pagesNode.Kids?.indexOf(blankPage.dictionary);
    if (kidIndex >= 0) pagesNode.Kids.splice(kidIndex, 1);
    pagesNode.Count = Math.max(0, Number(pagesNode.Count || 0) - 1);
  }

  internalDoc.page = pageBuffer[pageBuffer.length - 1];
}

function drawCover(doc: PdfDoc, report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  const width = doc.page.width;
  const height = doc.page.height;

  doc.rect(0, 0, width, height).fill(COLORS.navy);
  doc.rect(0, height - 176, width, 176).fill(COLORS.navy2);

  const motifX = width - 226;
  const motifY = 76;
  const nodes = [
    [0, 48], [48, 16], [96, 64], [144, 24], [192, 72],
    [48, 112], [96, 144], [144, 104], [192, 152],
  ] as Array<[number, number]>;
  const edges = [[0, 1], [0, 5], [1, 2], [2, 3], [2, 6], [3, 4], [3, 7], [5, 6], [6, 7], [7, 8]] as Array<[number, number]>;
  edges.forEach(([a, b]) => {
    const start = nodes[a];
    const end = nodes[b];
    doc.moveTo(motifX + start[0], motifY + start[1])
      .lineTo(motifX + end[0], motifY + end[1])
      .lineWidth(0.65)
      .strokeColor('#1E3A8A')
      .stroke();
  });
  nodes.forEach(([x, y], index) => {
    doc.circle(motifX + x, motifY + y, index % 3 === 0 ? 4 : 2.8)
      .fill(index % 2 === 0 ? '#2563EB' : '#38BDF8');
  });

  doc.rect(PAGE.left, 76, 82, 5).fill(COLORS.cyan);
  doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(TYPE.h1).text('PatentNest.ai', PAGE.left, 96, { width: 300 });
  doc.fillColor('#BFDBFE').font(FONTS.regular).fontSize(TYPE.h3).text('Preliminary Novelty Assessment Report', PAGE.left, 128, { width: 360 });

  doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(TYPE.display)
    .text(report.reportTitle, PAGE.left, 254, { width: 405, lineGap: SPACE.xs });
  doc.y += SPACE.lg;
  doc.fillColor('#E0F2FE').font(FONTS.medium).fontSize(TYPE.h2)
    .text(report.inventionTitle, PAGE.left, doc.y, { width: 420, lineGap: SPACE.xs });

  const cardY = 500;
  doc.roundedRect(PAGE.left, cardY, width - PAGE.left - PAGE.right, 128, 8).fill('#111C36');
  const meta = [
    ['Report No.', report.reportNumber],
    ['Generated', report.generatedDate],
    ['Jurisdiction', report.jurisdiction],
    ['Source Mode', report.methodology.corpus],
    ['Prepared By', report.preparedBy],
  ];
  let y = cardY + SPACE.lg;
  meta.forEach(([label, value]) => {
    doc.fillColor('#93C5FD').font(FONTS.semibold).fontSize(TYPE.caption).text(label.toUpperCase(), PAGE.left + SPACE.lg, y, { width: 112 });
    doc.fillColor(COLORS.white).font(FONTS.regular).fontSize(TYPE.small).text(truncate(value, 96), PAGE.left + 140, y, { width: 290 });
    y += SPACE.xl - SPACE.xs;
  });

  doc.fillColor('#BFDBFE').font(FONTS.regular).fontSize(TYPE.caption)
    .text(report.confidentiality, PAGE.left, height - 74, { width: contentWidth(doc), align: 'center' });
}

function drawCard(doc: PdfDoc, x: number, y: number, width: number, height: number, radius = 7) {
  doc.roundedRect(x + 2, y + 3, width, height, radius).fill('#E9EEF5');
  doc.roundedRect(x, y, width, height, radius).fillAndStroke(COLORS.white, '#DCE4EE');
}

function drawSnapshotMetric(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  value: string,
  label: string,
  accent = COLORS.blue,
) {
  drawCard(doc, x, y, width, 68, 6);
  doc.rect(x, y, 3, 68).fill(accent);
  doc.fillColor(accent).font(FONTS.bold).fontSize(value.length > 12 ? TYPE.h3 : TYPE.h2)
    .text(value, x + SPACE.md, y + SPACE.md, { width: width - 20, height: 21, ellipsis: true });
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.small)
    .text(label, x + SPACE.md, y + 41, { width: width - 20, height: 18, lineGap: 1 });
}

function drawSnapshotInfoItem(doc: PdfDoc, x: number, y: number, width: number, label: string, value: string) {
  doc.circle(x + 6, y + 7, 5).fill(COLORS.paleBlue);
  doc.circle(x + 6, y + 7, 1.7).fill(COLORS.blue);
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(label.toUpperCase(), x + 17, y, { width: width - 17, height: 9, lineBreak: false, ellipsis: true });
  doc.fillColor(COLORS.text).font(FONTS.regular).fontSize(TYPE.caption)
    .text(truncate(value, 90), x + 17, y + 12, { width: width - 17, height: 27, ellipsis: true, lineGap: 1 });
}

function highestMappedRow(report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  return report.comparisons
    .flatMap(item => item.rows.map(row => ({ row, patent: item.publicationNumber })))
    .filter(item => item.row.status === 'Present' || item.row.status === 'Partial')
    .sort((a, b) => Number(b.row.extentScore || 0) - Number(a.row.extentScore || 0))[0];
}

function strongestDifferentiatorRow(report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  const rows = report.comparisons
    .flatMap(item => item.rows.map(row => ({ row, patent: item.publicationNumber })))
    .filter(item => item.row.status === 'Absent' || item.row.status === 'Unknown');
  return rows.find(item => /distinction|differentiator|not disclosed|absent/i.test(item.row.crispRemark)) || rows[0];
}

function drawDecisionFact(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  accent: string,
  options: { height?: number; valueHeight?: number; truncateValue?: boolean } = {},
) {
  const height = options.height || 54;
  const valueHeight = options.valueHeight || 20;
  drawCard(doc, x, y, width, height, 6);
  doc.rect(x, y, 3, height).fill(accent);
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(label.toUpperCase(), x + SPACE.md, y + 10, { width: width - 20, height: 9, lineBreak: false, ellipsis: true });
  const text = options.truncateValue === false ? cleanText(value) : truncate(value, 115);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .text(text, x + SPACE.md, y + 24, { width: width - 20, height: valueHeight, ellipsis: options.truncateValue !== false, lineGap: 1.2 });
}

function drawExecutiveSnapshot(doc: PdfDoc, report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  const risk = riskAssessmentFor(report);
  const strongest = report.comparisons.find(item => item.publicationNumber === report.publicClosestCitation?.publicationNumber)
    || report.comparisons.reduce((best, item) => (
      Number(item.coverage?.score || 0) > Number(best?.coverage?.score || 0) ? item : best
    ), report.comparisons[0]);
  const signal = cleanText(risk.headline || report.finalAssessment.decision, 'Review required');
  const palette = verdictPalette(signal);
  const mappedRow = highestMappedRow(report);
  const differentiatorRow = strongestDifferentiatorRow(report);
  const mainDifferentiator = cleanText(report.mainDifferentiator) || (differentiatorRow
    ? `${differentiatorRow.row.featureNumber} - ${differentiatorRow.row.userFeature}`
    : 'No unmapped differentiator identified');
  const reviewFocus = cleanText(report.attorneyReviewFocus) || (strongest
    ? `Review ${strongest.publicationNumber} first; compare ${mappedRow?.row.featureNumber || 'mapped features'} and preserve ${differentiatorRow?.row.featureNumber || 'unmapped distinctions'} in claim-positioning review.`
    : 'Run detailed citation mapping before forming claim-positioning conclusions.');

  doc.addNamedDestination('executive-snapshot', 'XYZ', PAGE.left, PAGE.top, null);
  doc.rect(PAGE.left, PAGE.top + 2, 72, 4).fill(COLORS.cyan);
  doc.fillColor(COLORS.text).font(FONTS.bold).fontSize(TYPE.h1)
    .text('Executive Snapshot', PAGE.left, PAGE.top + 18, { width: contentWidth(doc) });
  doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.small)
    .text('A concise view of retrieval volume, mapped evidence, and the automated overlap signal.', PAGE.left, PAGE.top + 49, { width: contentWidth(doc) });

  const verdictY = PAGE.top + 76;
  const rationale = firstSentence(report.finalAssessment.summary);
  doc.roundedRect(PAGE.left, verdictY, contentWidth(doc), 86, 7).fillAndStroke(palette.fill, palette.stroke);
  doc.rect(PAGE.left, verdictY, 4, 86).fill(palette.accent);
  doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .text('DETERMINISTIC RISK VERDICT', PAGE.left + SPACE.lg, verdictY + SPACE.md, { width: 180, lineBreak: false });
  doc.fillColor(palette.text).font(FONTS.bold).fontSize(TYPE.h3)
    .text(signal, PAGE.left + SPACE.lg, verdictY + 29, { width: 180, height: 30, ellipsis: true });
  doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(`Review stage: preliminary assessment`, PAGE.left + SPACE.lg, verdictY + 64, { width: 180, height: 9, lineBreak: false, ellipsis: true });
  const riskLines = [
    `${risk.noveltyRiskLabel} - ${risk.noveltyRiskExplanation}`,
    `${risk.combinationRiskLabel} - ${risk.combinationRiskExplanation}`,
  ].join('\n');
  doc.fillColor('#334155').font(FONTS.regular).fontSize(TYPE.small)
    .text(riskLines || rationale, PAGE.left + 210, verdictY + SPACE.md, {
      width: contentWidth(doc) - 226,
      height: 62,
      lineGap: 1.5,
      ellipsis: true,
    });

  const factsY = verdictY + 98;
  const factGap = SPACE.sm;
  const factWidth = (contentWidth(doc) - factGap * 2) / 3;
  drawDecisionFact(doc, PAGE.left, factsY, factWidth, 'Novelty risk', `${risk.noveltyRisk} - ${risk.noveltyRiskExplanation}`, COLORS.blue);
  drawDecisionFact(doc, PAGE.left + factWidth + factGap, factsY, factWidth, 'Combination risk', `${risk.combinationRisk} - ${risk.combinationRiskExplanation}`, COLORS.red);
  drawDecisionFact(doc, PAGE.left + (factWidth + factGap) * 2, factsY, factWidth, 'Main differentiator', mainDifferentiator, COLORS.success, {
    height: 64,
    valueHeight: 34,
    truncateValue: false,
  });

  const focusY = factsY + 76;
  doc.roundedRect(PAGE.left, focusY, contentWidth(doc), 58, 6).fillAndStroke('#F8FAFC', '#CBD5E1');
  doc.circle(PAGE.left + 15, focusY + 17, 4).fill(palette.accent);
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text('ATTORNEY REVIEW FOCUS', PAGE.left + 28, focusY + 9, { width: 145, height: 9, lineBreak: false });
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.small)
    .text(reviewFocus, PAGE.left + 28, focusY + 23, { width: contentWidth(doc) - 44, height: 28, lineGap: 1.2, ellipsis: true });

  const metricsY = focusY + 70;
  const gap = SPACE.sm;
  const metricWidth = (contentWidth(doc) - gap * 3) / 4;
  const metrics = [
    [String(report.counts.retrieved), 'Candidates', COLORS.blue],
    [String(report.counts.found), 'Shortlisted', COLORS.blue2],
    [strongest ? strongest.referenceRole : 'No mapped reference', 'Top reference', COLORS.success],
    [signal, 'Signal', palette.accent],
  ] as Array<[string, string, string]>;
  metrics.forEach(([value, label, accent], index) => {
    drawSnapshotMetric(doc, PAGE.left + index * (metricWidth + gap), metricsY, metricWidth, value, label, accent);
  });

  const detailY = metricsY + 80;
  const detailGap = SPACE.md;
  const detailWidth = (contentWidth(doc) - detailGap) / 2;
  const detailCardHeight = 164;
  drawCard(doc, PAGE.left, detailY, detailWidth, detailCardHeight);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.body)
    .text('Closest Mapped Citation', PAGE.left + SPACE.md, detailY + SPACE.md, { width: detailWidth - 24 });
  doc.rect(PAGE.left + SPACE.md, detailY + 31, 28, 2).fill(COLORS.blue);
  if (strongest) {
    doc.fillColor(COLORS.blue2).font(FONTS.bold).fontSize(TYPE.h3)
      .text(strongest.publicationNumber, PAGE.left + SPACE.md, detailY + 42, { width: detailWidth - 24, height: 16, ellipsis: true });
    doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.small)
      .text(strongest.title, PAGE.left + SPACE.md, detailY + 64, { width: detailWidth - 24, height: 42, ellipsis: true, lineGap: 2 });
    doc.roundedRect(PAGE.left + SPACE.md, detailY + 112, 112, 21, 5).fillAndStroke(COLORS.paleBlue, '#BFDBFE');
    doc.fillColor(COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.caption)
      .text(strongest.referenceRole, PAGE.left + 18, detailY + 119, { width: 100, height: 9, lineBreak: false, ellipsis: true });
  } else {
    doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.small)
      .text('No citation was mapped for detailed comparison.', PAGE.left + SPACE.md, detailY + 48, { width: detailWidth - 24 });
  }

  const takeawayX = PAGE.left + detailWidth + detailGap;
  drawCard(doc, takeawayX, detailY, detailWidth, detailCardHeight);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.body)
    .text('Key Takeaway', takeawayX + SPACE.md, detailY + SPACE.md, { width: detailWidth - 24 });
  doc.rect(takeawayX + SPACE.md, detailY + 31, 28, 2).fill(COLORS.success);
  doc.fillColor('#334155').font(FONTS.regular).fontSize(TYPE.small)
    .text(`${rationale}\n\nPotential Differentiation Space: ${report.potentialDifferentiationSpace}`, takeawayX + SPACE.md, detailY + 44, {
      width: detailWidth - 24,
      height: 108,
      lineGap: 2,
      ellipsis: false,
    });

  const methodY = detailY + detailCardHeight + 12;
  drawCard(doc, PAGE.left, methodY, contentWidth(doc), 86);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.small)
    .text('Report Basis', PAGE.left + SPACE.md, methodY + SPACE.md, { width: 110 });
  const infoWidth = (contentWidth(doc) - 24) / 4;
  const infoItems = [
    ['Corpus', report.methodology.corpus],
    ['Search method', report.methodology.retrievalMode],
    ['Assessment basis', report.evidenceBasis],
    ['Report type', 'AI-assisted patent intelligence'],
  ];
  infoItems.forEach(([label, value], index) => {
    const x = PAGE.left + SPACE.md + index * infoWidth;
    drawSnapshotInfoItem(doc, x, methodY + 36, infoWidth - 10, label, value);
  });

  doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.micro)
    .text('Automated mapping should be validated against complete patent records and claims.', PAGE.left, pageBottom(doc) - 14, { width: contentWidth(doc), align: 'center' });
  doc.y = pageBottom(doc);
}

function drawSectionHeading(doc: PdfDoc, title: string) {
  doc.font(FONTS.bold).fontSize(TYPE.h2);
  const headingHeight = doc.heightOfString(title, { width: contentWidth(doc) });
  ensureSpace(doc, headingHeight + SPACE.section);
  doc.y += SPACE.sm;
  doc.font(FONTS.bold).fontSize(TYPE.h2).fillColor(COLORS.text).text(title, PAGE.left, doc.y, { width: contentWidth(doc) });
  doc.moveTo(PAGE.left, doc.y + SPACE.xs).lineTo(doc.page.width - PAGE.right, doc.y + SPACE.xs).lineWidth(1).strokeColor(COLORS.blue).stroke();
  doc.y += SPACE.md;
}

function drawGroupHeading(doc: PdfDoc, number: string, title: string) {
  ensureSpace(doc, 54);
  const y = doc.y + SPACE.sm;
  doc.roundedRect(PAGE.left, y, contentWidth(doc), 38, 5).fill(COLORS.navy2);
  doc.fillColor(COLORS.cyan).font(FONTS.bold).fontSize(TYPE.h3)
    .text(number, PAGE.left + SPACE.md, y + SPACE.md, { width: 24, lineBreak: false });
  doc.fillColor(COLORS.white).font(FONTS.semibold).fontSize(TYPE.h3)
    .text(title, PAGE.left + 44, y + SPACE.md, { width: contentWidth(doc) - 56, lineBreak: false });
  doc.y = y + 38 + SPACE.md;
}

function drawParagraph(doc: PdfDoc, text: string) {
  const value = cleanText(text);
  doc.font(FONTS.regular).fontSize(TYPE.body);
  const height = doc.heightOfString(value, { width: contentWidth(doc), align: 'justify', lineGap: 2 });
  ensureSpace(doc, Math.min(height + SPACE.md, doc.page.height - PAGE.top - PAGE.bottom));
  doc.fillColor('#334155')
    .text(value, PAGE.left, doc.y, { width: contentWidth(doc), align: 'justify', lineGap: 2 });
  doc.y += SPACE.md;
}

function keyValueRow(doc: PdfDoc, label: string, value: string) {
  drawFlowingLabeledText(doc, label, value, { indent: SPACE.sm });
}

function drawFlowLabel(doc: PdfDoc, label: string) {
  ensureSpace(doc, 34);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, contentWidth(doc), 20, 3).fill(COLORS.paleBlue);
  doc.fillColor(COLORS.text)
    .font(FONTS.semibold)
    .fontSize(TYPE.small)
    .text(label, PAGE.left + 8, y + 6, { width: contentWidth(doc) - 16, lineBreak: false });
  doc.y = y + 25;
}

function drawFlowTextBlock(doc: PdfDoc, label: string, value: string) {
  const text = cleanText(value, '-');
  drawFlowLabel(doc, label);
  doc.fillColor(COLORS.text)
    .font(FONTS.regular)
    .fontSize(TYPE.body)
    .text(text, PAGE.left + 8, doc.y, {
      width: contentWidth(doc) - 16,
      align: 'justify',
      lineGap: 1.4,
    });
  doc.y += SPACE.md;
}

function drawFlowBulletList(doc: PdfDoc, label: string, items: string[]) {
  const list = items.map(item => cleanText(item, '')).filter(Boolean);
  if (!list.length) return;
  drawFlowLabel(doc, label);
  list.forEach(item => {
    ensureSpace(doc, 26);
    const y = doc.y;
    doc.circle(PAGE.left + 12, y + 5, 2).fill(COLORS.blue);
      doc.fillColor(COLORS.text)
      .font(FONTS.regular)
      .fontSize(TYPE.body)
      .text(item, PAGE.left + 22, y, {
        width: contentWidth(doc) - 30,
        align: proseAlign(item),
        lineGap: 1.4,
      });
    doc.y += SPACE.xs;
  });
  doc.y += SPACE.sm;
}

function drawMetadataGrid(doc: PdfDoc, items: Array<[string, string]>) {
  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2);
    const cellWidth = contentWidth(doc) / 2;
    const labelWidth = 78;
    const padding = 7;
    const valueWidths = pair.map(() => cellWidth - labelWidth - padding * 2);
    doc.font(FONTS.regular).fontSize(TYPE.small);
    const rowHeight = Math.max(28, ...pair.map(([_, value], i) => doc.heightOfString(truncate(value, 240), { width: valueWidths[i], lineGap: 1.5 }) + padding * 2));
    ensureSpace(doc, rowHeight + 2);
    const y = doc.y;
    doc.rect(PAGE.left, y, contentWidth(doc), rowHeight).fill(index % 4 === 2 ? COLORS.surface : COLORS.white);
    pair.forEach(([label, value], i) => {
      const x = PAGE.left + i * cellWidth;
      doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.caption)
        .text(label, x + padding, y + padding, { width: labelWidth - padding, height: rowHeight - padding * 2, ellipsis: true });
      doc.fillColor(COLORS.text).font(FONTS.regular).fontSize(TYPE.small)
        .text(truncate(value, 240) || '-', x + labelWidth, y + padding, { width: cellWidth - labelWidth - padding, height: rowHeight - padding * 2, ellipsis: true, lineGap: 1.5 });
    });
    doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.left + contentWidth(doc), y + rowHeight)
      .lineWidth(0.45).strokeColor(COLORS.border).stroke();
    doc.y = y + rowHeight;
  }
}

function drawTableRow(
  doc: PdfDoc,
  cells: string[],
  widths: number[],
  opts: {
    header?: boolean;
    fills?: string[];
    fontSize?: number;
    textColors?: string[];
    aligns?: PdfTextAlign[];
    verticalAligns?: Array<'top' | 'center'>;
    boldCells?: number[];
    repeatHeader?: { cells: string[]; widths: number[] };
  } = {}
) {
  const padding = 6;
  const fontSize = opts.fontSize || (opts.header ? TYPE.caption : TYPE.small);
  const prepared = cells.map(cell => opts.header ? truncate(cell, 120) : cleanText(cell));
  doc.font(opts.header ? FONTS.semibold : FONTS.regular).fontSize(fontSize);
  const heights = prepared.map((cell, index) => doc.heightOfString(cell || '-', { width: widths[index] - padding * 2, lineGap: 1.5 }) + padding * 2);
  const rowHeight = Math.max(opts.header ? 26 : 28, ...heights);
  const pageChanged = ensureSpace(doc, rowHeight + 2);
  if (pageChanged && opts.repeatHeader && !opts.header) {
    drawTableRow(doc, opts.repeatHeader.cells, opts.repeatHeader.widths, { header: true });
    ensureSpace(doc, rowHeight + 2);
  }

  const y = doc.y;
  let x = PAGE.left;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const rowFill = opts.header ? COLORS.tableHeader : (opts.fills?.[0] || COLORS.white);
  doc.rect(PAGE.left, y, totalWidth, rowHeight).fill(rowFill);
  prepared.forEach((cell, index) => {
    const text = cell || '-';
    const textWidth = widths[index] - padding * 2;
    const align = opts.aligns?.[index] || (opts.header ? 'left' : proseAlign(text));
    const font = opts.header || opts.boldCells?.includes(index) ? FONTS.semibold : FONTS.regular;
    const textHeight = doc.heightOfString(text, { width: textWidth, align, lineGap: 1.5 });
    const textY = opts.verticalAligns?.[index] === 'center'
      ? y + Math.max(padding, (rowHeight - textHeight) / 2)
      : y + padding;
    doc.fillColor(opts.header ? COLORS.white : (opts.textColors?.[index] || COLORS.text))
      .font(font)
      .fontSize(fontSize)
      .text(text, x + padding, textY, {
        width: textWidth,
        height: rowHeight - padding * 2,
        align,
        lineGap: 1.5,
      });
    x += widths[index];
  });
  doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.left + totalWidth, y + rowHeight)
    .lineWidth(opts.header ? 0.8 : 0.4).strokeColor(opts.header ? COLORS.blue2 : COLORS.border).stroke();
  doc.y = y + rowHeight;
}

const REFERENCE_FEATURE_TABLE = {
  paddingX: 7,
  paddingY: 7,
  fontSize: TYPE.caption,
  headerFontSize: TYPE.caption,
  lineGap: 1.35,
  minRowHeight: 50,
  divider: '#D7E0EA',
  continuationFill: '#F1F5F9',
} as const;

function referenceFeatureTableWidths(doc: PdfDoc) {
  const total = contentWidth(doc);
  const keyFeature = 150;
  const referenceDisclosure = 190;
  return [keyFeature, referenceDisclosure, total - keyFeature - referenceDisclosure];
}

function referenceFeatureTableHeaders(publicationNumber: string) {
  return [
    'Key Feature',
    `Reference Disclosure: ${cleanText(publicationNumber)}`,
    'Professional Remark',
  ];
}

function referenceFeatureHeaderHeight(doc: PdfDoc, headers: string[], widths: number[]) {
  doc.font(FONTS.semibold).fontSize(REFERENCE_FEATURE_TABLE.headerFontSize);
  const heights = headers.map((header, index) => doc.heightOfString(header, {
    width: widths[index] - REFERENCE_FEATURE_TABLE.paddingX * 2,
    lineGap: 1,
  }) + REFERENCE_FEATURE_TABLE.paddingY * 2);
  return Math.max(30, ...heights);
}

function drawReferenceFeatureTableHeader(doc: PdfDoc, headers: string[], widths: number[]) {
  const rowHeight = referenceFeatureHeaderHeight(doc, headers, widths);
  ensureSpace(doc, rowHeight + REFERENCE_FEATURE_TABLE.minRowHeight);
  const y = doc.y;
  let x = PAGE.left;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  doc.rect(PAGE.left, y, totalWidth, rowHeight).fill(COLORS.tableHeader);
  headers.forEach((header, index) => {
    doc.fillColor(COLORS.white)
      .font(FONTS.semibold)
      .fontSize(REFERENCE_FEATURE_TABLE.headerFontSize)
      .text(header, x + REFERENCE_FEATURE_TABLE.paddingX, y + REFERENCE_FEATURE_TABLE.paddingY, {
        width: widths[index] - REFERENCE_FEATURE_TABLE.paddingX * 2,
        height: rowHeight - REFERENCE_FEATURE_TABLE.paddingY * 2,
        lineGap: 1,
      });
    if (index > 0) {
      doc.moveTo(x, y).lineTo(x, y + rowHeight).lineWidth(0.35).strokeColor('#93C5FD').stroke();
    }
    x += widths[index];
  });
  doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.left + totalWidth, y + rowHeight)
    .lineWidth(0.8).strokeColor(COLORS.blue2).stroke();
  doc.y = y + rowHeight;
}

function labeledLine(label: string, value: unknown) {
  const text = cleanText(value, '');
  return text ? `${label}: ${text}` : '';
}

function referenceFeatureCells(row: AttorneyReportFeatureRow, _index: number) {
  const statusLabel = cleanText(row.statusLabel, cleanText(row.status, 'Review'));
  const supportingPassage = cleanText(row.evidenceQuote, '');
  const submittedDisclosure = cleanText(row.userDisclosure, '');

  return [
    [
      `${cleanText(row.featureNumber)} - ${cleanText(row.userFeature)}`,
      submittedDisclosure ? labeledLine('Submitted disclosure', submittedDisclosure) : '',
    ].filter(Boolean).join('\n'),
    [
      cleanText(row.patentDisclosure, 'No mapped patent disclosure was available for this feature.'),
      `Mapping assessment: ${statusLabel}`,
      `Evidence strength: ${cleanText(row.evidenceStrength, 'Weak')} - ${cleanText(row.evidenceStrengthReason, 'Evidence should be confirmed from source records.')}`,
      supportingPassage ? labeledLine('Supporting passage', supportingPassage) : '',
    ].filter(Boolean).join('\n'),
    cleanText(row.professionalRemark || row.crispRemark, 'No professional review note was mapped for this feature.'),
  ];
}

function referenceFeatureRowHeight(doc: PdfDoc, cells: string[], widths: number[]) {
  doc.font(FONTS.regular).fontSize(REFERENCE_FEATURE_TABLE.fontSize);
  const heights = cells.map((cell, index) => {
    if (!cell) return 0;
    return doc.heightOfString(cell, {
      width: widths[index] - REFERENCE_FEATURE_TABLE.paddingX * 2,
      align: index === 0 ? 'center' : proseAlign(cell),
      lineGap: REFERENCE_FEATURE_TABLE.lineGap,
    }) + REFERENCE_FEATURE_TABLE.paddingY * 2;
  });
  return Math.max(REFERENCE_FEATURE_TABLE.minRowHeight, ...heights);
}

function splitReferenceFeatureCellsToHeight(doc: PdfDoc, cells: string[], widths: number[], rowHeight: number) {
  doc.font(FONTS.regular).fontSize(REFERENCE_FEATURE_TABLE.fontSize);
  const availableTextHeight = Math.max(12, rowHeight - REFERENCE_FEATURE_TABLE.paddingY * 2);
  return cells.map((cell, index) => {
    if (!cell) return ['', ''] as const;
    return fitTextToHeight(
      doc,
      cell,
      widths[index] - REFERENCE_FEATURE_TABLE.paddingX * 2,
      availableTextHeight,
      REFERENCE_FEATURE_TABLE.lineGap,
    );
  });
}

function hasRemainingTableText(cells: string[]) {
  return cells.some(cell => cleanText(cell, '').length > 0);
}

function referenceRowStatus(cells: string[]) {
  const statusLine = cleanText(cells[3], '').split('\n')[0] || '';
  const status = statusLine.replace(/^Status:\s*/i, '');
  if (/present/i.test(status)) return 'Present';
  if (/partial/i.test(status)) return 'Partial';
  if (/absent/i.test(status)) return 'Absent';
  return 'Review';
}

function referenceRowFill(status: string, rowIndex: number, continuation: boolean) {
  if (continuation) return REFERENCE_FEATURE_TABLE.continuationFill;
  if (status === 'Present') return '#F7FFFB';
  if (status === 'Partial') return '#FFFEF7';
  if (status === 'Absent') return '#FFF9FA';
  return rowIndex % 2 ? COLORS.tableAlt : COLORS.white;
}

function drawReferenceFeatureRowChunk(
  doc: PdfDoc,
  cells: string[],
  widths: number[],
  rowHeight: number,
  rowIndex: number,
  continuation: boolean,
) {
  const y = doc.y;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const rowStatus = referenceRowStatus(cells);
  const palette = statusPalette(rowStatus);
  const fill = referenceRowFill(rowStatus, rowIndex, continuation);
  let x = PAGE.left;

  doc.rect(PAGE.left, y, totalWidth, rowHeight).fill(fill);
  if (!continuation) {
    doc.rect(PAGE.left, y, 3, rowHeight).fill(palette.text);
  }
  cells.forEach((cell, index) => {
    if (index > 0) {
      doc.moveTo(x, y).lineTo(x, y + rowHeight).lineWidth(0.25).strokeColor(REFERENCE_FEATURE_TABLE.divider).stroke();
    }
    const text = cell || (continuation && index === 0 ? `${rowIndex + 1} cont.` : '');
    const textX = x + REFERENCE_FEATURE_TABLE.paddingX;
    const textY = y + REFERENCE_FEATURE_TABLE.paddingY;
    const textWidth = widths[index] - REFERENCE_FEATURE_TABLE.paddingX * 2;
    const textHeight = rowHeight - REFERENCE_FEATURE_TABLE.paddingY * 2;

    if (index === 3 && !continuation) {
      const statusLine = text.split('\n')[0] || '';
      const badgeWidth = Math.min(textWidth, Math.max(42, doc.widthOfString(statusLine) + 12));
      doc.roundedRect(textX - 1, textY - 1, badgeWidth, 13, 3).fillAndStroke(palette.fill, palette.stroke);
    }

    const textColor = index === 0 ? COLORS.blue2 : (index === 4 ? '#111827' : COLORS.text);
    doc.fillColor(textColor)
      .font(index === 0 ? FONTS.semibold : FONTS.regular)
      .fontSize(REFERENCE_FEATURE_TABLE.fontSize)
      .text(text, textX, textY, {
        width: textWidth,
        height: textHeight,
        align: index === 0 ? 'center' : proseAlign(text),
        lineGap: REFERENCE_FEATURE_TABLE.lineGap,
      });
    x += widths[index];
  });

  doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.left + totalWidth, y + rowHeight)
    .lineWidth(0.45).strokeColor(COLORS.border).stroke();
  doc.y = y + rowHeight;
}

function drawReferenceFeatureRow(
  doc: PdfDoc,
  row: AttorneyReportFeatureRow,
  rowIndex: number,
  widths: number[],
  headers: string[],
) {
  let remaining = referenceFeatureCells(row, rowIndex);
  let continuation = false;

  while (hasRemainingTableText(remaining)) {
    if (pageBottom(doc) - doc.y < REFERENCE_FEATURE_TABLE.minRowHeight) {
      addPage(doc);
      drawReferenceFeatureTableHeader(doc, headers, widths);
    }

    const available = pageBottom(doc) - doc.y;
    const fullHeight = referenceFeatureRowHeight(doc, remaining, widths);
    const rowHeight = fullHeight <= available ? fullHeight : Math.max(REFERENCE_FEATURE_TABLE.minRowHeight, available);
    const split = splitReferenceFeatureCellsToHeight(doc, remaining, widths, rowHeight);
    const chunks = split.map(([chunk]) => chunk);
    const rest = split.map(([, next]) => next);

    if (continuation) {
      if (!chunks[0]) chunks[0] = `${cleanText(row.featureNumber)} cont.`;
    }

    drawReferenceFeatureRowChunk(doc, chunks, widths, rowHeight, rowIndex, continuation);
    remaining = rest;

    if (hasRemainingTableText(remaining)) {
      addPage(doc);
      drawReferenceFeatureTableHeader(doc, headers, widths);
      continuation = true;
    }
  }
}

function drawFeatureTable(doc: PdfDoc, publicationNumber: string, rows: AttorneyReportFeatureRow[]) {
  const widths = referenceFeatureTableWidths(doc);
  const headers = referenceFeatureTableHeaders(publicationNumber);
  drawReferenceFeatureTableHeader(doc, headers, widths);
  rows.forEach((row, index) => {
    drawReferenceFeatureRow(doc, row, index, widths, headers);
  });
  doc.y += SPACE.md;
}

function drawDetailedFeatureRow(doc: PdfDoc, row: AttorneyReportFeatureRow, index: number) {
  ensureSpace(doc, 94);
  const x = PAGE.left;
  const y = doc.y;
  const width = contentWidth(doc);
  const padding = SPACE.md;
  const featureNumberWidth = 54;
  const statusWidth = 94;
  const featureWidth = width - featureNumberWidth - statusWidth;
  doc.font(FONTS.medium).fontSize(TYPE.body);
  const featureHeight = doc.heightOfString(cleanText(row.userFeature), { width: featureWidth - padding * 2, lineGap: 1.5 });
  const rowHeight = Math.max(48, featureHeight + padding * 2);
  const fill = index % 2 ? COLORS.surface : COLORS.white;
  const palette = statusPalette(row.status);

  doc.roundedRect(x, y, width, rowHeight, 5).fill(fill);
  doc.fillColor(COLORS.blue2).font(FONTS.bold).fontSize(TYPE.h3)
    .text(row.featureNumber, x + padding, y + padding, { width: featureNumberWidth - padding, lineBreak: false });
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.body)
    .text(cleanText(row.userFeature), x + featureNumberWidth, y + padding, {
      width: featureWidth - padding * 2,
      lineGap: 1.5,
    });

  const badgeWidth = statusWidth - 20;
  const badgeY = y + (rowHeight - 24) / 2;
  doc.roundedRect(x + width - statusWidth + 8, badgeY, badgeWidth, 24, 5).fillAndStroke(palette.fill, palette.stroke);
  doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .text(row.statusLabel, x + width - statusWidth + 12, badgeY + 8, {
      width: badgeWidth - 8,
      height: 10,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  doc.moveTo(x, y + rowHeight).lineTo(x + width, y + rowHeight).lineWidth(0.5).strokeColor(COLORS.border).stroke();
  doc.y = y + rowHeight + SPACE.md;

  const userDisclosure = cleanText(row.userDisclosure, '');
  if (userDisclosure && userDisclosure !== cleanText(row.userFeature, '')) {
    drawFlowingLabeledText(doc, 'Submitted disclosure', userDisclosure, { indent: SPACE.md });
  }
  drawFlowingLabeledText(doc, 'Patent disclosure', row.patentDisclosure, { indent: SPACE.md });

  const evidence = row.evidenceQuote
    ? row.evidenceQuote
    : 'No supporting passage was mapped in the reviewed citation record.';
  drawFlowingLabeledText(doc, 'Supporting passage', evidence, {
    indent: SPACE.xl,
    color: COLORS.muted,
    labelColor: statusColor(row.status),
    fontSize: TYPE.small,
  });

  drawFlowingLabeledText(doc, 'Professional remark', row.professionalRemark || row.crispRemark, { indent: SPACE.md });

  ensureSpace(doc, SPACE.lg);
  doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.left + contentWidth(doc), doc.y)
    .lineWidth(0.8).strokeColor('#E2E8F0').stroke();
  doc.y += SPACE.lg;
}

function drawCitationTable(doc: PdfDoc, citations: AttorneyReportCitation[]) {
  const widths = [34, 90, contentWidth(doc) - 304, 110, 70];
  const headers = ['S.No.', 'Citation No.', 'Title', 'Reference Role', 'Priority'];
  drawTableRow(doc, headers, widths, { header: true });
  citations.forEach((citation, index) => {
    drawTableRow(doc, [
      String(index + 1),
      citation.publicationNumber,
      citation.title,
      citation.referenceRole,
      citation.reviewPriority,
    ], widths, { fills: index % 2 ? widths.map(() => COLORS.tableAlt) : undefined, repeatHeader: { cells: headers, widths } });
  });
}

function drawFeatureStatusMatrix(doc: PdfDoc, report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  const features = report.inventionFeatures;
  if (!features.length || !report.comparisons.length) {
    doc.font(FONTS.regular).fontSize(TYPE.small).fillColor(COLORS.muted).text('Feature matrix will appear after citation mapping.', PAGE.left, doc.y, { width: contentWidth(doc) });
    return;
  }

  const closestPn = report.publicClosestCitation?.publicationNumber;
  const strongestReference = report.comparisons.find(item => item.publicationNumber === closestPn)
    || report.comparisons.reduce((best, item) => (
      Number(item.coverage?.score || 0) > Number(best?.coverage?.score || 0) ? item : best
    ), report.comparisons[0]);
  ensureSpace(doc, 42);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.h3)
    .text('Key Feature Mapping Across Relevant Citations', PAGE.left, doc.y, { width: contentWidth(doc) });
  doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.caption)
    .text('Cells indicate whether each feature is mapped, partially mapped, or not mapped in the citation record.', PAGE.left, doc.y + 4, { width: contentWidth(doc) });
  doc.y += SPACE.sm;

  const chunkSize = 8;
  for (let start = 0; start < features.length; start += chunkSize) {
    const featureChunk = features.slice(start, start + chunkSize);
    const citationWidth = 90;
    const roleWidth = 96;
    const signalWidth = 60;
    const featureWidth = (contentWidth(doc) - citationWidth - roleWidth - signalWidth) / featureChunk.length;
    const widths = [citationWidth, roleWidth, ...featureChunk.map(() => featureWidth), signalWidth];
    const headers = ['Citation No.', 'Reference Role', ...featureChunk.map((_, index) => `KF${start + index + 1}`), 'Priority'];
    drawFeatureMatrixHeader(doc, headers, widths);
    report.comparisons.forEach((item, itemIndex) => {
      const statusRows = featureChunk.map((_, index) => item.rows[start + index]);
      const needed = itemIndex === report.comparisons.length - 1 ? 59 : 32;
      if (ensureSpace(doc, needed)) drawFeatureMatrixHeader(doc, headers, widths);
      drawFeatureMatrixRow(
        doc,
        item.publicationNumber,
        item.referenceRole,
        item.reviewPriority,
        item.overlapRiskLevel,
        statusRows,
        widths,
        item.publicationNumber === strongestReference.publicationNumber,
        itemIndex,
      );
    });
    drawFeatureMatrixLegend(doc);
    if (start + chunkSize >= features.length) drawFeatureMatrixInsight(doc, report, strongestReference);
    doc.y += SPACE.sm;
  }
}

function drawFeatureMatrixHeader(doc: PdfDoc, headers: string[], widths: number[]) {
  const rowHeight = 26;
  ensureSpace(doc, rowHeight + 2);
  const y = doc.y;
  let x = PAGE.left;
  doc.rect(PAGE.left, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill('#F4F7FB');
  headers.forEach((header, index) => {
    doc.fillColor('#162033').font(FONTS.semibold).fontSize(index === 0 ? TYPE.caption : TYPE.micro)
      .text(header, x + 5, y + 8, {
        width: widths[index] - 10,
        height: 10,
        align: index === 0 ? 'left' : 'center',
        lineBreak: false,
      });
    x += widths[index];
  });
  doc.moveTo(PAGE.left, y + rowHeight).lineTo(x, y + rowHeight).lineWidth(0.7).strokeColor(COLORS.border).stroke();
  doc.y = y + rowHeight;
}

function drawFeatureMatrixRow(
  doc: PdfDoc,
  publicationNumber: string,
  referenceRole: string,
  reviewPriority: string,
  overlapSignal: string,
  rows: Array<AttorneyReportFeatureRow | undefined>,
  widths: number[],
  strongest: boolean,
  rowIndex: number,
) {
  const rowHeight = 30;
  const y = doc.y;
  const rowFill = strongest ? '#F7FAFF' : rowIndex % 2 ? '#FCFDFE' : COLORS.white;
  let x = PAGE.left;
  doc.rect(PAGE.left, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill(rowFill);

  widths.forEach((width, index) => {
    if (index === 0) {
      doc.fillColor(strongest ? COLORS.blue2 : '#334155')
        .font(strongest ? FONTS.semibold : FONTS.regular)
        .fontSize(TYPE.caption)
        .text(publicationNumber, x + 8, y + 10, {
          width: width - 16,
          height: 10,
          lineBreak: false,
          ellipsis: true,
        });
    } else if (index === 1) {
      const label = cleanText(referenceRole, 'Review');
      const badgeWidth = Math.min(86, width - 10);
      const badgeX = x + (width - badgeWidth) / 2;
      doc.roundedRect(badgeX, y + 7.5, badgeWidth, 15, 4).fillAndStroke(COLORS.paleBlue, '#BFDBFE');
      doc.fillColor(COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.micro)
        .text(label, badgeX + 2, y + 11.5, { width: badgeWidth - 4, height: 8, align: 'center', lineBreak: false });
    } else if (index === widths.length - 1) {
      drawOverlapSignal(doc, reviewPriority || overlapSignal, x, y, width, rowHeight);
    } else {
      drawFeatureMatrixBadge(doc, rows[index - 2], x, y, width, rowHeight);
    }
    x += width;
  });
  doc.moveTo(PAGE.left, y + rowHeight).lineTo(x, y + rowHeight).lineWidth(0.35).strokeColor(COLORS.border).stroke();
  doc.y = y + rowHeight;
}

function drawFeatureMatrixBadge(
  doc: PdfDoc,
  row: AttorneyReportFeatureRow | undefined,
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number,
) {
  const status = row?.status === 'Present' ? 'Present' : row?.status === 'Partial' ? 'Partial' : row?.status === 'Unknown' ? 'Unknown' : 'Absent';
  const badgeWidth = Math.min(38, Math.max(25, cellWidth - 13));
  const badgeHeight = 15;
  const x = cellX + (cellWidth - badgeWidth) / 2;
  const y = cellY + (cellHeight - badgeHeight) / 2;
  const label = row?.publicMappingCode || (status === 'Absent' ? 'N' : status === 'Partial' ? 'P' : status === 'Unknown' ? 'R' : 'D');

  const palette = statusPalette(status);
  doc.roundedRect(x, y, badgeWidth, badgeHeight, 4).fillAndStroke(palette.fill, palette.stroke);
  doc.fillColor(palette.text);

  doc.font(status === 'Absent' ? FONTS.regular : FONTS.semibold)
    .fontSize(TYPE.micro)
    .text(label, x + 2, y + 4.2, {
      width: badgeWidth - 4,
      height: 8,
      align: 'center',
      lineBreak: false,
    });
}

function drawOverlapSignal(doc: PdfDoc, value: string, x: number, y: number, width: number, height: number) {
  const normalized = cleanText(value, 'Review');
  const compact = /high|direct/i.test(normalized)
    ? 'High'
    : /medium|moderate|partial/i.test(normalized)
      ? 'Moderate'
      : /low/i.test(normalized)
        ? 'Low'
        : 'Review';
  const color = compact === 'High'
    ? COLORS.red
    : compact === 'Moderate'
      ? COLORS.warning
      : compact === 'Low'
        ? COLORS.muted
        : COLORS.blue;
  doc.circle(x + 9, y + height / 2, 2.5).fill(color);
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.micro)
    .text(compact, x + 15, y + 11, { width: width - 19, height: 9, lineBreak: false, ellipsis: true });
}

function drawFeatureMatrixLegend(doc: PdfDoc) {
  ensureSpace(doc, 27);
  const y = doc.y + 9;
  const items = [
    { label: 'D Directly mapped', fill: STATUS.Present.fill, stroke: STATUS.Present.stroke },
    { label: 'P Partially mapped', fill: STATUS.Partial.fill, stroke: STATUS.Partial.stroke },
    { label: 'N Not expressly taught', fill: STATUS.Absent.fill, stroke: STATUS.Absent.stroke },
    { label: 'R Full-text review', fill: STATUS.Review.fill, stroke: STATUS.Review.stroke },
  ];
  const itemWidths = [120, 122, 138, 120];
  let x = PAGE.left + 2;
  items.forEach((item, index) => {
    doc.roundedRect(x, y, 17, 11, 3).fillAndStroke(item.fill, item.stroke);
    doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.micro)
      .text(item.label, x + 25, y + 2, { width: itemWidths[index] - 25, height: 9, lineBreak: false });
    x += itemWidths[index];
  });
  doc.y = y + 15;
}

function drawFeatureMatrixInsight(
  doc: PdfDoc,
  report: ReturnType<typeof buildNoveltyAttorneyReportModel>,
  strongestReference: ReturnType<typeof buildNoveltyAttorneyReportModel>['comparisons'][number],
) {
  ensureSpace(doc, 60);
  const mapped = strongestReference.rows.filter(row => row.status === 'Present' || row.status === 'Partial');
  const featureLabels = mapped.slice(0, 6).map(row => row.featureNumber).join(', ');
  const remaining = Math.max(0, strongestReference.rows.length - mapped.length);
  const insight = report.matrixInsight || (mapped.length
    ? `Closest mapped citation ${strongestReference.publicationNumber} is a ${strongestReference.referenceRole.toLowerCase()}. Mapped features include ${featureLabels}${mapped.length > 6 ? ' and others' : ''}; ${remaining} feature${remaining === 1 ? '' : 's'} remain not expressly taught or require full-text review.`
    : `No extracted feature was mapped to ${strongestReference.publicationNumber} in the reviewed citation record.`);
  const y = doc.y + 7;
  doc.roundedRect(PAGE.left, y, contentWidth(doc), 43, 6).fillAndStroke('#EEF5FF', '#D6E6FF');
  doc.circle(PAGE.left + 18, y + 16, 7).fill(COLORS.blue);
  doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(TYPE.small)
    .text('i', PAGE.left + 15.5, y + 11.5, { width: 5, height: 9, align: 'center' });
  doc.fillColor(COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.caption)
    .text('Insight', PAGE.left + 31, y + 9, { width: 45, height: 10, lineBreak: false });
  doc.fillColor('#334155').font(FONTS.regular).fontSize(TYPE.caption)
    .text(insight, PAGE.left + 70, y + 8, { width: contentWidth(doc) - 82, height: 29, lineGap: 1.2, ellipsis: true });
  doc.y = y + 48;
}

function drawEvidenceBadge(doc: PdfDoc, label: string, x: number, y: number) {
  const normalized = label.toLowerCase();
  const palette = normalized.includes('inference')
    ? { fill: '#FEF2F2', stroke: '#FECACA', text: '#B91C1C' }
    : normalized.includes('abstract')
      ? { fill: '#F5F3FF', stroke: '#DDD6FE', text: '#6D28D9' }
      : normalized.includes('none') || normalized.includes('not found')
        ? { fill: '#F8FAFC', stroke: '#CBD5E1', text: '#64748B' }
        : { fill: '#EFF6FF', stroke: '#BFDBFE', text: '#1D4ED8' };
  const width = Math.max(43, Math.min(76, doc.widthOfString(label) + 19));
  doc.roundedRect(x, y, width, 17, 4).fillAndStroke(palette.fill, palette.stroke);
  doc.circle(x + 8, y + 8.5, 2).fill(palette.text);
  doc.fillColor(palette.text).font(FONTS.medium).fontSize(TYPE.micro)
    .text(label, x + 13, y + 5, { width: width - 17, height: 8, lineBreak: false, ellipsis: true });
  return width;
}

function drawCitationCardHeader(
  doc: PdfDoc,
  item: ReturnType<typeof buildNoveltyAttorneyReportModel>['comparisons'][number],
  index: number,
  total: number,
  jurisdiction: string,
) {
  const x = PAGE.left;
  const width = contentWidth(doc);
  doc.font(FONTS.semibold).fontSize(TYPE.small);
  const titleHeight = doc.heightOfString(cleanText(item.title), { width: width - 28, lineGap: 1.5 });
  const height = Math.max(184, 155 + titleHeight);
  ensureSpace(doc, height + SPACE.lg);
  const y = doc.y;
  drawCard(doc, x, y, width, height, 7);
  const riskPalette = verdictPalette(item.noveltyThreat || item.overlapRiskLevel);
  doc.rect(x, y, 5, height).fill(riskPalette.accent);

  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(`REFERENCE ${index + 1} OF ${total}`, x + 18, y + 13, { width: 110, height: 9, lineBreak: false });
  doc.roundedRect(x + width - 252, y + 9, 122, 23, 5).fillAndStroke(riskPalette.fill, riskPalette.stroke);
  doc.fillColor(riskPalette.text).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(truncate(item.noveltyThreat || item.overlapRiskLevel, 34), x + width - 244, y + 16, { width: 106, height: 8, align: 'center', lineBreak: false, ellipsis: true });
  doc.roundedRect(x + width - 124, y + 9, 110, 23, 5).fillAndStroke(COLORS.paleBlue, '#BFDBFE');
  doc.fillColor(COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(item.reviewPriority, x + width - 112, y + 16, { width: 86, height: 8, align: 'center', lineBreak: false, ellipsis: true });

  doc.fillColor(COLORS.blue2).font(FONTS.bold).fontSize(TYPE.h3)
    .text(`${cleanText(item.citationNo, `D${index + 1}`)}  ${item.publicationNumber}`, x + 18, y + 38, { width: width - 36, height: 16, lineBreak: false, ellipsis: true });
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.small)
    .text(cleanText(item.title), x + 18, y + 59, { width: width - 36, lineGap: 1.5 });

  const separatorY = y + 67 + titleHeight;
  doc.moveTo(x + 18, separatorY).lineTo(x + width - 18, separatorY).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
  const meta = [
    ['Reference role', item.referenceRole],
    ['Publication / priority', `${item.publicationDate} / ${item.priorityDate}`],
    ['Assignee', item.assignees],
    ['Jurisdiction', jurisdiction],
  ];
  const metaY = separatorY + 10;
  const cellWidth = (width - 36) / 4;
  doc.roundedRect(x + 18, metaY - 3, width - 36, 47, 5).fill('#F8FAFC');
  meta.forEach(([label, value], metaIndex) => {
    const metaX = x + 28 + metaIndex * cellWidth;
    doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
      .text(label.toUpperCase(), metaX, metaY + 4, { width: cellWidth - 18, height: 9, lineBreak: false, ellipsis: true });
    doc.fillColor(COLORS.text).font(FONTS.regular).fontSize(TYPE.caption)
      .text(truncate(value, 82), metaX, metaY + 17, { width: cellWidth - 18, height: 20, ellipsis: true, lineGap: 1 });
  });

  const evidenceY = metaY + 57;
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text('REVIEW SIGNAL', x + 18, evidenceY + 4, { width: 72, height: 8, lineBreak: false });
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .text(`${item.rows.filter(row => row.status === 'Present').length} directly mapped / ${item.rows.filter(row => row.status === 'Partial').length} partially mapped / ${item.rows.filter(row => row.status === 'Unknown').length} full-text review`, x + 94, evidenceY + 3, { width: 360, height: 10, lineBreak: false, ellipsis: true });
  doc.y = y + height + SPACE.md;
}

function drawNameList(doc: PdfDoc, names: string[], emptyText: string) {
  if (!names.length) {
    doc.font(FONTS.regular).fontSize(TYPE.small).fillColor(COLORS.muted).text(emptyText, PAGE.left + 18, doc.y, { width: contentWidth(doc) - 36 });
    doc.y += SPACE.sm;
    return;
  }
  names.forEach(name => {
    ensureSpace(doc, 18);
    doc.circle(PAGE.left + 8, doc.y + 5, 2).fill(COLORS.blue);
    doc.font(FONTS.regular).fontSize(TYPE.body).fillColor(COLORS.text).text(name, PAGE.left + 18, doc.y, { width: contentWidth(doc) - 28 });
    doc.y += SPACE.xs;
  });
}

function drawEntityLandscape(doc: PdfDoc, landscape: ReturnType<typeof buildNoveltyAttorneyReportModel>['assigneeLandscape']) {
  drawParagraph(doc, landscape.summary);
  if (landscape.repeated.length > 0) {
    drawFlowBulletList(
      doc,
      'Repeated Signals',
      landscape.repeated.map(item => `${item.name} (${item.count} mapped citation${item.count === 1 ? '' : 's'})`)
    );
  }
  landscape.groups.forEach(group => {
    drawFlowBulletList(doc, group.label, group.names);
  });
}

async function pdfBuffer(doc: PdfDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer | Uint8Array | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }

    const payload = verifyJWT(authHeader.substring(7));
    if (!payload?.sub) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const searchRun = await prisma.noveltySearchRun.findFirst({
      where: { id: params.searchId, userId: payload.sub },
    });
    if (!searchRun) return NextResponse.json({ error: 'Novelty search not found' }, { status: 404 });

    const enrichedSearchRun = await hydrateNoveltyReportPatentMetadata(searchRun);
    const report = buildNoveltyAttorneyReportModel(enrichedSearchRun);
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
      bufferPages: true,
      autoFirstPage: true,
      info: { Title: report.reportTitle, Author: report.preparedBy, Subject: report.inventionTitle },
    });
    registerReportFonts(doc);
    const sectionPages: Array<{ number: string; title: string; page: number; destination: string; level: 1 | 2 }> = [];

    drawCover(doc, report);

    addPage(doc);
    const tocPageIndex = doc.bufferedPageRange().count - 1;

    addPage(doc);
    drawExecutiveSnapshot(doc, report);
    sectionPages.push({ number: '', title: 'Executive Snapshot', page: doc.bufferedPageRange().count, destination: 'executive-snapshot', level: 1 });

    addPage(doc);
    const startGroup = (number: string, title: string) => {
      ensureSpace(doc, 60);
      const destination = `section-${sectionPages.length + 1}`;
      doc.addNamedDestination(destination, 'XYZ', PAGE.left, Math.max(PAGE.top, doc.y - 8), null);
      sectionPages.push({ number, title, page: doc.bufferedPageRange().count, destination, level: 1 });
      drawGroupHeading(doc, number, title);
    };
    const startSection = (number: string, title: string, level: 1 | 2 = 1) => {
      ensureSpace(doc, 54);
      const destination = `section-${sectionPages.length + 1}`;
      doc.addNamedDestination(destination, 'XYZ', PAGE.left, Math.max(PAGE.top, doc.y - 8), null);
      sectionPages.push({ number, title, page: doc.bufferedPageRange().count, destination, level });
      drawSectionHeading(doc, `${number} ${title}`);
    };

    startGroup('1', 'Search Overview');
    startSection('1.1', 'Objective', 2);
    drawParagraph(
      doc,
      'The objective of this report is to organize relevant patent records and map available evidence against the extracted key features of the submitted invention for review.'
    );
    drawMetadataGrid(doc, [
      ['Search Query', report.searchQuery],
      ['Analysis Type', report.evidenceBasis],
    ]);
    drawMetadataGrid(doc, report.countLabels.map(item => [item.label, String(item.value)]));

    startSection('1.2', 'Search Scope and Methodology', 2);
    drawMetadataGrid(doc, [
      ['Corpus + retrieval mode', report.methodology.corpus],
      ['Search / mapping mode', report.methodology.retrievalMode],
      ['Assessment scope', report.methodology.searchedEvidence],
      ['Review status', report.methodology.preliminaryStatus],
    ]);
    drawFlowBulletList(doc, 'Techniques Used', report.methodology.techniques);

    startSection('1.3', 'Key Features', 2);
    drawParagraph(doc, 'The key features are extracted from the submitted disclosure and classified to separate core mechanisms, implementation details, novelty-candidate features, and generic features that should not be relied on alone.');
    drawTableRow(doc, ['Key Feature', 'Importance', 'Type', 'Feature Description'], [58, 122, 92, contentWidth(doc) - 272], { header: true });
    report.featureSummaries.forEach((feature, index) => {
      drawTableRow(doc, [
        feature.featureNumber,
        feature.importanceLabel,
        feature.typeLabel,
        `${feature.feature}${feature.genericWarning ? `\n${feature.genericWarning}` : ''}`,
      ], [58, 122, 92, contentWidth(doc) - 272], { fills: index % 2 ? [COLORS.tableAlt, COLORS.tableAlt, COLORS.tableAlt, COLORS.tableAlt] : undefined });
    });
    drawFlowTextBlock(doc, 'Generic Feature Risk', report.genericFeatureRisk.summary);

    startSection('1.4', 'Scoring Legend', 2);
    drawTableRow(doc, ['Score / Status', 'Meaning'], [128, contentWidth(doc) - 128], { header: true });
    report.scoringLegend.forEach((item, index) => {
      drawTableRow(doc, [item.label, item.meaning], [128, contentWidth(doc) - 128], { fills: index % 2 ? [COLORS.tableAlt, COLORS.tableAlt] : undefined });
    });

    startSection('1.5', 'Summary of Relevant Citations', 2);
    drawCitationTable(doc, report.citations);

    startSection('1.6', 'Component / Feature-Level Prior Art', 2);
    drawParagraph(
      doc,
      'These citations disclose one or more relevant invention features, subsystems, materials, process steps, or implementation details, but are not treated as full invention-level matches by themselves.'
    );
    if (report.componentCitations.length > 0) {
      drawCitationTable(doc, report.componentCitations);
    } else {
      drawParagraph(doc, 'No separate component / feature-level references were classified in this run.');
    }

    startSection('1.7', 'Key Feature Analysis Matrix', 2);
    drawFeatureStatusMatrix(doc, report);

    startGroup('2', 'Citation Analysis');
    startSection('2.1', 'Details of Relevant Patent Citations', 2);
    for (let itemIndex = 0; itemIndex < report.comparisons.length; itemIndex += 1) {
      const item = report.comparisons[itemIndex];
      drawCitationCardHeader(doc, item, itemIndex, report.comparisons.length, report.jurisdiction);
      drawMetadataGrid(doc, [
        ['Application No.', item.applicationNumber],
        ['Filing Date', item.filingDate],
        ['Priority Date', item.priorityDate],
        ['Reference Role', item.referenceRole],
        ['Review Priority', item.reviewPriority],
        ['Inventor(s)', item.inventors],
        ['CPC / IPC', `${item.cpcCodes} / ${item.ipcCodes}`],
        ['Source', item.link],
      ]);
      doc.y += SPACE.sm;
      drawFlowingLabeledText(doc, 'Patent Abstract', item.abstract);
      const normalizedAbstract = cleanText(item.abstract, '');
      const normalizedTechnicalDisclosure = cleanText(item.technicalDisclosure, '');
      if (
        normalizedTechnicalDisclosure &&
        normalizedTechnicalDisclosure !== normalizedAbstract &&
        !normalizedAbstract.includes(normalizedTechnicalDisclosure)
      ) {
        drawFlowingLabeledText(doc, 'Technical Disclosure', item.technicalDisclosure);
      }
      doc.font(FONTS.semibold).fontSize(TYPE.h3).fillColor(COLORS.text).text('Feature-by-Feature Comparison', PAGE.left, doc.y, { width: contentWidth(doc) });
      doc.y += SPACE.md;
      if (item.rows.length > 0) drawFeatureTable(doc, item.publicationNumber, item.rows);
      else drawParagraph(doc, 'No feature comparison rows were available for this citation.');
      doc.y += SPACE.sm;
      keyValueRow(doc, 'Reference Summary', item.summary);
      keyValueRow(doc, 'Claim Impact Summary', item.claimImpactSummary);
      doc.y += SPACE.md;
    }

    startSection('2.2', 'List of Other Shortlisted Citations', 2);
    if (report.otherShortlistedCitations.length > 0) {
      drawParagraph(doc, 'The below citations were shortlisted but not mapped in citation detail because the final report focuses on the most relevant mapped references.');
      drawCitationTable(doc, report.otherShortlistedCitations);
    } else {
      drawParagraph(doc, 'No additional shortlisted citations remained after the detailed mapped references were selected.');
    }

    startSection('3', 'Applicant / Assignee Landscape');
    drawEntityLandscape(doc, report.assigneeLandscape);

    startSection('4', 'Repeated Inventor / Entity Signals');
    drawEntityLandscape(doc, report.inventorSignals);

    startSection('5', 'Claim-Positioning Analysis');
    const claimPositioning = report.claimPositioningAnalysis;
    if (claimPositioning) {
      drawFlowTextBlock(doc, 'Primary Claim Focus', claimPositioning.primaryClaimFocus);
      if (claimPositioning.secondaryClaimFocus) {
        drawFlowTextBlock(doc, 'Secondary Claim Focus', claimPositioning.secondaryClaimFocus);
      }
      drawFlowTextBlock(doc, 'Remaining Inventive Core', claimPositioning.remainingInventiveCore);
      drawFlowTextBlock(doc, 'Why Still Distinguishable', claimPositioning.whyStillDistinguishable);
      drawFlowTextBlock(doc, 'Reasoning', claimPositioning.reasoning);
      drawFlowBulletList(doc, 'Weak Claim Areas', claimPositioning.weakClaimAreas || []);
      drawFlowBulletList(doc, 'Avoid Relying Solely On', claimPositioning.avoidRelyingSolelyOn || []);
    } else {
      drawParagraph(doc, 'Claim-positioning analysis was not generated for this report version.');
    }

    const conceptCoverage = Array.isArray(report.conceptMappedCoverageSummary) ? report.conceptMappedCoverageSummary : [];
    if (conceptCoverage.length) {
      drawFlowLabel(doc, 'Concept Mapped Coverage Summary');
      const widths = [160, 76, 76, 78, 74, contentWidth(doc) - 464];
      const header = ['Concept', 'Mapped', 'Single Ref.', 'Distributed', 'Level', 'Closest References'];
      drawTableRow(doc, header, widths, { header: true });
      conceptCoverage.forEach(item => drawTableRow(doc, [
        item.conceptTitle,
        `${item.mappedCoveragePercent}%`,
        `${item.singleReferenceMappedCoveragePercent}%`,
        `${item.distributedMappedCoveragePercent}%`,
        `${item.mappingLevel}${item.relationshipMapped ? ' + relationship' : ''}`,
        item.closestReferences.join(', ') || '-',
      ], widths, { repeatHeader: { cells: header, widths } }));
      doc.y += SPACE.md;
    }

    if (report.claimDraftingConsiderations) {
      drawFlowTextBlock(doc, 'Claim Drafting Considerations', report.claimDraftingConsiderations.independentClaimFocus);
      drawFlowBulletList(doc, 'Dependent Claim Ideas', report.claimDraftingConsiderations.dependentClaimIdeas || []);
      drawFlowBulletList(doc, 'Fallback Claim Ideas', report.claimDraftingConsiderations.fallbackClaimIdeas || []);
      drawFlowBulletList(doc, 'Review Before Drafting', report.claimDraftingConsiderations.reviewBeforeDrafting || []);
    }

    const draftingOpportunities = Array.isArray(report.draftingOpportunities) ? report.draftingOpportunities : [];
    if (draftingOpportunities.length) {
      drawFlowLabel(doc, 'Drafting Opportunities');
      const widths = [90, 150, contentWidth(doc) - 240];
      const header = ['Type', 'Title', 'Explanation'];
      drawTableRow(doc, header, widths, { header: true });
      draftingOpportunities.forEach(item => drawTableRow(doc, [
        item.opportunityType.replace(/_/g, ' '),
        item.title,
        `${item.explanation}${item.linkedFeatures?.length ? ` Linked features: ${item.linkedFeatures.join(', ')}` : ''}`,
      ], widths, { repeatHeader: { cells: header, widths } }));
      doc.y += SPACE.md;
    }

    if (report.strategicReviewFocus) {
      drawMetadataGrid(doc, [
        ['Highest priority reference', report.strategicReviewFocus.highestPriorityReference],
        ['Review reason', report.strategicReviewFocus.reviewReason],
        ['Highest overlap', report.strategicReviewFocus.highestOverlap],
        ['Lowest overlap', report.strategicReviewFocus.lowestOverlap],
        ['Critical relationship', report.strategicReviewFocus.criticalRelationshipToVerify],
        ['Full-text review', report.strategicReviewFocus.recommendedFullTextReview.join(', ') || '-'],
      ]);
      drawFlowBulletList(doc, 'Remaining Uncertainties', report.strategicReviewFocus.remainingUncertainties || []);
    }

    startSection('6', 'Claim-Positioning Observations');
    const risk = riskAssessmentFor(report);
    drawMetadataGrid(doc, [
      ['Automated overlap position', report.finalAssessment.decision],
      ['Novelty / anticipation risk', `${risk.noveltyRisk} - ${risk.noveltyRiskExplanation}`],
      ['Component-combination risk', `${risk.combinationRisk} - ${risk.combinationRiskExplanation}`],
      ['Closest mapped citation', report.publicClosestCitation?.publicationNumber || '-'],
      ['Reference role', report.publicClosestCitation?.referenceRole || '-'],
      ['Review priority', report.publicClosestCitation?.reviewPriority || '-'],
      ['Legal conclusion', report.reportConfidence.legalConclusion],
    ]);
    drawFlowTextBlock(doc, 'Summary', report.finalAssessment.summary);
    drawFlowTextBlock(doc, 'Potential Differentiation Space', report.potentialDifferentiationSpace || 'Potential differentiation space requires mapped feature analysis.');
    const claimConceptMapping = Array.isArray(report.claimConceptMapping) ? report.claimConceptMapping : [];
    if (claimConceptMapping.length) {
      drawFlowTextBlock(
        doc,
        'Concept Relationship Mapping',
        claimConceptMapping.map(item => {
          const coverage = `${item.mappedFeatures}/${item.totalFeatures}`;
          const relationship = item.relationshipMapped ? 'relationship mapped' : 'relationship not fully mapped';
          return `${item.claimConceptTitle}: ${coverage} linked features mapped; ${relationship}; ${item.reason}`;
        }).join('\n')
      );
    }
    if (report.attorneyReviewFocus) {
      drawFlowTextBlock(doc, 'Attorney Review Focus', report.attorneyReviewFocus);
    }
    drawFlowBulletList(doc, 'Key Risks', report.finalAssessment.risks);
    drawFlowBulletList(doc, 'Recommendations', report.finalAssessment.recommendations);
    drawFlowTextBlock(doc, 'Overall Drafting Direction', report.overallDraftingDirection);

    startSection('7', 'Limitations and Next Steps');
    drawParagraph(doc, report.limitations);
    drawFlowBulletList(doc, 'What To Do Next', report.nextSteps);

    doc.switchToPage(tocPageIndex);
    doc.y = PAGE.top + 10;
    doc.rect(PAGE.left, doc.y, 82, 5).fill(COLORS.cyan);
    doc.y += SPACE.xl;
    doc.fillColor(COLORS.text).font(FONTS.bold).fontSize(TYPE.h1).text('Table of Contents', PAGE.left, doc.y, { width: contentWidth(doc) });
    doc.y += SPACE.lg;
    sectionPages.forEach(item => {
      const y = doc.y;
      const rowHeight = item.level === 1 ? 22 : 18;
      const indent = item.level === 2 ? SPACE.lg : 0;
      doc.font(item.level === 1 ? FONTS.semibold : FONTS.regular).fontSize(item.level === 1 ? TYPE.body : TYPE.small).fillColor(COLORS.text)
        .text(`${item.number} ${item.title}`.trim(), PAGE.left + indent, y, { width: contentWidth(doc) - 58 - indent });
      doc.font(FONTS.semibold).fontSize(TYPE.small).fillColor(COLORS.blue)
        .text(String(item.page), doc.page.width - PAGE.right - 42, y, { width: 42, align: 'right' });
      doc.goTo(PAGE.left, y - 2, contentWidth(doc), rowHeight, item.destination, { Border: [0, 0, 0] });
      doc.moveTo(PAGE.left, y + rowHeight - 4).lineTo(doc.page.width - PAGE.right, y + rowHeight - 4).lineWidth(0.3).strokeColor('#E2E8F0').stroke();
      doc.y = y + rowHeight;
    });

    trimTrailingBlankPages(doc);
    drawHeaderFooter(doc, report.reportNumber, report.inventionTitle);
    const buffer = await pdfBuffer(doc);
    const filename = `${report.reportNumber}.pdf`;

    const disposition = request.nextUrl.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[AttorneyReportPDF] Failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate attorney report PDF' }, { status: 500 });
  }
}
