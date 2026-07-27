import { objectionLabel, type AssembledReply, type ReplyBlock, type AmendedClaim } from './reply-assembly'
import { formatParagraphRefs } from './document-intake'
import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — reply HTML preview
 *
 * Renders the SAME assembled reply model as the DOCX exporter, as a styled,
 * print-like legal document for on-screen preview (the DOCX is the filing
 * deliverable; this is the "print preview" the attorney reviews). Structure and
 * numbering mirror the DOCX exactly so what they see is what they file.
 */

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function markedClaimHtml(c: AmendedClaim): string {
  const marked = esc(c.markedText)
    .replace(/&lt;ins&gt;([\s\S]*?)&lt;\/ins&gt;/g, '<ins>$1</ins>')
    .replace(/&lt;del&gt;([\s\S]*?)&lt;\/del&gt;/g, '<del>$1</del>')
  return `<p class="claim"><span class="cn">${c.claimNumber}.</span> ${marked}</p>`
}

function paras(text: string): string {
  // formatParagraphRefs: internal ¶0007 anchors read as "[0007]" in the filing.
  return formatParagraphRefs(text).split(/\n{2,}/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`).join('')
}

export function renderReplyHtml(assembled: AssembledReply, profile: OfficeActionProfile): string {
  const f = profile.response.export?.formatting || {}
  const font = f.font || 'Times New Roman'
  let secNo = 0
  const parts: string[] = []

  for (const block of assembled.blocks) parts.push(renderBlockHtml(block, () => ++secNo))

  const meta = assembled.meta
  return `<!-- generated preview: FER reply ${esc(meta.applicationNumber)} -->
<style>
  .fer-doc{--ink:#1a1a1a;--muted:#555;--rule:#d8d5cc;--para:#f6f4ee;
    font-family:"${font}","Times New Roman",Georgia,serif;color:var(--ink);
    max-width:760px;margin:0 auto;background:#fff;padding:56px 64px;line-height:1.5;
    box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 30px rgba(0,0,0,.10);font-size:15px}
  @media (prefers-color-scheme:dark){.fer-doc{--ink:#e6e3da;--muted:#9a968b;--rule:#3a3730;--para:#20242c;background:#171a1f;box-shadow:0 8px 30px rgba(0,0,0,.5)}}
  .fer-doc .addr{white-space:pre-line;margin-bottom:6px}
  .fer-doc .re{font-weight:700}
  .fer-doc .subject{font-weight:700;margin:18px 0 16px;text-align:center;text-transform:none}
  .fer-doc .salut{margin:0 0 16px}
  .fer-doc h2.sec{font-size:14px;letter-spacing:.03em;margin:26px 0 10px;padding-bottom:4px;border-bottom:1px solid var(--rule);
    display:flex;gap:10px}
  .fer-doc h2.sec .no{color:var(--muted);font-variant-numeric:tabular-nums}
  .fer-doc p{margin:0 0 11px;text-align:justify}
  .fer-doc .obj{margin:14px 0 4px}
  .fer-doc .obj .oh{font-weight:700}
  .fer-doc .obj .oh .no{color:var(--muted);font-weight:400;margin-right:8px;font-variant-numeric:tabular-nums}
  .fer-doc .indent{margin-left:26px}
  .fer-doc .concern{font-style:italic;color:var(--muted);background:var(--para);border-left:2px solid var(--rule);
    padding:7px 12px;border-radius:3px;margin:6px 0 8px 26px}
  .fer-doc .subhead{font-weight:700;margin:10px 0 4px 26px}
  .fer-doc .claim{margin-left:26px;text-align:justify}
  .fer-doc .claim .cn{font-weight:700}
  .fer-doc ins{text-decoration:none;border-bottom:1.5px solid currentColor}
  .fer-doc del{text-decoration:line-through;opacity:.7}
  .fer-doc .basis{font-style:italic;color:var(--muted);margin-left:26px}
  .fer-doc .sig{margin-top:30px;white-space:pre-line}
</style>
<div class="fer-doc">${parts.join('')}</div>`
}

function renderBlockHtml(block: ReplyBlock, nextNo: () => number): string {
  switch (block.type) {
    case 'addressBlock':
      return `<div class="addr">${block.lines.map(l => l.startsWith('Re:') ? `<span class="re">${esc(l)}</span>` : esc(l)).join('\n')}</div>`
    case 'subjectLine':
      return `<div class="subject">Subject: ${esc(block.text)}</div>`
    case 'salutation':
      return `<p class="salut">${esc(block.text)}</p>`
    case 'namedSection': {
      const n = nextNo()
      return `<h2 class="sec"><span class="no">${n}.</span>${esc(block.title.toUpperCase())}</h2>${paras(block.body)}`
    }
    case 'objections': {
      const n = nextNo()
      const items = block.objections.map((o, i) => {
        const concern = o.examinerConcern ? `<div class="concern">Examiner's objection: ${esc(o.examinerConcern)}</div><div class="subhead">Applicant’s submission:</div>` : ''
        return `<div class="obj"><div class="oh"><span class="no">${n}.${i + 1}</span>Objection ${esc(objectionLabel(o))} — ${esc(o.title)}${o.statuteBasis ? ` (${esc(o.statuteBasis)})` : ''}</div></div>${concern}<div class="indent">${paras(o.bodyText)}</div>`
      }).join('')
      return `<h2 class="sec"><span class="no">${n}.</span>${esc(block.title.toUpperCase())}</h2>${items}`
    }
    case 'amendments': {
      const n = nextNo()
      let h = `<h2 class="sec"><span class="no">${n}.</span>${esc(block.title.toUpperCase())}</h2>`
      if (block.marked.length) h += `<div class="subhead">Marked copy of the amended claims:</div>${block.marked.map(markedClaimHtml).join('')}`
      if (block.clean.length) h += `<div class="subhead">Clean copy of the amended claims:</div>${block.clean.map(c => `<p class="claim"><span class="cn">${c.claimNumber}.</span> ${esc(c.cleanText)}</p>`).join('')}`
      if (block.basisRefs.length) h += `<p class="basis">The foregoing amendments find support in the specification as filed at ${esc(block.basisRefs.join(', '))}, and fall wholly within the scope of the claims as originally filed (Section 59).</p>`
      return h
    }
    case 'signatureBlock':
      return `<div class="sig">${block.lines.map(esc).join('\n')}</div>`
  }
}
