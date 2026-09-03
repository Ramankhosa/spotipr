import { describe, it, expect } from 'vitest'
import {
  formatParagraphRefsForFiling, formatParagraphRefsForPreview, UNVERIFIED_REF_PLACEHOLDER,
  parseClaimElements, extractClaimsText, chunkParagraphs, splitParagraphs, analyzeParagraphMarkers
} from '../document-intake'
import { assembleReply, buildBasisSentence, type DraftedObjectionReply, type CaseMeta } from '../reply-assembly'
import { renderReplyHtml } from '../reply-html-preview'
import { isRareToken, scanForFeature } from '../absence-scan'
import { findContradictions } from '../contradiction-lint'
import { checkAmendmentBasis } from '../strategy-service'
import { toClaimNumbers } from '../claim-chart-service'
import { refreshDeadline } from '../deadline-engine'
import { normalizeClassified, fallbackCards, verifyQuote, alignedCoverage } from '../objection-classifier'
import { dedupeAmendments } from '../reply-pipeline'

/**
 * Regressions for defects found in the FER (office action) module review.
 * Each test names the failure it prevents, not the function it calls.
 */

const PROFILE: any = {
  meta: { office: 'Indian Patent Office' },
  response: {
    skeleton: ['objectionWiseReply'],
    phrases: {},
    export: { formatting: {} }
  },
  objections: []
}

const META: CaseMeta = { jurisdictionOffice: 'IPO', applicationNumber: '202211012345', numbering: 'AUTHORED' }

function reply(over: Partial<DraftedObjectionReply> = {}): DraftedObjectionReply {
  return {
    objectionId: 'o1', sortOrder: 0, code: 'NOVELTY', title: 'Lack of novelty',
    examinerConcern: 'D1 discloses the claim', bodyText: 'The applicant submits otherwise.',
    approved: true, quoteVerified: true, ...over
  }
}

describe('paragraph anchors never reach a filing unvetted', () => {
  const citable = new Set(['¶0007'])

  it('a bracketed anchor takes the same citable check as a bare one', () => {
    // Was: the bracket-unwrap stripped the ¶ BEFORE the citable check, so
    // "[¶0999]" was emitted as an authoritative-looking "[0999]".
    expect(formatParagraphRefsForFiling('see [¶0999]', { numbering: 'AUTHORED', citableIds: citable }))
      .toBe(`see ${UNVERIFIED_REF_PLACEHOLDER}`)
  })

  it('a bracketed anchor that IS citable still renders as a citation', () => {
    expect(formatParagraphRefsForFiling('see [¶0007]', { numbering: 'AUTHORED', citableIds: citable }))
      .toBe('see [0007]')
  })

  it('a bracketed anchor is padded, not emitted raw', () => {
    expect(formatParagraphRefsForFiling('see [¶7]', { numbering: 'AUTHORED', citableIds: citable }))
      .toBe('see [0007]')
  })

  it('the preview shows the same verdict as the filing', () => {
    // Was: preview rendered every authored anchor as a clean "[0999]" while the
    // DOCX wrote a placeholder — the attorney read one thing and filed another.
    expect(formatParagraphRefsForPreview('see ¶0999', 'AUTHORED', citable))
      .not.toContain('[0999]')
    expect(formatParagraphRefsForPreview('see ¶0007', 'AUTHORED', citable)).toBe('see [0007]')
  })
})

describe('the filed document contains only what the attorney approved', () => {
  it('an unapproved section is omitted and reported, not silently filed', () => {
    const assembled = assembleReply({
      profile: PROFILE, meta: META, namedSections: {}, amendedClaims: [],
      objectionReplies: [
        reply({ objectionId: 'ok', approved: true }),
        reply({ objectionId: 'unread', sortOrder: 1, approved: false, bodyText: 'Model text nobody read.' })
      ]
    })
    const block: any = assembled.blocks.find(b => b.type === 'objections')
    expect(block.objections.map((o: any) => o.objectionId)).toEqual(['ok'])
    expect(block.omitted).toHaveLength(1)
    expect(block.omitted[0].reason).toBe('unapproved')
  })

  it('a failed section does not produce a heading with no body', () => {
    const assembled = assembleReply({
      profile: PROFILE, meta: META, namedSections: {}, amendedClaims: [],
      objectionReplies: [reply({ approved: true, bodyText: '', draftError: 'LLM timeout' })]
    })
    const block: any = assembled.blocks.find(b => b.type === 'objections')
    expect(block.objections).toHaveLength(0)
    expect(block.omitted[0].reason).toBe('empty')
  })

  it('the preview names what was left out', () => {
    const assembled = assembleReply({
      profile: PROFILE, meta: META, namedSections: {}, amendedClaims: [],
      objectionReplies: [reply({ objectionId: 'x', approved: false })]
    })
    expect(renderReplyHtml(assembled, PROFILE)).toContain('Not included in this reply')
  })
})

describe('the HTML preview cannot be used to run script', () => {
  it('a font name from the jurisdiction profile cannot close the style block', () => {
    const hostile: any = {
      ...PROFILE,
      response: { ...PROFILE.response, export: { formatting: { font: 'x</style><script>alert(1)</script>' } } }
    }
    const assembled = assembleReply({
      profile: hostile, meta: META, namedSections: {}, amendedClaims: [], objectionReplies: [reply()]
    })
    const html = renderReplyHtml(assembled, hostile)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</style><')
  })
})

describe('drafted lists survive into the document', () => {
  it('single newlines are kept as breaks, not collapsed into a run-on paragraph', () => {
    const assembled = assembleReply({
      profile: PROFILE, meta: META, namedSections: {}, amendedClaims: [],
      objectionReplies: [reply({ bodyText: 'The invention differs in:\n(a) first;\n(b) second.' })]
    })
    const html = renderReplyHtml(assembled, PROFILE)
    expect(html).toContain('<br>')
  })
})

describe('claims inside a complete specification are found', () => {
  it('the Indian "WE CLAIM:" heading opens the claims section', () => {
    const spec = [
      'FIELD OF THE INVENTION', 'The invention relates to widgets of an improved kind.',
      'WE CLAIM:', '1. A widget comprising a frame and a housing coupled thereto.'
    ].join('\n\n')
    expect(extractClaimsText(spec)).toContain('A widget comprising')
  })
})

describe('claim parsing', () => {
  it('a spaced claim marker does not leak the next claim number into the previous claim', () => {
    // "2 ." is a routine PDF-extraction spacing artifact.
    const els = parseClaimElements('1. A method comprising cooling the mixture.\n2 . The method of claim 1, wherein x.')
    const claim1 = els.filter(e => e.claimNumber === 1).map(e => e.text).join(' ')
    expect(claim1).not.toMatch(/\s2\s*$/)
  })

  it('a numberless back-reference is read as dependent', () => {
    const els = parseClaimElements('1. A method.\n2. The method as claimed in any of the preceding claims, wherein x.')
    expect(els.find(e => e.claimNumber === 2)!.isIndependent).toBe(false)
  })

  it('a reference past the first 80 characters is still a dependency', () => {
    const long = '1. A method.\n2. A computer readable medium storing instructions which when executed by a processor cause performance of the method of claim 1.'
    expect(parseClaimElements(long).find(e => e.claimNumber === 2)!.isIndependent).toBe(false)
  })
})

describe('chunking is bounded even without sentence punctuation', () => {
  it('a delimiter-free run is still split to the token cap', () => {
    const blob = 'AAAA'.repeat(4000)           // one "sentence", no . ; :
    const paras = splitParagraphs(blob, analyzeParagraphMarkers(blob))
    for (const chunk of chunkParagraphs(paras, 400)) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(400 * 3)
    }
  })
})

describe('absence findings are not overturned by ordinary field vocabulary', () => {
  it('common engineering words do not count as rare', () => {
    for (const t of ['sensor', 'signal', 'coupled', 'control', 'processor']) {
      expect(isRareToken(t)).toBe(false)
    }
  })

  it('a genuinely distinctive term still does', () => {
    expect(isRareToken('phaseolin')).toBe(true)
    expect(isRareToken('dq116425')).toBe(true)
  })

  it('a claim feature of common words does not match an unrelated document', () => {
    const feature = 'a sensor coupled to a processor configured to output a control signal'
    const unrelated = 'The apparatus includes a control signal generator and a processor for cooling.'
    expect(scanForFeature(feature, unrelated).found).toBe(false)
  })

  it('a number does not match inside a longer number', () => {
    // "100" must not hit inside "1000 rpm".
    expect(scanForFeature('heated to 100 degrees', 'The rotor spins at 1000 rpm.').found).toBe(false)
  })
})

describe('contradiction lint fires on real reply prose', () => {
  const facts = [
    { citationLabel: 'D1', claimNumber: 1, feature: 'a phaseolin promoter operably linked to the gene', verdict: 'DISCLOSED' },
    { citationLabel: 'D1', claimNumber: 4, feature: 'a phaseolin promoter operably linked to the gene', verdict: 'DISCLOSED' }
  ]

  it('a sentence that merely mentions "the objection" is still checked', () => {
    // Was: any sentence containing "objection" or "controller" was skipped —
    // which is most Indian FER reply prose.
    const found = findContradictions({
      sections: [{ where: 'objection 1', text: 'In response to the objection, it is submitted that D1 does not disclose the phaseolin promoter.' }],
      facts
    })
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].blocking).toBe(true)
  })

  it('one limitation charted across several claims stays a blocking finding', () => {
    // Was: two rows for the same feature counted as "several features" and
    // downgraded a real contradiction to an advisory warning.
    const found = findContradictions({
      sections: [{ where: 'objection 1', text: 'D1 does not disclose the phaseolin promoter operably linked to the gene.' }],
      facts
    })
    expect(found.some(f => f.blocking)).toBe(true)
  })

  it('a sentence about the examiner is still not a claim about a document', () => {
    const found = findContradictions({
      sections: [{ where: 'objection 1', text: 'The examiner has alleged that D1 does not disclose the phaseolin promoter.' }],
      facts
    })
    expect(found).toHaveLength(0)
  })
})

describe('Section 59 basis', () => {
  it('a deletion-only amendment needs no basis paragraph', () => {
    const verdict = checkAmendmentBasis(
      { claimNumber: 7, markedText: '<del>A widget comprising a frame.</del>', cleanText: '', basisRefs: [] } as any,
      []
    )
    expect(verdict.verdict).toBe('pass')
  })

  it('an insertion with no basis is still rejected', () => {
    const verdict = checkAmendmentBasis(
      { claimNumber: 1, markedText: 'A widget <ins>having a titanium frame</ins>.', cleanText: '', basisRefs: [] } as any,
      []
    )
    expect(verdict.verdict).toBe('fail')
  })

  it('a range basis ref is cited in full, not truncated to its first number', () => {
    const sentence = buildBasisSentence(
      [{ claimNumber: 1, markedText: 'x', cleanText: 'x', basisRefs: ['¶0038-¶0041'] }],
      'AUTHORED'
    )
    expect(sentence).toContain('[0038]')
    expect(sentence).toContain('[0041]')
  })
})

describe('claim numbers from LLM output', () => {
  it('string claim numbers do not silently empty the chart', () => {
    expect(toClaimNumbers(['1', '3'])).toEqual([1, 3])
    expect(toClaimNumbers(['claim 2'])).toEqual([2])
    expect(toClaimNumbers([1, 1, 2])).toEqual([1, 2])
    expect(toClaimNumbers(undefined)).toEqual([])
  })
})

describe('deadlines are relative to today, not to ingest day', () => {
  it('a lapsed deadline reports as expired however it was stored', () => {
    const stale = { dueDate: '2020-01-01', daysRemaining: 177, urgency: 'normal' as const }
    const fresh = refreshDeadline(stale, '2026-08-05')
    expect(fresh.daysRemaining).toBeLessThan(0)
    expect(fresh.urgency).toBe('expired')
  })

  it('a live deadline is recomputed from the due date', () => {
    const fresh = refreshDeadline({ dueDate: '2026-08-20', daysRemaining: 999, urgency: 'normal' as const }, '2026-08-05')
    expect(fresh.daysRemaining).toBe(15)
    expect(fresh.urgency).toBe('critical')
  })
})

describe('malformed LLM parse output cannot fail the whole ingest', () => {
  it('an objection with no examinerText is dropped, not written as null', () => {
    const cards = fallbackCards([{ number: '3' } as any], 'source text')
    expect(cards).toHaveLength(0)
  })

  it('a model-dropped raw with no text is not appended either', () => {
    const cards = normalizeClassified([], [{ number: '1' } as any], 'source text')
    expect(cards.every(c => c.examinerText.trim().length > 0)).toBe(true)
  })
})

// ===========================================================================
// Second review pass — the paths by which an unsupported statement could still
// reach a filed document.
// ===========================================================================

describe('a "verbatim" quote must actually have been written as one', () => {
  // Two passages, far enough apart that no single window covers both.
  const FILLER = 'Filler text regarding unrelated matters. '.repeat(60)
  const D1 = `The apparatus includes a rotary drum mounted on a horizontal shaft and driven by an `
    + `electric motor at a constant angular velocity. ${FILLER} `
    + `A control unit receives a temperature signal from a thermocouple positioned within the drying chamber.`

  it('a passage spliced from two distant parts of the document is rejected', () => {
    // Every bigram but the junction one is present in the source, so the old
    // set-membership test scored this ~0.93 and called it verbatim.
    const spliced = 'a rotary drum mounted on a horizontal shaft receives a temperature signal from a thermocouple positioned'
    expect(verifyQuote(spliced, D1)).toBe(false)
  })

  it('a genuine long quote survives extraction noise inside it', () => {
    const withGlitch = 'The apparatus includes a rotary drum mounted on a horizontal shaft 3 and driven by an electric motor'
    expect(verifyQuote(withGlitch, D1)).toBe(true)
  })

  it('a quote whose clauses have been reordered is rejected', () => {
    const reordered = 'driven by an electric motor at a constant angular velocity and mounted on a horizontal shaft'
    expect(verifyQuote(reordered, D1)).toBe(false)
  })

  it('an exact quote still passes on the fast path', () => {
    expect(verifyQuote('a rotary drum mounted on a horizontal shaft', D1)).toBe(true)
  })

  it('alignment is measured in order, not as set membership', () => {
    expect(alignedCoverage(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1)
    expect(alignedCoverage(['c', 'b', 'a'], ['a', 'b', 'c'])).toBeLessThan(1)
  })
})

describe('the basis sentence covers only the claims whose basis was established', () => {
  const amendment = (over: any) => ({
    claimNumber: 1, markedText: '<ins>a phase-change material</ins>', cleanText: 'x',
    basisRefs: ['¶0007'], basisVerdict: 'pass' as const, ...over
  })

  it('an amendment whose basis failed is not asserted to fall within Section 59', () => {
    // Was: one sentence over "the foregoing amendments", built from the union of
    // every claim's refs — so a claim contributing no refs was covered anyway.
    const sentence = buildBasisSentence([
      amendment({}),
      amendment({ claimNumber: 5, basisRefs: [], basisVerdict: 'fail' })
    ], 'AUTHORED')
    expect(sentence).toContain('claim 1')
    expect(sentence).toContain('[0007]')
    expect(sentence).not.toContain('claim 5')
    expect(sentence).not.toContain('foregoing')
  })

  it('several supported claims are named together', () => {
    const sentence = buildBasisSentence([
      amendment({}),
      amendment({ claimNumber: 3, basisRefs: ['¶0021'] })
    ], 'AUTHORED')
    expect(sentence).toContain('claims 1 and 3')
    expect(sentence).toContain('find support')
  })

  it('a deletion is stated as a deletion, not as supported by a paragraph', () => {
    const sentence = buildBasisSentence([
      amendment({ claimNumber: 4, markedText: '<del>and optionally a heater</del>', basisRefs: [] })
    ], 'AUTHORED')
    expect(sentence).toContain('claim 4')
    expect(sentence).toContain('deletion only')
    expect(sentence).not.toContain('find support')
  })

  it('nothing is claimed when no amendment has established basis', () => {
    expect(buildBasisSentence([
      amendment({ basisRefs: [], basisVerdict: 'fail' })
    ], 'AUTHORED')).toBe('')
  })

  it('a draft written before basisVerdict existed still gets its sentence', () => {
    const sentence = buildBasisSentence([
      { claimNumber: 2, markedText: '<ins>x</ins>', cleanText: 'x', basisRefs: ['¶0011'] }
    ], 'AUTHORED')
    expect(sentence).toContain('claim 2')
  })
})

describe('competing amendments to one claim are kept, not overwritten', () => {
  const a = (claimNumber: number, marked: string, verdict?: 'pass' | 'risk' | 'fail') =>
    ({ claimNumber, markedText: marked, cleanText: marked, basisRefs: [], basisVerdict: verdict })

  it('the better-supported proposal is filed and the other is carried', () => {
    const [claim] = dedupeAmendments([a(1, '<ins>weak</ins>', 'fail'), a(1, '<ins>strong</ins>', 'pass')])
    expect(claim.markedText).toContain('strong')
    expect(claim.alternatives).toHaveLength(1)
    expect(claim.alternatives?.[0].markedText).toContain('weak')
  })

  it('the losing proposal is not silently discarded even when it came second', () => {
    const [claim] = dedupeAmendments([a(1, '<ins>strong</ins>', 'pass'), a(1, '<ins>weak</ins>', 'fail')])
    expect(claim.markedText).toContain('strong')
    expect(claim.alternatives?.[0].markedText).toContain('weak')
  })

  it('alternatives carried in from an earlier pass are not dropped on resume', () => {
    const carried: any = { ...a(1, '<ins>chosen</ins>', 'pass'), alternatives: [a(1, '<ins>earlier</ins>', 'risk')] }
    const [claim] = dedupeAmendments([carried, a(1, '<ins>newest</ins>', 'fail')])
    const texts = (claim.alternatives || []).map(x => x.markedText)
    expect(texts).toContain('<ins>earlier</ins>')
    expect(texts).toContain('<ins>newest</ins>')
  })

  it('one amendment per claim still yields one entry with no alternatives', () => {
    const out = dedupeAmendments([a(1, '<ins>only</ins>', 'pass'), a(2, '<ins>other</ins>', 'pass')])
    expect(out).toHaveLength(2)
    expect(out.every(c => !c.alternatives)).toBe(true)
  })
})
