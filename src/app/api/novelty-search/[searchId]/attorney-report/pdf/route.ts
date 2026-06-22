import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildNoveltyAttorneyReportModel, type AttorneyReportCitation, type AttorneyReportFeatureRow } from '@/lib/novelty-attorney-report';
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata';

export const runtime = 'nodejs';

const PDFDocument = require('pdfkit/js/pdfkit.standalone');

type PdfDoc = InstanceType<typeof PDFDocument>;

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
};

const PAGE = {
  left: 50,
  right: 50,
  top: 58,
  bottom: 58,
};

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
  if (status === 'Present') return COLORS.red;
  if (status === 'Partial') return COLORS.amber;
  if (status === 'Absent') return COLORS.green;
  return COLORS.slate;
}

function featureCoverageText(row: AttorneyReportFeatureRow) {
  if (typeof row.extentScore !== 'number') return '';
  return `Feature Coverage: ${Math.round(row.extentScore * 100)}%`;
}

function addPage(doc: PdfDoc) {
  doc.addPage();
  doc.y = PAGE.top;
}

function ensureSpace(doc: PdfDoc, needed: number) {
  if (doc.y + needed > doc.page.height - PAGE.bottom) addPage(doc);
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
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(reportNumber, PAGE.left, headerY, { width: 210, height: 10, lineBreak: false })
      .text(truncate(title, 86), width - PAGE.right - 240, headerY, { width: 240, height: 10, align: 'right', lineBreak: false });
    doc.moveTo(PAGE.left, 41).lineTo(width - PAGE.right, 41).lineWidth(0.6).strokeColor(COLORS.border).stroke();
    doc.moveTo(PAGE.left, height - 46).lineTo(width - PAGE.right, height - 46).lineWidth(0.6).strokeColor(COLORS.border).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
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
  doc.rect(0, height - 190, width, 190).fill(COLORS.navy2);

  const nodes = [
    [70, 132], [178, 78], [302, 126], [438, 72], [530, 142],
    [112, 642], [230, 706], [362, 626], [496, 710],
  ] as Array<[number, number]>;
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [1, 7], [2, 6]] as Array<[number, number]>;
  edges.forEach(([a, b]) => {
    const start = nodes[a];
    const end = nodes[b];
    doc.moveTo(start[0], start[1]).lineTo(end[0], end[1]).lineWidth(0.8).strokeColor('#1E40AF').stroke();
  });
  nodes.forEach(([x, y], index) => {
    doc.circle(x, y, index % 3 === 0 ? 5 : 3.5).fill(index % 2 === 0 ? COLORS.cyan : COLORS.blue);
  });

  for (let i = 0; i < 7; i += 1) {
    const x = 355 + i * 23;
    const y = 238 + i * 29;
    doc.roundedRect(x, y, 128, 18, 9).lineWidth(0.9).strokeColor(i % 2 === 0 ? COLORS.blue : COLORS.cyan).stroke();
  }

  doc.rect(PAGE.left, 76, 82, 5).fill(COLORS.cyan);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(32).text('PatentNest.ai', PAGE.left, 96, { width: 360 });
  doc.fillColor('#BFDBFE').font('Helvetica').fontSize(11).text('Patent Intelligence Report', PAGE.left + 2, 139, { width: 300 });

  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(30)
    .text(report.reportTitle, PAGE.left, 255, { width: 410, lineGap: 2 });
  doc.moveDown(0.8);
  doc.fillColor('#DBEAFE').font('Helvetica').fontSize(15)
    .text(truncate(report.inventionTitle, 180), { width: 420, lineGap: 3 });

  const cardY = 492;
  doc.roundedRect(PAGE.left, cardY, width - PAGE.left - PAGE.right, 126, 10).fill('#111C36');
  const meta = [
    ['Report No.', report.reportNumber],
    ['Generated', report.generatedDate],
    ['Jurisdiction', report.jurisdiction],
    ['Source Mode', report.methodology.corpus],
    ['Prepared By', report.preparedBy],
  ];
  let y = cardY + 20;
  meta.forEach(([label, value]) => {
    doc.fillColor('#93C5FD').font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), PAGE.left + 22, y, { width: 110 });
    doc.fillColor(COLORS.white).font('Helvetica').fontSize(9).text(truncate(value, 96), PAGE.left + 136, y, { width: 300 });
    y += 19;
  });

  doc.fillColor('#BFDBFE').font('Helvetica').fontSize(8)
    .text(report.confidentiality, PAGE.left, height - 74, { width: contentWidth(doc), align: 'center' });
}

function drawSectionHeading(doc: PdfDoc, title: string) {
  ensureSpace(doc, 48);
  doc.moveDown(0.45);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text).text(title, PAGE.left, doc.y, { width: contentWidth(doc) });
  doc.moveTo(PAGE.left, doc.y + 5).lineTo(doc.page.width - PAGE.right, doc.y + 5).lineWidth(1.2).strokeColor(COLORS.blue).stroke();
  doc.moveDown(0.65);
}

function drawParagraph(doc: PdfDoc, text: string) {
  ensureSpace(doc, 44);
  doc.font('Helvetica').fontSize(8.7).fillColor('#334155')
    .text(cleanText(text), PAGE.left, doc.y, { width: contentWidth(doc), align: 'justify', lineGap: 1.3 });
  doc.moveDown(0.7);
}

function keyValueRow(doc: PdfDoc, label: string, value: string) {
  const text = truncate(value, 700);
  doc.font('Helvetica').fontSize(7.5);
  const rowHeight = Math.max(21, doc.heightOfString(text || '-', { width: contentWidth(doc) - 154 }) + 10);
  ensureSpace(doc, rowHeight + 2);
  const y = doc.y;
  doc.rect(PAGE.left, y, 142, rowHeight).fillAndStroke(COLORS.paleBlue, COLORS.border);
  doc.rect(PAGE.left + 142, y, contentWidth(doc) - 142, rowHeight).fillAndStroke(COLORS.white, COLORS.border);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(7.6).text(label, PAGE.left + 7, y + 7, { width: 128 });
  doc.fillColor(COLORS.text).font('Helvetica').fontSize(7.6).text(text || '-', PAGE.left + 150, y + 7, { width: contentWidth(doc) - 158 });
  doc.y = y + rowHeight;
}

function drawFlowLabel(doc: PdfDoc, label: string) {
  ensureSpace(doc, 34);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, contentWidth(doc), 20, 3).fill(COLORS.paleBlue);
  doc.fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(label, PAGE.left + 8, y + 6, { width: contentWidth(doc) - 16, lineBreak: false });
  doc.y = y + 25;
}

function drawFlowTextBlock(doc: PdfDoc, label: string, value: string) {
  const text = cleanText(value, '-');
  drawFlowLabel(doc, label);
  doc.fillColor(COLORS.text)
    .font('Helvetica')
    .fontSize(8.4)
    .text(text, PAGE.left + 8, doc.y, {
      width: contentWidth(doc) - 16,
      align: 'left',
      lineGap: 1.4,
    });
  doc.moveDown(0.85);
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
      .font('Helvetica')
      .fontSize(8.4)
      .text(item, PAGE.left + 22, y, {
        width: contentWidth(doc) - 30,
        align: 'left',
        lineGap: 1.4,
      });
    doc.moveDown(0.45);
  });
  doc.moveDown(0.45);
}

function drawMetadataGrid(doc: PdfDoc, items: Array<[string, string]>) {
  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2);
    const cellWidth = contentWidth(doc) / 2;
    const labelWidth = 78;
    const valueWidths = pair.map(() => cellWidth - labelWidth - 12);
    doc.font('Helvetica').fontSize(7.3);
    const rowHeight = Math.max(22, ...pair.map(([_, value], i) => doc.heightOfString(truncate(value, 240), { width: valueWidths[i] }) + 10));
    ensureSpace(doc, rowHeight + 2);
    const y = doc.y;
    pair.forEach(([label, value], i) => {
      const x = PAGE.left + i * cellWidth;
      doc.rect(x, y, labelWidth, rowHeight).fillAndStroke(COLORS.paleBlue, COLORS.border);
      doc.rect(x + labelWidth, y, cellWidth - labelWidth, rowHeight).fillAndStroke(COLORS.white, COLORS.border);
      doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(7.2).text(label, x + 6, y + 7, { width: labelWidth - 10 });
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(7.2).text(truncate(value, 240) || '-', x + labelWidth + 6, y + 7, { width: cellWidth - labelWidth - 12 });
    });
    if (pair.length === 1) {
      const x = PAGE.left + cellWidth;
      doc.rect(x, y, cellWidth, rowHeight).fillAndStroke(COLORS.white, COLORS.border);
    }
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
    maxHeight?: number;
    fontSize?: number;
    textColors?: string[];
    aligns?: Array<'left' | 'center' | 'right'>;
    verticalAligns?: Array<'top' | 'center'>;
    boldCells?: number[];
  } = {}
) {
  const padding = 4.5;
  const fontSize = opts.fontSize || (opts.header ? 7.5 : 7);
  const prepared = cells.map(cell => truncate(cell, opts.header ? 120 : 720));
  doc.font(opts.header ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  const heights = prepared.map((cell, index) => doc.heightOfString(cell || '-', { width: widths[index] - padding * 2 }) + padding * 2);
  const rowHeight = Math.min(Math.max(opts.header ? 20 : 22, ...heights), opts.maxHeight || 118);
  ensureSpace(doc, rowHeight + 2);

  const y = doc.y;
  let x = PAGE.left;
  prepared.forEach((cell, index) => {
    const fill = opts.header ? COLORS.tableHeader : (opts.fills?.[index] || COLORS.white);
    const text = cell || '-';
    const textWidth = widths[index] - padding * 2;
    const align = opts.aligns?.[index] || 'left';
    const font = opts.header || opts.boldCells?.includes(index) ? 'Helvetica-Bold' : 'Helvetica';
    const textHeight = doc.heightOfString(text, { width: textWidth, align });
    const textY = opts.verticalAligns?.[index] === 'center'
      ? y + Math.max(padding, (rowHeight - textHeight) / 2)
      : y + padding;
    doc.rect(x, y, widths[index], rowHeight).fillAndStroke(fill, COLORS.border);
    doc.fillColor(opts.header ? COLORS.white : (opts.textColors?.[index] || COLORS.text))
      .font(font)
      .fontSize(fontSize)
      .text(text, x + padding, textY, {
        width: textWidth,
        height: rowHeight - padding * 2,
        align,
      });
    x += widths[index];
  });
  doc.y = y + rowHeight;
}

function drawFeatureTable(doc: PdfDoc, rows: AttorneyReportFeatureRow[]) {
  const widths = [32, 104, 136, 48, 170];
  drawTableRow(doc, ['KF', 'User idea', 'Patent disclosure', 'Status', 'Remark'], widths, { header: true });
  rows.forEach((row, index) => {
    const patentDisclosure = [
      truncate(row.patentDisclosure, 420),
      row.evidenceQuote ? `Evidence (${row.evidenceSource}): ${truncate(row.evidenceQuote, 140)}` : '',
      featureCoverageText(row),
    ].filter(Boolean).join('\n');
    drawTableRow(
      doc,
      [
        row.featureNumber,
        `${truncate(row.userFeature, 140)}\n${truncate(row.userDisclosure, 260)}`,
        patentDisclosure,
        row.statusLabel,
        truncate(row.crispRemark, 430),
      ],
      widths,
      {
        maxHeight: 138,
        fills: [
          index % 2 ? COLORS.tableAlt : COLORS.white,
          index % 2 ? COLORS.tableAlt : COLORS.white,
          index % 2 ? COLORS.tableAlt : COLORS.white,
          COLORS.paleBlue,
          index % 2 ? COLORS.tableAlt : COLORS.white,
        ],
        textColors: [
          COLORS.text,
          COLORS.text,
          COLORS.text,
          statusColor(row.status),
          COLORS.text,
        ],
        aligns: ['left', 'left', 'left', 'center', 'left'],
        verticalAligns: ['top', 'top', 'top', 'center', 'top'],
        boldCells: [3],
      }
    );
  });
}

function drawCitationTable(doc: PdfDoc, citations: AttorneyReportCitation[]) {
  const widths = [34, 86, 184, 82, 58, 46];
  drawTableRow(doc, ['S.No.', 'Citation No.', 'Title', 'Match Category', 'Retrieval', 'Evidence'], widths, { header: true });
  citations.forEach((citation, index) => {
    drawTableRow(doc, [
      String(index + 1),
      citation.publicationNumber,
      citation.title,
      citation.matchCategoryLabel,
      pct(citation.relevanceScore),
      citation.evidenceQuality,
    ], widths, { fills: index % 2 ? widths.map(() => COLORS.tableAlt) : undefined, maxHeight: 70 });
  });
}

function drawFeatureStatusMatrix(doc: PdfDoc, report: ReturnType<typeof buildNoveltyAttorneyReportModel>) {
  const features = report.inventionFeatures;
  if (!features.length || !report.comparisons.length) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text('Feature matrix will appear after citation mapping.', PAGE.left, doc.y, { width: contentWidth(doc) });
    return;
  }

  const chunkSize = 6;
  for (let start = 0; start < features.length; start += chunkSize) {
    const featureChunk = features.slice(start, start + chunkSize);
    const widths = [112, ...featureChunk.map(() => Math.floor((contentWidth(doc) - 112) / featureChunk.length))];
    drawTableRow(doc, ['Citation No.', ...featureChunk.map((_, index) => `KF${start + index + 1}`)], widths, { header: true });
    report.comparisons.forEach((item, itemIndex) => {
      drawTableRow(doc, [
        item.publicationNumber,
        ...featureChunk.map((_, index) => {
          const row = item.rows[start + index];
          return row ? `${row.statusLabel}${typeof row.extentScore === 'number' ? `\n${Math.round(row.extentScore * 100)}% coverage` : ''}` : '-';
        }),
      ], widths, { fills: itemIndex % 2 ? widths.map(() => COLORS.tableAlt) : undefined, maxHeight: 42 });
    });
    doc.moveDown(0.5);
  }
}

function drawReferenceBanner(doc: PdfDoc, label: string, rightText: string) {
  ensureSpace(doc, 52);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, contentWidth(doc), 30, 4).fill(COLORS.blue);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(10.5)
    .text(label, PAGE.left + 10, y + 9, { width: 280 });
  doc.fillColor('#DBEAFE').font('Helvetica').fontSize(8)
    .text(rightText, PAGE.left + 300, y + 10, { width: contentWidth(doc) - 312, align: 'right' });
  doc.y = y + 34;
}

function drawNameList(doc: PdfDoc, names: string[], emptyText: string) {
  if (!names.length) {
    doc.font('Helvetica').fontSize(8.8).fillColor(COLORS.muted).text(emptyText, PAGE.left + 18, doc.y, { width: contentWidth(doc) - 36 });
    doc.moveDown(0.8);
    return;
  }
  names.forEach(name => {
    ensureSpace(doc, 18);
    doc.circle(PAGE.left + 8, doc.y + 5, 2).fill(COLORS.blue);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(name, PAGE.left + 18, doc.y, { width: contentWidth(doc) - 28 });
    doc.moveDown(0.55);
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
    const sectionPages: Array<{ number: string; title: string; page: number; destination: string }> = [];

    drawCover(doc, report);

    addPage(doc);
    const tocPageIndex = doc.bufferedPageRange().count - 1;

    addPage(doc);
    const startSection = (number: string, title: string) => {
      ensureSpace(doc, 54);
      const destination = `section-${sectionPages.length + 1}`;
      doc.addNamedDestination(destination, 'XYZ', PAGE.left, Math.max(PAGE.top, doc.y - 8), null);
      sectionPages.push({ number, title, page: doc.bufferedPageRange().count, destination });
      drawSectionHeading(doc, `${number} ${title}`);
    };

    startSection('1.1', 'Objective');
    drawParagraph(
      doc,
      'The objective of this report is to organize relevant patent records and map available evidence against the extracted key features of the submitted invention for review.'
    );
    drawMetadataGrid(doc, [
      ['Search Query', report.searchQuery],
      ['Analysis Type', report.evidenceBasis],
    ]);
    drawMetadataGrid(doc, report.countLabels.map(item => [item.label, String(item.value)]));

    startSection('1.2', 'Search Scope and Methodology');
    drawMetadataGrid(doc, [
      ['Corpus + retrieval mode', report.methodology.corpus],
      ['Retrieval / mapping mode', report.methodology.retrievalMode],
      ['Evidence scope', report.methodology.searchedEvidence],
      ['Review status', report.methodology.preliminaryStatus],
    ]);
    drawFlowBulletList(doc, 'Techniques Used', report.methodology.techniques);

    startSection('1.3', 'Key Features');
    drawParagraph(doc, 'The key features are extracted from the submitted disclosure and classified to separate core mechanisms, implementation details, novelty-candidate features, and generic features that should not be relied on alone.');
    drawTableRow(doc, ['Key Feature', 'Type', 'Feature Description'], [58, 92, contentWidth(doc) - 150], { header: true });
    report.featureSummaries.forEach((feature, index) => {
      drawTableRow(doc, [
        feature.featureNumber,
        feature.typeLabel,
        `${feature.feature}${feature.genericWarning ? `\n${feature.genericWarning}` : ''}`,
      ], [58, 92, contentWidth(doc) - 150], { fills: index % 2 ? [COLORS.tableAlt, COLORS.tableAlt, COLORS.tableAlt] : undefined, maxHeight: 82 });
    });
    drawFlowTextBlock(doc, 'Generic Feature Risk', report.genericFeatureRisk.summary);

    startSection('1.4', 'Scoring Legend');
    drawTableRow(doc, ['Score / Status', 'Meaning'], [128, contentWidth(doc) - 128], { header: true });
    report.scoringLegend.forEach((item, index) => {
      drawTableRow(doc, [item.label, item.meaning], [128, contentWidth(doc) - 128], { fills: index % 2 ? [COLORS.tableAlt, COLORS.tableAlt] : undefined, maxHeight: 54 });
    });

    startSection('1.5', 'Summary of Relevant Citations');
    drawCitationTable(doc, report.citations);

    startSection('1.6', 'Component / Feature-Level Prior Art');
    drawParagraph(
      doc,
      'These citations disclose one or more relevant invention features, subsystems, materials, process steps, or implementation details, but are not treated as full invention-level matches by themselves.'
    );
    if (report.componentCitations.length > 0) {
      drawCitationTable(doc, report.componentCitations);
    } else {
      drawParagraph(doc, 'No separate component / feature-level references were classified in this run.');
    }

    startSection('1.7', 'Key Feature Analysis Matrix');
    drawFeatureStatusMatrix(doc, report);

    startSection('2.1', 'Details of Relevant Patent Citations');
    for (const item of report.comparisons) {
      ensureSpace(doc, 170);
      drawReferenceBanner(
        doc,
        `Reference ${item.citationNo.replace(/\D/g, '') || item.citationNo}: ${item.publicationNumber}`,
        `Retrieval ${pct(item.relevanceScore)} | ${item.noveltyThreat}`
      );
      drawMetadataGrid(doc, [
        ['Publication No.', item.publicationNumber],
        ['Publication Date', item.publicationDate],
        ['Application No.', item.applicationNumber],
        ['Filing Date', item.filingDate],
        ['Feature Coverage', pct(item.coverage.score)],
        ['Match Category', item.matchCategoryLabel],
        ['Overlap Category', item.noveltyThreat],
        ['Assignee(s)', item.assignees],
        ['Inventor(s)', item.inventors],
        ['CPC / IPC', `${item.cpcCodes} / ${item.ipcCodes}`],
        ['Source', item.link],
      ]);
      keyValueRow(doc, 'Title', item.title);
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text).text('Technical Disclosure', PAGE.left, doc.y, { width: contentWidth(doc) });
      doc.moveDown(0.25);
      drawParagraph(doc, truncate(item.technicalDisclosure, 1100));
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text).text('Feature-by-Feature Comparison', PAGE.left, doc.y, { width: contentWidth(doc) });
      doc.moveDown(0.35);
      drawFeatureTable(doc, item.rows);
      doc.moveDown(0.5);
      keyValueRow(doc, 'Reference Summary', item.summary);
      keyValueRow(doc, 'Claim Impact Summary', item.claimImpactSummary);
      doc.moveDown(0.6);
    }

    if (report.otherShortlistedCitations.length > 0) {
      startSection('2.3', 'List of Other Shortlisted Citations');
      drawParagraph(doc, 'The below citations were shortlisted but not mapped in citation detail because the final report focuses on the most relevant mapped references.');
      drawCitationTable(doc, report.otherShortlistedCitations);
    }

    startSection('3', 'Applicant / Assignee Landscape');
    drawEntityLandscape(doc, report.assigneeLandscape);

    startSection('4', 'Repeated Inventor / Entity Signals');
    drawEntityLandscape(doc, report.inventorSignals);

    startSection('5', 'Claim-Positioning Observations');
    drawMetadataGrid(doc, [
      ['Automated overlap position', report.finalAssessment.decision],
      ['Automated report confidence', report.finalAssessment.confidence],
      ['Retrieval confidence', report.reportConfidence.retrievalConfidence],
      ['Feature-mapping confidence', report.reportConfidence.featureMappingConfidence],
      ['Legal conclusion', report.reportConfidence.legalConclusion],
    ]);
    drawFlowTextBlock(doc, 'Summary', report.finalAssessment.summary);
    drawFlowBulletList(doc, 'Key Risks', report.finalAssessment.risks);
    drawFlowBulletList(doc, 'Recommendations', report.finalAssessment.recommendations);
    drawFlowTextBlock(doc, 'Overall Drafting Direction', report.overallDraftingDirection);

    startSection('6', 'Limitations and Next Steps');
    drawParagraph(doc, report.limitations);
    drawFlowBulletList(doc, 'What To Do Next', report.nextSteps);

    doc.switchToPage(tocPageIndex);
    doc.y = PAGE.top + 10;
    doc.rect(PAGE.left, doc.y, 82, 5).fill(COLORS.cyan);
    doc.moveDown(1.3);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(22).text('Table of Contents', PAGE.left, doc.y, { width: contentWidth(doc) });
    doc.moveDown(1);
    sectionPages.forEach(item => {
      const y = doc.y;
      const rowHeight = 17;
      doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
        .text(`${item.number} ${item.title}`, PAGE.left, y, { width: contentWidth(doc) - 58 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.blue)
        .text(String(item.page), doc.page.width - PAGE.right - 42, y, { width: 42, align: 'right' });
      doc.goTo(PAGE.left, y - 2, contentWidth(doc), rowHeight, item.destination, { Border: [0, 0, 0] });
      doc.moveTo(PAGE.left, doc.y + 4).lineTo(doc.page.width - PAGE.right, doc.y + 4).lineWidth(0.3).strokeColor('#E2E8F0').stroke();
      doc.moveDown(0.6);
    });

    trimTrailingBlankPages(doc);
    drawHeaderFooter(doc, report.reportNumber, report.inventionTitle);
    const buffer = await pdfBuffer(doc);
    const filename = `${report.reportNumber}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[AttorneyReportPDF] Failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate attorney report PDF' }, { status: 500 });
  }
}
