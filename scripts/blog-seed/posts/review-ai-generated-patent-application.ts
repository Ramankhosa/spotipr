import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'review-ai-generated-patent-application',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 33,
  title: 'How to review an AI-generated patent application',
  subtitle:
    'The nine failure modes AI drafts actually exhibit, how to detect each one in minutes, and the review order — claims first, formalities last — that catches them before filing.',
  excerpt:
    'AI can draft a specification in minutes; reviewing it properly is now the job. The nine failure modes to hunt for, the order that catches them fastest, and what the signing practitioner is actually certifying.',
  answerSummary:
    'Review an AI-generated patent application in risk order, not page order: claims first against real prior art, then a claim-to-description support map, then figure and reference-numeral concordance, then a consistency sweep for invented numbers, citations and terminology drift, then formalities. This order targets the nine failure modes generated drafts actually exhibit, and it matters because the practitioner’s signature — not the tool — certifies the filing.',
  keyTakeaways: [
    'An AI-generated patent application shifts the work from writing to reviewing: a wrong draft reads exactly like a right one, so the review must be structural, not impressionistic.',
    'Review claims first and never front to back — claim scope against real prior art is the decision that matters most, and it is the one decision the model could not make.',
    'Invented parameter ranges, performance figures and citations create enablement and support exposure under 35 U.S.C. §112 in the US, Article 83 EPC in Europe and Section 10(4) in India.',
    'Results-only claim language draws eligibility objections in every major office — §101 in the US, technical-character objections at the EPO, and Section 3(k) in India.',
    'Under USPTO practice the signature certifies the filing under 37 CFR 11.18 regardless of what tool drafted it; no office in the US, Europe or India lets software be the signatory.',
  ],
  faqs: [
    {
      question: 'Do I still need this review if the tool ran a prior-art search?',
      answer:
        'Yes. A tool’s search narrows the field; it does not make the scope decision. You still need to know what corpus was searched, what the query actually was, and whether the closest documents were read rather than merely retrieved. Treat the tool’s search as an input to the claims-first pass, not a substitute for it — claim scope set by retrieval statistics rather than by a person who read the art is still failure mode one.',
    },
    {
      question: 'What is the fastest check with the highest yield?',
      answer:
        'Two checks, roughly fifteen minutes together. First, read claim 1 against the two or three closest documents you know — this surfaces the over-broad-scope failure that costs the most to fix later. Second, run an antecedent-basis scan over the claim set, which is mechanical and catches the most common drafting defect in generated claims. If either check fails, stop and fix before spending time on the description, because the description will change anyway.',
    },
    {
      question: 'Does the USPTO require me to disclose that AI drafted the application?',
      answer:
        'Not as a general rule. The USPTO’s February 2024 guidance on practitioner use of AI confirms that existing duties — candour, confidentiality, competence — already govern the work, and that there is no general duty to disclose AI involvement unless it becomes material to patentability or to a proceeding. What the office relies on instead is the signature: under 37 CFR 11.18 the practitioner certifies the filing, however it was produced. The review is how you make that certification true.',
    },
    {
      question: 'How do I catch invented numbers and fabricated citations quickly?',
      answer:
        'Inventory, then attribute. List every quantitative statement — ranges, tolerances, percentages, performance figures — and every citation in the draft, then ask a single question of each: who supplied this? Anything the inventor did not provide and no document supports is presumptively fabricated; it gets confirmed by an engineer or deleted. For citations, look each one up and confirm it exists and says what the draft claims. The pass is tedious, mechanical and non-negotiable.',
    },
    {
      question: 'Are the failure modes different for Europe or India?',
      answer:
        'The failure modes are the same; the objections they draw differ by office. Over-claiming meets novelty and inventive-step rejections everywhere. Unsupported specifics raise §112 in the US, Article 83 at the EPO and Section 10(4) in India. Results-only language triggers §101 in the US, technical-character objections in Europe and Section 3(k) in India. Reviewing once against the strictest applicable standard is cheaper than discovering the differences office by office during prosecution.',
    },
  ],
  focusKeyword: 'ai-generated patent application',
  secondaryKeywords: [
    'ai patent drafting mistakes',
    'ai patent review checklist',
    'reviewing ai patent drafts',
    'ai hallucination patent claims',
  ],
  tags: ['artificial-intelligence', 'drafting', 'quality', 'practice-management'],
  jurisdictions: ['US', 'EP', 'IN', 'PCT'],
  seoTitle: 'How to review an AI-generated patent application',
  seoDescription:
    'A working checklist for reviewing an AI-generated patent application: the nine failure modes, the claims-first review order, and honest time bands for a proper pass.',
  relatedSlugs: ['ai-patent-drafting', 'chatgpt-patent-drafting-confidentiality', 'how-to-write-patent-claims'],
  content: `
<p>We build patent drafting software, and the uncomfortable fact about our category is this: the faster a tool produces a draft, the more the professional work becomes review. Our earlier piece on <a href="/blog/ai-patent-drafting">what AI drafting does well and where it fails</a> explains where the technology helps; this article is the other half — a working checklist for reviewing an AI-generated patent application before your name goes anywhere near it. It is organised around the nine failure modes we actually see in generated drafts, and around a review order that catches them in hours rather than days.</p>

<h2>Why does an AI-generated patent application need a different review?</h2>

<p>Because the failure surface moved. A human associate’s weak draft fails visibly — thin description, clumsy claims, gaps you can see from across the room. A generated draft fails invisibly: the prose is fluent, the structure is orthodox, and a claim that reads straight onto prior art looks identical on the page to one that does not. Volume makes it worse. A tool that produces sixty pages in twenty minutes has converted a writing problem into a reviewing problem, and reading those pages the way you would read your own work — front to back, trusting your memory of why each sentence exists — no longer works, because nobody made the decisions the prose implies. The review has to be structural: a deliberate hunt for specific failure modes, in a specific order.</p>

<h2>What are the nine failure modes?</h2>

<p>Nine is not rhetoric; these are the modes an AI-generated patent application actually exhibits, and each is detectable in minutes if you look for it deliberately.</p>

<h3>1. An over-broad claim 1 the art will destroy</h3>

<p>The most consequential failure. Models produce text shaped like a broad claim with no representation of what has already been claimed in the field. <em>Detect:</em> read claim 1 against the three closest documents from a real <a href="/blog/how-to-do-a-prior-art-search">prior-art search</a> — and if no search was run, that is itself the finding. <em>Draws:</em> novelty and inventive-step rejections, plus a narrowing amendment history you did not need. Claim scope is a human decision made against a real search; a proper <a href="/novelty-search">novelty search</a> belongs before the claim, not after the rejection.</p>

<h3>2. Antecedent-basis errors</h3>

<p><em>Detect:</em> scan the claims for every “the” and “said”, and check that the element was introduced with “a” or “an” earlier in its chain; automated checkers flag most instances in seconds. <em>Draws:</em> indefiniteness and clarity objections — §112(b) in the US, Article 84 at the EPO, and their equivalents in India. Cheap to fix before filing, mildly humiliating after.</p>

<h3>3. Phantom or inconsistent reference numerals</h3>

<p><em>Detect:</em> build two lists — numerals used in the figures, numerals used in the text — and diff them. Generated text confidently cites elements no figure shows, and figures carry numerals the description never mentions. <em>Draws:</em> drawing and formality objections at every office, and genuine support trouble when the phantom element turns out to sit in a claim.</p>

<h3>4. Invented parameter ranges and performance figures</h3>

<p><em>Detect:</em> inventory every number in the draft and ask who supplied it; anything the inventor did not provide is presumptively fabricated. <em>Draws:</em> the sharpest exposure on this list — enablement and support problems under <a href="https://www.uspto.gov/">35 U.S.C. §112</a>, <a href="https://www.epo.org/">Article 83 EPC</a> and Section 10(4) of the Indian Patents Act, and validity attacks years later if a claimed range has no basis anyone can produce.</p>

<h3>5. Fabricated or misattributed citations</h3>

<p><em>Detect:</em> look up every citation and confirm it exists and says what the draft claims it says. Models generate plausible bibliographies on demand. <em>Draws:</em> candour problems if a fabricated reference reaches an information disclosure statement, and credibility damage with the examiner that outlasts the application.</p>

<h3>6. Terminology drift</h3>

<p><em>Detect:</em> search the document for synonym families — processor, controller, module; fastener, connector, clip — and decide whether each family is one element or several. <em>Draws:</em> clarity objections now, and claim-construction fights later, when nobody can say whether the “controller” of paragraph forty is the “processor” of claim 1.</p>

<h3>7. Results-only claim language</h3>

<p><em>Detect:</em> flag every “configured to improve”, “so as to optimise” and “thereby enhancing”, and ask what mechanism performs the result. Models default to results-language because the training corpus talks that way. <em>Draws:</em> eligibility objections across the board — §101 in the US, technical-character objections at the EPO, and <a href="/blog/software-patents-in-india-section-3k">Section 3(k) in India</a>.</p>

<h3>8. Boilerplate embodiments no claim uses</h3>

<p><em>Detect:</em> for each alternative embodiment, find the claim that relies on it; the orphans are padding. <em>Draws:</em> no objection at all — just excess-page fees, translation costs, prosecution drag, and an examiner hunting for your invention somewhere around paragraph 240. Cut them.</p>

<h3>9. Missing enabling detail</h3>

<p><em>Detect:</em> find the paragraph that should teach <em>how</em> the hard step works and check that it does not merely restate <em>that</em> it works; models summarise where a specification must specify. <em>Draws:</em> enablement rejections under §112, Article 83 and Section 10(4) — and this mode, unlike the others, can be unfixable after filing, because the missing matter cannot be added later.</p>

<h2>In what order should you review?</h2>

<p>Not front to back. Fluent prose lulls a reviewer into line-editing when the draft needs auditing, and the expensive failures cluster at the joints — between claims and description, between text and figures — that linear reading never stresses. Review an AI-generated patent application in risk order instead: claims first, because scope is the decision that matters and the one the model could not make; then a support map tracing every claim term into the description that enables it; then figures and numerals; then the consistency sweep for drift, invented numbers and citations; formalities last. The order front-loads the findings that would force a redraft — there is no point polishing reference numerals in a specification whose claim 1 is about to change. What a well-formed claim set should look like at the end of that first pass is covered in <a href="/blog/how-to-write-patent-claims">how to write patent claims</a>.</p>

<figure><svg viewBox="0 0 760 436" role="img" aria-label="The five-pass review order for an AI-drafted application: claims first, then support map, figures and numerals, consistency sweep, and formalities last" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif"><title>The five-pass review order for an AI-drafted application: claims first, then support map, figures and numerals, consistency sweep, and formalities last</title><line x1="100" y1="50" x2="100" y2="386" stroke="#e4e7ec" stroke-width="2"/><rect x="140" y="20" width="592" height="60" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="100" cy="50" r="18" fill="#1d4ed8"/><text x="100" y="55" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">1</text><text x="162" y="45" font-size="15" font-weight="600" fill="#101828">Claims first</text><text x="162" y="66" font-size="13" fill="#667085">Catching: scope the art will destroy, antecedent basis, results-only language</text><rect x="140" y="104" width="592" height="60" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="100" cy="134" r="18" fill="#1d4ed8"/><text x="100" y="139" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">2</text><text x="162" y="129" font-size="15" font-weight="600" fill="#101828">Support map</text><text x="162" y="150" font-size="13" fill="#667085">Catching: claim terms with no enabling description behind them</text><rect x="140" y="188" width="592" height="60" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="100" cy="218" r="18" fill="#1d4ed8"/><text x="100" y="223" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">3</text><text x="162" y="213" font-size="15" font-weight="600" fill="#101828">Figures and numerals</text><text x="162" y="234" font-size="13" fill="#667085">Catching: phantom references, numbering that disagrees with the text</text><rect x="140" y="272" width="592" height="60" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="100" cy="302" r="18" fill="#1d4ed8"/><text x="100" y="307" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">4</text><text x="162" y="297" font-size="15" font-weight="600" fill="#101828">Consistency sweep</text><text x="162" y="318" font-size="13" fill="#667085">Catching: terminology drift, invented numbers, citations that do not exist</text><rect x="140" y="356" width="592" height="60" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="100" cy="386" r="18" fill="#1d4ed8"/><text x="100" y="391" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">5</text><text x="162" y="381" font-size="15" font-weight="600" fill="#101828">Formalities</text><text x="162" y="402" font-size="13" fill="#667085">Catching: jurisdiction format, abstract, claim and page counts</text></svg><figcaption>Fig. 1 — The five-pass review order: risk first, formalities last.</figcaption></figure>

<h2>How long does a proper review take?</h2>

<p>Longer than the generation took, which is the point. The bands below are qualitative — they stretch with claim count, technology and how much the tool was given to work with — but they are honest about where a competent review of an AI-generated patent application actually spends its time.</p>

<table>
  <thead>
    <tr><th>Pass</th><th>What you are checking</th><th>Typical band</th></tr>
  </thead>
  <tbody>
    <tr><td>1. Claims first</td><td>Scope against real art, antecedent basis, results-only language</td><td>30–60 min</td></tr>
    <tr><td>2. Support map</td><td>Every claim term traced to enabling description</td><td>30–45 min</td></tr>
    <tr><td>3. Figures and numerals</td><td>Numeral concordance in both directions</td><td>15–30 min</td></tr>
    <tr><td>4. Consistency sweep</td><td>Terminology drift, invented numbers, citations</td><td>20–40 min</td></tr>
    <tr><td>5. Formalities</td><td>Jurisdiction format, abstract, claim and page counts</td><td>10–20 min</td></tr>
  </tbody>
</table>

<p>Call it a half day for a specification of ordinary length. If the review is taking longer than drafting used to, the tool has produced too much specification — cut the orphan embodiments and the review shrinks with the page count.</p>

<p>Two of the passes deserve tooling. Numeral concordance and antecedent-basis checking are mechanical, rule-governed and better done by software than by a tired reader — the same class of tool that generated the draft can and should check it, and a checker that reports nothing found is itself worth recording in the file. The passes that cannot be delegated are the first two: nobody but the responsible practitioner can decide that claim 1 survives the art, or that the description genuinely enables what the claims recite. Budget the human hours there, and let the machines do the counting.</p>

<h2>What does the reviewer sign up to?</h2>

<p>Everything. The <a href="https://www.uspto.gov/">USPTO</a> said it plainly in its February 2024 guidance on practitioner use of AI: the existing duties — candour, confidentiality, competence — already apply, there is no general duty to disclose that AI was used unless it becomes material, and the practitioner’s signature under 37 CFR 11.18 certifies the filing regardless of what tool drafted it. The tool is never the signatory. The same logic holds before the EPO and the <a href="https://www.ipindia.gov.in/">Indian Patent Office</a>: the representative answers for the application however it was produced. Which is the real argument for the checklist above — the review is not overhead on the AI workflow; for the person whose name is on the filing, the review <em>is</em> the workflow.</p>

<p>None of this argues against the tools — we sell one. It argues for respecting what changed: an AI-generated patent application arrives looking finished, and looking finished was once decent evidence that a competent person had made the underlying decisions. It no longer is. The nine failure modes are where that gap hides, and the claims-first order is the fastest honest way through them.</p>
`,
}
