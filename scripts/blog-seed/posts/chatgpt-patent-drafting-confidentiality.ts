import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'chatgpt-patent-drafting-confidentiality',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 13,
  title: 'ChatGPT patent drafting: confidentiality and prior-art risk',
  subtitle:
    'Whether a private prompt can destroy novelty is unsettled; the risks in the terms are not. What absolute novelty in Europe and India, the US grace period and consumer AI terms mean for an unfiled invention.',
  excerpt:
    'Everyone asks it after the paste has already happened. A candid look at whether ChatGPT patent drafting risks your novelty, what consumer AI terms actually permit, and the short procedural workflow that keeps an unfiled invention confidential.',
  answerSummary:
    'Not on consumer defaults. Whether a private prompt is a novelty-destroying public disclosure is unsettled in the US, Europe and India — but consumer AI tiers may retain prompts, train on them and route samples to human reviewers, and shared conversation links have been indexed by search engines. Enterprise tiers with written no-training commitments change the analysis. The reliable protection is procedural: controlled tools, no shared links, and filing before the invention circulates.',
  keyTakeaways: [
    'Whether a private prompt to an AI model is “made available to the public” has not been decided by any court or patent office in the US, Europe or India — the question is genuinely unsettled.',
    'Under Article 54 EPC and the Indian Patents Act, novelty is absolute: any disclosure made available to the public before the filing or priority date is prior art, with no general grace period.',
    'The United States gives a limited one-year grace period for an inventor’s own disclosures — a cushion for accidents, not a strategy, and one that does not travel to Europe or India.',
    'The practical risk lives in consumer AI terms — retention, training on inputs, human review — and in user error such as shared conversation links, which search engines have indexed.',
    'The USPTO’s February 2024 guidance leaves existing duties intact: confidentiality, candour and competence apply to AI-assisted work, and the practitioner’s signature certifies the filing regardless of the tool.',
  ],
  faqs: [
    {
      question: 'Does deleting a chat remove the risk?',
      answer:
        'Not reliably. Deletion controls what you can see, not necessarily what the provider retains: backups, safety logs and samples already routed to human reviewers may persist under the terms you accepted. Deletion also cannot recall a shared conversation link that a search engine has already indexed. Treat deletion as good hygiene after the fact, not as a remedy. The dependable fix is prevention — an enterprise tier with contractual retention limits, or filing before the disclosure leaves your hands.',
    },
    {
      question: 'Is an NDA with an AI vendor enough?',
      answer:
        'A written confidentiality and no-training commitment is the right foundation, but read what it actually covers. Check whether it excludes human review, whether it survives account closure, whether retention windows are defined, and whether it applies to every product tier your team actually uses. A negotiated enterprise agreement usually does this work; consumer terms of service almost never do. And no contract cures user error — a shared conversation link is your act, not the vendor’s.',
    },
    {
      question: 'My inventor already pasted the idea into a chatbot — now what?',
      answer:
        'Do not panic, and do not wait. File promptly — a provisional where that fits the strategy — because a filing date ends the exposure window. Then assess what happened: which tool, which tier, which settings, and whether the conversation was ever shared. In the United States, the one-year grace period may cover an inventor’s own disclosure if the prompt ever counts as one; Europe and India offer no such cushion, which is exactly why filing quickly matters more than analysing the terms.',
    },
    {
      question: 'Are patent-specific AI tools different from general chatbots?',
      answer:
        'Structurally, yes: the honest ones are built so the confidentiality answers are yes in writing — no training on your inputs, defined retention, access controls, and no public sharing surface. We build one, so verify rather than trust: ask any vendor, including us, for the commitments in the contract rather than on the marketing page. The models inside may be similar; the terms wrapped around them are the actual product.',
    },
    {
      question: 'Does the EPO or the Indian Patent Office care how a disclosure happened?',
      answer:
        'No. Under Article 54 EPC and the Indian Patents Act the only question is whether the invention was made available to the public before the filing or priority date — the route is irrelevant. A conference talk, a sales brochure and an indexed chatbot conversation are analysed the same way. Europe and India apply absolute novelty with narrow exceptions, so an accident is not a defence; the US grace period for an inventor’s own disclosures is the notable exception.',
    },
  ],
  focusKeyword: 'chatgpt patent drafting',
  secondaryKeywords: [
    'is chatgpt safe for patent drafting',
    'ai patent public disclosure',
    'chatgpt prior art',
    'confidential invention disclosure ai',
  ],
  tags: ['artificial-intelligence', 'confidentiality', 'novelty', 'practice-management'],
  jurisdictions: ['US', 'EP', 'IN', 'PCT'],
  seoTitle: 'ChatGPT patent drafting: confidentiality and prior-art risk',
  seoDescription:
    'Is ChatGPT safe for patent drafting? The legal question is unsettled; the operational risks are real. What consumer AI terms permit, and the safe workflow.',
  relatedSlugs: ['ai-patent-drafting', 'review-ai-generated-patent-application', 'provisional-vs-complete-specification'],
  content: `
<p>We build patent drafting software, so we have an interest in how this question gets answered — treat what follows with the scepticism that deserves. It is the question we hear most often, usually after the paste has already happened: is ChatGPT patent drafting safe, or has the inventor just published the invention? The honest answer comes in two parts. The legal question — whether a private prompt to a model can count as a disclosure that destroys novelty — is unsettled in every major jurisdiction. The operational risks are real all the same, and they live somewhere less dramatic: in the terms of consumer AI services, and in ordinary user error.</p>

<p>This article walks that risk end to end: what the novelty statutes actually say, where an unfiled disclosure can leak, what consumer terms permit, what the professional duties require, and the short workflow that removes most of the exposure. It pairs with our candid account of <a href="/blog/ai-patent-drafting">what AI drafting is genuinely good at</a> and the checklist for <a href="/blog/review-ai-generated-patent-application">reviewing an AI-generated draft</a> before it is filed.</p>

<h2>Is ChatGPT patent drafting safe before you file?</h2>

<p>On a consumer account with default settings: no, and you do not need a court ruling to reach that view. A consumer tier may retain your prompts, may use them to improve models unless you opt out, and may route samples to human reviewers. None of that is hidden; it is what the terms say. An unfiled invention disclosure handed over on those conditions is confidential mainly in the sense that nobody has looked yet.</p>

<p>On an enterprise tier with a written no-training commitment and retention controls, or in a purpose-built drafting tool contracted on those lines, the picture changes substantially. The rest of this article is the reasoning behind that short answer, and the checklist for acting on it.</p>

<h2>Can a prompt count as public disclosure?</h2>

<p>Start with the statutes. Under <a href="https://www.epo.org/">Article 54 EPC</a> and the <a href="https://www.ipindia.gov.in/">Indian Patents Act</a>, novelty is absolute: anything made available to the public, anywhere and in any form, before the filing or priority date is prior art. There is no general grace period. The United States is the outlier, with a limited one-year grace period for the inventor’s own disclosures — a cushion for accidents, not a drafting strategy, and one that evaporates the moment the same family is filed in Europe or India.</p>

<p>So the live question is whether a private prompt to a model is “made available to the public”. Nobody knows. No patent office or court in the US, Europe or India has decided whether a prompt sitting on a provider’s servers amounts to a public disclosure, and any confident answer you read — in either direction — is a prediction dressed as law. That is the honest position, and it is also the reason this question is the wrong place to spend your worry.</p>

<p>The real exposure is mundane and sits in two places. First, the terms: if the provider may retain the prompt, train models on it and route samples to human reviewers, your ability to show that the disclosure stayed confidential erodes with each of those rights. Second, user error: pasting into the wrong tier, a conversation link forwarded to a client, a screenshot in a pitch deck. The exotic worry — the model reciting your invention to a stranger — is speculative; the mundane routes are not.</p>

<aside class="note"><strong>The share button is the risk.</strong> In 2025 it was widely reported that shared chatbot conversation links were being indexed by search engines. A shared conversation is a publication in the ordinary sense — no unsettled law required. If one habit changes after reading this, make it this one: never share a conversation that mentions an unfiled invention.</aside>

<figure><svg viewBox="0 0 760 392" role="img" aria-label="How an unfiled invention prompt can leak from a consumer AI service, contrasted with an enterprise path that has no publication route" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif"><title>How an unfiled invention prompt can leak from a consumer AI service, contrasted with an enterprise path that has no publication route</title><defs><marker id="leak-arr-grey" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#98a2b3"/></marker><marker id="leak-arr-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1d4ed8"/></marker></defs><rect x="10" y="14" width="740" height="238" rx="8" fill="#fff" stroke="#e4e7ec"/><text x="28" y="40" font-size="13" font-weight="600" fill="#667085" letter-spacing="1">CONSUMER DEFAULTS</text><rect x="28" y="126" width="112" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="84" y="153" text-anchor="middle" font-size="14" fill="#101828">Your prompt</text><line x1="140" y1="149" x2="184" y2="149" stroke="#98a2b3" marker-end="url(#leak-arr-grey)"/><rect x="190" y="126" width="140" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="260" y="147" text-anchor="middle" font-size="14" fill="#101828">Consumer AI</text><text x="260" y="164" text-anchor="middle" font-size="13" fill="#667085">service</text><polyline points="330,149 362,149 362,81 394,81" fill="none" stroke="#98a2b3" marker-end="url(#leak-arr-grey)"/><line x1="330" y1="149" x2="394" y2="149" stroke="#98a2b3" marker-end="url(#leak-arr-grey)"/><polyline points="330,149 362,149 362,217 394,217" fill="none" stroke="#98a2b3" marker-end="url(#leak-arr-grey)"/><rect x="400" y="58" width="150" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="475" y="85" text-anchor="middle" font-size="14" fill="#101828">Provider retention</text><line x1="550" y1="81" x2="584" y2="81" stroke="#98a2b3" marker-end="url(#leak-arr-grey)"/><rect x="590" y="58" width="142" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="661" y="85" text-anchor="middle" font-size="14" fill="#101828">Training corpus</text><rect x="400" y="126" width="150" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="475" y="147" text-anchor="middle" font-size="14" fill="#101828">Human review</text><text x="475" y="164" text-anchor="middle" font-size="13" fill="#667085">sampled prompts</text><rect x="400" y="194" width="150" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="475" y="221" text-anchor="middle" font-size="14" fill="#101828">Shared chat link</text><line x1="550" y1="217" x2="584" y2="217" stroke="#98a2b3" marker-end="url(#leak-arr-grey)"/><rect x="590" y="194" width="142" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="661" y="215" text-anchor="middle" font-size="14" fill="#101828">Search-engine</text><text x="661" y="232" text-anchor="middle" font-size="13" fill="#667085">index</text><rect x="10" y="268" width="740" height="110" rx="8" fill="#fff" stroke="#1d4ed8"/><text x="28" y="294" font-size="13" font-weight="600" fill="#1d4ed8" letter-spacing="1">ENTERPRISE OR PURPOSE-BUILT</text><rect x="28" y="312" width="112" height="46" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><text x="84" y="339" text-anchor="middle" font-size="14" fill="#101828">Your prompt</text><line x1="140" y1="335" x2="184" y2="335" stroke="#1d4ed8" marker-end="url(#leak-arr-blue)"/><rect x="190" y="312" width="200" height="46" rx="8" fill="#f7f8fa" stroke="#1d4ed8"/><text x="290" y="333" text-anchor="middle" font-size="14" fill="#101828">No-training commitment</text><text x="290" y="350" text-anchor="middle" font-size="13" fill="#667085">contractual, in writing</text><line x1="390" y1="335" x2="434" y2="335" stroke="#1d4ed8" marker-end="url(#leak-arr-blue)"/><rect x="440" y="312" width="160" height="46" rx="8" fill="#f7f8fa" stroke="#1d4ed8"/><text x="520" y="333" text-anchor="middle" font-size="14" fill="#101828">Retention controls</text><text x="520" y="350" text-anchor="middle" font-size="13" fill="#667085">defined, operable</text><line x1="600" y1="335" x2="644" y2="335" stroke="#1d4ed8" marker-end="url(#leak-arr-blue)"/><text x="652" y="330" font-size="14" font-weight="600" fill="#1d4ed8">No publication</text><text x="652" y="348" font-size="14" font-weight="600" fill="#1d4ed8">path</text></svg><figcaption>Fig. 1 — Where an unfiled disclosure can leak from a consumer AI service, and the enterprise path that closes each route.</figcaption></figure>

<h2>What do the terms of consumer AI tools actually permit?</h2>

<p>Stated generally — the specifics vary by vendor and change often, which is itself part of the problem — the pattern across consumer and enterprise tiers looks like this:</p>

<table>
  <thead>
    <tr><th>Question</th><th>Consumer tier, default settings</th><th>Enterprise or purpose-built</th></tr>
  </thead>
  <tbody>
    <tr><td>Are prompts retained?</td><td>Often, under the provider’s general policy</td><td>Defined retention windows, deletion controls</td></tr>
    <tr><td>Are inputs used for training?</td><td>Frequently permitted unless you opt out</td><td>Excluded by contract, in writing</td></tr>
    <tr><td>Can humans read the prompts?</td><td>Samples may be routed to reviewers</td><td>Restricted or excluded by contract</td></tr>
    <tr><td>Confidentiality commitment?</td><td>General terms, not tailored to unfiled IP</td><td>Negotiated confidentiality obligations</td></tr>
    <tr><td>Fit for unfiled inventions?</td><td>No</td><td>Yes, with the checks below</td></tr>
  </tbody>
</table>

<p>Notice what the table is really saying: the difference between reckless and defensible ChatGPT patent drafting is not the model, it is the contract wrapped around the model. The same architecture sits behind both columns. What you buy on an enterprise tier is the right-hand column in writing — and what you accept on a consumer login is the left-hand column by default.</p>

<h2>Does using AI waive privilege or breach client confidentiality?</h2>

<p>For practitioners there is a second problem that has nothing to do with novelty. A client’s unfiled disclosure is confidential information, and pasting it into a consumer service whose terms permit retention, training and human review is difficult to square with the duty of confidentiality, whatever a patent office eventually says about prior art. Privilege is its own tangle — the law on routing privileged material through a software vendor is thin — but volunteering a communication to a third party whose staff may read it is not how anyone protects a privileged document.</p>

<p>The <a href="https://www.uspto.gov/">USPTO</a> addressed practitioner use of AI in guidance from February 2024, and its position is usefully boring: the existing duties — candour, confidentiality, competence, export control — already cover it. There is no general duty to disclose that AI was used unless it becomes material. And the signature rule does the real work: under 37 CFR 11.18, the practitioner’s signature certifies the filing regardless of what tool drafted it. The office does not care that a model wrote the sentence; it cares that you signed it.</p>

<h2>How do you evaluate any AI drafting vendor?</h2>

<p>Including us. The questions are the same whether the vendor is a general-purpose chatbot or a patent-specific platform, and a vendor who answers them slowly is answering them.</p>

<ol>
  <li><strong>Are my inputs used to train models?</strong> The only acceptable answer is no, in writing, covering every tier your team will actually use.</li>
  <li><strong>What is retained, and for how long?</strong> Look for defined retention windows and a deletion mechanism you can operate yourself.</li>
  <li><strong>Where is the data processed?</strong> Region matters for privilege and, for some subject matter, for export control and <a href="/blog/foreign-filing-license-india">foreign filing permissions</a>.</li>
  <li><strong>Who at the vendor can see my content?</strong> Access controls and the human-review policy, stated precisely.</li>
  <li><strong>What happens to shared outputs?</strong> If the product has a share or publish surface, understand exactly what becomes public, and when.</li>
</ol>

<p>Purpose-built drafting tools, including the one we make, are designed around these answers — that is much of the category’s reason to exist. But “built for patents” on a landing page is not a contract term. Ask for the commitments in writing, from us as much as from anyone.</p>

<h2>What is the safe workflow?</h2>

<p>If you want ChatGPT patent drafting — or any AI-assisted drafting — without the confidentiality anxiety, the workflow is short and mostly procedural:</p>

<ol>
  <li><strong>File first where speed matters.</strong> A <a href="/blog/provisional-vs-complete-specification">provisional application</a> is the cheapest confidentiality instrument there is: once it is on file, later leaks can no longer destroy novelty for what it discloses.</li>
  <li><strong>Use enterprise or zero-retention tiers only.</strong> Do ChatGPT patent drafting for unfiled matter on a tier with a written no-training commitment, or in a purpose-built tool — never on consumer defaults.</li>
  <li><strong>Never share conversation links.</strong> Treat every share button as a publish button, because functionally it is one.</li>
  <li><strong>Strip identifying detail when exploring.</strong> For general questions — claim formats, statutory language, background art — an anonymised version of the problem discloses nothing worth protecting.</li>
  <li><strong>Record what was disclosed where.</strong> A one-line register — date, tool, tier, what went in — turns a future panic into a lookup.</li>
  <li><strong>Keep the searching inside controlled tools.</strong> Prior-art and <a href="/novelty-search">novelty searching</a> involves typing the invention into things; use tools contracted for exactly that.</li>
</ol>

<p>The summary we would want as a client: the courts have not decided whether a prompt is a disclosure, and you should behave as if they had. Every risk in this article closes with process — the right tier, no shared links, a filing date early in the story. ChatGPT patent drafting is not forbidden fruit; it is a tool with terms attached, and the terms, not the model, are where your invention is kept or lost.</p>
`,
}
