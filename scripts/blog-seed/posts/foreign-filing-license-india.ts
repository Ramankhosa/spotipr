import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'foreign-filing-license-india',
  categorySlug: 'filing-and-prosecution',
  publishedDaysAgo: 21,
  title: 'Foreign filing license in India: the Section 39 trap',
  subtitle:
    'Section 39 turns on residence, not citizenship — and it catches multinational teams that never thought to ask where an inventor lives. The rule, the trap and the fix.',
  excerpt:
    'One Bengaluru-based co-inventor on a US-first provisional is enough to breach Section 39 of the Indian Patents Act. What the license is, who needs it, how Form 25 works, and the workflow that keeps global filing programmes out of trouble.',
  answerSummary:
    'A foreign filing license is written permission from the Indian Patent Office, requested on Form 25, that a person resident in India needs before filing a patent application outside India. Residence, not citizenship, is the test. It is unnecessary only when the same invention was filed in India at least six weeks earlier and no secrecy direction is in force. Skipping it risks deemed abandonment, revocation and criminal penalties.',
  keyTakeaways: [
    'Section 39 of the Indian Patents Act applies to anyone resident in India — an American engineer posted to Bengaluru is covered, an Indian citizen settled in Munich is not.',
    'India allows two lawful routes to a foreign first filing: permission on Form 25, or an Indian application for the same invention that is at least six weeks old with no secrecy direction in force.',
    'Form 25 requests in India are ordinarily disposed of within 21 days under Rule 71(2), which usually makes the license faster than waiting out the six weeks after an Indian first filing.',
    'The United States ties its foreign filing license to where the invention was made and grants it routinely with the filing receipt — full US compliance therefore proves nothing about Section 39 in India.',
    'A PCT application filed at a receiving office outside India counts as a foreign filing for Section 39 purposes, so the international route is not a way around the Indian rule.',
  ],
  faqs: [
    {
      question: 'Does Section 39 apply to foreign citizens working in India?',
      answer:
        'Yes. The test is residence, not citizenship. A German or American engineer living and working in India is a person resident in India for Section 39 purposes, and needs the license — or a six-week-old Indian filing with no secrecy direction — before an application for their invention is filed abroad. Conversely, an Indian citizen genuinely resident abroad is outside the section. Passport colour tells you nothing; the address does.',
    },
    {
      question: 'Does a PCT application count as a foreign filing under Section 39?',
      answer:
        'Yes, if it is filed at a receiving office outside the conditions Section 39 sets. A PCT application filed abroad for an invention with an India-resident inventor is a foreign filing like any other, and needs either the license or an Indian application at least six weeks old with no secrecy direction in force. Teams sometimes assume the international route is jurisdiction-neutral; for Section 39 purposes it is not.',
    },
    {
      question: 'How long does the license take in India?',
      answer:
        'Under Rule 71(2) of the Patents Rules, a Form 25 request is ordinarily disposed of within 21 days. In a real filing schedule that makes it the fast path: three weeks is easier to absorb than the six-week wait that follows an Indian first filing, and it does not force you to restructure which country gets the priority application. Build the three weeks into the plan rather than discovering them at the deadline.',
    },
    {
      question: 'What if the applicant is a foreign company but one inventor lives in India?',
      answer:
        'The obligation attaches to the person resident in India, not to the company or its place of incorporation. A US applicant with no Indian presence still has a Section 39 problem if a named inventor is resident in India when the first filing is made abroad. The filing programme has to clear the section before that filing: either obtain the license on Form 25 or make the first filing in India and wait out the six weeks.',
    },
    {
      question: 'What are the penalties for breaching Section 39?',
      answer:
        'Two levels. Under Section 40, the corresponding Indian application is deemed abandoned and any patent granted on it is liable to revocation — the commercial consequence, and the one that surfaces years later in due diligence or litigation. Under Section 118, contravention is a criminal offence; check the current text of the Act for the penalty as amended. If a breach has already happened, involve Indian counsel immediately rather than filing onwards as if nothing occurred.',
    },
  ],
  focusKeyword: 'foreign filing license',
  secondaryKeywords: [
    'section 39 patents act',
    'form 25 india',
    'first filing in india',
    'foreign filing permission india',
  ],
  tags: ['india', 'filing', 'section-39', 'international'],
  jurisdictions: ['IN', 'PCT'],
  seoTitle: 'Foreign filing license in India: the Section 39 trap',
  seoDescription:
    'Section 39 requires India-resident inventors to get a foreign filing license before filing abroad. Who is caught, how Form 25 works, and the safe workflow.',
  relatedSlugs: ['patent-filing-forms-india', 'pct-national-phase-deadlines', 'patent-cost-in-india'],
  content: `
<p>Section 39 of the Indian Patents Act is the most commonly tripped-over rule in Indian patent practice, and the people it catches are rarely careless. They are in-house counsel running a tidy multinational filing programme who did not know one inventor had moved to Pune. The rule itself is short: a person resident in India must not apply for a patent outside India without a foreign filing license from the Indian Patent Office, unless an application for the same invention was filed in India at least six weeks earlier and no secrecy direction is in force.</p>

<p>Residence, not citizenship. An American engineer on a two-year posting in Bengaluru is inside the section; an Indian citizen settled in Munich is outside it. That one word does most of the damage described below.</p>

<h2>What is a foreign filing license and who needs one?</h2>

<p>A foreign filing license (FFL) is written permission from the Controller to file a patent application outside India, requested on Form 25. Section 39 demands it of every person resident in India — inventor or applicant — before a first filing abroad.</p>

<p>There are exactly two lawful routes to filing outside India:</p>

<ul>
  <li><strong>India-first:</strong> file the application in India, wait at least six weeks, confirm no secrecy direction under Section 35 has issued, and then file abroad freely.</li>
  <li><strong>License-first:</strong> obtain the FFL on Form 25, then file abroad directly — no Indian filing required at all.</li>
</ul>

<p>Note what the section does not care about: where the company is incorporated, where the invention was conceived, or where the patent will eventually be enforced. It attaches to people. A Delaware corporation with no Indian office still has a Section 39 problem if one of the five named inventors lives in Hyderabad.</p>

<h2>Why do multinational teams get caught?</h2>

<p>Because nothing in a US- or Europe-centric workflow asks the question. Three scenarios cover most of the incidents we see:</p>

<ol>
  <li><strong>The US-first provisional with a Bengaluru co-inventor.</strong> US counsel files the provisional the way they always do — fast, quiet, priority secured. One of the inventors is on the company’s India engineering team. Section 39 applied to that inventor from the moment the filing was made abroad, and nobody in the chain ever asked where the inventors live.</li>
  <li><strong>The PCT filed abroad.</strong> A PCT application filed at a receiving office outside India counts as a foreign filing for Section 39 purposes unless the Indian-filing-plus-six-weeks condition is already met. The international route feels jurisdiction-neutral; for Section 39 it is simply a filing abroad. The same team then plans <a href="/blog/pct-national-phase-deadlines">national phase entries</a> around a priority filing that India regards as unlawful.</li>
  <li><strong>The mid-project relocation.</strong> The inventor lived in Boston when the project began and in Hyderabad by the time the next application in the family was filed. The filing programme kept running on autopilot — but at that later filing there was an India-resident inventor on the team, and the programme never re-checked.</li>
  <li><strong>The acquired R&amp;D centre.</strong> A US or European company buys an Indian engineering business, or opens a development centre in Chennai, and inherits a pipeline of inventors the filing playbook was never written for. The playbook says nothing about Section 39 because it never needed to; the first joint invention out of the new team walks straight into it.</li>
</ol>

<p>The fix is organisational and boring: record the country of residence for every inventor when the disclosure is captured, and re-confirm it at every filing event. One field on the intake form is the entire apparatus — see <a href="/blog/invention-disclosure-to-filing">from invention disclosure to filing</a>.</p>

<h2>How do you request one?</h2>

<p>File Form 25 at the Indian Patent Office. It carries the applicant and inventor details, the reason for filing abroad, and a brief description of the invention — enough for the office to judge the subject matter. Attaching a draft specification or a clear technical summary helps; the easier the invention is to assess, the smoother the disposal.</p>

<p>Under Rule 71(2) of the Patents Rules, the request is ordinarily disposed of within 21 days. That number reshapes the decision: three weeks of waiting is compatible with most filing schedules, while the alternative — an Indian first filing plus a six-week wait — takes longer and dictates where your priority application lives. The permission is forward-looking only: it authorises a filing you have not yet made, so request it before the foreign filing, not as a repair afterwards.</p>

<p>Three practicalities. First, no Indian patent application is needed — the license-first route exists precisely so that the priority filing can happen abroad. Second, a registered Indian patent agent normally prepares and files Form 25; the current form and rules text are on <a href="https://ipindia.gov.in/">ipindia.gov.in</a>. Third, when the grant comes back, file it with the family’s records. Years later, an acquirer’s diligence team will ask how an application with a Hyderabad-based inventor came to be first filed in Delaware; a one-page license answers the question, and its absence starts a much longer conversation. Form 25 sits alongside the rest of the Indian filing paperwork — see <a href="/blog/patent-filing-forms-india">patent filing forms in India</a> for the full set.</p>

<h2>What happens if you skip the foreign filing license?</h2>

<p>The consequences are structural, not administrative. Under Section 40, the corresponding Indian application is deemed to have been abandoned, and any patent already granted on it is liable to be revoked. Under Section 118, contravention of Section 39 is a criminal offence — check the current text of the Act for the penalty as amended.</p>

<p>Section 40 is the commercial teeth. It does not fine you; it removes the Indian patent from the family. And because revocation liability attaches to the granted patent, the defect does not fade with time — it sits in the file for an opponent, or an acquirer’s diligence team, to find years later. A procedural miss at the start of a programme becomes a validity argument at the end of it.</p>

<p>The economics are badly asymmetric. Clearing the section costs a form and three weeks; breaching it puts the Indian member of the family permanently at risk, in a market that is increasingly the point of the filing. If a historic breach does surface, resist the instinct to keep filing as if nothing happened — get Indian counsel to look at the specific facts before the next application in the family goes anywhere.</p>

<h2>How do other countries handle foreign filing restrictions?</h2>

<p>India is not unusual in having a rule; it is unusual in what triggers it. The US and China regulate where the invention was <em>made</em>; India regulates where the inventor <em>lives</em>.</p>

<table>
  <thead>
    <tr><th>Jurisdiction</th><th>Trigger</th><th>What is required</th></tr>
  </thead>
  <tbody>
    <tr><td>India</td><td>Any person resident in India applying abroad</td><td>Foreign filing license on Form 25, or an Indian filing at least six weeks old with no secrecy direction</td></tr>
    <tr><td>United States</td><td>Invention made in the US (35 U.S.C. 184)</td><td>A foreign filing license, routinely granted automatically with the filing receipt — see <a href="https://www.uspto.gov/">uspto.gov</a></td></tr>
    <tr><td>China</td><td>Invention made in China</td><td>A confidentiality examination before any foreign filing</td></tr>
    <tr><td>United Kingdom</td><td>Security-sensitive inventions only</td><td>Restrictions on a narrow class; most filings are unaffected</td></tr>
  </tbody>
</table>

<p>The gap between the triggers is exactly where teams fall. A US company can be fully compliant with 35 U.S.C. 184 — license granted automatically on its filing receipt — and simultaneously in breach of Section 39, because the two rules ask different questions about the same filing. Nor does the <a href="https://www.wipo.int/">PCT</a> offer shelter: an international application filed at a receiving office abroad is, for Section 39, a foreign filing like any other.</p>

<h2>What is the safe workflow?</h2>

<figure>
<svg viewBox="0 0 760 470" role="img" aria-label="Decision flowchart for teams with an India-resident inventor showing when a foreign filing license or an Indian first filing is required before filing abroad" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif">
<title>Decision flowchart for teams with an India-resident inventor showing when a foreign filing license or an Indian first filing is required before filing abroad</title>
<defs>
<marker id="ffl-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d4ed8"/></marker>
<marker id="ffl-grey" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#98a2b3"/></marker>
</defs>
<rect x="40" y="28" width="290" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="185" y="55" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">Any inventor resident in India?</text>
<text x="185" y="76" text-anchor="middle" font-size="13" fill="#667085">residence, not citizenship</text>
<rect x="470" y="28" width="250" height="64" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="1.5"/>
<text x="595" y="55" text-anchor="middle" font-size="15" font-weight="600" fill="#1d4ed8">No Section 39 issue</text>
<text x="595" y="76" text-anchor="middle" font-size="13" fill="#344054">file anywhere</text>
<line x1="330" y1="60" x2="462" y2="60" stroke="#1d4ed8" stroke-width="1.5" marker-end="url(#ffl-blue)"/>
<text x="390" y="50" font-size="13" fill="#667085">no</text>
<line x1="185" y1="92" x2="185" y2="128" stroke="#98a2b3" stroke-width="1.5" marker-end="url(#ffl-grey)"/>
<text x="197" y="116" font-size="13" fill="#667085">yes</text>
<rect x="40" y="136" width="290" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="185" y="163" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">First filing outside India?</text>
<text x="185" y="184" text-anchor="middle" font-size="13" fill="#667085">a PCT filed abroad counts</text>
<rect x="470" y="136" width="250" height="80" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="1.5"/>
<text x="595" y="163" text-anchor="middle" font-size="15" font-weight="600" fill="#1d4ed8">File in India first</text>
<text x="595" y="184" text-anchor="middle" font-size="13" fill="#344054">wait 6 weeks, confirm no secrecy</text>
<text x="595" y="203" text-anchor="middle" font-size="13" fill="#344054">direction — then file abroad</text>
<line x1="330" y1="168" x2="462" y2="168" stroke="#1d4ed8" stroke-width="1.5" marker-end="url(#ffl-blue)"/>
<text x="390" y="158" font-size="13" fill="#667085">no</text>
<line x1="185" y1="200" x2="185" y2="240" stroke="#98a2b3" stroke-width="1.5" marker-end="url(#ffl-grey)"/>
<text x="197" y="226" font-size="13" fill="#667085">yes</text>
<rect x="40" y="248" width="290" height="72" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="185" y="276" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">Foreign filing license granted?</text>
<text x="185" y="297" text-anchor="middle" font-size="13" fill="#667085">Form 25 — ordinarily disposed in ~21 days</text>
<rect x="470" y="252" width="250" height="64" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="1.5"/>
<text x="595" y="279" text-anchor="middle" font-size="15" font-weight="600" fill="#1d4ed8">File abroad</text>
<text x="595" y="300" text-anchor="middle" font-size="13" fill="#344054">with the FFL on record</text>
<line x1="330" y1="284" x2="462" y2="284" stroke="#1d4ed8" stroke-width="1.5" marker-end="url(#ffl-blue)"/>
<text x="390" y="274" font-size="13" fill="#667085">yes</text>
<line x1="185" y1="320" x2="185" y2="360" stroke="#98a2b3" stroke-width="1.5" marker-end="url(#ffl-grey)"/>
<text x="197" y="346" font-size="13" fill="#667085">not yet</text>
<rect x="40" y="368" width="340" height="76" rx="8" fill="#f7f8fa" stroke="#98a2b3"/>
<text x="210" y="395" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">Do not file abroad</text>
<text x="210" y="416" text-anchor="middle" font-size="13" fill="#667085">Section 40: deemed abandonment, revocation risk</text>
<text x="210" y="434" text-anchor="middle" font-size="13" fill="#667085">Section 118: criminal penalties</text>
</svg>
<figcaption>Fig. 1 — The Section 39 decision. Cobalt paths are the safe exits; everything else waits.</figcaption>
</figure>

<p>Reduced to a calendar decision, the two safe branches look like this:</p>

<ul>
  <li><strong>India-first</strong> suits India-centric portfolios: file in India, wait six weeks, confirm no secrecy direction, then file abroad. It costs six weeks and requires no permission, and the priority application sits in the jurisdiction where the team lives.</li>
  <li><strong>License-first</strong> suits US-first or PCT-first programmes that happen to have an India-resident inventor: Form 25, roughly 21 days under Rule 71(2), then file wherever the programme dictates.</li>
</ul>

<p>As a standing policy for a global company, three lines cover it:</p>

<ol>
  <li>Every invention disclosure records country of residence for every inventor, and the answer is re-confirmed at each filing event — filings, not conceptions, are what Section 39 regulates.</li>
  <li>If any inventor is resident in India and the first filing will happen abroad, Form 25 goes in before the filing is scheduled, with the ~21-day disposal built into the timeline.</li>
  <li>Whenever India-first is chosen instead, the six-week date is diarised, and the foreign filings hold until it passes with no secrecy direction on the file.</li>
</ol>

<p>Whichever branch you take, the compliance apparatus is one question asked early: country of residence, for each inventor, at disclosure and again at filing. Teams that ask it never meet Section 39 again; teams that do not tend to meet it in diligence. If your filings start in India, PatentNest drafts India-ready specifications and the filing bundle around them — <a href="/free-trial">start a free trial</a>. The residence check costs one line on a form; skipping it can cost the Indian patent.</p>
`,
}
