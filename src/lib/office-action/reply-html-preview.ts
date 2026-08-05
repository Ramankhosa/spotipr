import { objectionLabel, type AssembledReply, type ReplyBlock, type AmendedClaim } from './reply-assembly'
import { formatParagraphRefsForPreview, type ParagraphNumbering } from './document-intake'
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

/**
 * The preview is a reading surface, not a filing artefact, so it uses the
 * lenient formatter: an anchor that could not be filed is shown as a visible
 * placeholder rather than throwing, which is what lets the attorney see what
 * needs fixing instead of an error page.
 */
function paras(text: string, numbering: ParagraphNumbering, citableIds?: Set<string>): string {
  return formatParagraphRefsForPreview(text, numbering, citableIds)
    .split(/\n{2,}/)
    .map(block => block.split('\n').map(l => l.trim()).filter(Boolean))
    .filter(lines => lines.length > 0)
    // Single newlines stay as breaks, matching the DOCX. Collapsing them ran the
    // drafter's enumerated lists together into one paragraph.
    .map(lines => `<p>${lines.map(esc).join('<br>')}</p>`).join('')
}

/**
 * A font name from the jurisdiction profile is untrusted input — it reaches this
 * module from the super-admin jurisdiction config and is interpolated into a
 * <style> block that the workspace injects with dangerouslySetInnerHTML. A value
 * containing "</style><script>…" would execute in the session of every attorney
 * who previews a reply in that jurisdiction. Only a plain font name survives.
 */
function safeFontName(raw: string | undefined): string {
  const cleaned = String(raw || '').replace(/[^A-Za-z0-9 \-]/g, '').trim().slice(0, 64)
  return cleaned || 'Times New Roman'
}

export function renderReplyHtml(
  assembled: AssembledReply,
  profile: OfficeActionProfile,
  opts: { citableIds?: Set<string> } = {}
): string {
  const f = profile.response.export?.formatting || {}
  const font = safeFontName(f.font)
  let secNo = 0
  const parts: string[] = []

  const numbering = assembled.meta.numbering
  // The same citable set the filing renderer uses. Without it the preview showed
  // an unvetted anchor as a clean "[0999]" while the DOCX wrote
  // "[reference to verify]" — the one divergence that matters, in the direction
  // where the attorney reads something correct and files something else.
  for (const block of assembled.blocks) parts.push(renderBlockHtml(block, () => ++secNo, numbering, opts.citableIds))

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
  /* Procedural undertakings — the attorney must complete and clear these. */
  .fer-doc .attn p{background:#fff3a3;padding:2px 4px}
  .fer-doc .attn-do{background:#fff3a3;border-left:3px solid #d4a017;padding:8px 10px;margin-top:8px;font-size:.92em}
  .fer-doc .attn-do ul{margin:6px 0 0 18px}
  /* Sections the export leaves out — shown so the gap is visible, never filed. */
  .fer-doc .omitted{border:1px dashed var(--rule);border-radius:4px;padding:10px 12px;margin:14px 0 0;
    color:var(--muted);font-size:.92em}
  .fer-doc .omitted ul{margin:6px 0 0 18px}
  .fer-doc .claim{margin-left:26px;text-align:justify}
  .fer-doc .claim .cn{font-weight:700}
  .fer-doc ins{text-decoration:none;border-bottom:1.5px solid currentColor}
  .fer-doc del{text-decoration:line-through;opacity:.7}
  .fer-doc .basis{font-style:italic;color:var(--muted);margin-left:26px}
  .fer-doc .sig{margin-top:30px;white-space:pre-line}
</style>
<div class="fer-doc">${parts.join('')}</div>`
}

function renderBlockHtml(
  block: ReplyBlock,
  nextNo: () => number,
  numbering: ParagraphNumbering,
  citableIds?: Set<string>
): string {
  switch (block.type) {
    case 'addressBlock':
      return `<div class="addr">${block.lines.filter(Boolean).map(l => l.startsWith('Re:') ? `<span class="re">${esc(l)}</span>` : esc(l)).join('\n')}</div>`
    case 'subjectLine':
      return `<div class="subject">Subject: ${esc(block.text)}</div>`
    case 'salutation':
      return `<p class="salut">${esc(block.text)}</p>`
    case 'namedSection': {
      const n = nextNo()
      return `<h2 class="sec"><span class="no">${n}.</span>${esc(block.title.toUpperCase())}</h2>${paras(block.body, numbering, citableIds)}`
    }
    case 'objections': {
      const n = nextNo()
      const items = block.objections.map((o, i) => {
        const concern = o.examinerConcern ? `<div class="concern">Examiner's objection: ${esc(o.examinerConcern)}</div><div class="subhead">Applicant’s submission:</div>` : ''
        // The action list is workspace-only and is NOT in the DOCX, so it is
        // labelled as such — an instruction to "remove before filing" pointing at
        // text the file never contained sends the attorney hunting for nothing.
        const bodyHtml = o.attorneyAction
          ? `<div class="attn">${paras(o.bodyText, numbering, citableIds)}${(o.actionItems || []).length
              ? `<div class="attn-do"><strong>Attorney action (shown here only — not in the exported file):</strong><ul>${(o.actionItems || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`
              : ''}</div>`
          : paras(o.bodyText, numbering, citableIds)
        return `<div class="obj"><div class="oh"><span class="no">${n}.${i + 1}</span>Objection ${esc(objectionLabel(o))} — ${esc(o.title)}${o.statuteBasis ? ` (${esc(o.statuteBasis)})` : ''}</div></div>${concern}<div class="indent">${bodyHtml}</div>`
      }).join('')
      // What is NOT in the letter, and why. Silence here would read as "every
      // objection is answered" while the export quietly left sections out.
      const gaps = block.omitted.length
        ? `<div class="omitted"><strong>Not included in this reply (${block.omitted.length}):</strong><ul>${
            block.omitted.map(({ reply, reason }) =>
              `<li>Objection ${esc(objectionLabel(reply))} — ${esc(reply.title)}: ${
                reason === 'empty' ? 'no text drafted yet' : 'drafted but not approved'
              }</li>`).join('')
          }</ul></div>`
        : ''
      return `<h2 class="sec"><span class="no">${n}.</span>${esc(block.title.toUpperCase())}</h2>${items}${gaps}`
    }
    case 'amendments': {
      const n = nextNo()
      let h = `<h2 class="sec"><span class="no">${n}.</span>${esc(block.title.toUpperCase())}</h2>`
      if (block.marked.length) {
        h += `<div class="subhead">Marked copy of the amended claims:</div>`
        h += `<p class="basis">Insertions are underlined; deletions are struck through.</p>`
        h += block.marked.map(markedClaimHtml).join('')
      }
      if (block.clean.length) {
        h += `<div class="subhead">Clean copy of the amended claims:</div>`
        h += block.clean.map(c => `<p class="claim"><span class="cn">${c.claimNumber}.</span> ${esc(c.cleanText)}</p>`).join('')
      }
      // Built deterministically in reply-assembly. Joining basisRefs here is what
      // used to put a raw "¶0004" in front of the Controller.
      if (block.basisSentence) h += `<p class="basis">${esc(block.basisSentence)}</p>`
      return h
    }
    case 'signatureBlock':
      return `<div class="sig">${block.lines.map(esc).join('\n')}</div>`
  }
}
