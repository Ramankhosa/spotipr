import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildNoveltyAttorneyReportModel, formatFirmAddressLines, type AttorneyReportCitation, type AttorneyReportFeatureRow } from '@/lib/novelty-attorney-report';
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata';
import { canonicalReportPublicationNumber } from '@/lib/novelty-report-reference-selection';
import { loadFirmBranding } from '@/lib/firm-profile-service';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

// --- Firm accent theming ----------------------------------------------------
// A tenant may set a single brand accent color. We honor it by overriding the accent-family
// keys of the module-level COLORS palette for the duration of a single request, then
// restoring them in a `finally`.
//
// SAFETY: this is concurrency-safe ONLY because the entire PDF drawing pass
// (drawCover(...) ... drawHeaderFooter(...)) is fully synchronous — there is no `await`
// between applyAccentOverrides() and the first `await pdfBuffer(doc)`. Node cannot
// interleave another request into that synchronous block, so each request draws with its
// own accent before yielding. DO NOT introduce an `await` into the drawing pass.
const ACCENT_KEYS = ['blue', 'blue2', 'cyan', 'tableHeader'] as const;

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`.toUpperCase();
}

function mixToward(hex: string, target: number, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (target - r) * amount, g + (target - g) * amount, b + (target - b) * amount);
}
const darkenColor = (hex: string, amount: number) => mixToward(hex, 0, amount);
const lightenColor = (hex: string, amount: number) => mixToward(hex, 255, amount);

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Keep an accent used as a fill behind white text legible: darken very light accents.
function clampForFill(hex: string): string {
  let out = hex;
  let guard = 0;
  while (relativeLuminance(out) > 0.5 && guard < 8) {
    out = darkenColor(out, 0.15);
    guard++;
  }
  return out;
}

function deriveAccentOverrides(accent?: string | null): Partial<Record<typeof ACCENT_KEYS[number], string>> | null {
  const hex = normalizeHexColor(accent);
  if (!hex) return null;
  return {
    blue: hex,
    blue2: darkenColor(hex, 0.14),
    cyan: lightenColor(hex, 0.22),
    tableHeader: clampForFill(hex),
  };
}

function applyAccentOverrides(accent?: string | null): () => void {
  const overrides = deriveAccentOverrides(accent);
  if (!overrides) return () => {};
  const saved: Partial<Record<string, string>> = {};
  for (const key of ACCENT_KEYS) {
    const value = overrides[key];
    if (value) {
      saved[key] = (COLORS as Record<string, string>)[key];
      (COLORS as Record<string, string>)[key] = value;
    }
  }
  return () => {
    for (const key of Object.keys(saved)) (COLORS as Record<string, string>)[key] = saved[key]!;
  };
}

// PDFKit's doc.image supports PNG/JPEG only (not SVG). Decode a firm logo data-URI to a
// Buffer, validating the magic bytes; return null on anything unsupported.
function decodeFirmLogo(dataUri?: string | null): Buffer | null {
  if (!dataUri) return null;
  try {
    const match = dataUri.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    return isPng || isJpg ? buffer : null;
  } catch {
    return null;
  }
}

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

// Like cleanText but preserves line breaks (cleans whitespace within each line),
// so values that are intentionally a list can render/measure as multiple lines.
function cleanMultiline(value: unknown, fallback = '-') {
  const text = String(value ?? '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
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

function patentDestination(index: number) {
  return `patent-detail-${index + 1}`;
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

// --- Table of Contents -------------------------------------------------------------
// The TOC is laid out with fixed row heights so its page count can be computed BEFORE
// the content is rendered. The exact number of pages is reserved up front and the rows
// are placed with explicit coordinates afterwards — the TOC must never rely on PDFKit's
// implicit page overflow, which appends pages at the END of the document.

type TocEntry = { number: string; title: string; page: number; destination: string; level: 1 | 2 | 3 };

const TOC = {
  rowHeight: { 1: 24, 2: 18, 3: 15 } as Record<1 | 2 | 3, number>,
  groupGap: 7,
  headerBlock: 86,
  continuationHeaderBlock: 50,
} as const;

function tocLayout(doc: PdfDoc, levels: Array<1 | 2 | 3>) {
  const bottom = doc.page.height - PAGE.bottom;
  const positions: Array<{ pageOffset: number; y: number }> = [];
  let pageOffset = 0;
  let y = PAGE.top + TOC.headerBlock;
  for (const level of levels) {
    const gap = level === 1 ? TOC.groupGap : 0;
    const height = TOC.rowHeight[level];
    if (y + gap + height > bottom) {
      pageOffset += 1;
      y = PAGE.top + TOC.continuationHeaderBlock;
    } else {
      y += gap;
    }
    positions.push({ pageOffset, y });
    y += height;
  }
  return { positions, pageCount: pageOffset + 1 };
}

// Mirrors the exact sequence of sectionPages.push(...) calls in the GET handler so the
// reserved TOC page count always matches the rendered entry list.
function plannedTocLevels(patentCount: number, paperCount: number, hasCombinations = false, hasMappedAppendix = false): Array<1 | 2 | 3> {
  const levels: Array<1 | 2 | 3> = [];
  levels.push(1); // Executive Snapshot
  levels.push(1); // 1 Search Overview
  for (let i = 0; i < 7; i++) levels.push(2); // 1.1 - 1.7
  if (hasCombinations) levels.push(2); // 1.8 inventive-step combinations
  levels.push(1); // 2 Citation Analysis
  levels.push(2); // 2.1 Relevant Patent Citations
  for (let i = 0; i < patentCount; i++) levels.push(3);
  if (paperCount > 0) {
    levels.push(2); // 2.x Relevant Scholarly Publications
    for (let i = 0; i < paperCount; i++) levels.push(3);
  }
  if (hasMappedAppendix) levels.push(1); // Appendix A
  levels.push(2); // List of Other Shortlisted Citations
  for (let i = 0; i < 5; i++) levels.push(1); // Sections 3-7
  return levels;
}

function drawTocHeader(doc: PdfDoc, first: boolean) {
  const y = PAGE.top + 10;
  doc.rect(PAGE.left, y, 82, 5).fill(COLORS.cyan);
  doc.fillColor(COLORS.text).font(FONTS.bold).fontSize(first ? TYPE.h1 : TYPE.h2)
    .text(first ? 'Table of Contents' : 'Table of Contents (continued)', PAGE.left, y + SPACE.lg, {
      width: contentWidth(doc),
      lineBreak: false,
    });
}

function drawTocRow(doc: PdfDoc, item: TocEntry, y: number) {
  const rowHeight = TOC.rowHeight[item.level];
  const indent = item.level === 3 ? SPACE.xl : item.level === 2 ? SPACE.lg : 0;
  const font = item.level === 1 ? FONTS.semibold : FONTS.regular;
  const fontSize = item.level === 1 ? TYPE.body : item.level === 3 ? TYPE.micro : TYPE.small;
  const textColor = item.level === 1 ? COLORS.text : item.level === 3 ? COLORS.slate : COLORS.text;
  const label = `${item.number} ${item.title}`.trim();
  const numberWidth = 34;
  const textWidth = contentWidth(doc) - numberWidth - indent - 10;

  doc.font(font).fontSize(fontSize).fillColor(textColor)
    .text(label, PAGE.left + indent, y, { width: textWidth, height: rowHeight, lineBreak: false, ellipsis: '...' });

  const labelWidth = Math.min(doc.widthOfString(label), textWidth);
  const dotsStart = PAGE.left + indent + labelWidth + 7;
  const dotsEnd = doc.page.width - PAGE.right - numberWidth - 5;
  if (dotsEnd > dotsStart + 14) {
    const leaderY = y + fontSize * 0.72;
    doc.save();
    doc.moveTo(dotsStart, leaderY).lineTo(dotsEnd, leaderY)
      .lineWidth(0.5).strokeColor('#C9D4E2').dash(1, { space: 3 }).stroke().undash();
    doc.restore();
  }

  doc.font(item.level === 1 ? FONTS.semibold : FONTS.regular)
    .fontSize(item.level === 1 ? TYPE.small : TYPE.caption)
    .fillColor(item.level === 1 ? COLORS.text : COLORS.muted)
    .text(String(item.page), doc.page.width - PAGE.right - numberWidth, y, { width: numberWidth, align: 'right', lineBreak: false });
  doc.goTo(PAGE.left, y - 1, contentWidth(doc), rowHeight, item.destination, { Border: [0, 0, 0] });
}

function fillTableOfContents(doc: PdfDoc, entries: TocEntry[], tocPageIndexes: number[]) {
  const layout = tocLayout(doc, entries.map(entry => entry.level));
  if (layout.pageCount > tocPageIndexes.length) {
    console.warn(`[AttorneyReportPDF] TOC needs ${layout.pageCount} pages but ${tocPageIndexes.length} were reserved; trailing entries will be omitted.`);
  }
  let renderedPageOffset = -1;
  entries.forEach((entry, index) => {
    const position = layout.positions[index];
    if (!position || position.pageOffset >= tocPageIndexes.length) return;
    if (position.pageOffset !== renderedPageOffset) {
      renderedPageOffset = position.pageOffset;
      doc.switchToPage(tocPageIndexes[renderedPageOffset]);
      drawTocHeader(doc, renderedPageOffset === 0);
    }
    drawTocRow(doc, entry, position.y);
  });
}
// -------------------------------------------------------------------------------------

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
    highestSingleReferenceCoreCoveragePercent: 0,
    distributedCoreCoveragePercent: 0,
    assessmentConfidence: 'Low' as const,
  };
}

// Split `value` so the first chunk fits within `height`. Prefers splitting at line
// breaks, then sentence ends, then word boundaries, and pulls the split point back
// when the remainder would be a stranded single line (widow/orphan control).
function fitTextToHeight(doc: PdfDoc, value: string, width: number, height: number, lineGap: number) {
  if (doc.heightOfString(value, { width, lineGap }) <= height) return [value, ''] as const;
  const singleLineHeight = doc.heightOfString('Ag', { width: Math.max(width, 40), lineGap });
  if (height < singleLineHeight) return ['', value] as const;

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

  const window = value.slice(0, best);
  const newline = window.lastIndexOf('\n');
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  const whitespace = window.lastIndexOf(' ');
  let splitAt = best;
  if (newline > 0 && newline >= best - 220) splitAt = newline;
  else if (sentence > 0 && sentence >= best - 180) splitAt = sentence + 1;
  else if (whitespace > Math.max(0, best - 80)) splitAt = whitespace;

  let tail = value.slice(splitAt).trimStart();
  if (tail && doc.heightOfString(tail, { width, lineGap }) <= singleLineHeight + 1) {
    const earlierNewline = value.lastIndexOf('\n', Math.max(0, splitAt - 2));
    const earlierSentence = Math.max(
      value.lastIndexOf('. ', Math.max(0, splitAt - 2)),
      value.lastIndexOf('! ', Math.max(0, splitAt - 2)),
      value.lastIndexOf('? ', Math.max(0, splitAt - 2)),
    );
    const earlier = earlierNewline > 0 ? earlierNewline : (earlierSentence > 0 ? earlierSentence + 1 : -1);
    if (earlier > splitAt * 0.4) {
      splitAt = earlier;
      tail = value.slice(splitAt).trimStart();
    }
  }
  const head = value.slice(0, splitAt).trimEnd();
  if (!head) return [value.slice(0, best).trimEnd(), value.slice(best).trimStart()] as const;
  return [head, tail] as const;
}

function proseAlign(_value: unknown): PdfTextAlign {
  // Left-align throughout. PDFKit has no hyphenation, so justified text produces
  // ragged inter-word "rivers" and one-word-per-line stacking in narrow columns.
  return 'left';
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
    ensureSpace(doc, 64);
    doc.fillColor(options.labelColor || COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.caption)
      .text(`${label}${continued ? ' (continued)' : ''}`.toUpperCase(), x, doc.y, { width, lineBreak: false });
    doc.y += SPACE.sm;
    doc.fillColor(options.color || '#334155').font(FONTS.regular).fontSize(fontSize);
    const available = Math.max(24, pageBottom(doc) - doc.y);
    const [chunk, rest] = fitTextToHeight(doc, remaining, width, available, lineGap);
    doc.text(chunk, x, doc.y, { width, align: 'left', lineGap });
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
      .text(`Page ${pageNo} of ${range.count}`, width - PAGE.right - 110, footerY, { width: 110, height: 10, align: 'right', lineBreak: false });
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
  // Co-branding: a firm's logo (or name) leads the cover; otherwise the PatentNest wordmark.
  const firm = report.firm;
  const logoBuffer = decodeFirmLogo(firm?.logoDataUri);
  let subtitleY = 128;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, PAGE.left, 90, { fit: [210, 48] });
      subtitleY = 150;
    } catch {
      doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(TYPE.h1).text(firm?.firmName || 'PatentNest.ai', PAGE.left, 96, { width: 390 });
      subtitleY = 128;
    }
  } else {
    doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(TYPE.h1).text(firm?.firmName || 'PatentNest.ai', PAGE.left, 96, { width: 390 });
  }
  doc.fillColor('#BFDBFE').font(FONTS.regular).fontSize(TYPE.h3)
    .text(cleanText(report.reportTitle, 'Preliminary Novelty Assessment Report'), PAGE.left, subtitleY, { width: 420 });

  // The invention itself is the cover headline; the report type is already stated in
  // the subtitle above (previously the same phrase appeared twice on the cover).
  const coverTitle = cleanText(report.inventionTitle, report.reportTitle);
  const coverTitleSize = coverTitle.length > 110 ? 20 : coverTitle.length > 70 ? 24 : TYPE.display;
  doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(coverTitleSize)
    .text(coverTitle, PAGE.left, 254, { width: 430, lineGap: SPACE.xs });

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

  // Firm contact line (address / phone / email / website) in the cover footer band.
  if (firm) {
    const contact = [
      formatFirmAddressLines(firm).join(', '),
      firm.phone,
      firm.email,
      firm.website,
    ].filter(Boolean).join('   ·   ');
    if (contact) {
      doc.fillColor('#BFDBFE').font(FONTS.regular).fontSize(TYPE.caption)
        .text(contact, PAGE.left, height - 118, { width: contentWidth(doc), align: 'center' });
    }
  }

  // Co-brand attribution: keep a subtle "Powered by PatentNest.ai" when a firm brand leads.
  if (firm && report.showPoweredBy !== false) {
    doc.fillColor('#93C5FD').font(FONTS.regular).fontSize(TYPE.micro)
      .text('Powered by PatentNest.ai', PAGE.left, height - 96, { width: contentWidth(doc), align: 'center' });
  }

  doc.fillColor('#BFDBFE').font(FONTS.regular).fontSize(TYPE.caption)
    .text(report.confidentiality, PAGE.left, height - 74, { width: contentWidth(doc), align: 'center' });
}

function drawCard(doc: PdfDoc, x: number, y: number, width: number, height: number, radius = 7) {
  doc.roundedRect(x + 2, y + 3, width, height, radius).fill('#E9EEF5');
  doc.roundedRect(x, y, width, height, radius).fillAndStroke(COLORS.white, '#DCE4EE');
}

function measuredTextHeight(
  doc: PdfDoc,
  value: unknown,
  width: number,
  font: string,
  fontSize: number,
  lineGap = 1.2,
) {
  const text = cleanMultiline(value, '');
  if (!text) return 0;
  doc.font(font).fontSize(fontSize);
  return doc.heightOfString(text, { width, lineGap });
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
    .text(value, x + SPACE.md, y + SPACE.md, { width: width - 20, height: 21, ellipsis: '...' });
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.small)
    .text(label, x + SPACE.md, y + 41, { width: width - 20, height: 18, lineGap: 1 });
}

function snapshotInfoItemHeight(doc: PdfDoc, width: number, value: string) {
  const valueHeight = measuredTextHeight(doc, value || '-', Math.max(20, width - 17), FONTS.regular, TYPE.caption, 1);
  return Math.max(39, 12 + valueHeight);
}

function drawSnapshotInfoItem(doc: PdfDoc, x: number, y: number, width: number, label: string, value: string) {
  doc.circle(x + 6, y + 7, 5).fill(COLORS.paleBlue);
  doc.circle(x + 6, y + 7, 1.7).fill(COLORS.blue);
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(label.toUpperCase(), x + 17, y, { width: width - 17, height: 9, lineBreak: false, ellipsis: '...' });
  doc.fillColor(COLORS.text).font(FONTS.regular).fontSize(TYPE.caption)
    .text(cleanMultiline(value, '-'), x + 17, y + 12, { width: width - 17, lineGap: 1 });
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
  options: { height?: number; valueHeight?: number; truncateValue?: boolean; valueFontSize?: number } = {},
) {
  const height = options.height || 54;
  const valueHeight = options.valueHeight || 20;
  const valueFontSize = options.valueFontSize || TYPE.caption;
  drawCard(doc, x, y, width, height, 6);
  doc.rect(x, y, 3, height).fill(accent);
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(label.toUpperCase(), x + SPACE.md, y + 10, { width: width - 20, height: 9, lineBreak: false, ellipsis: '...' });
  const text = options.truncateValue === false ? cleanText(value) : truncate(value, 115);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .fontSize(valueFontSize)
    .text(text, x + SPACE.md, y + 24, { width: width - 20, height: valueHeight, ellipsis: options.truncateValue !== false, lineGap: 1.2 });
}

function decisionFactHeight(doc: PdfDoc, width: number, value: string, valueFontSize = TYPE.caption) {
  const valueHeight = measuredTextHeight(doc, value, width - 20, FONTS.semibold, valueFontSize, 1.2);
  return Math.max(54, 24 + valueHeight + SPACE.md);
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

  let currentY = PAGE.top + 76;
  const reserveSnapshotBlock = (height: number) => {
    if (currentY + height > pageBottom(doc) - 18) {
      addPage(doc);
      doc.rect(PAGE.left, PAGE.top + 2, 72, 4).fill(COLORS.cyan);
      doc.fillColor(COLORS.text).font(FONTS.bold).fontSize(TYPE.h2)
        .text('Executive Snapshot (continued)', PAGE.left, PAGE.top + 16, { width: contentWidth(doc) });
      currentY = PAGE.top + 44;
    }
    const y = currentY;
    currentY += height;
    return y;
  };

  doc.addNamedDestination('executive-snapshot', 'XYZ', PAGE.left, PAGE.top, null);
  doc.rect(PAGE.left, PAGE.top + 2, 72, 4).fill(COLORS.cyan);
  doc.fillColor(COLORS.text).font(FONTS.bold).fontSize(TYPE.h1)
    .text('Executive Snapshot', PAGE.left, PAGE.top + 18, { width: contentWidth(doc) });
  doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.small)
    .text('A concise view of retrieval volume, mapped evidence, and the automated overlap signal.', PAGE.left, PAGE.top + 49, { width: contentWidth(doc) });

  const rationale = firstSentence(report.finalAssessment.summary);
  const verdictLeftWidth = 180;
  const verdictRightX = PAGE.left + 210;
  const verdictRightWidth = contentWidth(doc) - 226;
  const signalHeight = measuredTextHeight(doc, signal, verdictLeftWidth, FONTS.bold, TYPE.h3, 1.2);
  const stageHeight = measuredTextHeight(doc, 'Review stage: preliminary assessment', verdictLeftWidth, FONTS.semibold, TYPE.micro, 1);
  // The two risk lines are shown in the fact cards below; the banner carries the
  // headline rationale so the same sentences are not printed twice back to back.
  const rationaleHeight = measuredTextHeight(doc, rationale, verdictRightWidth, FONTS.regular, TYPE.small, 1.5);
  const verdictHeight = Math.max(86, SPACE.md + 9 + 8 + signalHeight + 8 + stageHeight + SPACE.md, SPACE.md + rationaleHeight + SPACE.md);
  const verdictY = reserveSnapshotBlock(verdictHeight + 12);

  doc.roundedRect(PAGE.left, verdictY, contentWidth(doc), verdictHeight, 7).fillAndStroke(palette.fill, palette.stroke);
  doc.rect(PAGE.left, verdictY, 4, verdictHeight).fill(palette.accent);
  doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .text('AUTOMATED RISK SIGNAL', PAGE.left + SPACE.lg, verdictY + SPACE.md, { width: verdictLeftWidth, lineBreak: false });
  doc.fillColor(palette.text).font(FONTS.bold).fontSize(TYPE.h3)
    .text(signal, PAGE.left + SPACE.lg, verdictY + 29, { width: verdictLeftWidth, lineGap: 1.2 });
  doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(`Review stage: preliminary assessment`, PAGE.left + SPACE.lg, verdictY + 29 + signalHeight + 8, { width: verdictLeftWidth, lineGap: 1 });
  doc.fillColor('#334155').font(FONTS.regular).fontSize(TYPE.small)
    .text(rationale, verdictRightX, verdictY + SPACE.md, {
      width: verdictRightWidth,
      lineGap: 1.5,
    });

  const factGap = SPACE.sm;
  const factWidth = (contentWidth(doc) - factGap * 2) / 3;
  const noveltyFact = `${risk.noveltyRiskLabel} - ${risk.noveltyRiskExplanation}`;
  const combinationFact = `${risk.combinationRiskLabel} - ${risk.combinationRiskExplanation}`;
  const factHeight = Math.max(
    96,
    decisionFactHeight(doc, factWidth, noveltyFact, TYPE.caption),
    decisionFactHeight(doc, factWidth, combinationFact, TYPE.caption),
    decisionFactHeight(doc, factWidth, mainDifferentiator, TYPE.caption),
  );
  const factsY = reserveSnapshotBlock(factHeight + 12);
  drawDecisionFact(doc, PAGE.left, factsY, factWidth, 'Novelty risk', noveltyFact, COLORS.blue, {
    height: factHeight,
    valueHeight: factHeight - 34,
    truncateValue: false,
    valueFontSize: TYPE.caption,
  });
  drawDecisionFact(doc, PAGE.left + factWidth + factGap, factsY, factWidth, 'Combination risk', combinationFact, COLORS.red, {
    height: factHeight,
    valueHeight: factHeight - 34,
    truncateValue: false,
    valueFontSize: TYPE.caption,
  });
  drawDecisionFact(doc, PAGE.left + (factWidth + factGap) * 2, factsY, factWidth, 'Main differentiator', mainDifferentiator, COLORS.success, {
    height: factHeight,
    valueHeight: factHeight - 34,
    truncateValue: false,
    valueFontSize: TYPE.caption,
  });

  const reviewFocusHeight = measuredTextHeight(doc, reviewFocus, contentWidth(doc) - 44, FONTS.medium, TYPE.small, 1.2);
  const focusHeight = Math.max(68, 23 + reviewFocusHeight + SPACE.md);
  const focusY = reserveSnapshotBlock(focusHeight + 14);
  doc.roundedRect(PAGE.left, focusY, contentWidth(doc), focusHeight, 6).fillAndStroke('#F8FAFC', '#CBD5E1');
  doc.circle(PAGE.left + 15, focusY + 17, 4).fill(palette.accent);
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text('ATTORNEY REVIEW FOCUS', PAGE.left + 28, focusY + 9, { width: 145, height: 9, lineBreak: false });
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.small)
    .text(reviewFocus, PAGE.left + 28, focusY + 23, { width: contentWidth(doc) - 44, lineGap: 1.2 });

  const detailGap = SPACE.md;
  const detailWidth = (contentWidth(doc) - detailGap) / 2;
  const strongestPnHeight = strongest ? measuredTextHeight(doc, strongest.publicationNumber, detailWidth - 24, FONTS.bold, TYPE.h3, 1) : 0;
  const strongestTitleHeight = strongest ? measuredTextHeight(doc, strongest.title, detailWidth - 24, FONTS.medium, TYPE.small, 2) : 0;
  const strongestRoleHeight = strongest ? measuredTextHeight(doc, strongest.referenceRole, detailWidth - 36, FONTS.semibold, TYPE.caption, 1) : 0;
  const strongestCardHeight = strongest
    ? Math.max(164, 42 + strongestPnHeight + 6 + strongestTitleHeight + 10 + strongestRoleHeight + 34)
    : 96;
  const takeawayText = `${rationale}\n\nPotential Differentiation Space: ${report.potentialDifferentiationSpace}`;
  const takeawayTextHeight = measuredTextHeight(doc, takeawayText, detailWidth - 24, FONTS.regular, TYPE.small, 2);
  const detailCardHeight = Math.max(164, strongestCardHeight, 44 + takeawayTextHeight + SPACE.md);
  const detailY = reserveSnapshotBlock(detailCardHeight + 12);

  drawCard(doc, PAGE.left, detailY, detailWidth, detailCardHeight);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.body)
    .text('Closest Mapped Citation', PAGE.left + SPACE.md, detailY + SPACE.md, { width: detailWidth - 24 });
  doc.rect(PAGE.left + SPACE.md, detailY + 31, 28, 2).fill(COLORS.blue);
  if (strongest) {
    doc.fillColor(COLORS.blue2).font(FONTS.bold).fontSize(TYPE.h3)
      .text(strongest.publicationNumber, PAGE.left + SPACE.md, detailY + 42, { width: detailWidth - 24, lineGap: 1 });
    doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.small)
      .text(strongest.title, PAGE.left + SPACE.md, detailY + 42 + strongestPnHeight + 6, { width: detailWidth - 24, lineGap: 2 });
    const roleY = detailY + 42 + strongestPnHeight + 6 + strongestTitleHeight + 10;
    const roleHeight = Math.max(21, strongestRoleHeight + 12);
    doc.roundedRect(PAGE.left + SPACE.md, roleY, detailWidth - 24, roleHeight, 5).fillAndStroke(COLORS.paleBlue, '#BFDBFE');
    doc.fillColor(COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.caption)
      .text(strongest.referenceRole, PAGE.left + 18, roleY + 7, { width: detailWidth - 36, lineGap: 1 });
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
    .text(takeawayText, takeawayX + SPACE.md, detailY + 44, {
      width: detailWidth - 24,
      lineGap: 2,
    });

  const infoWidth = (contentWidth(doc) - 24) / 4;
  // Render the corpus as a vertical list rather than a run-on string.
  const corpusParts = cleanText(report.methodology.corpus, '')
    .split(/\s*;\s*/)
    .flatMap(part => part.split(/\s*\+\s*/))
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1));
  const corpusValue = corpusParts.length ? corpusParts.map(part => `-  ${part}`).join('\n') : report.methodology.corpus;
  const infoItems = [
    ['Corpus', corpusValue],
    ['Search method', report.methodology.retrievalMode],
    ['Assessment basis', report.evidenceBasis],
    ['Report type', 'AI-assisted patent intelligence'],
  ];
  const infoHeights = infoItems.map(([_, value]) => snapshotInfoItemHeight(doc, infoWidth - 10, value));
  const methodHeight = Math.max(86, 36 + Math.max(...infoHeights) + SPACE.md);
  const methodY = reserveSnapshotBlock(methodHeight + 16);
  drawCard(doc, PAGE.left, methodY, contentWidth(doc), methodHeight);
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.small)
    .text('Report Basis', PAGE.left + SPACE.md, methodY + SPACE.md, { width: 110 });
  infoItems.forEach(([label, value], index) => {
    const x = PAGE.left + SPACE.md + index * infoWidth;
    drawSnapshotInfoItem(doc, x, methodY + 36, infoWidth - 10, label, value);
  });

  doc.fillColor(COLORS.muted).font(FONTS.regular).fontSize(TYPE.micro)
    .text('Automated mapping should be validated against complete patent records and claims.', PAGE.left, pageBottom(doc) - 14, { width: contentWidth(doc), align: 'center' });
  doc.y = Math.max(currentY, pageBottom(doc));
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
  const height = doc.heightOfString(value, { width: contentWidth(doc), align: 'left', lineGap: 2 });
  ensureSpace(doc, Math.min(height + SPACE.md, doc.page.height - PAGE.top - PAGE.bottom));
  doc.fillColor('#334155')
    .text(value, PAGE.left, doc.y, { width: contentWidth(doc), align: 'left', lineGap: 2 });
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
      align: 'left',
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
    const labelWidth = 92;
    const padding = 7;
    const valueWidths = pair.map(() => cellWidth - labelWidth - padding * 2);
    // Row height accounts for wrapped labels as well as values, so labels such as
    // "Candidate records retrieved/ranked" render in full instead of being clipped.
    doc.font(FONTS.regular).fontSize(TYPE.small);
    const valueHeights = pair.map(([_, value], i) => doc.heightOfString(truncate(value, 240), { width: valueWidths[i], lineGap: 1.5 }) + padding * 2);
    doc.font(FONTS.semibold).fontSize(TYPE.caption);
    const labelHeights = pair.map(([label]) => doc.heightOfString(cleanText(label), { width: labelWidth - padding, lineGap: 1 }) + padding * 2);
    const rowHeight = Math.max(28, ...valueHeights, ...labelHeights);
    ensureSpace(doc, rowHeight + 2);
    const y = doc.y;
    doc.rect(PAGE.left, y, contentWidth(doc), rowHeight).fill(index % 4 === 2 ? COLORS.surface : COLORS.white);
    pair.forEach(([label, value], i) => {
      const x = PAGE.left + i * cellWidth;
      doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.caption)
        .text(cleanText(label), x + padding, y + padding, { width: labelWidth - padding, height: rowHeight - padding * 2, lineGap: 1 });
      doc.fillColor(COLORS.text).font(FONTS.regular).fontSize(TYPE.small)
        .text(truncate(value, 240) || '-', x + labelWidth, y + padding, { width: cellWidth - labelWidth - padding, height: rowHeight - padding * 2, ellipsis: '...', lineGap: 1.5 });
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
  const minRowHeight = opts.header ? 26 : 28;
  const prepared = cells.map(cell => opts.header ? truncate(cell, 120) : cleanText(cell));

  const measureRowHeight = (rowCells: string[], minHeight: number) => {
    doc.font(opts.header ? FONTS.semibold : FONTS.regular).fontSize(fontSize);
    const heights = rowCells.map((cell, index) => cell
      ? doc.heightOfString(cell, { width: widths[index] - padding * 2, lineGap: 1.5 }) + padding * 2
      : 0);
    return Math.max(minHeight, ...heights);
  };

  const drawChunk = (rowCells: string[], rowHeight: number, continuation: boolean) => {
    const y = doc.y;
    let x = PAGE.left;
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    const rowFill = opts.header ? COLORS.tableHeader : (opts.fills?.[0] || COLORS.white);
    doc.rect(PAGE.left, y, totalWidth, rowHeight).fill(rowFill);
    rowCells.forEach((cell, index) => {
      const text = cell || (continuation ? '' : '-');
      const textWidth = widths[index] - padding * 2;
      const align = opts.aligns?.[index] || (opts.header ? 'left' : proseAlign(text));
      const font = opts.header || opts.boldCells?.includes(index) ? FONTS.semibold : FONTS.regular;
      if (text) {
        const textHeight = doc.heightOfString(text, { width: textWidth, align, lineGap: 1.5 });
        const textY = opts.verticalAligns?.[index] === 'center' && !continuation
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
      }
      x += widths[index];
    });
    doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.left + totalWidth, y + rowHeight)
      .lineWidth(opts.header ? 0.8 : 0.4).strokeColor(opts.header ? COLORS.blue2 : COLORS.border).stroke();
    doc.y = y + rowHeight;
  };

  const breakPage = () => {
    addPage(doc);
    if (opts.repeatHeader && !opts.header) {
      drawTableRow(doc, opts.repeatHeader.cells, opts.repeatHeader.widths, { header: true });
    }
  };

  doc.font(opts.header ? FONTS.semibold : FONTS.regular).fontSize(fontSize);
  const lineHeight = doc.heightOfString('Ag', { width: 1000, lineGap: 1.5 });
  const minChunkHeight = padding * 2 + lineHeight * 2;

  let remaining = prepared;
  let continuation = false;
  let guard = 0;
  while (guard++ < 40) {
    const rowHeight = measureRowHeight(remaining, continuation ? Math.ceil(padding * 2 + lineHeight) : minRowHeight);
    const available = pageBottom(doc) - doc.y;
    if (rowHeight + 2 <= available) {
      drawChunk(remaining, rowHeight, continuation);
      return;
    }
    // The row does not fit the remaining space. If there is not enough room for a
    // useful chunk (two text lines), move to the next page; otherwise split the row
    // so the current page is filled instead of being left partially blank.
    if (available < minChunkHeight + 2) {
      breakPage();
      continue;
    }
    doc.font(opts.header ? FONTS.semibold : FONTS.regular).fontSize(fontSize);
    const chunkTextHeight = available - 2 - padding * 2;
    const split = remaining.map((cell, index) => cell
      ? fitTextToHeight(doc, cell, widths[index] - padding * 2, chunkTextHeight, 1.5)
      : (['', ''] as const));
    const heads = split.map(([head]) => head);
    const tails = split.map(([, tail]) => tail);
    if (!heads.some(head => head)) {
      breakPage();
      continue;
    }
    drawChunk(heads, measureRowHeight(heads, Math.ceil(padding * 2 + lineHeight)), continuation);
    if (!tails.some(tail => tail)) return;
    remaining = tails;
    continuation = true;
    breakPage();
  }
}

const REFERENCE_FEATURE_TABLE = {
  paddingX: 7,
  paddingY: 7,
  fontSize: TYPE.caption,
  headerFontSize: TYPE.caption,
  lineGap: 1.35,
  minRowHeight: 50,
  // Height reserved above the disclosure column's text for the status badge row
  // ("Mapping assessment: ..."). Measurement and rendering MUST both include this,
  // otherwise rows measure as fitting but spill their last line into a forced
  // continuation page, leaving the rest of the current page blank.
  statusBadgeHeight: 18,
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
  // Keep each row compact: show a short, feature-specific mapped snippet and the
  // supporting passage — NOT the full abstract (which is already in the citation
  // header). The submitted disclosure is dropped here; it is redundant with the
  // Key Features table (1.3) and the feature name in the first column. Repeating the
  // full abstract per feature is what previously made rows taller than a page and
  // left blank continuation pages.
  const supportingPassage = cleanText(row.evidenceQuote, '');
  const mappedDisclosure = cleanText(row.patentDisclosure, '');
  const mappedSnippet = mappedDisclosure ? truncate(mappedDisclosure, 220) : '';

  return [
    `${cleanText(row.featureNumber)} - ${cleanText(row.userFeature)}`,
    [
      mappedSnippet ? labeledLine('Mapped disclosure', mappedSnippet) : '',
      supportingPassage ? labeledLine('Evidence', truncate(supportingPassage, 220)) : '',
      `Evidence strength: ${cleanText(row.evidenceStrength, 'Weak')} - ${cleanText(row.evidenceStrengthReason, 'Evidence should be confirmed from source records.')}`,
    ].filter(Boolean).join('\n'),
    truncate(cleanText(row.professionalRemark || row.crispRemark, 'No professional review note was mapped for this feature.'), 320),
  ];
}

function referenceFeatureRowHeight(
  doc: PdfDoc,
  cells: string[],
  widths: number[],
  minHeight: number = REFERENCE_FEATURE_TABLE.minRowHeight,
  firstChunk = true,
) {
  doc.font(FONTS.regular).fontSize(REFERENCE_FEATURE_TABLE.fontSize);
  const heights = cells.map((cell, index) => {
    if (!cell) return 0;
    const reservedBadgeHeight = firstChunk && index === 1 ? REFERENCE_FEATURE_TABLE.statusBadgeHeight : 0;
    return doc.heightOfString(cell, {
      width: widths[index] - REFERENCE_FEATURE_TABLE.paddingX * 2,
      align: index === 0 ? 'center' : proseAlign(cell),
      lineGap: REFERENCE_FEATURE_TABLE.lineGap,
    }) + REFERENCE_FEATURE_TABLE.paddingY * 2 + reservedBadgeHeight;
  });
  return Math.max(minHeight, ...heights);
}

function splitReferenceFeatureCellsToHeight(doc: PdfDoc, cells: string[], widths: number[], rowHeight: number, firstChunk: boolean) {
  doc.font(FONTS.regular).fontSize(REFERENCE_FEATURE_TABLE.fontSize);
  return cells.map((cell, index) => {
    if (!cell) return ['', ''] as const;
    const reservedBadgeHeight = firstChunk && index === 1 ? REFERENCE_FEATURE_TABLE.statusBadgeHeight : 0;
    const availableTextHeight = Math.max(12, rowHeight - REFERENCE_FEATURE_TABLE.paddingY * 2 - reservedBadgeHeight);
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

function referenceRowStatus(row: AttorneyReportFeatureRow) {
  if (row.status === 'Present' || row.status === 'Partial' || row.status === 'Absent') return row.status;
  return 'Review';
}

function referenceStatusParts(row: AttorneyReportFeatureRow) {
  const status = referenceRowStatus(row);
  const code = cleanText(row.publicMappingCode, status === 'Present' ? 'D' : status === 'Partial' ? 'P' : status === 'Absent' ? 'N' : 'R');
  const label = cleanText(row.statusLabel || row.publicMappingStatus, status === 'Present' ? 'Directly Mapped' : status === 'Partial' ? 'Partially Mapped' : status === 'Absent' ? 'Not Found' : 'Requires Full-Text Review');
  return { code, label };
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
  row: AttorneyReportFeatureRow,
  cells: string[],
  widths: number[],
  rowHeight: number,
  rowIndex: number,
  continuation: boolean,
) {
  const y = doc.y;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const rowStatus = referenceRowStatus(row);
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

    if (index === 1 && !continuation) {
      const { code, label } = referenceStatusParts(row);
      const badgeWidth = Math.min(36, Math.max(24, doc.widthOfString(code) + 14));
      doc.roundedRect(textX, textY, badgeWidth, 14, 4).fillAndStroke(palette.fill, palette.stroke);
      doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.micro)
        .text(code, textX + 2, textY + 4, {
          width: badgeWidth - 4,
          height: 8,
          align: 'center',
          lineBreak: false,
        });
      doc.fillColor(palette.text).font(FONTS.semibold).fontSize(TYPE.micro)
        .text(`Mapping assessment: ${label}`, textX + badgeWidth + 5, textY + 4, {
          width: Math.max(20, textWidth - badgeWidth - 5),
          height: 8,
          lineBreak: false,
          ellipsis: '...',
        });
    }

    const renderedText = text;
    const renderedTextY = index === 1 && !continuation ? textY + REFERENCE_FEATURE_TABLE.statusBadgeHeight : textY;
    const renderedTextHeight = index === 1 && !continuation ? Math.max(8, textHeight - REFERENCE_FEATURE_TABLE.statusBadgeHeight) : textHeight;
    const textColor = index === 0 ? COLORS.blue2 : COLORS.text;
    doc.fillColor(textColor)
      .font(index === 0 ? FONTS.semibold : FONTS.regular)
      .fontSize(REFERENCE_FEATURE_TABLE.fontSize)
      .text(renderedText, textX, renderedTextY, {
        width: textWidth,
        height: renderedTextHeight,
        align: index === 0 ? 'left' : proseAlign(renderedText),
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
  let guard = 0;

  while (hasRemainingTableText(remaining) && guard++ < 40) {
    // Never start (or continue) a feature row in a sliver of space at the page
    // bottom: require room for the status badge plus a few readable lines,
    // otherwise begin on a fresh page.
    const minStart = continuation ? 44 : 96;
    if (pageBottom(doc) - doc.y < minStart) {
      addPage(doc);
      drawReferenceFeatureTableHeader(doc, headers, widths);
    }

    const available = pageBottom(doc) - doc.y;
    const minHeight = continuation ? 30 : REFERENCE_FEATURE_TABLE.minRowHeight;
    const fullHeight = referenceFeatureRowHeight(doc, remaining, widths, minHeight, !continuation);
    const rowHeight = fullHeight <= available ? fullHeight : Math.max(minHeight, available);
    const split = splitReferenceFeatureCellsToHeight(doc, remaining, widths, rowHeight, !continuation);
    const chunks = split.map(([chunk]) => chunk);
    const rest = split.map(([, next]) => next);

    if (!chunks.some(chunk => chunk)) {
      // Nothing fit in the available space (orphan control refused a fragment):
      // retry on a fresh page rather than drawing an empty row.
      addPage(doc);
      drawReferenceFeatureTableHeader(doc, headers, widths);
      continue;
    }

    if (continuation) {
      if (!chunks[0]) chunks[0] = `${cleanText(row.featureNumber)} cont.`;
    }

    drawReferenceFeatureRowChunk(doc, row, chunks, widths, rowHeight, rowIndex, continuation);
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
      ellipsis: '...',
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
  const comparisons = report.mainComparisons || report.comparisons;
  if (!features.length || !comparisons.length) {
    doc.font(FONTS.regular).fontSize(TYPE.small).fillColor(COLORS.muted).text('Feature matrix will appear after citation mapping.', PAGE.left, doc.y, { width: contentWidth(doc) });
    return;
  }

  const closestPn = report.publicClosestCitation?.publicationNumber;
  const strongestReference = comparisons.find(item => item.publicationNumber === closestPn)
    || comparisons.reduce((best, item) => (
      Number(item.coverage?.score || 0) > Number(best?.coverage?.score || 0) ? item : best
    ), comparisons[0]);
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
    comparisons.forEach((item, itemIndex) => {
      const statusRows = featureChunk.map((_, index) => item.rows[start + index]);
      const needed = itemIndex === comparisons.length - 1 ? 59 : 32;
      if (ensureSpace(doc, needed)) drawFeatureMatrixHeader(doc, headers, widths);
      drawFeatureMatrixRow(
        doc,
        item.publicationNumber,
        patentDestination(itemIndex),
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
  destination: string,
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
      const linkX = x + 4;
      const linkY = y + 5;
      const linkWidth = width - 8;
      const linkHeight = rowHeight - 10;
      doc.fillColor(strongest ? COLORS.blue2 : '#334155')
        .font(strongest ? FONTS.semibold : FONTS.regular)
        .fontSize(TYPE.caption)
        .text(publicationNumber, x + 8, y + 10, {
          width: width - 16,
          height: 10,
          lineBreak: false,
          ellipsis: '...',
        });
      doc.goTo(linkX, linkY, linkWidth, linkHeight, destination, { Border: [0, 0, 0] });
      doc.moveTo(x + 8, y + 22).lineTo(x + Math.min(width - 8, 8 + doc.widthOfString(publicationNumber)), y + 22)
        .lineWidth(0.25).strokeColor(strongest ? COLORS.blue2 : COLORS.border).stroke();
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
      ? 'Medium'
      : /standard/i.test(normalized)
        ? 'Standard'
        : /low/i.test(normalized)
          ? 'Low'
          : 'Review';
  const color = compact === 'High'
    ? COLORS.red
    : compact === 'Medium'
      ? COLORS.warning
      : compact === 'Low' || compact === 'Standard'
        ? COLORS.muted
        : COLORS.blue;
  doc.circle(x + 9, y + height / 2, 2.5).fill(color);
  doc.fillColor(COLORS.text).font(FONTS.medium).fontSize(TYPE.micro)
    .text(compact, x + 15, y + 11, { width: width - 19, height: 9, lineBreak: false, ellipsis: '...' });
}

function drawFeatureMatrixLegend(doc: PdfDoc) {
  ensureSpace(doc, 27);
  const y = doc.y + 9;
  const items = [
    { label: 'D Directly mapped', fill: STATUS.Present.fill, stroke: STATUS.Present.stroke },
    { label: 'P Partially mapped', fill: STATUS.Partial.fill, stroke: STATUS.Partial.stroke },
    { label: 'N Not found', fill: STATUS.Absent.fill, stroke: STATUS.Absent.stroke },
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
    .text(insight, PAGE.left + 70, y + 8, { width: contentWidth(doc) - 82, height: 29, lineGap: 1.2, ellipsis: '...' });
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
    .text(label, x + 13, y + 5, { width: width - 17, height: 8, lineBreak: false, ellipsis: '...' });
  return width;
}

function drawCitationCardHeader(
  doc: PdfDoc,
  item: ReturnType<typeof buildNoveltyAttorneyReportModel>['comparisons'][number],
  index: number,
  total: number,
  destination?: string,
) {
  const x = PAGE.left;
  const width = contentWidth(doc);
  doc.font(FONTS.semibold).fontSize(TYPE.small);
  const titleHeight = doc.heightOfString(cleanText(item.title), { width: width - 28, lineGap: 1.5 });
  const height = Math.max(184, 155 + titleHeight);
  ensureSpace(doc, height + SPACE.lg);
  if (destination) {
    doc.addNamedDestination(destination, 'XYZ', PAGE.left, Math.max(PAGE.top, doc.y - 8), null);
  }
  const y = doc.y;
  drawCard(doc, x, y, width, height, 7);
  const riskPalette = verdictPalette(item.noveltyThreat || item.overlapRiskLevel);
  doc.rect(x, y, 5, height).fill(riskPalette.accent);

  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(`REFERENCE ${index + 1} OF ${total}`, x + 18, y + 13, { width: 110, height: 9, lineBreak: false });
  doc.roundedRect(x + width - 252, y + 9, 122, 23, 5).fillAndStroke(riskPalette.fill, riskPalette.stroke);
  doc.fillColor(riskPalette.text).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(truncate(item.noveltyThreat || item.overlapRiskLevel, 34), x + width - 244, y + 16, { width: 106, height: 8, align: 'center', lineBreak: false, ellipsis: '...' });
  doc.roundedRect(x + width - 124, y + 9, 110, 23, 5).fillAndStroke(COLORS.paleBlue, '#BFDBFE');
  doc.fillColor(COLORS.blue2).font(FONTS.semibold).fontSize(TYPE.micro)
    .text(item.reviewPriority, x + width - 112, y + 16, { width: 86, height: 8, align: 'center', lineBreak: false, ellipsis: '...' });

  doc.fillColor(COLORS.blue2).font(FONTS.bold).fontSize(TYPE.h3)
    .text(`${cleanText(item.citationNo, `D${index + 1}`)}  ${item.publicationNumber}`, x + 18, y + 38, { width: width - 36, height: 16, lineBreak: false, ellipsis: '...' });
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.small)
    .text(cleanText(item.title), x + 18, y + 59, { width: width - 36, lineGap: 1.5 });

  const separatorY = y + 67 + titleHeight;
  doc.moveTo(x + 18, separatorY).lineTo(x + width - 18, separatorY).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
  const meta = [
    ['Reference role', item.referenceRole],
    ['Publication / priority', `${item.publicationDate} / ${item.priorityDate}`],
    ['Assignee', item.assignees],
    ['Publication authority', item.publicationJurisdiction || 'Not available'],
  ];
  const metaY = separatorY + 10;
  const cellWidth = (width - 36) / 4;
  doc.roundedRect(x + 18, metaY - 3, width - 36, 47, 5).fill('#F8FAFC');
  meta.forEach(([label, value], metaIndex) => {
    const metaX = x + 28 + metaIndex * cellWidth;
    doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
      .text(label.toUpperCase(), metaX, metaY + 4, { width: cellWidth - 18, height: 9, lineBreak: false, ellipsis: '...' });
    doc.fillColor(COLORS.text).font(FONTS.regular).fontSize(TYPE.caption)
      .text(truncate(value, 82), metaX, metaY + 17, { width: cellWidth - 18, height: 20, ellipsis: '...', lineGap: 1 });
  });

  const evidenceY = metaY + 57;
  doc.fillColor(COLORS.muted).font(FONTS.semibold).fontSize(TYPE.micro)
    .text('REVIEW SIGNAL', x + 18, evidenceY + 4, { width: 72, height: 8, lineBreak: false });
  doc.fillColor(COLORS.text).font(FONTS.semibold).fontSize(TYPE.caption)
    .text(`${item.rows.filter(row => row.status === 'Present').length} directly mapped / ${item.rows.filter(row => row.status === 'Partial').length} partially mapped / ${item.rows.filter(row => row.status === 'Unknown').length} full-text review`, x + 94, evidenceY + 3, { width: 360, height: 10, lineBreak: false, ellipsis: '...' });
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
  let restoreAccent: (() => void) | null = null;
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

    // Tenant firm branding (co-brand cover / prepared-by / accent). Any tenant member may
    // read it; loadFirmBranding is guarded and returns null if unavailable.
    const firm = await loadFirmBranding(payload.tenant_id);

    const enrichedSearchRun = await hydrateNoveltyReportPatentMetadata(searchRun);
    const report = buildNoveltyAttorneyReportModel(enrichedSearchRun, firm);
    // Apply the firm accent for this request's (synchronous) drawing pass; restored in finally.
    restoreAccent = applyAccentOverrides(firm?.accentColor);
    const detailedComparisons = Array.isArray(report.mainComparisons) ? report.mainComparisons : report.comparisons;
    const patentComparisons = detailedComparisons.filter(item => item.referenceType !== 'paper');
    const paperComparisons = detailedComparisons.filter(item => item.referenceType === 'paper');
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
      bufferPages: true,
      autoFirstPage: true,
      info: { Title: report.reportTitle, Author: report.preparedBy, Subject: report.inventionTitle },
    });
    registerReportFonts(doc);
    const sectionPages: Array<{ number: string; title: string; page: number; destination: string; level: 1 | 2 | 3 }> = [];

    drawCover(doc, report);

    // Reserve the exact number of TOC pages up front (the entry sequence is
    // deterministic), so the TOC can never overflow onto pages appended at the end
    // of the document.
    const tocPlan = tocLayout(doc, plannedTocLevels(
      patentComparisons.length,
      paperComparisons.length,
      (report.potentialCombinations || []).length > 0,
      (report.appendixMappedComparisons || []).length > 0,
    ));
    const tocPageIndexes: number[] = [];
    for (let i = 0; i < tocPlan.pageCount; i++) {
      addPage(doc);
      tocPageIndexes.push(doc.bufferedPageRange().count - 1);
    }

    // PDF sidebar bookmarks mirroring the TOC hierarchy (best-effort, never fatal).
    const outlineRoot = (doc as any).outline;
    let outlineL1: any = null;
    let outlineL2: any = null;
    const addOutline = (level: 1 | 2 | 3, title: string) => {
      try {
        if (!outlineRoot) return;
        if (level === 1) { outlineL1 = outlineRoot.addItem(title); outlineL2 = null; }
        else if (level === 2) { outlineL2 = (outlineL1 || outlineRoot).addItem(title); }
        else { (outlineL2 || outlineL1 || outlineRoot).addItem(title); }
      } catch { /* bookmarks are cosmetic */ }
    };

    addPage(doc);
    addOutline(1, 'Executive Snapshot');
    sectionPages.push({ number: '', title: 'Executive Snapshot', page: doc.bufferedPageRange().count, destination: 'executive-snapshot', level: 1 });
    drawExecutiveSnapshot(doc, report);

    addPage(doc);
    const startGroup = (number: string, title: string) => {
      ensureSpace(doc, 60);
      const destination = `section-${sectionPages.length + 1}`;
      doc.addNamedDestination(destination, 'XYZ', PAGE.left, Math.max(PAGE.top, doc.y - 8), null);
      addOutline(1, `${number} ${title}`.trim());
      sectionPages.push({ number, title, page: doc.bufferedPageRange().count, destination, level: 1 });
      drawGroupHeading(doc, number, title);
    };
    const startSection = (number: string, title: string, level: 1 | 2 = 1) => {
      ensureSpace(doc, 54);
      const destination = `section-${sectionPages.length + 1}`;
      doc.addNamedDestination(destination, 'XYZ', PAGE.left, Math.max(PAGE.top, doc.y - 8), null);
      addOutline(level, `${number} ${title}`.trim());
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
      ['Anticipation risk', report.riskAssessment.noveltyRisk],
      ['Combination / inventive-step risk', report.riskAssessment.combinationRisk],
      ['Highest single-reference core coverage', `${report.riskAssessment.highestSingleReferenceCoreCoveragePercent ?? Math.round((report.riskAssessment.strongestSingleReferenceCoreCoverage || 0) * 100)}%`],
      ['Distributed core-feature coverage', `${report.riskAssessment.distributedCoreCoveragePercent ?? Math.round((report.riskAssessment.distributedCoreCoverage || 0) * 100)}%`],
      ['Assessment confidence', report.riskAssessment.assessmentConfidence || report.finalAssessment.confidence || 'Low'],
      ['Coverage caution', 'Distributed coverage cannot by itself establish anticipation by one reference.'],
      ['Search Query', report.searchQuery],
      ['Analysis Type', report.evidenceBasis],
    ]);
    drawMetadataGrid(doc, report.countLabels.map(item => [item.label, String(item.value)]));

    startSection('1.2', 'Search Scope and Methodology', 2);
    drawMetadataGrid(doc, [
      ['Patent nationality coverage', report.methodology.corpus],
      ['Search / mapping mode', report.methodology.retrievalMode],
      ['Assessment scope', report.methodology.searchedEvidence],
      ['Review status', report.methodology.preliminaryStatus],
    ]);
    drawFlowBulletList(doc, 'Techniques Used', report.methodology.techniques);

    startSection('1.3', 'Key Features', 2);
    drawParagraph(doc, 'The key features are extracted from the submitted disclosure and classified to separate core mechanisms, implementation details, novelty-candidate features, and generic features that should not be relied on alone.');
    const keyFeatureHeader = ['Key Feature', 'Importance', 'Type', 'Feature Description'];
    const keyFeatureWidths = [58, 122, 92, contentWidth(doc) - 272];
    drawTableRow(doc, keyFeatureHeader, keyFeatureWidths, { header: true });
    report.featureSummaries.forEach((feature, index) => {
      drawTableRow(doc, [
        feature.featureNumber,
        feature.importanceLabel,
        feature.typeLabel,
        `${feature.feature}${feature.genericWarning ? `\n${feature.genericWarning}` : ''}`,
      ], keyFeatureWidths, {
        fills: index % 2 ? [COLORS.tableAlt, COLORS.tableAlt, COLORS.tableAlt, COLORS.tableAlt] : undefined,
        repeatHeader: { cells: keyFeatureHeader, widths: keyFeatureWidths },
      });
    });
    drawFlowTextBlock(doc, 'Generic Feature Risk', report.genericFeatureRisk.summary);

    startSection('1.4', 'Scoring Legend', 2);
    drawTableRow(doc, ['Score / Status', 'Meaning'], [128, contentWidth(doc) - 128], { header: true });
    report.scoringLegend.forEach((item, index) => {
      drawTableRow(doc, [item.label, item.meaning], [128, contentWidth(doc) - 128], { fills: index % 2 ? [COLORS.tableAlt, COLORS.tableAlt] : undefined });
    });

    startSection('1.5', 'Summary of Relevant Citations', 2);
    drawCitationTable(doc, report.mainCitations || report.citations);

    startSection('1.6', 'Component / Feature-Level Prior Art', 2);
    drawParagraph(
      doc,
      'These citations disclose one or more relevant invention features, subsystems, materials, process steps, or implementation details, but are not treated as full invention-level matches by themselves.'
    );
    const mainComponents = (report.mainCitations || report.citations).filter(item => item.matchCategory === 'component');
    if (mainComponents.length > 0) {
      drawCitationTable(doc, mainComponents);
    } else {
      drawParagraph(doc, 'No separate component / feature-level references were classified in this run.');
    }

    startSection('1.7', 'Key Feature Analysis Matrix', 2);
    drawFeatureStatusMatrix(doc, report);

    if ((report.potentialCombinations || []).length > 0) {
      startSection('1.8', 'Potential Inventive-Step Combinations', 2);
      drawParagraph(doc, 'These pairs support inventive-step review only. They are not single-reference novelty or anticipation conclusions.');
      (report.potentialCombinations || []).forEach((pair, index) => {
        drawFlowTextBlock(doc, `Combination ${index + 1}: ${pair.referenceA.publicationNumber} + ${pair.referenceB.publicationNumber}`, [
          `Reference A teaches: ${pair.referenceA.teaches.join('; ') || '-'}`,
          `Reference B adds: ${pair.referenceB.adds.join('; ') || '-'}`,
          `Combined important-feature coverage: ${pair.combinedImportantFeatureCoverage}%`,
          `Apparent motivation: ${pair.apparentMotivation}`,
          `Still missing: ${pair.missingImportantFeatures.join('; ') || pair.stillMissingRelationship}`,
        ].join('\n'));
      });
    }

    const drawReferenceDetails = (
      items: typeof report.comparisons,
      sectionNumber: string,
      sectionTitle: string,
    ) => {
      startSection(sectionNumber, sectionTitle, 2);
      if (!items.length) {
        drawParagraph(doc, `No ${sectionTitle.toLowerCase()} were selected for detailed feature mapping in this run.`);
        return;
      }
      items.forEach((item, localIndex) => {
        // Compare canonically: a raw-string miss would resolve to -1 and silently
        // link the card's named destination to the first card in the report.
        const itemKey = canonicalReportPublicationNumber(item.publicationNumber);
        const itemIndex = Math.max(0, detailedComparisons.findIndex(
          comparison => canonicalReportPublicationNumber(comparison.publicationNumber) === itemKey
        ));
        const destination = patentDestination(itemIndex);
        drawCitationCardHeader(doc, item, itemIndex, detailedComparisons.length, destination);
        const tocTitle = item.referenceType === 'paper'
          ? truncate(item.title, 100)
          : `${cleanText(item.publicationNumber)} - ${truncate(item.title, 74)}`;
        addOutline(3, `${sectionNumber}.${localIndex + 1} ${tocTitle}`);
        sectionPages.push({
          number: `${sectionNumber}.${localIndex + 1}`,
          title: tocTitle,
          page: doc.bufferedPageRange().count,
          destination,
          level: 3,
        });
        drawMetadataGrid(doc, item.referenceType === 'paper' ? [
          ['Reference Type', 'Scholarly paper'],
          ['Authors', item.authors],
          ['Year / Venue', `${item.publicationDate} / ${item.venue}`],
          ['DOI', item.doi],
          ['Citation Count', item.citationCount === null ? '-' : String(item.citationCount)],
          ['Reference Role', item.referenceRole],
          ['Academic Source', item.sourceProviders],
          // Only show a link row when there is a usable link.
          ...(cleanText(item.link, '') ? [['Record URL', item.link] as [string, string]] : []),
        ] : [
          ['Application No.', item.applicationNumber],
          ['Filing Date', item.filingDate],
          ['Priority Date', item.priorityDate],
          ['Reference Role', item.referenceRole],
          ['Review Priority', item.reviewPriority],
          ['Publication Authority', item.publicationJurisdiction || 'Not available'],
          ['Search Authority Scope', item.searchAuthorityScope || 'Worldwide'],
          ['Source Corpus / Provider', item.sourceCorpus || item.sourceProviders || 'Not available'],
          ['Filing Country / Office', item.filingCountry || 'Not available'],
          ['Target Legal Jurisdiction', item.targetLegalJurisdiction || report.jurisdiction],
          ['Inventor(s)', item.inventors],
          ['CPC / IPC', `${item.cpcCodes} / ${item.ipcCodes}`],
          // Patent links are omitted (see report builder); no Source row when blank.
          ...(cleanText(item.link, '') ? [['Source', item.link] as [string, string]] : []),
        ]);
        doc.y += SPACE.sm;
        drawFlowingLabeledText(doc, item.referenceType === 'paper' ? 'Paper Abstract' : 'Patent Abstract', item.abstract);
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
        keyValueRow(doc, item.referenceType === 'paper' ? 'Paper Feature Remarks' : 'Reference Summary', item.summary);
        keyValueRow(doc, 'Claim Impact Summary', item.claimImpactSummary);
        doc.y += SPACE.md;
      });
    };

    startGroup('2', 'Citation Analysis');
    drawReferenceDetails(patentComparisons, '2.1', 'Relevant Patent Citations');
    if (paperComparisons.length > 0) {
      drawReferenceDetails(paperComparisons, '2.2', 'Relevant Scholarly Publications');
    }

    if ((report.appendixMappedComparisons || []).length > 0) {
      startSection('A', 'Appendix A: Remaining Mapped References', 1);
      drawParagraph(doc, 'These references were analyzed feature by feature and contributed to the assessment, but are summarized here because higher-priority mapped references are presented in detail.');
      drawCitationTable(doc, report.appendixMappedComparisons || []);
    }

    const otherCitationSection = paperComparisons.length > 0 ? '2.3' : '2.2';
    startSection(otherCitationSection, 'List of Other Shortlisted Citations (Appendix B: Shortlisted but Unmapped)', 2);
    const omittedEligibleCount = Number(report.otherShortlistedOmittedCount || 0);
    const rejectedCount = Number(report.otherShortlistedRejectedCount || 0);
    const ungatedCount = Number(report.otherShortlistedUngatedCount || 0);
    if (report.otherShortlistedCitations.length > 0) {
      drawParagraph(doc, 'The citations below explicitly passed the AI relevance gate but were not selected for detailed feature mapping because the report focuses on the most relevant mapped references.');
      drawCitationTable(doc, report.otherShortlistedCitations);
      if (omittedEligibleCount > 0) {
        doc.y += SPACE.sm;
        drawParagraph(doc, `${omittedEligibleCount} additional gate-approved unmapped citation${omittedEligibleCount === 1 ? ' was' : 's were'} omitted from this appendix to keep the report readable.`);
      }
    } else {
      drawParagraph(doc, 'No explicitly gate-approved unmapped citations remained after the detailed mapped references were selected.');
    }
    if (rejectedCount > 0 || ungatedCount > 0) {
      doc.y += SPACE.sm;
      drawParagraph(doc, `${rejectedCount} explicitly rejected and ${ungatedCount} ungated retrieval candidate${rejectedCount + ungatedCount === 1 ? ' was' : 's were'} excluded from the supplementary-reference list.`);
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
      ['Anticipation risk', `${risk.noveltyRisk} - ${risk.noveltyRiskExplanation}`],
      ['Combination / inventive-step risk', `${risk.combinationRisk} - ${risk.combinationRiskExplanation}`],
      ['Highest single-reference core coverage', `${risk.highestSingleReferenceCoreCoveragePercent ?? Math.round((risk.strongestSingleReferenceCoreCoverage || 0) * 100)}%`],
      ['Distributed core-feature coverage', `${risk.distributedCoreCoveragePercent ?? Math.round((risk.distributedCoreCoverage || 0) * 100)}% (cannot by itself establish anticipation)`],
      ['Assessment confidence', risk.assessmentConfidence || report.finalAssessment.confidence || 'Low'],
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
    drawParagraph(doc, report.limitations || 'This preliminary assessment is limited to abstract-level patent records and bibliographic metadata. Validate every mapping against the full patent documents, claims, drawings, family/legal status, and prosecution history before drawing any conclusion.');
    if (Array.isArray(report.nextSteps) && report.nextSteps.length > 0) {
      drawFlowBulletList(doc, 'What To Do Next', report.nextSteps);
    }

    fillTableOfContents(doc, sectionPages, tocPageIndexes);

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
  } finally {
    // Always restore the shared COLORS palette, even if drawing threw.
    restoreAccent?.();
  }
}
