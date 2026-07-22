import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  LevelFormat, convertMillimetersToTwip
} from 'docx'
import { objectionLabel, type AssembledReply, type AmendedClaim, type DraftedObjectionReply, type ReplyBlock } from './reply-assembly'
import type { OfficeActionProfile } from './oa-profile-schema'
import type { LintResult } from './compliance-lint'

/**
 * Office Action Studio — professional reply DOCX
 *
 * Renders the assembled reply as a filing-ready legal document: page setup and
 * typography from the jurisdiction profile, a reference/subject header, a
 * salutation, hierarchically numbered sections (1 / 1.1 / 2.1), and each FER
 * objection tackled systematically — the examiner's concern restated, then the
 * Applicant's response — followed by the amended claims (marked + clean) with
 * their §59 basis, the prayer, and the signature block.
 */

interface Fmt {
  font: string
  sizeHalfPt: number       // docx uses half-points
  lineSpacing: number      // 240ths
  justify: boolean
  marginTwip: number
  numbered: boolean
  restate: boolean
}

function resolveFmt(profile: OfficeActionProfile): Fmt {
  const f = profile.response.export?.formatting || {}
  return {
    font: f.font || 'Times New Roman',
    sizeHalfPt: Math.round((f.fontSizePt || 12) * 2),
    lineSpacing: Math.round((f.lineSpacing || 1.15) * 240),
    justify: f.justify !== false,
    marginTwip: convertMillimetersToTwip((f.marginCm || 2.5) * 10),
    numbered: f.numberedSections !== false,
    restate: f.restateExaminerObjection !== false
  }
}

const REF = 'oa-sections' // numbering reference id

export async function buildReplyDocx(
  assembled: AssembledReply,
  profile: OfficeActionProfile,
  opts: { includeComplianceNote?: boolean; lint?: LintResult } = {}
): Promise<Buffer> {
  const fmt = resolveFmt(profile)
  const children: Paragraph[] = []
  let sectionNo = 0

  const body = (text: string, o: { italics?: boolean; bold?: boolean; indent?: number; after?: number } = {}) =>
    new Paragraph({
      alignment: fmt.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      spacing: { line: fmt.lineSpacing, after: o.after ?? 120 },
      indent: o.indent ? { left: o.indent } : undefined,
      children: [new TextRun({ text, italics: o.italics, bold: o.bold })]
    })

  const numberedHeading = (title: string): Paragraph => {
    sectionNo++
    return new Paragraph({
      spacing: { before: 260, after: 120, line: fmt.lineSpacing },
      numbering: fmt.numbered ? { reference: REF, level: 0 } : undefined,
      children: [new TextRun({ text: title.toUpperCase(), bold: true })]
    })
  }
  const subNumbered = (runs: TextRun[]): Paragraph =>
    new Paragraph({
      alignment: fmt.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      spacing: { before: 120, after: 80, line: fmt.lineSpacing },
      numbering: fmt.numbered ? { reference: REF, level: 1 } : undefined,
      children: runs
    })

  for (const block of assembled.blocks) {
    renderBlock(block, { children, fmt, body, numberedHeading, subNumbered })
  }

  if (opts.includeComplianceNote && opts.lint) {
    children.push(new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: '— Internal verification note (not for filing) —', italics: true, color: '888888' })] }))
    for (const c of opts.lint.checks) {
      children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({
        text: `${c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'} ${c.label}${c.detail ? ' — ' + c.detail : ''}`,
        color: '888888', size: 18
      })] }))
    }
  }

  const doc = new Document({
    creator: 'Office Action Studio',
    title: `FER Reply — ${assembled.meta.applicationNumber}`,
    styles: { default: { document: { run: { font: fmt.font, size: fmt.sizeHalfPt } } } },
    numbering: {
      config: [{
        reference: REF,
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 0, hanging: 360 } } } },
          { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2.', alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 480, hanging: 480 } } } }
        ]
      }]
    },
    sections: [{
      properties: { page: { margin: { top: fmt.marginTwip, bottom: fmt.marginTwip, left: fmt.marginTwip, right: fmt.marginTwip } } },
      children
    }]
  })
  return Packer.toBuffer(doc)
}

interface Ctx {
  children: Paragraph[]
  fmt: Fmt
  body: (t: string, o?: any) => Paragraph
  numberedHeading: (t: string) => Paragraph
  subNumbered: (runs: TextRun[]) => Paragraph
}

function renderBlock(block: ReplyBlock, ctx: Ctx) {
  const { children, fmt, body, numberedHeading, subNumbered } = ctx
  switch (block.type) {
    case 'addressBlock':
      for (const line of block.lines) children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: line, bold: line.startsWith('Re:') })] }))
      children.push(new Paragraph({ spacing: { after: 80 }, children: [] }))
      break
    case 'subjectLine':
      children.push(new Paragraph({ spacing: { before: 80, after: 160 }, children: [new TextRun({ text: 'Subject: ', bold: true }), new TextRun({ text: block.text, bold: true })] }))
      break
    case 'salutation':
      children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: block.text })] }))
      break
    case 'namedSection':
      children.push(numberedHeading(block.title))
      for (const p of splitParas(block.body)) children.push(body(p))
      break
    case 'objections': {
      children.push(numberedHeading(block.title))
      for (const o of block.objections) {
        // 2.N — Objection heading
        children.push(subNumbered([new TextRun({ text: `Objection ${objectionLabel(o)} — ${o.title}${o.statuteBasis ? ` (${o.statuteBasis})` : ''}`, bold: true })]))
        // Examiner's concern (restated) then the Applicant's response — the systematic pair.
        if (fmt.restate && o.examinerConcern) {
          children.push(body(`Examiner's objection: ${o.examinerConcern}`, { italics: true, indent: 480, after: 80 }))
          children.push(body('Applicant’s submission:', { bold: true, indent: 480, after: 40 }))
        }
        for (const p of splitParas(o.bodyText)) children.push(body(p, { indent: 480 }))
      }
      break
    }
    case 'amendments': {
      children.push(numberedHeading(block.title))
      if (block.marked.length) {
        children.push(subNumbered([new TextRun({ text: 'Marked copy of the amended claims:', bold: true })]))
        for (const c of block.marked) children.push(markedClaimParagraph(c, fmt))
      }
      if (block.clean.length) {
        children.push(subNumbered([new TextRun({ text: 'Clean copy of the amended claims:', bold: true })]))
        for (const c of block.clean) children.push(body(`${c.claimNumber}. ${c.cleanText}`, { indent: 480 }))
      }
      if (block.basisRefs.length) {
        children.push(body(`The foregoing amendments find support in the specification as filed at ${block.basisRefs.join(', ')}, and fall wholly within the scope of the claims as originally filed (Section 59).`, { indent: 480, italics: true }))
      }
      break
    }
    case 'signatureBlock':
      children.push(new Paragraph({ spacing: { before: 260 }, children: [] }))
      for (const line of block.lines) children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: line })] }))
      break
  }
}

function splitParas(text: string): string[] {
  return (text || '').split(/\n{2,}/).map(s => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
}

function markedClaimParagraph(claim: AmendedClaim, fmt: Fmt): Paragraph {
  const runs: TextRun[] = [new TextRun({ text: `${claim.claimNumber}. ` })]
  const tokens = claim.markedText.split(/(<ins>[\s\S]*?<\/ins>|<del>[\s\S]*?<\/del>)/g)
  for (const tok of tokens) {
    if (!tok) continue
    const ins = /^<ins>([\s\S]*)<\/ins>$/.exec(tok)
    const del = /^<del>([\s\S]*)<\/del>$/.exec(tok)
    if (ins) runs.push(new TextRun({ text: ins[1], underline: {} }))
    else if (del) runs.push(new TextRun({ text: del[1], strike: true }))
    else runs.push(new TextRun({ text: tok }))
  }
  return new Paragraph({
    alignment: fmt.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    spacing: { line: fmt.lineSpacing, after: 120 }, indent: { left: 480 }, children: runs
  })
}
