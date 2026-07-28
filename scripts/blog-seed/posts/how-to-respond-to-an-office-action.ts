import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'how-to-respond-to-an-office-action',
  categorySlug: 'filing-and-prosecution',
  publishedDaysAgo: 85,
  title: 'How to respond to a patent office action (or an Indian FER)',
  subtitle:
    'Reading the rejection properly, choosing between argument and amendment, and writing a response that ends prosecution rather than extending it.',
  excerpt:
    'Almost every application is rejected first time — it is the normal opening move, not a verdict. Here is how to read an office action, decide what to argue and what to amend, and structure a response that actually persuades.',
  answerSummary:
    'To respond to an office action, first separate the rejections by type: formal objections, novelty (§102 / anticipation), obviousness (§103 / inventive step) and clarity or eligibility (§112 / §101). Address every single one, decide for each whether to argue or amend, ground every argument in specific claim language and specific passages of the cited art, and file before the deadline — three months in the US, extendable to six; six months from an Indian FER, extendable by three.',
  keyTakeaways: [
    'A first rejection is the normal course of prosecution, not a sign the application is weak — the majority of applications that eventually grant are rejected at least once.',
    'You must respond to every rejection and objection raised. A response that ignores one is incomplete and can be held non-responsive, wasting the round entirely.',
    'Amend only as far as necessary. Every narrowing amendment permanently reduces scope and, in the US, creates prosecution history estoppel that limits equivalents later.',
    'Argue from the claim language and the cited document’s actual text: quote the paragraph, name the missing element, and show why the reference does not disclose it.',
    'An examiner interview before filing a written response resolves many disagreements in thirty minutes that would otherwise consume two written rounds and six months.',
    'India’s FER deadline is six months from issue, extendable by three on request; the US gives three months, extendable to six on payment, with the extension fee rising each month.',
  ],
  faqs: [
    {
      question: 'Is an office action a rejection of my patent?',
      answer:
        'It is a rejection of the claims as currently written, which is a different and much more ordinary thing. The examiner is stating a position that you may argue against or accommodate by amendment. Most granted patents were rejected at least once on the way, and many were rejected twice.',
    },
    {
      question: 'What is the difference between a final and a non-final office action?',
      answer:
        'In US practice, a non-final action opens the exchange and you may respond freely with amendments and argument. A final action closes it: your options narrow to an appeal, a Request for Continued Examination, or an after-final amendment the examiner has discretion to refuse. "Final" describes the stage of prosecution, not the fate of the application.',
    },
    {
      question: 'How long do I have to respond to an Indian First Examination Report?',
      answer:
        'Six months from the date the FER is issued, extendable by up to three further months on a request filed with the prescribed fee. The application must be put in order for grant within that window; failure to comply results in the application being deemed abandoned.',
    },
    {
      question: 'Should I amend the claims or argue against the rejection?',
      answer:
        'Argue where the reference genuinely does not disclose what the examiner says it does — you keep your full scope. Amend where it does, or where argument would take more rounds than the scope is worth. The common error is amending immediately to make the rejection go away, which grants a narrower patent than the applicant was entitled to.',
    },
    {
      question: 'Can I talk to the examiner directly?',
      answer:
        'Yes, and you should. Examiner interviews are available in most jurisdictions and are routine in US practice. Thirty minutes on a call — walking through why the cited reference lacks your element, or floating amendment language before you commit to it — regularly resolves what two written rounds would not.',
    },
  ],
  focusKeyword: 'office action',
  secondaryKeywords: [
    'office action response',
    'how to respond to an office action',
    'first examination report india',
    'patent rejection 102 103',
    'fer response',
    'final office action',
  ],
  tags: ['prosecution', 'office-actions', 'india', 'uspto'],
  jurisdictions: ['US', 'IN', 'EP'],
  seoTitle: 'How to respond to a patent office action or Indian FER',
  seoDescription:
    'How to read and answer a patent office action: rejection types, argue vs amend, response structure, deadlines in the US and India, and the mistakes that cost scope.',
  relatedSlugs: ['how-to-write-patent-claims', 'software-patent-eligibility', 'how-to-do-a-prior-art-search'],
  content: `
<p>An office action arrives eighteen months to two years after filing, runs to a dozen pages of numbered paragraphs, and rejects most or all of your claims. This is normal. It is the examiner's opening position in a negotiation about scope, and the majority of patents that eventually grant were rejected at least once first.</p>

<p>What separates a cheap prosecution from an expensive one is almost entirely the quality of the first response.</p>

<h2>What is in an office action?</h2>

<p>Every action, in whatever jurisdiction, is a set of objections in roughly this hierarchy:</p>

<table>
  <thead>
    <tr><th>Type</th><th>US provision</th><th>What the examiner is saying</th><th>Usual answer</th></tr>
  </thead>
  <tbody>
    <tr><td>Formal objections</td><td>Rule-based</td><td>Drawings, abstract, sequence listing, formatting</td><td>Fix it; never argue</td></tr>
    <tr><td>Clarity / definiteness</td><td>§112(b)</td><td>A claim term is unclear or lacks antecedent basis</td><td>Amend the wording</td></tr>
    <tr><td>Written description / enablement</td><td>§112(a)</td><td>The description does not support the claim</td><td>Point to the passage, or narrow</td></tr>
    <tr><td>Eligibility</td><td>§101</td><td>Directed to an abstract idea</td><td>Argue practical application; amend to recite the technical improvement</td></tr>
    <tr><td>Anticipation (novelty)</td><td>§102</td><td>One document discloses every element</td><td>Show a missing element, or amend</td></tr>
    <tr><td>Obviousness / inventive step</td><td>§103</td><td>Two or more documents combined make it obvious</td><td>Attack the combination or the motivation</td></tr>
  </tbody>
</table>

<p>An Indian First Examination Report follows the same logic under different labels: objections under Section 2(1)(j) for novelty and inventive step, Section 3 for non-patentable subject matter (including the Section 3(k) software exclusion), and Section 10 for sufficiency and clarity. It will also list formal requirements — Form 3 statements about corresponding foreign applications, proof of right, and similar — which are easy to overlook and will hold up grant on their own.</p>

<p>The rules behind each objection are public: the <a href="https://www.uspto.gov/web/offices/pac/mpep/index.html">USPTO’s MPEP</a> sets out how US examiners are instructed to apply §§101, 102, 103 and 112, and the <a href="https://ipindia.gov.in/">Indian Patent Office</a> publishes its Manual of Patent Office Practice and Procedure alongside the CRI guidelines. Reading the examiner’s own instructions is the cheapest office action preparation available.</p>

<h2>Step 1 — Read the office action before reading the references</h2>

<p>Work out precisely what is being asserted, claim by claim. For each rejection write down:</p>

<ul>
  <li>Which claims it applies to</li>
  <li>Which documents are cited, and for which specific elements</li>
  <li>Which paragraph or figure of each document the examiner points to</li>
  <li>For an obviousness rejection: what the stated <strong>motivation to combine</strong> is</li>
</ul>

<p>Examiners map claim elements to references element by element, and the mapping is where the argument lives. Frequently one element is supported by a passage that, read in full, says something materially different — or by nothing at all beyond an assertion that it would be "well known in the art".</p>

<h2>Step 2 — Read the cited art properly</h2>

<p>Not the abstract. Not the examiner's summary. The actual passages cited, and the surrounding context. Ask three questions of each reference:</p>

<ol>
  <li><strong>Does it really disclose that element</strong>, or something adjacent that the examiner has read your claim onto?</li>
  <li><strong>Is the date right?</strong> Publication dates, priority dates and grace periods all sometimes disqualify a reference outright.</li>
  <li><strong>For a combination:</strong> would a skilled person actually have combined these? Does one reference teach away from the other? Would combining them break the thing the first reference exists to do?</li>
</ol>

<p>"Teaching away" is the strongest obviousness argument available and the most under-used. If reference A exists specifically to avoid the problem that adding reference B would cause, the combination is not obvious — it is contrary to what A teaches.</p>

<h2>Step 3 — Decide, per rejection, whether to argue or amend</h2>

<table>
  <thead>
    <tr><th>Situation</th><th>Response</th></tr>
  </thead>
  <tbody>
    <tr><td>The reference does not disclose the element</td><td><strong>Argue.</strong> Quote the reference, name the missing element, keep your scope.</td></tr>
    <tr><td>It does disclose it, but your dependent claim adds something it lacks</td><td><strong>Amend</strong> by pulling that limitation up into the independent claim.</td></tr>
    <tr><td>The combination is unmotivated or teaches away</td><td><strong>Argue</strong> the combination, not the individual references.</td></tr>
    <tr><td>The claim is genuinely unclear</td><td><strong>Amend.</strong> Clarity objections are not worth a round.</td></tr>
    <tr><td>Eligibility rejection</td><td><strong>Both:</strong> argue practical application and, where needed, amend to recite the technical mechanism from the description.</td></tr>
    <tr><td>Formal objection</td><td><strong>Comply.</strong> Always.</td></tr>
  </tbody>
</table>

<p>The default instinct — amend until the rejection disappears — is what produces narrow, commercially useless patents. Every narrowing amendment permanently gives up scope, and in the US it creates prosecution history estoppel, limiting your ability to reach equivalents later. Concede scope deliberately, in exchange for allowance, not reflexively to end an argument.</p>

<h2>Step 4 — Structure the response</h2>

<p>A response that persuades follows the examiner's own order and leaves nothing unanswered:</p>

<ol>
  <li><strong>Claim listing.</strong> Every claim, with its status marker (original / currently amended / cancelled / new) and amendments shown in the required format. Errors here get responses bounced on formalities.</li>
  <li><strong>Remarks, in the examiner's numbering.</strong> Take the rejections in the order raised, so nothing appears to have been skipped.</li>
  <li><strong>For each rejection:</strong> state the rejection, state your position in one sentence, then support it — quoting the claim language and the reference text, side by side.</li>
  <li><strong>Explain amendments and their support.</strong> Cite the paragraph of the specification as filed that supports each amendment. This forecloses a new-matter objection before it is raised.</li>
  <li><strong>Close with a request for allowance</strong> and an offer to discuss by interview.</li>
</ol>

<p>Two rules of tone. Be specific rather than assertive: "Smith does not disclose local retraining; paragraph [0042] describes retraining performed at a remote server" beats three paragraphs asserting that the invention is different. And do not characterise the invention more broadly than the claims do — everything you write becomes prosecution history that a court may read later.</p>

<h2>Office action deadlines</h2>

<table>
  <thead>
    <tr><th>Jurisdiction</th><th>Deadline</th><th>Extension</th></tr>
  </thead>
  <tbody>
    <tr><td>United States</td><td>3 months (usually)</td><td>Up to 6 months, fee rising each month</td></tr>
    <tr><td>India (FER)</td><td>6 months from issue</td><td>+3 months on request with fee</td></tr>
    <tr><td>EPO</td><td>Typically 4 months</td><td>Extension possible in defined circumstances</td></tr>
  </tbody>
</table>

<p>Missing a US deadline abandons the application, though revival on an unintentional-delay basis is available at a cost. In India, failing to put the application in order within the extended period means the application is deemed abandoned — and the Indian window is less forgiving in practice than the length suggests, because the response often requires foreign-application information and instructions from an overseas client.</p>

<aside class="note"><strong>Use the interview.</strong> A US examiner interview before filing the written response is free, routinely granted, and often decisive — you can put proposed amendment language in front of the examiner and find out whether it would be allowable before it becomes part of the permanent record. Firms that interview systematically prosecute in fewer rounds. The same applies to a hearing before the Indian Controller when objections are maintained.</aside>

<h2>What to do after a final rejection</h2>

<ul>
  <li><strong>Request for Continued Examination (US).</strong> Pay a fee, reopen prosecution, keep negotiating. Common and effective; also how prosecution costs quietly double.</li>
  <li><strong>Appeal.</strong> Slow — often two years or more — but the right route when the examiner's position is legally wrong rather than merely unfavourable.</li>
  <li><strong>After-final amendment.</strong> Limited, discretionary, worth trying where a small change would plainly place the case in condition for allowance.</li>
  <li><strong>Continuation or divisional.</strong> Take the allowable narrow claims now, and pursue the broader ones in a child application that keeps the priority date alive.</li>
  <li><strong>Abandon.</strong> Sometimes correct. If the only allowable claim is one no competitor would ever infringe, the maintenance fees are a subscription to nothing.</li>
</ul>

<h2>The pattern worth noticing</h2>

<p>Almost every difficult office action traces back to a claim drafted without knowing what the closest prior art actually said. The applicants who prosecute in one round are the ones who searched first, drafted claims that already accounted for the art, and had the technical improvement written into the specification before the examiner ever asked for it.</p>

<p>Which is to say: the cheapest office action response is written eighteen months earlier, during <a href="/blog/how-to-do-a-prior-art-search">the prior-art search</a> and the <a href="/blog/how-to-write-patent-claims">claim drafting</a>.</p>
`,
}
