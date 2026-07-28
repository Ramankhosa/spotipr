import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'ai-patent-drafting',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 68,
  title: 'AI patent drafting: what it does well, and where it fails',
  subtitle:
    'An honest account of which parts of drafting a patent application AI genuinely accelerates, which parts it quietly damages, and how to supervise it.',
  excerpt:
    'AI drafting tools can write a specification in minutes. That is the easy part of the job. Here is a candid breakdown of what they do well, the four failure modes to watch for, and a workflow that keeps a human where the decisions are.',
  answerSummary:
    'AI drafting tools are genuinely good at the volumetric parts of a patent application: expanding an embodiment into a full description, generating alternatives and definitions, drafting dependent claims, summaries and abstracts, and reformatting between jurisdictions. They are unreliable at the judgement work — deciding claim scope against prior art, assessing inventive step and handling eligibility — because those depend on knowing what the art already covers and what a court would make of a word.',
  keyTakeaways: [
    'The bottleneck in patent drafting was never typing; it was deciding what to claim. AI compresses the typing, which is real time saved, but leaves the deciding where it was.',
    'The strongest, most reliable use is description expansion: turning one worked embodiment plus a claim set into a complete, internally consistent specification with alternatives, definitions and figure references.',
    'The most dangerous failure is confident over-claiming — a model will happily produce a broad claim 1 that reads directly onto prior art it never saw, and the text looks exactly as authoritative as a good claim.',
    'Every AI-generated factual statement in a specification is a liability until checked: fabricated citations, invented parameter ranges and unsupported performance figures all create prosecution and, later, validity problems.',
    'Confidentiality is a live risk. An unfiled invention pasted into a consumer chatbot may become a disclosure issue; use tools with contractual confidentiality and no training on your data.',
    'Nothing in AI drafting changes who signs. In most jurisdictions only a registered practitioner may prosecute on another’s behalf, and the duty of candour applies to what the filing says, not to who typed it.',
  ],
  faqs: [
    {
      question: 'Can AI legally draft a patent application?',
      answer:
        'A tool can produce text; the responsibility remains with the person who files it. In most jurisdictions only a registered patent attorney or agent may represent another party before the office, and professional duties — accuracy, candour, competence — attach to the filing regardless of how it was produced. Inventors filing on their own behalf may use whatever tools they like and carry the consequences themselves.',
    },
    {
      question: 'Does using AI affect inventorship?',
      answer:
        'Inventorship attaches to the conception of the invention, not to the drafting of the document. Using AI to write the specification does not change who invented it. What is unsettled is the separate question of AI as an inventor of the underlying invention — the USPTO, the EPO and the UK have all held that an inventor must be a natural person, and the USPTO’s inventorship guidance requires a significant human contribution to the claimed conception.',
    },
    {
      question: 'Is it safe to paste my invention into a chatbot?',
      answer:
        'Not into a consumer product with default settings. Two risks: the provider may retain and train on the input, and — depending on the terms and how the content is handled — you may weaken your position on confidentiality before filing. Use enterprise tooling with contractual confidentiality and training opt-out, or a tool built for the purpose, and file a provisional before circulating the disclosure widely.',
    },
    {
      question: 'Will an examiner know the application was AI-drafted?',
      answer:
        'There is no disclosure requirement in the major offices, and no reliable detector. What examiners do notice are the symptoms: claim sets with no clear point of novelty, descriptions that repeat the claims in longer words, boilerplate alternatives that the claims never use, and inconsistent terminology. Those attract objections on their own merits.',
    },
    {
      question: 'Where does AI save the most time in a real drafting workflow?',
      answer:
        'In our experience, three places: expanding a settled claim set into a full description, generating first-draft dependent claims from a feature list, and adapting a specification between jurisdiction formats. Together these are a large share of the hours and almost none of the judgement.',
    },
  ],
  focusKeyword: 'ai patent drafting',
  secondaryKeywords: [
    'ai patent drafting software',
    'can ai write a patent application',
    'automated patent drafting',
    'ai for patent attorneys',
  ],
  tags: ['artificial-intelligence', 'drafting', 'tools', 'practice-management'],
  jurisdictions: ['US', 'EP', 'IN', 'PCT'],
  seoTitle: 'AI patent drafting: what it does well and where it fails',
  seoDescription:
    'An honest assessment of AI patent drafting in 2026: which parts of the work it accelerates, the four failure modes to watch for, and a supervision workflow that protects claim scope.',
  relatedSlugs: ['how-to-write-patent-claims', 'software-patent-eligibility', 'how-to-do-a-prior-art-search'],
  content: `
<p>We build patent drafting software, so treat what follows with the scepticism that deserves. It is written to be useful rather than flattering, because the version of this argument that oversells the technology is the one that gets practitioners burned and then makes them distrust the whole category.</p>

<p>The honest summary: AI has substantially changed the cost of <em>producing</em> a patent application, and has barely touched the cost of <em>deciding</em> what should be in one. Those are different halves of the job, and confusing them is where the damage happens.</p>

<h2>What is AI patent drafting genuinely good at?</h2>

<h3>Expanding an embodiment into a full description</h3>

<p>This is the strongest use case by a distance. Give a model a settled claim set, one worked embodiment and a feature list, and it will produce a complete, internally consistent description: element-by-element walkthroughs, figure references, definitions, and the alternative embodiments that preserve scope. Hours of work, done in minutes, with a quality ceiling limited mainly by what you fed it.</p>

<p>It works because this task is <em>expansion under constraint</em> — the decisions have already been made and the model is executing them consistently. That is precisely what language models are reliable at.</p>

<h3>Generating dependent claims from a feature list</h3>

<p>Twelve dependent claims, each adding one distinct limitation, correctly formatted with proper antecedent basis, in the office's preferred style. A model does this well and fast. You still choose which features are worth a claim and in what order — but the mechanical drafting is genuinely solved.</p>

<h3>Jurisdictional reformatting</h3>

<p>Converting a US-style specification into EPO two-part form, restructuring for Indian practice, adjusting claim counts to fee thresholds, generating the summary sections each office expects. Tedious, rule-governed, error-prone by hand, and well suited to automation.</p>

<h3>Prior art triage</h3>

<p>Semantic search finds documents that are conceptually close but share no vocabulary — exactly the blind spot in keyword searching. A model summarising forty documents against your feature matrix, flagging the five that need a human, is a real change in what one person can review in a day. It is triage, not judgement: which of those differences is technically meaningful remains yours. See <a href="/blog/how-to-do-a-prior-art-search">how to run a prior-art search</a>.</p>

<h3>Consistency checking</h3>

<p>The unglamorous work where machines beat humans outright: claim terms without antecedent basis, reference numerals that appear in the figures but not the text, claims referring to elements the description never mentions, terminology that drifts between "processor" and "controller" across forty pages. This is proofreading against rules, and it should be automated in every workflow.</p>

<h2>Where does AI patent drafting fail?</h2>

<h3>1. Confident over-claiming</h3>

<p>The most consequential failure. Ask for a broad independent claim and you will get one — fluent, well-formed, and frequently reading straight onto prior art the model never saw. It has no representation of what has already been claimed in your field; it is producing text shaped like a broad claim.</p>

<p>What makes this dangerous rather than merely wrong is that a bad claim and a good claim look identical on the page. A drafter who has read the closest art spots the problem in seconds; one who has not may file it.</p>

<p><strong>Mitigation:</strong> never let claim scope be set by a model. Search first, build the feature matrix, decide the minimum novel element set yourself, then use AI to draft <em>around that decision</em>.</p>

<h3>2. Fabricated specifics</h3>

<p>Models generate plausible detail on demand: parameter ranges, material properties, citations, performance figures. In a patent specification those become representations about the invention that you cannot support — a problem during prosecution when an examiner asks for basis, and a considerably larger problem years later if validity is challenged.</p>

<p><strong>Mitigation:</strong> treat every number and citation in generated text as unverified until an engineer or inventor confirms it. Anything nobody can confirm comes out.</p>

<h3>3. Eligibility blind spots</h3>

<p>Software and AI applications live or die on whether the claim recites a technical improvement rather than a result. Models default to results-language — "configured to optimise", "so as to improve efficiency" — because that is how the training corpus talks. It is also precisely what draws §101, Article 52 and Section 3(k) objections. The details are in <a href="/blog/software-patent-eligibility">are software and AI inventions patentable?</a>.</p>

<p><strong>Mitigation:</strong> have the technical problem and the technical mechanism written down before generation starts, and check every claim against them afterwards.</p>

<h3>4. Volume without judgement</h3>

<p>A tool that produces 60 pages in 20 minutes creates a reviewing problem where there used to be a writing problem. Long specifications cost more in translation and excess-page fees, take longer to prosecute, and — worst — hide the invention. Examiners are not paid to look for your point of novelty in paragraph 240.</p>

<p><strong>Mitigation:</strong> set a length target before drafting, and cut generated alternatives that no claim relies on.</p>

<p>One legal boundary is settled and worth stating plainly: the <a href="https://www.uspto.gov/">USPTO</a>, the <a href="https://www.epo.org/">EPO</a> and the UK office have all held that a named inventor must be a natural person, and USPTO inventorship guidance requires a significant human contribution to the claimed conception. AI patent drafting changes who writes the document; it does not change who invented the invention.</p>

<h2>An AI patent drafting workflow that keeps the judgement human</h2>

<table>
  <thead>
    <tr><th>Stage</th><th>Who leads</th><th>What AI contributes</th></tr>
  </thead>
  <tbody>
    <tr><td>Invention capture</td><td>Inventor + attorney</td><td>Structured questions; gap-spotting in the disclosure</td></tr>
    <tr><td>Prior art search</td><td>Attorney or searcher</td><td>Semantic retrieval, summarisation, first-pass feature mapping</td></tr>
    <tr><td><strong>Claim scope decision</strong></td><td><strong>Attorney — alone</strong></td><td><strong>Nothing. This is the job.</strong></td></tr>
    <tr><td>Independent claim drafting</td><td>Attorney</td><td>Wording variants of a decided scope</td></tr>
    <tr><td>Dependent claims</td><td>AI drafts, attorney selects</td><td>Full first draft from the feature list</td></tr>
    <tr><td>Description</td><td>AI drafts, attorney edits</td><td>Expansion, alternatives, definitions, figure text</td></tr>
    <tr><td>Figures</td><td>Attorney + draughtsperson</td><td>Numbering consistency, reference checking</td></tr>
    <tr><td>Consistency pass</td><td>AI</td><td>Antecedent basis, numerals, terminology drift</td></tr>
    <tr><td><strong>Final review and filing</strong></td><td><strong>Attorney — alone</strong></td><td><strong>Nothing</strong></td></tr>
  </tbody>
</table>

<p>Read down the "who leads" column and the pattern is clear: AI owns the volume, humans own the decisions. Every serious failure we have seen came from moving one row up the table.</p>

<h2>What to ask an AI patent drafting vendor</h2>

<p>Including us. If a tool cannot answer these plainly, that is your answer:</p>

<ol>
  <li><strong>Is my unfiled disclosure used to train models?</strong> The only acceptable answer is no, in writing.</li>
  <li><strong>Where is the data stored and processed?</strong> Jurisdiction matters for privilege and for export control on some subject matter.</li>
  <li><strong>Can I see why it produced this?</strong> Traceability from output back to the disclosure is the difference between a draft you can check and one you must trust.</li>
  <li><strong>Does it search real prior art, or generate from a prompt?</strong> These are entirely different products often described in the same language.</li>
  <li><strong>What does it do when it does not know?</strong> A tool that flags a gap is safer than one that fills it with plausible text.</li>
  <li><strong>Who owns the output?</strong> Read the terms.</li>
</ol>

<aside class="note"><strong>The realistic gain.</strong> Practitioners running a supervised workflow report roughly 30–50% less time on a first draft — concentrated in description writing and formatting, not in claim strategy. That is a genuine and significant improvement. It is not the same as "AI writes your patent", and firms that sell the second thing tend to deliver the first anyway.</aside>

<h2>The part that has not changed</h2>

<p>A patent is a legal instrument whose value is decided years later by whether one sentence covers a product somebody built. That sentence still has to be written by someone who has read the prior art, understands the technology, and can predict how an examiner and a court will read a word. No current tool does that, and the honest ones do not claim to.</p>

<p>What has changed is that the eight hours that used to go into producing pages can now go into the decisions that determine whether the patent is worth anything. That is a better trade than it sounds — provided the hours actually move, rather than simply disappearing from the bill.</p>
`,
}
