import { BasePatentService, LLMResult, User } from './base-patent-service';
import { llmGateway } from './metering/gateway';
import { prisma } from './prisma';
import { TaskCode, NoveltySearchStatus, NoveltySearchStage, Prisma } from '@prisma/client';
import { IdeaBankService } from './idea-bank-service';
import { ideaBankFunnel, isIdeaBankGenerationEnabled, type IdeaFunnelInput, type PriorArtAnalysisItem } from './idea-bank-funnel';
import { trackServiceUsage } from './service-usage-tracker';
import { checkServiceAccess } from './org-access-service';
import { sendEmail } from './mailer';
import crypto from 'crypto';
import { patentSearchOrchestrator, type PatentRetrievalQuery, type PatentSearchConceptGroup, type PatentSearchFilters, type PatentSearchQueryPlan, type PatentSearchSourceMode } from '@/lib/patent-search';
import { fetchLocalPatentClaims } from '@/lib/local-patent-claims-service';
import { compactLogDetails } from '@/lib/patent-search/provider-runtime';
import {
  literatureSearchService,
  normalizeLiteratureCandidate,
  type LiteratureSearchOptions,
} from '@/lib/literature-search-service';
import {
  DEFAULT_MINIMUM_VISIBLE_CONFIDENCE,
  DEFAULT_VISIBLE_PRIOR_ART_LIMIT,
  buildVisiblePriorArtResults,
  canonicalPriorArtNumber,
  getPriorArtPublicationNumber,
  matchCategoryFromDecision,
  matchCategoryLabel,
  normalizeRerankDecision,
  type PriorArtGateRecord,
} from '@/lib/novelty-prior-art-visibility';

const FEATURE_MAPPING_CACHE_VERSION = 'v1.2';
const STAGE15_GATE_CACHE_VERSION = 'stage15-gate-v3';

// How many LLM batches each novelty stage runs at once (per search). Tune via the
// NOVELTY_LLM_CONCURRENCY env var; hard-capped so a bad value can't hammer the
// provider's rate limits. NOTE: this is per-search — N concurrent searches multiply it.
const NOVELTY_LLM_MAX_CONCURRENCY = 12;
const NOVELTY_LLM_CONCURRENCY = Math.max(
  1,
  Math.min(NOVELTY_LLM_MAX_CONCURRENCY, Math.trunc(Number(process.env.NOVELTY_LLM_CONCURRENCY) || 6))
);

function escapeEmailHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildAuthenticatedNoveltyReportUrl(searchId: string): string {
  const appUrl = String(process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://patentnest.ai').replace(/\/$/, '');
  return `${appUrl}/novelty-search/${encodeURIComponent(searchId)}/pdf`;
}

function searchSourceIncludesEpo(mode?: string | null): boolean {
  return mode === 'EPO_ONLY' || mode === 'PQAI_PLUS_EPO' || mode === 'PQAI_PLUS_INDIAN_EPO';
}

function removeEpoKeywordInstructions(prompt: string): string {
  return prompt
    .replace(/\n  "epoTitleKeywords": \["short object\/system phrase likely to appear in a European patent title"\],\n  "epoAbstractKeywords": \["mechanism\/function phrase likely to appear in a European patent abstract"\],\n  "epoCombinedKeywords": \["fallback phrase suitable for either European patent title or abstract"\],/g, '')
    .replace(/\nEPO TITLE\/ABSTRACT KEYWORD SEARCH:\n- epoTitleKeywords are for EPO OPS title field searches\.[\s\S]*?- Do not duplicate phrases across epoTitleKeywords, epoAbstractKeywords, and epoCombinedKeywords unless the phrase is essential\.\n/g, '\n');
}

// LLM Prompt Specification for Novelty Search (enhanced versions)
export const NOVELTY_SEARCH_NORMALIZATION_PROMPT = `

You are a patent search strategist. Analyze the invention and return ONLY a JSON object.

INVENTION TITLE: {title}

INVENTION DESCRIPTION:

{rawIdea}

OUTPUT FORMAT â€” Return ONLY valid JSON (one object). No markdown fences, no pre/post text, no explanations.

{

  "searchQuery": "plain-English query ≤35 words describing what the invention is and how it works, suitable for patent database search",

  "invention_features": ["feature 1", "feature 2", "feature 3"],

  "inventionType": ["MECHANICAL", "SOFTWARE"]

}

GLOBAL RULES

- Output must be valid JSON (double-quoted keys/values, comma-separated).
- "inventionType": Select 1-2 best fit archetypes for the invention logic.
  - MECHANICAL: Physical structures, moving parts, tools, housing, hinges.
  - SOFTWARE: Algorithms, data processing, AI, cloud platforms, blockchain.
  - CHEMICAL: Compounds, compositions, formulations, synthesis methods.
  - ELECTRICAL: Circuits, sensors, power systems, semiconductors, signal processing.
  - BIO: Genetics, proteins, medical treatments, diagnostics, organisms.
  - GENERAL: Fallback if no specific fit.

- Return only the JSON object; nothing else.

- Use ASCII characters only.

- Do not repeat identical phrases between "searchQuery" and any item in "invention_features".

- Avoid speculative claims, performance metrics, marketing language, or legal claim phrasing.

SEARCH QUERY (field: "searchQuery")

- ≤35 words, plain English, no boolean operators, no special query syntax.

- Convey the core technical concept and the key operating mechanism(s); ignore business use cases and background context.

- Use general technical terms that maximize recall while preserving the invention's distinctive mechanism(s).

FEATURE LIST (field: "invention_features")

- Return 3â€“8 items; each 3â€“8 words.

- Each item must be a distinct technical mechanism, structure, configuration, process step, or algorithmic controlâ€”not a benefit, result, or application context.

- Phrase features broadly enough to capture synonyms and domain-equivalent terms; avoid proprietary names.

- No overlap or near-duplicates across items.

GENERIC COMPONENT HANDLING

- Do NOT list trivial, everyday components (e.g., processor, memory, sensor, transceiver, database, display, battery, network module, housing, server, API) as standalone features.

- Include such elements ONLY when they play a non-obvious role or participate in a novel configuration/interaction/control logic/material property.

- Prefer integrating generics into higher-level mechanisms (e.g., "feedback-controlled microfluidic delivery" rather than separate "controller" and "pump").

QUALITY FILTERS (apply to both fields)

- Avoid outcome/benefit-only phrases (e.g., "real-time monitoring", "smart control") unless coupled to a concrete mechanism.

- Prefer integrative/feedback mechanisms that tie sensing â†” processing â†” actuation (or domain equivalents).

- Remove filler adjectives (e.g., smart, efficient, robust) unless technically specific.

- Keep nouns/noun-phrases primary; verbs only where they define a process step or control logic.

DOMAIN ADAPTATION (choose expressions appropriate to the invention's field)

- Mechanical/Civil/Materials: express mechanisms as configurations, load/flow/thermal paths, material-geometry relationships, joining/fabrication processes, kinematics/actuation.

- Electronics/Embedded/Comms: express data paths, control logic, signal processing chains, power/latency/energy mechanisms, protocol/architecture specifics where non-obvious.

- Software/AI/Data: express model class/learning or inference mechanism, control policy, data structures/flows, algorithmic pipelines; avoid "software module" generics.

- Medical Devices/Biomed: express biosensing/transduction principles, closed-loop control, delivery/actuation mechanisms, physiological interfacing, packaging/form factor integrations.

- Biotech/Pharma/Chem: express molecular structures/classes, formulation components/ratios, binding/interaction mechanisms, reaction pathways, process steps, release profiles, scaffold/vehicle properties.

CONSTRAINTS & VALIDATION

- If the invention has fewer than 3 core mechanisms, return fewer items (do not pad with generic or redundant features).

- Do not include citations, references, or prior-art IDs.

- Do not include units, claims language ("comprising/wherein"), or legal boilerplate.

FAIL-SAFES

- If uncertain, prioritize the most distinctive mid-level mechanisms (integration, control loop, configuration, interaction) over lists of generic parts or high-level benefits.

`;

export const NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2 = `
You are a patent novelty search strategist. Analyze the invention and return ONLY one valid JSON object.

INVENTION TITLE: {title}

INVENTION DESCRIPTION:
{rawIdea}

OUTPUT JSON SHAPE:
{
  "searchQuery": "plain-English patent search query, 12-35 words",
  "invention_features": ["mechanism-level feature"],
  "feature_details": [
    {
      "feature": "copy one invention_features item exactly",
      "feature_type": "core_technical|implementation|novelty_candidate|generic_weak",
      "user_disclosure": "what the user's invention specifically does for this feature",
      "technical_role": "why this feature matters technically",
      "source_excerpt": "short excerpt from the user disclosure, or empty string",
      "claimable_text": "attorney-style functional/structural phrase for claim positioning",
      "embedding_search_text": "controlled search/embedding phrase with synonyms and patent terminology",
      "feature_confidence": 0.0
    }
  ],
  "inventionType": ["MECHANICAL|SOFTWARE|CHEMICAL|ELECTRICAL|BIO|GENERAL"],
  "cpcCodes": ["optional CPC class hint, or empty array"],
  "ipcCodes": ["optional IPC class hint, or empty array"],
  "epoTitleKeywords": ["short object/system phrase likely to appear in a European patent title"],
  "epoAbstractKeywords": ["mechanism/function phrase likely to appear in a European patent abstract"],
  "epoCombinedKeywords": ["fallback phrase suitable for either European patent title or abstract"],
  "novelty_focus": ["feature most likely to drive novelty"],
  "novelty_focus_interactions": [
    {
      "type": "feature_interaction|single_feature|architecture",
      "description": "how linked features cooperate to create the novelty focus",
      "linked_features": ["copy invention_features items exactly"]
    }
  ],
  "architectural_innovation": "single sentence describing the cooperative invention-level architecture",
  "claim_concepts": [
    {
      "title": "short claim-positioning title",
      "linked_features": ["copy invention_features items exactly"],
      "claimable_summary": "how the linked features cooperate technically",
      "importance": "primary|secondary|fallback",
      "risk_if_missing": "what claim strength is lost if this concept is removed"
    }
  ],
  "search_exclusions": ["term that should not dominate search"],
  "google_concept_groups": [
    {
      "label": "short group label",
      "terms": ["2-5 interchangeable technical phrasings of ONE concept"],
      "required": true
    }
  ],
  "confidence": 0.0,
  "warnings": ["coverage or ambiguity warning"]
}

RULES:
- JSON only. No markdown, comments, citations, or text before/after JSON.
- Use ASCII only.
- Do not invent technical facts not present in the disclosure.
- Do not convert a hoped-for benefit into a technical feature unless the disclosure gives a concrete mechanism.
- The search query is used as the single PQAI query and as the broad local-corpus concept query.

FEATURE EXTRACTION DISCIPLINE:
- Return 3-8 invention_features unless the disclosure truly contains fewer; use up to 10 only when the disclosure contains many distinct concrete mechanisms.
- Keep invention_features as clean technical phrases. Do not prefix them with feature IDs such as "F1:" because retrieval and reports use these strings directly.
- Each invention_feature must be a standalone atomic technical phrase.
- Each invention_feature should capture only one technical object, mechanism, structure, material relationship, control relationship, process step, data flow, release mechanism, detection mechanism, verification mechanism, or algorithmic transformation.
- Do not combine multiple independent ideas into one feature.
- If a phrase contains multiple independent mechanisms joined by "and", split it into separate features unless the combined relationship itself is the invention.
- Order invention_features from broad core mechanisms to narrower differentiators.
- The first 2-4 features should describe baseline mechanisms likely to retrieve close prior art.
- Later features may capture narrower improvements or differentiators.
- Do not extract only the newest or most specific improvements; include the baseline mechanism that makes the invention searchable.
- Do not make features depend on the title or searchQuery for meaning.
- Do not repeat the full searchQuery or broad application field in every feature.
- Do not use benefits as features, such as "improved efficiency", "real-time monitoring", or "secure access", unless paired with a concrete mechanism.
- Do not extract only generic field labels such as device, system, composition, method, platform, app, server, controller, polymer, coating, sensor, module, or database.
- Do not list field-common generic components as standalone features. These include, by domain: engineering (processor, memory, sensor, controller, module, database, server, app, battery, housing, network, API); chemical/materials (composition, compound, polymer, coating, excipient, carrier, solvent); biological (sequence, vector, construct, antibody, assay, marker, cell line).
- Include generic components only when their specific interaction is material to novelty.
- invention_features must remain atomic and retrieval-friendly. Do not use them alone to represent the full inventive concept; use feature_details, architectural_innovation, claim_concepts, and novelty_focus_interactions for cooperative mechanisms.

FEATURE TYPE GUIDANCE:
- core_technical: a baseline technical object, architecture, mechanism, process, material structure, or transformation without which the invention would not work.
- novelty_candidate: a feature or feature interaction most likely to distinguish over prior art.
- implementation: a concrete but secondary embodiment, material choice, parameter, sensor, module, interface, manufacturing step, or deployment detail.
- generic_weak: a broad or field-common feature useful for context but not reliable alone for novelty or relevance gating.

FEATURE DETAILS RULES:
- feature_details must include exactly one row for each invention_features item.
- The feature field inside feature_details must copy the corresponding invention_features item exactly.
- user_disclosure must describe only what the user's disclosure actually says.
- technical_role must explain the technical function of the feature, not a market benefit.
- source_excerpt should quote or closely paraphrase the shortest available supporting phrase from the user disclosure.
- If the feature is inferred from the disclosure rather than explicitly stated, keep source_excerpt empty and mention the inference in warnings.
- Do not add materials, thresholds, ratios, dimensions, algorithms, sensors, biological targets, or data types unless disclosed.
- claimable_text must be 18-45 words and phrase the feature as functional/structural claim-positioning language without using claim boilerplate.
- embedding_search_text must be 12-30 words, must stay technical, and may include synonyms only when technically relevant.
- embedding_search_text must not include marketing words such as innovative, efficient, improved, advanced, or smart unless part of a known technical term.
- feature_confidence must reflect how directly the feature is supported by the submitted disclosure.

SEARCH QUERY DISCIPLINE:
- The searchQuery is for retrieving the closest prior art, not for proving novelty.
- Build searchQuery around the broad technical object, core operation, and baseline mechanism that older patents are likely to describe.
- If the invention contains both a known baseline workflow and a narrower improvement, put the baseline workflow in searchQuery and put the narrower improvement in novelty_focus.
- Do not overload searchQuery with every differentiator, threshold, formula, species, cryptographic step, exact sensor type, data format, material ratio, performance limit, or special embodiment unless that detail is essential to identify the invention category.
- A good searchQuery should still retrieve close prior art that lacks the invention's newest improvement.
- Construct searchQuery using this pattern when possible: technical object/system/process + primary operation + core mechanism/transformation + target object/material/data/condition.
- The search query must describe what the invention is and how it works, not its market benefit.
- Keep searchQuery broad and self-contained; do not stuff it with every feature.
- Prefer recall-oriented technical terms and preserve only the most central operating mechanism needed to find close prior art; avoid packing searchQuery with secondary refinements that belong in novelty_focus.

EPO TITLE/ABSTRACT KEYWORD SEARCH:
- epoTitleKeywords are for EPO OPS title field searches. Use 1-6 short noun phrases naming the technical object, system, device, composition, process, or controller likely to appear in patent titles.
- epoAbstractKeywords are for EPO OPS abstract field searches. Use 1-8 mechanism/function phrases likely to appear in abstracts, including operating mechanism, transformation, control relationship, material relationship, or process sequence.
- epoCombinedKeywords are fallback phrases useful in either title or abstract when the field is uncertain.
- Keep each EPO keyword phrase concise, normally 2-8 words. Do not use boolean syntax, wildcards, punctuation-heavy expressions, or full sentences.
- Do not duplicate phrases across epoTitleKeywords, epoAbstractKeywords, and epoCombinedKeywords unless the phrase is essential.

NOVELTY FOCUS RULES:
- novelty_focus must contain 1-4 features from invention_features that are most likely to distinguish over prior art.
- novelty_focus must copy feature strings exactly from invention_features.
- novelty_focus should usually prefer novelty_candidate features, but may include a core_technical feature if the core architecture itself appears novel.
- novelty_focus should hold differentiators that may be too narrow for the main searchQuery but important for later novelty assessment.
- novelty_focus must not include ordinary field-common parts unless their specific interaction is the likely inventive contribution. Prefer features involving a control relationship, material relationship, formulation relationship, biological target interaction, structural geometry, process sequence, signal-processing transformation, release/detection/verification mechanism, or measurable technical effect.
- novelty_focus_interactions must describe the cooperative relationship behind the novelty focus, not merely repeat one atomic feature.
- novelty_focus_interactions.linked_features must copy invention_features strings exactly.

CLAIM CONCEPT RULES:
- architectural_innovation must be one sentence and no more than 35 words.
- architectural_innovation must describe a cooperative architecture, such as X drives Y, A validates B, C controls D based on E, or P is stored for Q.
- architectural_innovation must not simply repeat the title.
- claim_concepts should group 2-5 related invention_features unless a single feature is genuinely claim-defining.
- Do not create more than 4 claim_concepts.
- claim_concepts.linked_features must copy invention_features strings exactly.
- claimable_summary must explain the technical relationship among linked features, not a market benefit.
- Prefer claim concepts that preserve causal or cooperative relationships such as identification driving control, sensing validating actuation, or generated records supporting traceability.

CLASSIFICATION:
- inventionType may include more than one category when appropriate.
- cpcCodes and ipcCodes should be empty arrays unless the class is strongly inferable from the disclosure.
- Use broad class hints only when they are likely to improve retrieval.

SEARCH EXCLUSIONS:
- search_exclusions should contain incidental, business-oriented, user-context, brand, marketing, or overly narrow embodiment terms that may pull irrelevant references or suppress close prior art.
- Do not exclude a term if it is necessary to identify the technical category of the invention.

GOOGLE PATENTS CONCEPT GROUPS (field: "google_concept_groups"):
- These drive a boolean Google Patents query of the form (group1 term OR synonyms) AND (group2 term OR synonyms).
- Return 2-3 groups. Each group is ONE concept expressed as 2-5 interchangeable technical phrasings a patent drafter might use.
- Group 1: the technical object/system/composition/process category (broad, REQUIRED).
- Group 2: the core operating mechanism, transformation, or control relationship (REQUIRED).
- Group 3 (optional): the most distinctive narrowing mechanism; set "required": false so it can widen instead of exclude.
- Terms must be 1-5 words, plain text. No boolean operators, wildcards, quotes, parentheses, or punctuation inside terms.
- Include domain synonyms and patent-style vocabulary variants (e.g. "dissolvable microneedle", "soluble microneedle array").
- Do not put two different concepts in the same group; do not repeat the same concept across groups.
- Groups must stay recall-safe: a close prior-art patent lacking the newest improvement should still match groups 1 and 2.

CONFIDENCE AND WARNINGS:
- confidence reflects disclosure sufficiency for novelty search, not patentability.
- warnings should call out missing mechanism detail, vague terms, missing materials, missing steps, missing data flow, missing control logic, missing experimental parameters, or weak search coverage risks.
- If the disclosure is mostly an idea or desired result without enough mechanism, extract only the disclosed mechanism and add a warning.
- If several features are speculative or inferred, lower confidence.
`;

// Legacy prompts moved to bottom of file

export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT = `You are a patent analyst mapping invention features to prior-art patents.

Return ONLY one valid JSON object.

INPUTS
FEATURES: {invention_features}
PATENTS: {patent_batch} (objects with pn, title, abstract, link)

TASK
For every patent and feature, decide:
- "Present" → mechanism clearly described in the text
- "Partial" → related but missing a key element
- "Absent" → not supported by the text

Use the supplied patent data fields only.
Match by meaning (synonyms, paraphrases) but require concrete evidence; generic words like "AI", "sensor", "module", "controller" don't qualify unless they implement the full mechanism.

When Present/Partial, quote ≤25 words from the patent as evidence (direct quote + optional short paraphrase ≤ 20 words).
If Absent, give a ≤20 word reason.

OUTPUT
Return JSON only:

{
  "feature_map": [
    {
      "pn": "string",
      "link": "string|null",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [
        {"feature":"string",
         "quote":"≤25-word verbatim excerpt",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "partial": [
        {"feature":"string",
         "quote":"≤25-word verbatim excerpt",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "absent": [
        {"feature":"string",
         "reason":"≤12 words"}
      ]
    }
  ],
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Present = 1.0, Partial = 0.5, Absent = 0 → average → coverage_score.
- Quote required for Present/Partial; reason required for Absent.
- No invented text or assumptions; rely only on given fields.
- Keep ASCII; no markdown, comments, or explanations.`;

// V2: Compact, semantic-aware feature mapping prompt for Stage 3.5a
export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V2 = `You are a patent analyst mapping invention FEATURES to prior-art PATENTS. Return ONE JSON object only.

INPUTS
FEATURES: {invention_features}  (array of strings; copy each feature verbatim)
PATENTS: {patent_batch}  (repeated blocks with lines: PN, Title, Abstract)

TASK
For each patent PN, classify EVERY feature EXACTLY ONCE as:
- Present = mechanism clearly described with concrete wording
- Partial = related but missing a required element/constraint
- Absent = no concrete evidence in the supplied patent data

Use the supplied patent data fields only.

SEMANTIC MATCHING
- Treat synonyms/paraphrases/hypernyms/hyponyms as matches if they implement the same mechanism.
- Example equivalences:
  - "AI-based image analysis" ~= "computer vision", "intelligent image processing", "image recognition", "machine vision".
  - "object detection" ~= "detecting objects", "localizing targets".
  - "classify images" ~= "image classification", "recognition via ML/CNN model".
- Present when the quote shows the mechanism in action (verb + object). Avoid generic mentions like "AI module" without the image mechanism.
- Partial when related terms appear but a required element/constraint is missing (e.g., the real-time or edge aspect).
- Absent only when no concrete evidence for the mechanism exists in the supplied patent data.

EVIDENCE AND CONFIDENCE
- Quotes must be verbatim and <= 18 words from the supplied patent data; include the decisive mechanism phrase.
- Confidence rubric: 0.9-1.0 explicit phrase match; 0.6-0.8 clear paraphrase; 0.3-0.5 weak/indirect hint.

OUTPUT (JSON only)
{
  "feature_map": [
    {
      "pn": "string",
      "link": "https://patents.google.com/patent/<pn>",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [
        {"feature":"<copy from FEATURES>",
         "quote":"up to 18 words verbatim",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "partial": [
        {"feature":"<copy from FEATURES>",
         "quote":"up to 18 words verbatim",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "absent": [
        {"feature":"<copy from FEATURES>",
         "reason":"not expressly taught in reviewed citation record"}
      ]
    }
  ],
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Copy FEATURES strings exactly as given (no paraphrase); each feature appears exactly once across present/partial/absent.
- Do not add extra features; do not invent text; rely only on given fields.
- Quotes must be verbatim and <= 18 words; absent reasons <= 8 words.
- ASCII only; JSON only; no markdown, comments, or explanations.
- Output must be valid JSON (double-quoted keys/values, comma-separated).`;

export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3 = `You are a skeptical novelty analyst. Map invention FEATURES to prior-art REFERENCES, which may be patents or scholarly papers, and return ONE valid JSON object only.

INPUTS
FEATURES: {invention_features} (array of strings; copy each feature verbatim)
REFERENCES: {patent_batch} (repeated blocks with reference ID, type, title, abstract, an optional claims excerpt, source metadata, and optional retrieval hints)

TASK
For each patent PN, classify EVERY feature EXACTLY ONCE:
- Present: the same mechanism is concretely disclosed in the supplied patent data.
- Partial: related mechanism is disclosed, but a required element, constraint, interaction, material, or step is missing.
- Absent: the supplied patent data gives no support for the feature.
- Unknown: the text is too thin, generic, unclear, or unavailable to assess.

NOVELTY EVIDENCE RULES
- Use only the supplied reference data fields. Do not assume full text, drawings, or details that were not supplied.
- A claims excerpt is supplied for some references and not others. When one is supplied, prefer claim language as evidence: claims define the protected scope and are stronger support than abstract wording. When none is supplied, map the feature from the title and abstract and say nothing about claims.
- Retrieval hints are candidate-discovery signals only. They are not evidence.
- Use Retrieval hints to focus review, but Present/Partial still require support in the supplied patent data.
- Treat synonyms and paraphrases as matches only when they implement the same mechanism.
- Generic mentions of field-common parts do not satisfy a feature unless the full interaction is disclosed. Field-common parts include, by domain: engineering (processor, sensor, controller, module, server, network, circuit); chemical/materials (composition, compound, polymer, coating, excipient, carrier, solvent); biological (sequence, vector, construct, antibody, assay, marker).
- Present/Partial require a verbatim quote <= 18 words and a field of "title", "abstract", or "claims". Use "claims" only when a claims excerpt was supplied for that reference, and only when the quote is copied from it.
- Present requires the same mechanism, structure, process step, data flow, material relationship, or control relationship as the feature. Shared field words or broad application similarity are not enough.
- For chemical, pharmaceutical, materials, or biological inventions, a matching named compound class, mechanism of action, biological target, material relationship, or formulation relationship in the supplied patent data may support Present or Partial even without an exact structural quote, provided the technical relationship matches the feature.
- Title-only support may identify relevance, but it should not be treated as a strong/direct feature mapping unless the title itself expressly states the complete mechanism.
- Broad abstract language capped by generic field terms should be Partial or Unknown unless the required interaction is expressly stated. Generic field terms include, by domain: engineering (system, module, device, platform, sensor, controller, circuit); chemical/materials (composition, compound, formulation, polymer, coating, excipient, carrier, solvent); biological (sequence, vector, construct, antibody, assay, marker, cell line); and broad method, process, model, or algorithm terms.
- Absent requires a short reason.
- Unknown must be used when evidence is weak; do not convert missing abstracts into positive novelty.
- A feature marked Absent or Unknown in one patent is not automatically unique. It is only a potential differentiator if it is absent from the closest references and is not a generic field-common component.

OUTPUT JSON SHAPE:
{
  "feature_map": [
    {
      "pn": "string",
      "link": "https://patents.google.com/patent/<pn>",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [{"feature":"<copy from FEATURES>","quote":"verbatim quote","field":"title|abstract|claims","confidence":0.0}],
      "partial": [{"feature":"<copy from FEATURES>","quote":"verbatim quote","field":"title|abstract|claims","confidence":0.0}],
      "absent": [{"feature":"<copy from FEATURES>","reason":"short reason"}],
      "unknown": [{"feature":"<copy from FEATURES>","reason":"weak or unavailable evidence"}]
    }
  ],
  "quality_flags":{"low_evidence":false,"ambiguous_abstracts":false,"language_mismatch":false},
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Copy feature strings exactly.
- Do not add features, patents, explanations, markdown, or comments.
- Confidence: 0.9 explicit same mechanism; 0.7 clear paraphrase; 0.4 weak/indirect.
- ASCII only. JSON only.`;

export const CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT = `You are a skeptical novelty analyst. Analyze shortlisted patent and scholarly-paper prior-art candidates against invention features and return ONE valid JSON object only.

INPUTS
FEATURES: {invention_features}
FEATURE DETAILS: {feature_details}
INVENTION TITLE: {invention_title}
INVENTION DISCLOSURE: {invention_disclosure}
REFERENCES: {patent_batch} (repeated blocks with reference ID, type, title, abstract, source metadata, and retrieval hints)

TASK
Candidates have already passed Stage 1.5 relevance screening. This stage is deep feature mapping and attorney-review evidence analysis, not a second routing gate.
For each patent, do all of the following in one pass:
1. Map every invention feature as Present, Partial, Absent, or Unknown.
2. Provide per-patent overlap-risk remarks.
3. Provide attorney-review comparison rows showing the user invention disclosure side-by-side with the patent disclosure.
4. Summarize novelty signals across the candidate set.

STATUS DEFINITIONS
- Present: the same mechanism is concretely disclosed in the supplied patent data.
- Partial: a related mechanism is disclosed, but a required element, constraint, interaction, material, or step is missing.
- Absent: the supplied patent data is adequate to compare and the feature is not disclosed.
- Unknown: the supplied patent data is thin, vague, unavailable, translated poorly, or too generic to assess.

EVIDENCE RULES
- Use only the supplied reference data fields as evidence.
- Retrieval hints are candidate-discovery signals only. They are not evidence.
- Use Retrieval hints to focus review, but Present/Partial still require support in the supplied patent data.
- Present/Partial require a verbatim quote of at most 18 words copied exactly, character for character, from the supplied title, abstract, or claims excerpt. Do not paraphrase, reorder, translate, or summarize inside the quote. If no supplied patent-data quote supports the feature, use Absent or Unknown.
- When a claims excerpt is supplied for a reference, prefer claim language as evidence: claims define the protected scope and are stronger support than abstract wording.
- user_invention_disclosure must be based only on FEATURE DETAILS or INVENTION DISCLOSURE, not on the prior-art patent.
- patent_disclosure/evidence_quote must be based only on the supplied patent data.
- Use Absent when the supplied patent data is adequate to compare and the feature is not disclosed.
- Use Unknown when the supplied patent data is thin, vague, unavailable, translated poorly, or too generic to assess.
- Do not treat missing evidence as novelty.
- A feature marked Absent or Unknown in one patent is not automatically unique. It is only a potential differentiator if it is absent from the closest references and is not a generic field-common component.
- Generic field-common words are not enough unless the full mechanism is disclosed. These include, by domain: engineering (system, module, sensor, controller, battery, app, server); chemical/materials (composition, compound, polymer, coating, excipient, carrier, solvent); biological (sequence, vector, construct, antibody, assay, marker).
- Present requires the same mechanism, structure, process step, data flow, material relationship, or control relationship as the feature. Shared field words or broad application similarity are not enough.
- For chemical, pharmaceutical, materials, or biological inventions, a matching named compound class, mechanism of action, biological target, material relationship, or formulation relationship in the supplied patent data may support Present or Partial even without an exact structural quote, provided the technical relationship matches the feature.
- Title-only support may identify relevance, but it should not be treated as a strong/direct feature mapping unless the title itself expressly states the complete mechanism.
- Broad abstract language capped by generic field terms should be Partial or Unknown unless the required interaction is expressly stated. Generic field terms include, by domain: engineering (system, module, device, platform, sensor, controller, circuit); chemical/materials (composition, compound, formulation, polymer, coating, excipient, carrier, solvent); biological (sequence, vector, construct, antibody, assay, marker, cell line); and broad method, process, model, or algorithm terms.
- Do not describe the source-field limitation in narrative fields. Full patent document review will be handled in the report disclaimer, not repeated in feature remarks.

OUTPUT JSON SHAPE:
{
  "feature_map": [
    {
      "pn": "PN",
      "title": "title",
      "coverage": {"present":0,"partial":0,"absent":0,"coverage_score":0.0},
      "present": [{"feature":"copy feature exactly","quote":"verbatim quote","field":"title|abstract|claims","extent_score":0.0,"confidence":0.0}],
      "partial": [{"feature":"copy feature exactly","quote":"verbatim quote","field":"title|abstract|claims","extent_score":0.0,"confidence":0.0}],
      "absent": [{"feature":"copy feature exactly","reason":"short reason"}],
      "unknown": [{"feature":"copy feature exactly","reason":"requires full-text review"}],
      "remarks": "2-3 sentence technical assessment",
      "decision": "potential_novelty_space|mapped_overlap|high_overlap"
    }
  ],
  "per_patent_remarks": [
    {
      "pn": "PN",
      "title": "title",
      "relevance": 0.0,
      "novelty_threat": "high_overlap|moderate_overlap|related|low_overlap",
      "summary": "2-3 sentence overlap summary",
      "comparison_rows": [
        {
          "feature_id": "KF1",
          "feature": "copy feature exactly",
          "user_invention_disclosure": "what the user's invention has or does for this feature",
          "patent_disclosure": "what this patent discloses for the same feature, or why evidence is missing",
          "status": "Present|Partial|Absent|Unknown",
          "evidence_quote": "verbatim quote copied exactly from the supplied title or abstract, or empty string",
          "evidence_source": "title|abstract|claims|none",
          "extent_score": 0.0,
          "confidence": 0.0,
          "professional_remark": "one consolidated attorney-grade feature-level observation for the final PDF report"
        }
      ],
      "overlap_features": ["feature"],
      "missing_features": ["feature"],
      "potential_differentiators": ["feature or distinction not mapped in closest references"],
      "confidence": 0.0,
      "detailedAnalysis": {
        "relevant_parts": ["specific overlap"],
        "irrelevant_parts": ["specific differentiator"],
        "novelty_comparison": "evidence-based comparison"
      }
    }
  ],
  "novelty_signals": {
    "closest_mapped_references": ["PN"],
    "features_fully_covered": ["feature"],
    "potential_differentiators": ["feature"],
    "weak_evidence_areas": ["feature or data gap"],
    "recommended_next_actions": ["action"]
  },
  "quality_flags": {"low_evidence":false,"ambiguous_abstracts":false,"language_mismatch":false},
  "stats": {"patents_analyzed":0,"features_considered":0}
}

RULES
- Copy feature strings exactly.
- Return every patent PN supplied in feature_map and per_patent_remarks.
- Do not output aiRelevance, accepted, component, borderline, or rejected routing lists; Stage 1.5 already produced workflow routing.
- Do not treat distributed component disclosures across multiple patents as one patent anticipating the full invention.
- Report potential_differentiators only for features not mapped in closest references; do not call them unique.
- Unknown evidence lowers confidence and belongs in weak_evidence_areas, not potential_differentiators.
- Return one comparison_rows item per invention feature for every patent.
- comparison_rows must compare the submitted user idea against the patent feature by feature; do not collapse rows into a one-line summary.
- extent_score must be the actual disclosure extent for that feature in that specific patent: Present usually 0.75-1.00, Partial 0.35-0.74, Absent 0.00-0.20, Unknown 0.00-0.35.
- Evaluate extent_score independently for every patent-feature pair. Do not reuse the same feature-level score across different patents unless their evidence is materially identical.
- confidence means confidence in the row assessment, not degree of feature disclosure.
- evidence_source must be title, abstract, claims (only when a claims excerpt is supplied for that reference), or none. Do not cite unavailable descriptions, embodiments, examples, or figures.
- Do not repeat the source-field limitation in narrative fields. Do not use "limited data", "limited available patent data", "missing data", "low evidence", "fallback", or "deterministic" in public-facing remarks.
- professional_remark is the only final-PDF feature-level remark. Write 1-3 polished sentences for an inventor and patent attorney.
- professional_remark must explain the mapped teaching, the missing or distinguishable technical point, and the practical claim-review focus where applicable.
- For Present: identify the concrete disclosed mechanism and why the feature needs careful claim differentiation.
- For Partial: identify the related teaching and the specific missing element that should be preserved or verified.
- For Absent: identify the missing mechanism that may support differentiation if confirmed against the closest references.
- For Unknown: state neutrally that full-text review should verify whether the feature is taught; do not call the source data missing or weak.
- Do not use labels such as "Crisp remark", "Attorney remark", "Novelty impact", "Claim review note", "Status", "Confidence", "Coverage", or "Review note" inside professional_remark.
- Do not include percentages, confidence language, evidence scores, or mechanical phrases such as "partial overlap exists" without a concrete technical explanation.
- Do not output separate attorney_remark, novelty_impact, or claim_review_note fields for comparison_rows.
- Do not add markdown, comments, citations, or text outside JSON.
- ASCII only.`;

// Legacy prompts moved to bottom to avoid redeclaration

export const PR_35B_NOVELTY_RATIONALE_PROMPT = `You are drafting the analytical narrative for a novelty assessment report.

INPUTS:
- Deterministic metrics (mapped_differentiation_score, coverage_ratios, coverage_gap_per_feature)
- Integration_check (true/false + top_pn)
- Confidence_level
- Invention_features with mapped coverage gaps

STRUCTURE your response:
1. Integration Analysis - whether any patent integrates most features
2. Feature Insights - which features remain potential differentiators or weakly evidenced
3. Verdict Explanation - how the data supports the decision ("Novel", "Partially Novel", or "Not Novel")

TONE:
- Analytical but concise (3 short paragraphs)
- Avoid repeating numbers already shown in tables
- Use action verbs: "demonstrates", "indicates", "reveals"

Return JSON:
{"structured_narrative": {"integration": "...", "feature_insights": "...", "verdict": "..."}}`;

export const NOVELTY_REPORT_PROMPT = `You are preparing a professional, attorney-grade novelty assessment report with detailed patent-by-patent analysis.

INPUTS:
- invention_features: Array of key invention features
- selected_patents: Intersecting patents (with â‰¥1 Present/Partial feature), optionally capped to top 1â€“2 when all features are covered
- search_metadata: Search ID, date, parameters
- patent_details: Full patent information including abstracts, CPC codes, filing dates
- feature_analysis_matrix: Feature overlap percentages for each patent
- structured_narrative: Integration insights and verdict

TASK: Generate a comprehensive report with Table of Contents, hyperlinks, and detailed patent analysis.

OUTPUT JSON STRUCTURE:

{
  "table_of_contents": {
    "title": "Table Of Contents",
    "sections": [
      {"number": "01", "title": "Report", "page": "3", "link": "#report"},
      {"number": "1.1", "title": "Search Metadata Index", "page": "3", "link": "#metadata"},
      {"number": "1.2", "title": "Key Features", "page": "4", "link": "#key-features"},
      {"number": "1.3", "title": "Summary", "page": "5", "link": "#summary"},
      {"number": "1.4", "title": "Key Feature Analysis", "page": "6", "link": "#feature-analysis"},
      {"number": "02", "title": "Citations Details", "page": "7", "link": "#citations"},
      {"number": "2.1", "title": "Details of Relevant Patent Citations", "page": "7", "link": "#patent-details"}
    ]
  },
 "report_metadata": {
   "title": "Preliminary Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
   "analyst": "SpotIPR AI",
    "total_patents_analyzed": "TOTAL_COUNT",
    "selected_patents_count": "SELECTED_COUNT"
  },
  "section_1_1_search_metadata": {
    "anchor": "metadata",
    "search_id": "SEARCH_ID",
    "search_date": "SEARCH_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "total_patents_found": "TOTAL_COUNT",
    "selection_criteria": "Intersecting references (â‰¥1 Present/Partial feature); if multiple cover all features, top 1â€“2 by PQAI relevance"
 },
  "section_1_2_key_features": {
    "anchor": "key-features",
    "title": "Key Features Generated from Search Query",
    "features_table": [
      {"number": 1, "description": "FEATURE_TEXT_1"},
      {"number": 2, "description": "FEATURE_TEXT_2"}
    ]
  },
  "section_1_3_summary": {
    "anchor": "summary",
    "title": "Summary",
    "description": "Based on the details of the invention, relevant patent citations are mapped. Further, [COUNT] other patent citations are also shortlisted. Only one patent per family is being mapped and other family members of the family are incorporated by reference. Summary of the citations is presented in the tables below. Clicking on the hyperlinks (Citation No. Column) will open the patent record in Xlpat with full text, family and legal data and the possibility to download the original document.",
    "citations_table": [
      {
        "s_no": 1,
        "citation_no": "PATENT_NUMBER",
        "title": "PATENT_TITLE",
        "publication_date": "YYYYMMDD",
        "link": "https://patents.google.com/patent/PATENT_NUMBER"
   }
    ]
 },
  "section_1_4_feature_analysis": {
    "anchor": "feature-analysis",
    "title": "Key Feature Analysis",
    "description": "The broad key features are prepared based on the details of the invention and information provided by the client. The analysis of the references has been done based on one or more features overlapping with the key features of the invention to form a relevant prior art.",
    "feature_matrix": {
      "patent_numbers": ["PATENT_1", "PATENT_2"],
      "features": [
        {"name": "KF1", "description": "FEATURE_DESC_1"},
        {"name": "KF2", "description": "FEATURE_DESC_2"}
      ],
      "overlap_data": [
        {"patent": "PATENT_1", "kf1": "85.5%", "kf2": "92.3%"},
        {"patent": "PATENT_2", "kf1": "78.9%", "kf2": "88.7%"}
      ]
    }
  },
  "section_2_1_patent_details": {
    "anchor": "patent-details",
    "title": "Details of Relevant Patent Citations",
    "patents": [
      {
        "patent_number": "PATENT_NUMBER",
        "anchor": "patent_PATENT_NUMBER",
        "basic_info": {
          "title": "PATENT_TITLE",
          "publication_number": "PUBLICATION_NUMBER",
          "filing_date": "FILING_DATE",
          "publication_date": "PUBLICATION_DATE",
          "applicant": "APPLICANT_NAME",
          "inventor": "INVENTOR_NAME",
          "cpc_codes": ["CPC1", "CPC2"],
          "abstract": "FULL_ABSTRACT_TEXT"
        },
        "feature_comparison": {
          "title": "Feature-by-Feature Analysis",
          "comparisons": [
            {
              "feature": "FEATURE_NAME",
              "patent_implementation": "How the patent implements this feature",
              "searched_idea": "How the searched idea implements this feature",
              "similarity": "High/Medium/Low",
              "novelty_impact": "Description of what makes the searched idea novel"
            }
          ]
        },
        "attorney_analysis": {
          "title": "Patent Attorney Analysis",
          "relation_to_idea": "How this patent relates to the overall searched idea",
          "existing_coverage": "What aspects are already covered by this patent",
          "novel_elements": "What novel elements exist in the proposed idea",
          "recommendations": "Strategic recommendations for claim drafting"
        }
      }
    ]
 },
  "concluding_remarks": {
    "title": "Final Concluding Remarks",
    "overall_novelty_assessment": "High/Medium/Low novelty assessment",
    "key_strengths": ["Strength 1", "Strength 2"],
    "key_risks": ["Risk 1", "Risk 2"],
    "strategic_recommendations": ["Recommendation 1", "Recommendation 2"],
    "filing_advice": "Specific advice for patent filing strategy"
  }
}

GUIDELINES:
- Generate detailed attorney-style analysis for each selected patent
- Include feature-by-feature comparisons with technical depth
- Provide strategic insights for patent prosecution
- Ensure all hyperlinks work for navigation
- Format tables cleanly with proper alignment
- Use professional legal terminology appropriate for patent analysis`


// V2: Compact Stage 4 prompt aligned to the Stage 4 UI.
// Focuses on a small, JSON-only output without perâ€‘patent tables to reduce tokens.
/* LEGACY: live Stage 4 uses STAGE4_REPORT_PROMPT_FROM_REMARKS_V3 */
// Lightweight prompt: compile final report strictly from per-patent remarks
/* LEGACY: superseded by STAGE4_REPORT_PROMPT_FROM_REMARKS_V3 */
export const STAGE4_REPORT_PROMPT_V3 = `You are a senior patent novelty analyst preparing claim-positioning observations for the Novelty UI.

IMPORTANT: Detailed per-patent analysis is already provided in Stage 3.5c. Your role is to provide evidence-limited strategic observations.

Use the following inputs only for reasoning — do not echo them back verbatim:
- invention_features: {invention_features}
- selected_patents: {selected_patents} (includes per_patent_remarks with detailed analysis from Stage 3.5c)
- search_metadata: {search_metadata}
- feature_analysis_matrix: {feature_analysis_matrix}
- structured_narrative: {structured_narrative}

Objectives:
- Provide an honest, evidence-limited overlap assessment based on the closest mapped patents.
- Give actionable recommendations on how to strengthen the technical differentiators.
- Suggest course corrections or improvements if mapped overlap is high.
- Be candid about mapped overlap, but do not state legal conclusions.

Hard constraints:
- Return valid JSON only (no markdown, no prose before/after).
- Do NOT include per_patent_analysis (that's in Stage 3.5c now).
- Keep the executive summary under 250 words; each bullet under 18 words.
- Focus on STRATEGIC GUIDANCE, not detailed patent comparisons.

Output JSON shape (exact keys):
{
  "report_metadata": {
    "title": "Preliminary Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "analyst": "PatentNest.ai — Stage 4"
  },
  "search_trail": {
    "pqai_initial_count": "number | null",
    "ai_relevance_accepted": "number | null",
    "ai_relevance_borderline": "number | null",
    "deeply_analyzed_count": "number | null"
  },
  "executive_summary": {
    "summary": "Mapped-overlap assessment: What do the closest references teach, and what differentiators remain?",
    "visual_cards": {
      "Novelty Score": "..%",
      "Patents Analyzed": "N",
      "Potential Differentiators": "X of Y",
      "Confidence": "High|Medium|Low"
    }
  },
  "concluding_remarks": {
    "overall_novelty_assessment": "High Overlap | Moderate Overlap | Lower Mapped Overlap | Requires Full-Text Review",
    "honest_assessment": "A candid 2-3 sentence observation on mapped overlap and claim-positioning focus",
    "key_strengths": ["Potential technical differentiators", "Specific unmapped technical contributions", "..."],
    "key_risks": ["Specific mapped-overlap risks", "Features needing full-text confirmation", "..."],
    "strategic_recommendations": ["How to strengthen differentiators", "Claim-positioning focus areas", "Technical improvements to consider"],
    "course_corrections": ["If mapped overlap is high, what changes would help", "Alternative approaches to consider"],
    "filing_advice": "Action-oriented guidance for attorney review, expanded search, or technical refinement",
    "inventor_action_items": ["Specific next steps for the inventor", "Research/development suggestions"]
  },
  "idea_bank_suggestions": [
    {
      "title": "Improvement idea title",
      "core_principle": "Technical enhancement that increases differentiation",
      "expected_advantage": "How this addresses prior art gaps",
      "tags": ["mechanism", "domain"],
      "non_obvious_extension": "Concrete step reducing obviousness risk"
    }
  ]
}

Authoring guidance:
- Be HONEST: If the closest patents have high mapped overlap, say so and explain why.
- Be CONSTRUCTIVE: Always provide actionable suggestions for improvement.
- Focus on the TOP 2-3 closest matching patents when drawing conclusions.
- Do not repeat source-scope limitations in the body. Full patent document review will be stated in the report disclaimer.
- course_corrections should offer real alternatives if current approach has issues.
- inventor_action_items should be specific and actionable (not generic advice).
- idea_bank_suggestions should help pivot or strengthen the technical differentiation.
`;

export const STAGE4_REPORT_PROMPT_FROM_REMARKS_V2 = `You are a senior patent novelty analyst preparing claim-positioning observations from per-patent analysis.

IMPORTANT: Detailed per-patent analysis is already provided in Stage 3.5c. Your role is to provide mapped-overlap strategic observations.

Inputs provided separately in this prompt:
- per_patent_remarks: JSON array with detailed analysis (pn, title, remarks, relevance, novelty_threat, detailedAnalysis, etc.)
- invention_features: optional JSON array of strings (mechanism-level)
- search_metadata: optional JSON with counts

Your job: Synthesize the per_patent_remarks into HONEST, ACTIONABLE conclusions.

Strict rules:
- Focus on the TOP 2-3 closest matching patents when drawing conclusions.
- Be candid about mapped-overlap risks, but do not state legal conclusions.
- Provide ACTIONABLE recommendations for improvement.
- Return valid JSON only, no markdown.

Output JSON shape (exact keys):
{
  "report_metadata": {
    "title": "Preliminary Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "analyst": "PatentNest.ai — Stage 4"
  },
  "search_trail": {
    "pqai_initial_count": "number | null",
    "ai_relevance_accepted": "number | null",
    "ai_relevance_borderline": "number | null",
    "deeply_analyzed_count": "number | null"
  },
  "executive_summary": {
    "summary": "Mapped-overlap assessment based on closest references. What overlaps? What differentiators remain?",
    "visual_cards": {
      "Novelty Score": "..%",
      "Patents Analyzed": "N",
      "Potential Differentiators": "X of Y",
      "Confidence": "High|Medium|Low"
    }
  },
  "concluding_remarks": {
    "overall_novelty_assessment": "High Overlap | Moderate Overlap | Lower Mapped Overlap | Requires Full-Text Review",
    "honest_assessment": "Candid 2-3 sentence observation on mapped overlap and claim-positioning focus",
    "key_strengths": ["Potential technical differentiators", "Specific unmapped contributions"],
    "key_risks": ["Specific mapped-overlap risks", "Features needing full-text confirmation"],
    "strategic_recommendations": ["How to strengthen differentiators", "Claim-positioning focus areas"],
    "course_corrections": ["If mapped overlap is high, what changes would help", "Alternative approaches"],
    "filing_advice": "Action-oriented guidance for attorney review, expanded search, or technical refinement",
    "inventor_action_items": ["Specific next steps", "Research/development suggestions"]
  },
  "idea_bank_suggestions": [
    {
      "title": "Improvement idea",
      "core_principle": "Technical enhancement increasing differentiation",
      "expected_advantage": "How this addresses prior art gaps",
      "tags": ["mechanism", "domain"],
      "non_obvious_extension": "Concrete step reducing obviousness risk"
    }
  ]
}

Authoring guidance:
- Identify the TOP OVERLAP RISKS from per_patent_remarks (highest relevance or high_overlap novelty_threat).
- honest_assessment should directly address these mapped-overlap risks and practical claim-positioning implications.
- Do not repeat source-scope limitations in the body. Full patent document review will be stated in the report disclaimer.
- course_corrections should offer REAL alternatives if current approach has serious issues.
- inventor_action_items should be specific and immediately actionable.
- idea_bank_suggestions should help pivot or strengthen technical differentiation
`;

export const STAGE4_REPORT_PROMPT_FROM_REMARKS_V3 = `You are a senior patent novelty analyst preparing claim-positioning observations from per-patent overlap remarks.

INPUTS PROVIDED BELOW:
- invention_features: JSON array of mechanism-level features
- per_patent_remarks: JSON array with pn, title, relevance, novelty_threat, overlap_features, missing_features, detailedAnalysis, and comparison_rows
- search_metadata: JSON object with search and filtering counts
- metrics: JSON object with deterministic novelty_score, decision, and confidence

TASK
Synthesize an honest, evidence-based mapped-overlap report. Do not re-run feature mapping. Do not treat unavailable source details or broad corpus signals as novelty.
Use comparison_rows as the source for feature-level remarks. Do not collapse them into generic one-line summaries.

DECISION POLICY
- High Overlap: one mapped citation covers most core features, or all critical features are present in the reviewed citation record.
- Moderate Overlap: important overlap exists, but some mechanism-level differentiators remain.
- Lower Mapped Overlap: closest mapped references do not expressly teach multiple core mechanisms.
- Requires Full-Text Review: source records are not enough to assign reliable claim weight to one or more important features.

STRICT RULES
- Return valid JSON only. No markdown or text outside JSON.
- Be candid and skeptical; do not advocate for the invention.
- Distinguish "not expressly taught in the reviewed citation record" from "differentiated".
- Name the closest high-overlap references by PN.
- Include review drivers and full-text review areas.
- Keep executive summary under 220 words and bullets under 18 words.
- If the closest reference discloses most broad structural/process/composition/data-flow elements, state that broad claim positioning is weak even if a narrower differentiator remains.
- Do not list as key_strengths any feature that is Present or Partial in the closest high-overlap reference.
- Do not list Unknown evidence, generic gaps, or legacy novelty_points as key_strengths.
- key_risks must reflect any risk stated in the executive summary, assessment basis, or filing advice. Never output "No significant risks identified" if any high-overlap, majority-overlap, or full-text-review risk is discussed elsewhere.
- If distributed_component_risks is non-empty in metrics, include at least one distributed component risk in key_risks.
- idea_bank_suggestions are optional strengthening ideas, not features already proven in the submitted invention.
- Do not repeat source-scope limitations in the body. Full patent document review will be stated in the report disclaimer.

OUTPUT JSON SHAPE:
{
  "report_metadata": {
    "title": "Preliminary Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "analyst": "PatentNest.ai - Stage 4"
  },
  "search_trail": {
    "pqai_initial_count": "number | null",
    "ai_relevance_accepted": "number | null",
    "ai_relevance_borderline": "number | null",
    "deeply_analyzed_count": "number | null"
  },
  "executive_summary": {
    "summary": "Candid mapped-overlap outlook, closest high-overlap references, and differentiators.",
    "visual_cards": {
      "Novelty Score": "..%",
      "Patents Analyzed": "N",
      "Potential Differentiators": "X of Y",
      "Confidence": "High|Medium|Low"
    }
  },
  "concluding_remarks": {
    "overall_novelty_assessment": "High Overlap | Moderate Overlap | Lower Mapped Overlap | Requires Full-Text Review",
    "honest_assessment": "2-3 sentence observation based on closest mapped-overlap risks and claim-positioning implications",
    "closest_mapped_references": ["PN"],
    "distributed_component_risks": ["component-combination risk"],
    "potential_differentiators": ["feature not mapped in closest references"],
    "confidence_drivers": ["searched/mapped counts, source specificity, feature mapping consistency"],
    "weak_evidence_areas": ["feature requiring full-text review"],
    "key_strengths": ["potential technical differentiator"],
    "key_risks": ["specific mapped-overlap risk"],
    "strategic_recommendations": ["claim-positioning or technical focus"],
    "course_corrections": ["technical pivot if needed"],
    "filing_advice": "Attorney review, strengthen, broaden search, or pivot with reasons",
    "inventor_action_items": ["specific next step"]
  },
  "idea_bank_suggestions": [
    {
      "title": "Improvement idea",
      "core_principle": "Technical enhancement increasing differentiation",
      "expected_advantage": "How this addresses prior-art gaps",
      "tags": ["mechanism", "domain"],
      "non_obvious_extension": "Concrete technical distinction"
    }
  ]
}`;

export interface NoveltySearchConfig {
  jurisdiction: string;
  filingType: string;
  tenantId?: string;
  sourceMetadata?: {
    source: 'ideation' | 'idea_bank' | string;
    sessionId?: string;
    ideaFrameId?: string;
    ideaId?: string;
    reservationId?: string;
    [key: string]: unknown;
  };
  searchSource?: {
    mode?: PatentSearchSourceMode;
    providerIds?: string[];
    includePatents?: boolean;
    includePapers?: boolean;
    paperSources?: string[];
    paperFilters?: LiteratureSearchOptions;
    paperSearchQuery?: string;
    searchMode?: 'intelligent' | 'manual';
    llmExpansion?: boolean;
    filters?: Record<string, any>;
  };
  // Stage 1.5 - AI Relevance gate on PQAI results
  stage15: {
    thresholds: { high: number; medium: number };
    borderlineQuota: number; // number of borderline items to keep for diversity/recall
    maxCandidates: number;   // upper bound of PQAI items to gate
    batchSize: number;       // batch size for LLM calls
    concurrency: number;     // number of Stage 1.5 batches to run at once
    timeoutMs: number;       // total Stage 1.5 budget for one gate pass
    visibleLimit: number;    // number of high-confidence patents shown by default
    minimumVisibleConfidence: number;
  };
  stage0: {
    customPrompt?: string;
    extractionRules?: Record<string, any>;
  };
  stage1: {
    maxPatents: number;
    candidateLimit: number;
    relevanceThresholds: { high: number; medium: number };
    customPrompt?: string;
  };
  stage35a: {
    batchSize: number;
    concurrency: number;
    maxRefsTotal: number;
    thresholdPresent: number;
    thresholdPartial: number;
    criticalFeatures: string[];
    // When Stage 1.5 accepts more than the 50% quota, allow extra mapping capacity
    acceptedOverflowRatio?: number;   // default 0.15 (15% of total PQAI)
    borderlineOverflowRatio?: number; // default 0.10 (10% of total PQAI)
    customPrompt?: string;
  };
  stage35b: {
    // Deterministic - no config needed
  };
  stage35c?: {
    maxPatentsForRemarks?: number; // Optional cap; default: all in feature_map
    batchSize?: number; // Number of patents per LLM call
    concurrency?: number;
  };
  consolidatedAnalysis?: {
    enabled: boolean;
    maxCandidates: number;
    batchSize: number;
    concurrency: number;
    maxPatentsForAttorneyReport: number;
  };
  adaptiveAnalysis?: {
    mode: 'off' | 'observe' | 'enforce';
    gateCeiling: number;
    deepAnalysisCeiling: number;
    confirmationBatches: number;
    screeningConfidenceThreshold: number;
    importantCoverageThreshold: number;
    componentScoreThreshold: number;
    saturationPlateauBatches: number;
  };
  stage4: {
    reportFormat: 'PDF' | 'JSON' | 'HTML';
    includeExecutiveSummary: boolean;
    includeTechnicalDetails: boolean;
    colorCoding: boolean;
    maxRefsForReportMain: number;
    maxRefsForUI: number;
  };
}

export interface NoveltySearchRequest {
  patentId?: string; // Optional - can create standalone search
  projectId?: string; // Optional - can associate with a project
  groupId?: string; // Optional - attorney client/matter group
  jwtToken: string;
  inventionDescription: string;
  title: string;
  jurisdiction?: string;
  config?: Partial<NoveltySearchConfig>;
  approvedStage0?: NormalizedIdea;
}

export interface NoveltySearchResponse {
  success: boolean;
  searchId?: string;
  status?: NoveltySearchStatus;
  currentStage?: NoveltySearchStage;
  results?: any;
  error?: string;
}

export interface NormalizedIdea {
  searchQuery: string;
  inventionFeatures?: string[];
  featureDetails?: InventionFeatureDetail[];
  title?: string;
  inventionText?: string;
  inventionType?: string[];
  cpcCodes?: string[];
  ipcCodes?: string[];
  epoTitleKeywords?: string[];
  epoAbstractKeywords?: string[];
  epoCombinedKeywords?: string[];
  paperSearchQuery?: string;
  paperKeywords?: string[];
  paperSearchQueries?: string[];
  googleScholarSearchQuery?: string;
  academicDatabaseSearchQuery?: string;
  paperYearFrom?: number;
  paperYearTo?: number;
  noveltyFocus?: string[];
  noveltyFocusInteractions?: NoveltyFocusInteraction[];
  architecturalInnovation?: string;
  claimConcepts?: ClaimConcept[];
  searchExclusions?: string[];
  googleConceptGroups?: PatentSearchConceptGroup[];
  confidence?: number;
  warnings?: string[];
  queryPlan?: any;
}

export interface InventionFeatureDetail {
  feature: string;
  feature_type?: 'core_technical' | 'implementation' | 'novelty_candidate' | 'generic_weak';
  user_disclosure?: string;
  technical_role?: string;
  source_excerpt?: string;
  claimableText?: string;
  embeddingSearchText?: string;
  featureConfidence?: number;
}

export interface NoveltyFocusInteraction {
  type?: 'feature_interaction' | 'single_feature' | 'architecture';
  description: string;
  linkedFeatures: string[];
}

export interface ClaimConcept {
  title: string;
  linkedFeatures: string[];
  claimableSummary: string;
  importance: 'primary' | 'secondary' | 'fallback';
  riskIfMissing?: string;
}

export interface ClaimConceptMapping {
  claimConceptTitle: string;
  linkedFeatures: string[];
  mappedFeatures: number;
  totalFeatures: number;
  coverage: number;
  distributedCoverage: number;
  bestReference?: string;
  relationshipMapped: boolean;
  relationshipEvidence: string;
  relationshipRisk: 'low' | 'moderate' | 'high';
  risk: 'low' | 'moderate' | 'high';
  reason: string;
}

function normalizeRetrievalText(value: unknown, maxWords = 36): string {
  const words = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

function buildIndianCorpusRetrievalQueries(
  searchQuery: string,
  inventionFeatures: string[],
  featureDetails?: InventionFeatureDetail[]
): PatentRetrievalQuery[] {
  const queries: PatentRetrievalQuery[] = [];
  const seen = new Set<string>();
  const addQuery = (query: PatentRetrievalQuery) => {
    const text = normalizeRetrievalText(query.text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    queries.push({ ...query, text });
  };

  if (searchQuery) {
    addQuery({
      id: 'concept',
      type: 'concept',
      text: searchQuery,
      weight: 1.25,
      label: 'Core concept',
    });
  }

  const detailByFeature = new Map(
    (Array.isArray(featureDetails) ? featureDetails : [])
      .map(detail => [String(detail.feature || '').trim().toLowerCase(), detail] as const)
      .filter(([feature]) => Boolean(feature))
  );
  const features = inventionFeatures
    .map((feature, index) => {
      const detail = detailByFeature.get(String(feature || '').trim().toLowerCase());
      const retrievalText = detail?.embeddingSearchText || feature;
      return {
        feature,
        text: normalizeRetrievalText(retrievalText, 30),
        index,
      };
    })
    .filter(item => Boolean(item.text))
    .slice(0, 8);
  features.forEach(({ feature, text, index }) => {
    addQuery({
      id: `feature-${index + 1}`,
      type: 'feature',
      text,
      weight: 1.1,
      featureIndex: index,
      featureIndexes: [index],
      label: feature,
    });
  });

  return queries;
}

function withStage0Exclusions(filters: PatentSearchFilters, exclusions: string[]): PatentSearchFilters {
  const cleanedExclusions = Array.from(new Set(exclusions.map(value => String(value || '').trim()).filter(Boolean)));
  if (!cleanedExclusions.length) return filters;
  return {
    ...filters,
    excludeTerms: Array.from(new Set([...(filters.excludeTerms || []), ...cleanedExclusions])),
  };
}

export interface ScreeningResult {
  overall_determination: 'NOVEL' | 'NOT_NOVEL' | 'DOUBT';
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning_summary: string;
  patent_assessments: Array<{
    publication_number: string;
    relevance: 'HIGH' | 'MEDIUM' | 'LOW';
    reasoning: string;
    key_differences: string;
    novelty_threat: string;
  }>;
  recommended_next_steps: string;
  search_expansion_needed: boolean;
}

export interface AssessmentResult {
  determination: 'NOVEL' | 'NOT_NOVEL' | 'PARTIALLY_NOVEL';
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  novelty_analysis: {
    anticipated_elements: string[];
    novel_elements: string[];
    key_differences: string[];
  };
  non_obviousness_analysis: {
    obviousness_risks: string[];
    inventive_aspects: string[];
    prior_art_combinations: string[];
  };
  scope_analysis: {
    claim_breadth: 'NARROW' | 'MEDIUM' | 'BROAD';
    infringement_risk: 'LOW' | 'MEDIUM' | 'HIGH';
    workaround_options: string[];
  };
  commercial_analysis: {
    freedom_to_operate: 'CLEAR' | 'RISKY' | 'BLOCKED';
    licensing_opportunities: string[];
    market_impact: string;
  };
  recommendations: {
    prosecution_strategy: string[];
    freedom_to_operate: string[];
    next_steps: string[];
  };
  executive_summary: string;
}

// New interfaces for Stage 3.5a and 3.5b
export interface FeatureMapCell {
  feature: string;
  status: 'Present' | 'Partial' | 'Absent' | 'Unknown';
  feature_id?: string;
  user_invention_disclosure?: string;
  patent_disclosure?: string;
  extent_score?: number;
  confidence?: number;
  mappingConfidence?: number;
  evidenceDepth?: EvidenceDepth;
  legalEvidenceStrength?: number;
  qaDowngraded?: boolean;
  quote?: string;
  field?: string;
  evidence_source?: string;
  reason?: string;
  attorney_remark?: string;
  novelty_impact?: string;
  claim_review_note?: string;
  crisp_remark?: string;
  professional_remark?: string;
  evidence?: string | {
    quote: string;
    field: string;
  };
}

export interface PatentCoverage {
  present: number;
  partial: number;
  absent: number;
  coverage_score?: number; // Computed on our side
}

export interface PatentFeatureMap {
  pn: string;
  title?: string;
  link?: string | null;
  coverage?: PatentCoverage;
  present?: FeatureMapCell[];
  partial?: FeatureMapCell[];
  absent?: FeatureMapCell[];
  feature_analysis: FeatureMapCell[]; // For backward compatibility - always present after validation
  // New: lightweight narrative + labels (produced in 3.5a)
  remarks?: string; // 2â€“4 sentences, no legalese
  model_decision?: 'potential_novelty_space' | 'mapped_overlap' | 'high_overlap' | 'novel' | 'partial_novelty' | 'obvious';
  decision?: 'potential_novelty_space' | 'mapped_overlap' | 'high_overlap' | 'novel' | 'partial_novelty' | 'obvious'; // deterministic server computation
  screeningConfidence?: number;
  evidenceDepth?: EvidenceDepth;
  legalEvidenceStrength?: number;
  domainTier?: DomainTier;
  domainTierReason?: string;
  domainTierEvidenceQuote?: string;
  matchCategory?: PatentScreeningMatchCategory;
  genericMappedFeatureCount?: number;
  domainSpecificMappedFeatureCount?: number;
  noveltyCandidateMappedFeatureCount?: number;
  genericityRiskLevel?: GenericityRiskLevel;
  genericityRiskReasons?: string[];
  genericFeatureOnlyMatch?: boolean;
  cooperativeRelationshipPresentInSameAbstract?: boolean;
  cooperativeRelationshipEvidenceQuote?: string;
  importantFeatureCoverage?: number;
  importantUnknownRatio?: number;
  queryClusterIds?: string[];
}

export type EvidenceDepth = 'TITLE_ONLY' | 'ABSTRACT_ONLY' | 'TITLE_AND_ABSTRACT' | 'FULL_TEXT' | 'CLAIMS_AND_SPECIFICATION' | 'NONE';
export type DomainTier = 1 | 2 | 3 | 4 | 5;
export type GenericityRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type PatentScreeningMatchCategory =
  | 'HIGH_ABSTRACT_OVERLAP'
  | 'COMPONENT_LEVEL_OVERLAP'
  | 'ADJACENT_DOMAIN_ANALOGY'
  | 'WEAK_ANALOGY'
  | 'NOT_RELEVANT';
export type AdaptiveStopReason =
  | 'abstract_level_high_overlap_candidate_confirmed'
  | 'coverage_saturation'
  | 'candidate_pool_exhausted'
  | 'hard_ceiling_reached'
  | 'provider_or_cluster_coverage_incomplete'
  | 'safe_report_due_to_qa_failure';

export interface ScreeningQueryCluster {
  id: string;
  label: string;
  terms: string[];
  critical: boolean;
}

export interface AdaptiveScreeningProgress {
  mode: 'off' | 'observe' | 'enforce';
  complexity: 'simple' | 'moderate' | 'complex' | 'crowded';
  gatedCount: number;
  analyzedCount: number;
  remainingCount: number;
  batchesCompleted: number;
  projectedStopReason?: AdaptiveStopReason;
  terminalStopReason?: AdaptiveStopReason;
  decisivePatentNumber?: string;
  confirmationBatchCompleted: boolean;
  confirmationStable?: boolean;
  evidenceQualityLow: boolean;
  evidenceQualityReasons: string[];
  queryClusterCoverage: Record<string, { gated: number; analyzed: number }>;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  projectedTokensSaved: number;
}

type NoveltyStageProgress = {
  stage: 'relevance_review' | 'deep_analysis';
  status: 'running' | 'complete' | 'failed';
  analyzedPatents: number;
  totalPatents: number;
  processedBatches?: number;
  batchCount?: number;
  failedBatches?: number;
  percent: number;
  message: string;
  updatedAt: string;
};

export interface FeatureMapBatchResult {
  feature_map: PatentFeatureMap[];
  quality_flags: {
    low_evidence: boolean;
    ambiguous_abstracts: boolean;
    language_mismatch: boolean;
  };
  stats: {
    patents_analyzed: number;
    avg_abstract_length_words: number;
  };
  noHighConfidencePriorArt?: boolean;
  message?: string;
  retrievedCount?: number;
  reviewedCount?: number;
  progress?: NoveltyStageProgress;
  adaptiveScreening?: AdaptiveScreeningProgress;
}

export interface PerPatentCoverage {
  pn: string;
  present_count: number;
  partial_count: number;
  absent_count: number;
  coverage_ratio: number;
  present_only_ratio?: number;
  important_coverage_ratio?: number;
}

export interface PerFeatureUniqueness {
  feature: string;
  present_in: number;
  partial_in: number;
  absent_in: number;
  uniqueness: number;
  unknown_in?: number;
  mapped_in?: number;
  coverage_gap?: number;
  feature_seen_anywhere?: boolean;
  feature_gap_against_closest_refs?: boolean;
  combination_sensitive_differentiator?: boolean;
  feature_type?: InventionFeatureDetail['feature_type'];
  weight?: number;
}

export interface IntegrationCheck {
  any_single_patent_covers_majority: boolean;
  integration_pn?: string;
  explanation: string;
}

export interface FeatureMatrixCell {
  patentNumber: string;
  feature: string;
  status: 'Present' | 'Partial' | 'Absent' | 'Unknown';
  extent_score?: number;
  confidence?: number;
  evidence?: string;
  reason?: string;
}

export interface FeatureMatrix {
  patents: string[];
  features: string[];
  cells: FeatureMatrixCell[];
  patentTitles: Record<string, string>;
  llmUsage: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
}

export interface AggregationResult {
  idea_id: string;
  per_patent_coverage: PerPatentCoverage[];
  per_feature_uniqueness: PerFeatureUniqueness[];
  per_feature_coverage_gap?: PerFeatureUniqueness[];
  integration_check: IntegrationCheck;
  novelty_score: number;
  mapped_differentiation_score?: number;
  single_reference_max_coverage?: number;
  distributed_component_coverage?: number;
  distributed_component_features?: string[];
  distributed_component_risk_ratio?: number;
  distributed_component_risks?: string[];
  closest_mapped_references?: string[];
  combination_sensitive_differentiators?: string[];
  claimConceptMapping?: ClaimConceptMapping[];
  decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';
  mapped_overlap_assessment?: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';
  confidence: 'High' | 'Medium' | 'Low';
  risk_factors: string[];
  feature_matrix?: FeatureMatrix;
  structured_narrative?: any;
  // Optional per-patent remarks derived from Stage 3.5a mappings
  per_patent_remarks?: PerPatentRemark[];
  noHighConfidencePriorArt?: boolean;
  message?: string;
}

// Stage 3.5c / 3.5a per-patent remarks structure
export interface PerPatentRemark {
  pn: string;
  title?: string;
  abstract?: string;
  remarks: string; // concise, short narrative (< 25 words preferred)
  overlap_features?: string[];
  missing_features?: string[];
  novelty_points?: string[];
  potential_differentiators?: string[];
  confidence?: number; // 0..1
  decision?: 'potential_novelty_space' | 'mapped_overlap' | 'high_overlap' | 'novel' | 'partial_novelty' | 'obvious';
  // Enhanced detailed analysis fields (for Stage 3.5c)
  relevance?: number; // 0-1 relevance/overlap score
  novelty_threat?: string;
  summary?: string; // analysis summary
  comparison_rows?: PatentFeatureComparisonRow[];
  detailedAnalysis?: {
    relevant_parts: string[];    // overlapping elements with prior art
    irrelevant_parts: string[];  // differentiators - what's unique to the invention
    novelty_comparison: string;  // detailed novelty assessment narrative
  };
}

export interface PatentFeatureComparisonRow {
  feature_id: string;
  feature: string;
  user_invention_disclosure: string;
  patent_disclosure: string;
  status: FeatureMapCell['status'];
  evidence_quote?: string;
  evidence_source: 'title' | 'abstract' | 'title/abstract' | 'claims' | 'none';
  extent_score?: number;
  confidence?: number;
  crisp_remark: string;
  attorney_remark: string;
  novelty_impact: string;
  claim_review_note: string;
  professional_remark: string;
}

export class NoveltySearchService extends BasePatentService {

  private defaultConfig: NoveltySearchConfig = {
    jurisdiction: 'IN',
    filingType: 'utility',
    searchSource: {
      llmExpansion: true,
      filters: {}
    },
    // New Stage 1.5 (AI Relevance) defaults
    stage15: {
      thresholds: { high: 0.7, medium: 0.45 },
      borderlineQuota: 5,
      maxCandidates: 80,
      batchSize: 15,
      concurrency: NOVELTY_LLM_CONCURRENCY,
      timeoutMs: 90000,
      visibleLimit: DEFAULT_VISIBLE_PRIOR_ART_LIMIT,
      minimumVisibleConfidence: DEFAULT_MINIMUM_VISIBLE_CONFIDENCE
    },
    stage0: {},
    stage1: {
      maxPatents: DEFAULT_VISIBLE_PRIOR_ART_LIMIT,
      candidateLimit: 180,
      relevanceThresholds: { high: 0.8, medium: 0.5 }
    },
    stage35a: {
      batchSize: 8,
      concurrency: NOVELTY_LLM_CONCURRENCY,
      maxRefsTotal: 60,
      thresholdPresent: 0.70,
      thresholdPartial: 0.40,
      criticalFeatures: [],
      acceptedOverflowRatio: 0.15,
      borderlineOverflowRatio: 0.10
    },
    stage35b: {},
    stage35c: {
      maxPatentsForRemarks: undefined,
      batchSize: 8,
      concurrency: NOVELTY_LLM_CONCURRENCY
    },
    consolidatedAnalysis: {
      enabled: true,
      maxCandidates: 40,
      batchSize: 8,
      concurrency: NOVELTY_LLM_CONCURRENCY,
      maxPatentsForAttorneyReport: 40
    },
    adaptiveAnalysis: {
      mode: 'observe',
      gateCeiling: 180,
      deepAnalysisCeiling: 40,
      confirmationBatches: 1,
      screeningConfidenceThreshold: 0.75,
      importantCoverageThreshold: 0.90,
      componentScoreThreshold: 0.55,
      saturationPlateauBatches: 2
    },
    stage4: {
      reportFormat: 'PDF',
      includeExecutiveSummary: true,
      includeTechnicalDetails: true,
      colorCoding: true,
      maxRefsForReportMain: 10,
      maxRefsForUI: 12
    }
  };

  private async ensureSearchNotCancelled(searchId: string): Promise<{ success: true } | { success: false; error: string }> {
    const job = await (prisma as any).noveltySearchJob.findUnique({
      where: { searchId },
      select: { status: true },
    });
    if (job?.status === 'CANCELLED') {
      return { success: false, error: 'Novelty search was cancelled' };
    }
    return { success: true };
  }

  normalizeApprovedStage0(stage0Data: NormalizedIdea, inventionDisclosure = ''): NormalizedIdea {
    return this.normalizeStage0Idea(stage0Data, inventionDisclosure);
  }

  private mergeConfig(input?: Partial<NoveltySearchConfig>): NoveltySearchConfig {
    const requestConfig = input || {};
    return {
      ...this.defaultConfig,
      ...requestConfig,
      searchSource: {
        ...this.defaultConfig.searchSource,
        ...(requestConfig.searchSource || {}),
        filters: {
          ...(this.defaultConfig.searchSource?.filters || {}),
          ...((requestConfig.searchSource as any)?.filters || {}),
        }
      },
      stage0: { ...this.defaultConfig.stage0, ...(requestConfig.stage0 || {}) },
      stage1: { ...this.defaultConfig.stage1, ...(requestConfig.stage1 || {}) },
      stage15: { ...this.defaultConfig.stage15, ...(requestConfig.stage15 || {}) },
      stage35a: { ...this.defaultConfig.stage35a, ...(requestConfig.stage35a || {}) },
      stage35b: { ...this.defaultConfig.stage35b, ...(requestConfig.stage35b || {}) },
      stage35c: { ...this.defaultConfig.stage35c, ...(requestConfig.stage35c || {}) },
      consolidatedAnalysis: { ...this.defaultConfig.consolidatedAnalysis, ...(requestConfig.consolidatedAnalysis || {}) },
      adaptiveAnalysis: { ...this.defaultConfig.adaptiveAnalysis, ...(requestConfig.adaptiveAnalysis || {}) },
      stage4: { ...this.defaultConfig.stage4, ...(requestConfig.stage4 || {}) },
    } as NoveltySearchConfig;
  }

  private getFeatureStatus(patentMap: PatentFeatureMap | null | undefined, feature: string): FeatureMapCell['status'] | undefined {
    if (!patentMap || !Array.isArray(patentMap.feature_analysis)) return undefined;
    const exact = patentMap.feature_analysis.find(cell => cell.feature === feature);
    if (exact) return exact.status;
    const normalized = feature.toLowerCase();
    return patentMap.feature_analysis.find(cell => String(cell.feature || '').toLowerCase() === normalized)?.status;
  }

  private isGenericNoveltyFeature(feature: string): boolean {
    const normalized = String(feature || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return false;

    const mechanismIndicators = [
      'control relationship',
      'controlled release',
      'closed loop',
      'closed-loop',
      'feedback',
      'material relationship',
      'formulation ratio',
      'biological target',
      'target interaction',
      'structural geometry',
      'process sequence',
      'signal-processing',
      'signal processing',
      'data transformation',
      'technical effect',
      'release profile',
      'synthesis route',
      'circuit topology',
      'motion path',
      'engagement relationship',
      'enzyme trigger',
      'ph trigger',
      'sensor residual',
      'anomaly classifier',
      'synchronization',
      'modulation',
      'encoding',
      'inference logic',
    ];
    if (mechanismIndicators.some(indicator => normalized.includes(indicator))) {
      return false;
    }

    const genericTerms = new Set([
      'system', 'method', 'device', 'apparatus', 'processor', 'memory', 'sensor',
      'controller', 'control', 'module', 'server', 'database', 'api', 'housing',
      'display', 'battery', 'network', 'ui', 'interface', 'excipient', 'carrier',
      'clamp', 'circuit', 'element', 'step', 'process', 'algorithm', 'model',
      'software', 'application', 'app', 'pipe', 'connector', 'joint', 'valve',
      'pump', 'camera', 'transceiver', 'wireless', 'communication', 'data',
      'storage', 'user', 'input', 'output', 'component', 'material', 'layer',
      'member', 'unit', 'part', 'signal',
    ]);
    const stopWords = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'to', 'for', 'with', 'using', 'based', 'configured']);
    const words = normalized
      .split(/\s+/)
      .map(word => word.replace(/s$/, ''))
      .filter(word => word && !stopWords.has(word));

    if (words.length === 0 || words.length > 5) return false;
    const genericHits = words.filter(word => genericTerms.has(word)).length;
    return genericHits > 0 && genericHits >= Math.ceil(words.length * 0.6);
  }

  private findClosestFeatureMap(featureMaps: PatentFeatureMap[], inventionFeatures: string[]): PatentFeatureMap | null {
    const total = Math.max(1, inventionFeatures.length);
    let best: PatentFeatureMap | null = null;
    let bestScore = -1;
    let bestPresent = -1;

    for (const patentMap of featureMaps || []) {
      const cells = Array.isArray(patentMap?.feature_analysis) ? patentMap.feature_analysis : [];
      const present = cells.filter(cell => cell.status === 'Present').length;
      const partial = cells.filter(cell => cell.status === 'Partial').length;
      const score = (present + partial * 0.5) / total;
      if (score > bestScore || (score === bestScore && present > bestPresent)) {
        best = patentMap;
        bestScore = score;
        bestPresent = present;
      }
    }

    return best;
  }

  private isPotentialDifferentiator(
    feature: string,
    closestMap: PatentFeatureMap | null | undefined,
    qualityFlags?: { low_evidence?: boolean }
  ): boolean {
    if (!closestMap || qualityFlags?.low_evidence || this.isGenericNoveltyFeature(feature)) return false;
    const status = this.getFeatureStatus(closestMap, feature);
    if (!status || status === 'Unknown' || status === 'Present' || status === 'Partial') return false;
    return status === 'Absent';
  }

  private getPotentialDifferentiatorFeatures(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    qualityFlags?: { low_evidence?: boolean }
  ): string[] {
    const closestMap = this.findClosestFeatureMap(featureMaps, inventionFeatures);
    if (!closestMap) return [];
    return inventionFeatures.filter(feature => this.isPotentialDifferentiator(feature, closestMap, qualityFlags));
  }

  private featureMapsFromFeatureMatrix(featureMatrix?: FeatureMatrix): PatentFeatureMap[] {
    if (!featureMatrix || !Array.isArray(featureMatrix.patents) || !Array.isArray(featureMatrix.cells)) return [];
    return featureMatrix.patents.map(pn => ({
      pn,
      title: featureMatrix.patentTitles?.[pn],
      feature_analysis: featureMatrix.features.map(feature => {
        const cell = featureMatrix.cells.find(entry => entry.patentNumber === pn && entry.feature === feature);
        return {
          feature,
          status: (cell?.status || 'Absent') as FeatureMapCell['status'],
          confidence: cell?.confidence,
          evidence: cell?.evidence,
          reason: cell?.reason
        };
      })
    }));
  }

  private getPotentialDifferentiatorsFromAggregation(aggregationResult: AggregationResult): string[] {
    const fromRows = (aggregationResult.per_feature_uniqueness || [])
      .filter(entry => Boolean(entry.feature_gap_against_closest_refs ?? (entry.present_in === 0 && entry.partial_in === 0)) && !this.isGenericNoveltyFeature(entry.feature))
      .map(entry => entry.feature);
    if (fromRows.length > 0) return fromRows;
    const features = (aggregationResult.per_feature_uniqueness || []).map(entry => entry.feature).filter(Boolean);
    const qualityFlags = { low_evidence: aggregationResult.decision === 'Low Evidence' };
    const featureMaps = this.featureMapsFromFeatureMatrix(aggregationResult.feature_matrix);
    if (featureMaps.length > 0) {
      return this.getPotentialDifferentiatorFeatures(featureMaps, features, qualityFlags);
    }

    if (qualityFlags.low_evidence) return [];
    return (aggregationResult.per_feature_uniqueness || [])
      .filter(entry => entry.present_in === 0 && entry.partial_in === 0 && !this.isGenericNoveltyFeature(entry.feature))
      .map(entry => entry.feature);
  }

  private isNoRiskBoilerplate(value: any): boolean {
    const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return /^no (?:(?:significant|specific|material|additional)\s+)?risks? (identified|generated|found|noted)\.?$/.test(text);
  }

  private mergeRiskLists(...lists: Array<any[] | undefined>): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const value = String(item || '').trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(value);
      }
    }
    return merged;
  }

  /**
   * Generate the proposed retrieval query and invention features without
   * creating a novelty-search run. The caller must present these values to the
   * user and send the approved version when enqueueing the search.
   */
  async prepareNoveltySearch(request: NoveltySearchRequest): Promise<NoveltySearchResponse> {
    try {
      const user = await this.validateUser(request.jwtToken);
      if (user.tenantId) {
        const serviceAccess = await checkServiceAccess(user.id, user.tenantId, 'NOVELTY_SEARCH');
        if (!serviceAccess.allowed) {
          return { success: false, error: serviceAccess.reason || 'Novelty search access denied.' };
        }
      }
      const config = this.mergeConfig(request.config);
      const result = await this.performStage0(
        `preview-${user.id}`,
        request,
        config,
        user,
        request.jwtToken ? { authorization: `Bearer ${request.jwtToken}` } : {},
      );
      if (!result.success || !result.data) {
        return { success: false, error: result.error || 'Failed to generate search terms.' };
      }
      return { success: true, results: result.data };
    } catch (error) {
      console.error('Novelty search preparation error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to generate search terms' };
    }
  }

  /**
   * Validate and enqueue a novelty search without executing any LLM stage in
   * the request process. A NoveltySearchJob is the opt-in marker consumed by
   * the standalone background worker; legacy runs have no job row.
   */
  async enqueueNoveltySearch(request: NoveltySearchRequest): Promise<NoveltySearchResponse> {
    try {
      const user = await this.validateUser(request.jwtToken);
      let remainingQuota: { daily: number | null; monthly: number | null } | undefined;

      if (user.tenantId) {
        const serviceAccess = await checkServiceAccess(user.id, user.tenantId, 'NOVELTY_SEARCH');
        if (!serviceAccess.allowed) {
          return { success: false, error: serviceAccess.reason || 'Novelty search access denied.' };
        }
        remainingQuota = serviceAccess.remainingQuota;
      }

      const config = this.mergeConfig(request.config);
      const intelligentSearch = config.searchSource?.searchMode !== 'manual';
      const includeEpoKeywords = searchSourceIncludesEpo(config.searchSource?.mode);
      const includePapers = Boolean(config.searchSource?.includePapers);
      const approvedQuery = String(request.approvedStage0?.searchQuery || '').trim();
      const approvedFeatures = Array.isArray(request.approvedStage0?.inventionFeatures)
        ? Array.from(new Set(request.approvedStage0.inventionFeatures.map(feature => String(feature || '').trim()).filter(Boolean)))
        : [];
      const approvedEpoTitleKeywords = includeEpoKeywords
        ? this.normalizeEpoKeywordList((request.approvedStage0 as any)?.epoTitleKeywords ?? (request.approvedStage0 as any)?.epo_title_keywords)
        : [];
      const approvedEpoAbstractKeywords = includeEpoKeywords
        ? this.normalizeEpoKeywordList((request.approvedStage0 as any)?.epoAbstractKeywords ?? (request.approvedStage0 as any)?.epo_abstract_keywords)
        : [];
      const approvedEpoCombinedKeywords = includeEpoKeywords
        ? this.normalizeEpoKeywordList((request.approvedStage0 as any)?.epoCombinedKeywords ?? (request.approvedStage0 as any)?.epo_combined_keywords)
        : [];
      if (intelligentSearch && (!approvedQuery || approvedFeatures.length === 0)) {
        return { success: false, error: 'Review and approve the generated search query and invention features before queueing the novelty search.' };
      }

      const suppliedDetails = Array.isArray(request.approvedStage0?.featureDetails)
        ? request.approvedStage0.featureDetails
        : [];
      const approvedStage0Raw: NormalizedIdea | undefined = intelligentSearch
        ? {
            ...request.approvedStage0,
            searchQuery: approvedQuery.slice(0, 1000),
            inventionFeatures: approvedFeatures.slice(0, 30).map(feature => feature.slice(0, 1000)),
            ...(includeEpoKeywords ? {
              epoTitleKeywords: approvedEpoTitleKeywords,
              epoAbstractKeywords: approvedEpoAbstractKeywords,
              epoCombinedKeywords: approvedEpoCombinedKeywords,
            } : {}),
            ...(includePapers ? {
              paperSearchQuery: this.normalizeStage0Scalar(
                (request.approvedStage0 as any)?.paperSearchQuery || config.searchSource?.paperSearchQuery || approvedQuery,
                500
              ),
              paperKeywords: this.normalizeEpoKeywordList((request.approvedStage0 as any)?.paperKeywords),
              paperSearchQueries: this.normalizeEpoKeywordList((request.approvedStage0 as any)?.paperSearchQueries),
              googleScholarSearchQuery: this.normalizeStage0Scalar((request.approvedStage0 as any)?.googleScholarSearchQuery || (request.approvedStage0 as any)?.paperSearchQuery || approvedQuery, 500),
              academicDatabaseSearchQuery: this.normalizeStage0Scalar((request.approvedStage0 as any)?.academicDatabaseSearchQuery || (request.approvedStage0 as any)?.paperSearchQuery || approvedQuery, 500),
              paperYearFrom: Number((request.approvedStage0 as any)?.paperYearFrom) || 1900,
              paperYearTo: Number((request.approvedStage0 as any)?.paperYearTo) || new Date().getFullYear(),
            } : {}),
            featureDetails: approvedFeatures.slice(0, 30).map((feature, index) => {
              const exactMatch = suppliedDetails.find(detail => String(detail?.feature || '').trim() === feature);
              const existing = exactMatch || suppliedDetails[index];
              return existing
                ? {
                    ...existing,
                    feature,
                    // An edited feature is the user's approved disclosure. Do not
                    // retain stale generated wording as the comparison input.
                    user_disclosure: exactMatch
                      ? String(existing.user_disclosure || feature).trim()
                      : feature,
                  }
                : {
                    feature,
                    user_disclosure: feature,
                    technical_role: 'Technical feature reviewed and approved by the user.',
                    source_excerpt: '',
                  };
            }),
            title: request.title,
            inventionText: request.inventionDescription,
          }
        : undefined;
      if (approvedStage0Raw && !includeEpoKeywords) {
        delete (approvedStage0Raw as any).epoTitleKeywords;
        delete (approvedStage0Raw as any).epo_title_keywords;
        delete (approvedStage0Raw as any).epoAbstractKeywords;
        delete (approvedStage0Raw as any).epo_abstract_keywords;
        delete (approvedStage0Raw as any).epoCombinedKeywords;
        delete (approvedStage0Raw as any).epo_combined_keywords;
      }
      const approvedStage0: NormalizedIdea | undefined = approvedStage0Raw
        ? this.normalizeStage0Idea(approvedStage0Raw, request.inventionDescription)
        : undefined;

      if (request.patentId) await this.validatePatentAccess(request.patentId, user.id);

      if (request.projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: request.projectId,
            OR: [
              { userId: user.id },
              { collaborators: { some: { userId: user.id } } },
            ],
          },
          select: { id: true },
        });
        if (!project) throw new Error('Project not found or access denied');
      }

      if (request.groupId) {
        const group = await (prisma as any).noveltySearchGroup.findFirst({
          where: { id: request.groupId, userId: user.id, archivedAt: null },
          select: { id: true },
        });
        if (!group) throw new Error('Matter group not found or archived');
      }

      if (user.tenantId && remainingQuota) {
        const pendingJobs = await (prisma as any).noveltySearchJob.count({
          where: {
            status: { in: ['QUEUED', 'PROCESSING'] },
            search: { user: { tenantId: user.tenantId } },
          },
        });
        const finiteRemaining = [remainingQuota.daily, remainingQuota.monthly]
          .filter((value): value is number => typeof value === 'number');
        if (finiteRemaining.length > 0 && pendingJobs >= Math.min(...finiteRemaining)) {
          return { success: false, error: 'Novelty search quota is already reserved by queued searches.' };
        }
      }

      const searchRun = await prisma.$transaction(async tx => {
        const created = await tx.noveltySearchRun.create({
          data: {
            patentId: request.patentId,
            projectId: request.projectId,
            groupId: request.groupId,
            userId: user.id,
            status: approvedStage0 ? NoveltySearchStatus.STAGE_0_COMPLETED : NoveltySearchStatus.PENDING,
            currentStage: approvedStage0 ? NoveltySearchStage.STAGE_1 : NoveltySearchStage.STAGE_0,
            config: config as any,
            inventionDescription: request.inventionDescription,
            title: request.title,
            jurisdiction: config.jurisdiction,
            filingType: config.filingType,
            ...(approvedStage0 ? {
              stage0Results: approvedStage0 as any,
              stage0CompletedAt: new Date(),
            } : {}),
          } as any,
        });
        await (tx as any).noveltySearchJob.create({
          data: { searchId: created.id, status: 'QUEUED', currentStep: approvedStage0 ? 'STAGE_1' : 'STAGE_0' },
        });
        return created;
      });

      return {
        success: true,
        searchId: searchRun.id,
        status: approvedStage0 ? NoveltySearchStatus.STAGE_0_COMPLETED : NoveltySearchStatus.PENDING,
        currentStage: approvedStage0 ? NoveltySearchStage.STAGE_1 : NoveltySearchStage.STAGE_0,
      };
    } catch (error) {
      console.error('Novelty search enqueue error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to queue novelty search' };
    }
  }

  /**
   * Start a complete novelty search workflow
   */
  async startNoveltySearch(request: NoveltySearchRequest): Promise<NoveltySearchResponse> {
    try {
      // Validate user
      const user = await this.validateUser(request.jwtToken);

      // QUOTA CHECK: Use the centralized service-access gate so tenant status,
      // MANUAL_ATI bypasses, role/team rules, and plan quotas stay consistent
      // with the API middleware.
      if (user.tenantId) {
        const serviceAccess = await checkServiceAccess(user.id, user.tenantId, 'NOVELTY_SEARCH');
        if (!serviceAccess.allowed) {
          console.log(`[NoveltySearch] Access denied for tenant ${user.tenantId}: ${serviceAccess.reason}`);
          return {
            success: false,
            error: serviceAccess.reason || 'Novelty search access denied. Please contact your administrator.'
          };
        }
      }

      // Merge config with defaults
      const config = this.mergeConfig(request.config);

      // Validate patent access if provided
      if (request.patentId) {
        await this.validatePatentAccess(request.patentId, user.id);
      }

      // Validate project access if provided
      if (request.projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: request.projectId,
            userId: user.id
          }
        });
        if (!project) {
          throw new Error('Project not found or access denied');
        }
      }

      // Create search run record
      const searchRun = await prisma.noveltySearchRun.create({
        data: {
          patentId: request.patentId,
          projectId: request.projectId,
          userId: user.id,
          status: NoveltySearchStatus.PENDING,
          currentStage: NoveltySearchStage.STAGE_0,
          config: config as any,
          inventionDescription: request.inventionDescription,
          title: request.title,
          jurisdiction: config.jurisdiction,
          filingType: config.filingType,
        },
      });

      // Start Stage 0: Idea Normalization
      const stage0Result = await this.performStage0(searchRun.id, request, config, user, request.jwtToken ? { authorization: `Bearer ${request.jwtToken}` } : {});

      if (!stage0Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchRun.id },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage0Result.error };
      }

      // Update with stage 0 results
      await prisma.noveltySearchRun.update({
        where: { id: searchRun.id },
        data: {
          status: NoveltySearchStatus.STAGE_0_COMPLETED,
          currentStage: NoveltySearchStage.STAGE_1,
          stage0CompletedAt: new Date(),
          stage0Results: stage0Result.data as any
        }
      });

      return {
        success: true,
        searchId: searchRun.id,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: stage0Result.data
      };

    } catch (error) {
      console.error('Novelty search start error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start novelty search'
      };
    }
  }

  /**
   * Execute Stage 1.5: AI Relevance Gate
   */
  async executeStage15(
    searchId: string,
    userId: string,
    requestHeaders?: Record<string, string>,
    options?: { appendNextBatch?: boolean }
  ): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      const searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
      if (!searchRun) return { success: false, error: 'Novelty search not found' };

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage1Data = searchRun.stage1Results as unknown as any;
      const candidatePool = this.getStage1CandidatePool(stage1Data);
      if (!stage1Data || candidatePool.length === 0) {
        return { success: false, error: 'Stage 1 results are required before Stage 1.5' };
      }

      if (!options?.appendNextBatch && stage1Data.aiRelevance?.byPn) {
        const pqai = candidatePool;
        const maxCandidates = config.stage15.maxCandidates;
        const candidates = pqai.slice(0, Math.min(maxCandidates, pqai.length));
        const cacheKey = this.createStage15CacheKey(stage0Data, candidates);
        if (this.canReuseStage15Gate(stage1Data, cacheKey)) {
          const merged = this.mergeStage15Visibility(stage1Data, stage1Data.aiRelevance, config);
          if (!Array.isArray(stage1Data.visiblePriorArtResults)) {
            await prisma.noveltySearchRun.update({ where: { id: searchId }, data: { stage1Results: merged as any } });
          }
          return {
            success: true,
            searchId,
            status: NoveltySearchStatus.STAGE_1_COMPLETED,
            currentStage: NoveltySearchStage.STAGE_1,
            results: merged
          };
        }
      }

      const gate = await this.performStage15(searchId, stage0Data, stage1Data, config, requestHeaders, options);
      if (!gate.success) return { success: false, error: gate.error || 'Stage 1.5 failed' };
      const postGateCancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postGateCancellation.success) return postGateCancellation;

      // Merge back into stage1Results and persist
      const merged = this.mergeStage15Visibility(stage1Data, gate.data, config);
      await prisma.noveltySearchRun.update({ where: { id: searchId }, data: { stage1Results: merged as any } });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_1_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1, // logical marker; pipeline may still jump to 3.5 next
        results: merged
      };
    } catch (error) {
      console.error('Stage 1.5 execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 1.5 execution failed' };
    }
  }

  /**
   * Execute Stage 1: Initial Screening
   */
  async executeStage1(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      // Get search run
      let searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Allow resuming from any previous stage (don't enforce strict sequential progression for resume)
      // if (searchRun.currentStage !== NoveltySearchStage.STAGE_1) {
      //   return { success: false, error: 'Invalid stage progression' };
      // }

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;

      // Perform Stage 1 screening through the modular provider orchestrator.
      const stage1Result = await this.performStage1(searchRun, stage0Data, config, requestHeaders);
      const postSearchCancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postSearchCancellation.success) return postSearchCancellation;

      if (!stage1Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage1Result.error };
      }

      // Stage 1 is only provider retrieval. Relevance gating is Stage 1.5 so the
      // UI can show all returned patents before filtering them.
      const screeningData = stage1Result.data as any;
      const candidatePool = this.getStage1CandidatePool(screeningData);
      const hasResults = candidatePool.length > 0;
      const nextStage: NoveltySearchStage = hasResults ? NoveltySearchStage.STAGE_1 : NoveltySearchStage.STAGE_4;
      const status: NoveltySearchStatus = NoveltySearchStatus.STAGE_1_COMPLETED;

      const mergedStage1 = { ...(screeningData || {}), stage0: stage0Data };

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: nextStage,
          status: status,
          stage1CompletedAt: new Date(),
          stage1Results: mergedStage1 as any
        }
      });

      return {
        success: true,
        searchId,
        status,
        currentStage: nextStage,
        results: mergedStage1
      };

    } catch (error) {
      console.error('Stage 1 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 1 execution failed'
      };
    }
  }

  /**
   * Execute Stage 2: Patent Discovery
   * Combines provider patent search and AI relevance gating into one user-facing step.
   */
  async executeStage2(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      const searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
      if (!searchRun) return { success: false, error: 'Novelty search not found' };

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      if (!stage0Data?.searchQuery) {
        return { success: false, error: 'Stage 1 Idea Setup must be completed before Patent Discovery.' };
      }

      let stage1Data = searchRun.stage1Results as unknown as any;
      if (!stage1Data || this.getStage1CandidatePool(stage1Data).length === 0) {
        const stage1Result = await this.performStage1(searchRun, stage0Data, config, requestHeaders);
        const postSearchCancellation = await this.ensureSearchNotCancelled(searchId);
        if (!postSearchCancellation.success) return postSearchCancellation;
        if (!stage1Result.success) {
          await prisma.noveltySearchRun.update({ where: { id: searchId }, data: { status: NoveltySearchStatus.FAILED } });
          return { success: false, error: stage1Result.error };
        }
        stage1Data = { ...(stage1Result.data || {}), stage0: stage0Data };
      }

      if (this.getStage1CandidatePool(stage1Data).length > 0) {
        const gate = await this.performStage15(searchId, stage0Data, stage1Data, config, requestHeaders);
        const postGateCancellation = await this.ensureSearchNotCancelled(searchId);
        if (!postGateCancellation.success) return postGateCancellation;
        if (!gate.success) return { success: false, error: gate.error || 'AI relevance gate failed' };
        stage1Data = this.mergeStage15Visibility(stage1Data, gate.data, config);
      } else {
        stage1Data = {
          ...(stage1Data || {}),
          aiRelevance: {
            accepted: [],
            component: [],
            borderline: [],
            rejected: [],
            byPn: {},
            consideredCount: 0,
            totalCandidates: 0,
            boundedToTopCandidates: false
          }
        };
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_3_5,
          status: NoveltySearchStatus.STAGE_1_COMPLETED,
          stage1CompletedAt: new Date(),
          stage1Results: stage1Data as any,
          stage35CompletedAt: null,
          stage35Results: Prisma.JsonNull,
          stage4CompletedAt: null,
          stage4Results: Prisma.JsonNull,
          reportUrl: null
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_1_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_3_5,
        results: stage1Data
      };
    } catch (error) {
      console.error('Stage 2 execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 2 execution failed' };
    }
  }

  /**
   * Execute Stage 3: Deep Analysis
   * Combines feature mapping, deterministic aggregation, and top-threat remarks.
   */
  async executeStage3(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      let searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
      if (!searchRun) return { success: false, error: 'Novelty search not found' };

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      if (!stage0Data?.searchQuery) {
        return { success: false, error: 'Idea Setup must be completed before Deep Analysis.' };
      }

      let stage1Data = searchRun.stage1Results as unknown as any;
      if (!stage1Data || this.getStage1CandidatePool(stage1Data).length === 0) {
        const discovery = await this.executeStage1(searchId, userId, requestHeaders);
        if (!discovery.success) return discovery;
        searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
        if (!searchRun) return { success: false, error: 'Novelty search not found after patent search' };
        stage1Data = searchRun.stage1Results as unknown as any;
      }

      if (!stage1Data?.aiRelevance) {
        const relevance = await this.executeStage15(searchId, userId, requestHeaders);
        if (!relevance.success) return relevance;
        searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
        if (!searchRun) return { success: false, error: 'Novelty search not found after relevance analysis' };
        stage1Data = searchRun.stage1Results as unknown as any;
      }

      let stage35Data = searchRun.stage35Results as unknown as FeatureMapBatchResult | null;
      let stage4Data = searchRun.stage4Results as unknown as any;

      const hasExistingDeepAnalysis = !!(
        (
          stage35Data?.noHighConfidencePriorArt &&
          stage4Data?.noHighConfidencePriorArt
        ) ||
        (
          stage35Data &&
          Array.isArray(stage35Data.feature_map) &&
          stage35Data.feature_map.length > 0 &&
          stage4Data?.per_patent_coverage &&
          this.hasDetailedStage35cRemarks(stage4Data)
        )
      );

      if (!hasExistingDeepAnalysis) {
        const consolidated = await this.performConsolidatedDeepAnalysis(searchId, stage0Data, stage1Data, config, requestHeaders);
        const postAnalysisCancellation = await this.ensureSearchNotCancelled(searchId);
        if (!postAnalysisCancellation.success) return postAnalysisCancellation;

        if (consolidated.success && consolidated.data) {
          stage35Data = consolidated.data.stage35Data;
          stage4Data = consolidated.data.stage4Data;
          const mergedStage1 = consolidated.data.aiRelevance
            ? { ...(stage1Data || {}), aiRelevance: consolidated.data.aiRelevance }
            : stage1Data;

          await this.storeFeatureMapResults(searchId, stage35Data.feature_map);
          await prisma.noveltySearchRun.update({
            where: { id: searchId },
            data: {
              stage1Results: mergedStage1 as any,
              stage35Results: stage35Data as any,
              stage4Results: stage4Data as any,
              reportUrl: null
            }
          });
        } else {
          console.warn('[Stage3] Consolidated deep analysis failed; falling back to legacy route:', consolidated.error);

          const mapping = await this.executeStage35a(searchId, userId, requestHeaders);
          if (!mapping.success) return mapping;
          searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
          if (!searchRun) return { success: false, error: 'Novelty search not found after feature mapping' };
          stage35Data = searchRun.stage35Results as unknown as FeatureMapBatchResult;

          const aggregation = await this.executeStage35b(searchId, userId, requestHeaders);
          if (!aggregation.success) return aggregation;
          searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
          if (!searchRun) return { success: false, error: 'Novelty search not found after aggregation' };
          stage4Data = searchRun.stage4Results as unknown as any;

          if (!this.hasDetailedStage35cRemarks(stage4Data)) {
            const remarks = await this.executeStage35c(searchId, userId, requestHeaders);
            if (!remarks.success) return remarks;
            searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
            if (!searchRun) return { success: false, error: 'Novelty search not found after remarks' };
            stage4Data = searchRun.stage4Results as unknown as any;
          }
        }
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_4,
          status: NoveltySearchStatus.STAGE_3_5_COMPLETED,
          stage35CompletedAt: new Date()
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_3_5_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_4,
        results: {
          stage35: stage35Data,
          stage4: stage4Data,
          ...(stage4Data || {})
        }
      };
    } catch (error) {
      console.error('Stage 3 execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 3 execution failed' };
    }
  }

  /**
   * Execute Stage 3.5a: Feature Mapping Engine
   */
  async executeStage35a(
    searchId: string,
    userId: string,
    requestHeaders?: Record<string, string>,
    selectedPublicationNumbers?: string[]
  ): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      // Get search run
      let searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      let stage1Data = searchRun.stage1Results as unknown as any;

      console.log('[Stage3.5a][Service] selectedPublicationNumbers:', Array.isArray(selectedPublicationNumbers) ? selectedPublicationNumbers.length : 'n/a');
      console.log('[Stage3.5a][Service] stage1Results keys:', stage1Data ? Object.keys(stage1Data) : 'no stage1Results');
      const stage1CandidatePool = this.getStage1CandidatePool(stage1Data);
      console.log('[Stage3.5a][Service] stage1 pqai count:', Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults.length : 'n/a');
      console.log('[Stage3.5a][Service] stage1 candidate pool count:', stage1CandidatePool.length);

      // Check if Stage 1 results are available - manual progression requires explicit stage execution
      if (!stage1Data || stage1CandidatePool.length === 0) {
        if (!this.hasNoHighConfidencePriorArt(stage1Data)) {
          console.warn('[Stage3.5a][Service] Missing or empty Stage 1 results. Stage 3.5a requires Stage 1 to be completed first.');
          return {
            success: false,
            error: 'Stage 1 must be completed before running Stage 3.5a. Please execute Stage 1 first to fetch patent search results.'
          };
        }
      }

      // Filter the canonical Stage 1 candidate pool. New runs store provider results
      // in retrievalCandidates; pqaiResults exists only for old-run compatibility.
      if (Array.isArray(selectedPublicationNumbers) && selectedPublicationNumbers.length > 0) {
        const selected = new Set(selectedPublicationNumbers.map(canonicalPriorArtNumber).filter(Boolean));
        const candidatePool = this.getStage1CandidatePool(stage1Data);
        const filteredCandidates = candidatePool.filter((candidate: any) => {
          const pn = getPriorArtPublicationNumber(candidate);
          return Boolean(pn && selected.has(canonicalPriorArtNumber(pn)));
        });
        stage1Data = {
          ...stage1Data,
          retrievalCandidates: filteredCandidates,
          candidateResults: filteredCandidates,
          rawPriorArtResults: filteredCandidates,
        };
        console.log('[Stage3.5a][Service] Filtered candidate results by selection:', {
          before: candidatePool.length,
          after: filteredCandidates.length,
        });
      }

      // If AI relevance (Stage 1.5) has not been computed yet, do it now
      if (!stage1Data.aiRelevance && this.getStage1CandidatePool(stage1Data).length > 0) {
        try {
          const stage15 = await this.performStage15(
            searchId,
            stage0Data,
            stage1Data,
            this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>),
            requestHeaders
          );
          if (stage15.success && stage15.data) {
            stage1Data.aiRelevance = stage15.data;
            await prisma.noveltySearchRun.update({
              where: { id: searchId },
              data: {
                stage1Results: stage1Data as any
              }
            });
          }
        } catch (e) {
          console.warn('[Stage3.5a][Service] Stage 1.5 gate failed, proceeding without it:', e);
        }
      }

      // Perform Stage 3.5a feature mapping
      const stage35aResult = await this.performStage35a(
        searchId,
        stage0Data,
        stage1Data,
        config,
        requestHeaders
      );
      const postMappingCancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postMappingCancellation.success) return postMappingCancellation;

      if (!stage35aResult.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage35aResult.error };
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_3_5, // Will be renamed to STAGE_3_5A in enum
          status: NoveltySearchStatus.STAGE_3_5_COMPLETED, // Will be renamed to STAGE_3_5A_COMPLETED
          stage35CompletedAt: new Date(),
          stage35Results: stage35aResult.data as any,
          stage4CompletedAt: null,
          stage4Results: Prisma.JsonNull,
          reportUrl: null
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_3_5_COMPLETED, // Will be renamed
        currentStage: NoveltySearchStage.STAGE_3_5, // Will be renamed
        results: stage35aResult.data
      };

    } catch (error) {
      console.error('Stage 3.5a execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5a execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5b: Aggregation & Risk Analysis
   */
  async executeStage35b(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage35aData = searchRun.stage35Results as unknown as FeatureMapBatchResult;

      // Perform Stage 3.5b aggregation
      const stage35bResult = await this.performStage35b(searchId, stage0Data, stage35aData, config, requestHeaders);
      const postAggregationCancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postAggregationCancellation.success) return postAggregationCancellation;

      if (!stage35bResult.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage35bResult.error };
      }

      // Persist aggregation snapshot into stage4Results, but do NOT mark overall search as COMPLETED here.
      // Leave status at STAGE_3_5_COMPLETED and advance currentStage pointer to STAGE_4 for next action.
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_4,
          status: NoveltySearchStatus.STAGE_3_5_COMPLETED,
          stage4Results: stage35bResult.data as any
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_3_5_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_4,
        results: stage35bResult.data
      };

    } catch (error) {
      console.error('Stage 3.5b execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5b execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5c: Patent-by-Patent Remarks (Lite model)
   * - Generates concise remarks per patent using stage35a feature_map and PQAI abstracts
   * - Persists results under stage4Results.per_patent_remarks (without completing Stage 4)
   */
  async executeStage35c(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      const searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
      if (!searchRun) return { success: false, error: 'Novelty search not found' };

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage1Data = searchRun.stage1Results as unknown as any;
      const stage35aData = searchRun.stage35Results as unknown as FeatureMapBatchResult;

      if (!stage0Data?.inventionFeatures || !Array.isArray(stage0Data.inventionFeatures)) {
        return { success: false, error: 'Stage 0 features are required for Stage 3.5c' };
      }
      if (!stage35aData || !Array.isArray(stage35aData.feature_map) || stage35aData.feature_map.length === 0) {
        return { success: false, error: 'Stage 3.5a results are required for Stage 3.5c' };
      }

      // Ensure aggregation snapshot exists in stage4Results for continuity
      let aggregationResult = searchRun.stage4Results as unknown as AggregationResult | null;
      if (!aggregationResult) {
        const agg = await this.performStage35b(searchId, stage0Data, stage35aData, config, requestHeaders);
        if (!agg.success || !agg.data) {
          return { success: false, error: agg.error || 'Failed to compute aggregation for Stage 3.5c' };
        }
        aggregationResult = agg.data;
      }

      // Build quick lookup for abstracts from Stage 1 PQAI results
      const abstractByPn = new Map<string, string>();
      const titleByPn = new Map<string, string>();
      const stage1Candidates = this.getStage1CandidatePool(stage1Data);
      for (const r of stage1Candidates) {
        const pn = String(r.publication_number || r.publicationNumber || r.pn || r.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!pn) continue;
        const title = String(r.title || r.publication_title || '').trim();
        let abstractRaw: any = (r.abstract || r.snippet || r.description || r.abstract_text || r.abstractText || r.abstract_en || r.abstractEnglish || '');
        if (Array.isArray(abstractRaw)) abstractRaw = abstractRaw.join(' ');
        const abstract = String(abstractRaw || '').trim();
        if (!abstractByPn.has(pn)) {
          abstractByPn.set(pn, abstract);
          if (title) titleByPn.set(pn, title);
        }
      }

      const featureMaps = stage35aData.feature_map;
      const features = stage0Data.inventionFeatures;
      const rankedFeatureMaps = [...featureMaps].sort((a: any, b: any) => {
        const aScore = Number(a?.coverage?.coverage_score ?? 0);
        const bScore = Number(b?.coverage?.coverage_score ?? 0);
        return bScore - aScore;
      });
      const configuredLimit = config.stage35c?.maxPatentsForRemarks && config.stage35c.maxPatentsForRemarks > 0
        ? config.stage35c.maxPatentsForRemarks
        : undefined;
      const limit = Math.min(configuredLimit || 8, rankedFeatureMaps.length);

      const perPatentRemarks: PerPatentRemark[] = [];

      // Batch mode: try to generate remarks in groups to reduce LLM calls
      try {
        const batchSize = Math.max(1, config.stage35c?.batchSize || 8);
        const capped = rankedFeatureMaps.slice(0, limit);
        const batches = this.createBatches(capped, batchSize);
        for (let bi = 0; bi < batches.length; bi++) {
          const batch = batches[bi];
          const itemsText = batch.map((p, idx) => {
            const pnB = String(p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const titleB = p.title || titleByPn.get(pnB) || 'Untitled';
            const abstractB = abstractByPn.get(pnB) || '';
            const presentB = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
            const partialB = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
            const absentB = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Absent').map((c: FeatureMapCell) => c.feature);
            const unknownB = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Unknown').map((c: FeatureMapCell) => c.feature);
            const maxAbs = abstractB ? String(abstractB).replace(/\s+/g, ' ').trim() : '';
            return [
              `Item ${idx + 1}:`,
              `PN: ${pnB}`,
              `Title: ${titleB}`,
              `Abstract: ${maxAbs || 'N/A'}`,
              `Features: ${JSON.stringify(features)}`,
              `Present: ${JSON.stringify(presentB)}`,
              `Partial: ${JSON.stringify(partialB)}`,
              `Absent: ${JSON.stringify(absentB)}`,
              `Unknown: ${JSON.stringify(unknownB)}`,
              '---'
            ].join('\n');
          }).join('\n');

          const batchPrompt = [
            'You are a senior patent analyst providing detailed prior art assessment for inventor review.',
            'Given invention features and multiple prior-art patents with their feature mapping, return ONLY a JSON array.',
            '',
            'Each element must have these fields:',
            '{',
            '  "pn": "patent number",',
            '  "title": "patent title",',
            '  "relevance": 0.0-1.0 (mapped relevance based on supplied feature data),',
            '  "novelty_threat": "high_overlap|moderate_overlap|related|low_overlap",',
            '  "summary": "2-3 sentence analysis summary",',
            '  "detailedAnalysis": {',
            '    "relevant_parts": ["specific overlapping elements - what the patent covers that matches the invention"],',
            '    "irrelevant_parts": ["differentiators - what is not mapped in the reviewed citation record"],',
            '    "novelty_comparison": "reviewed citation record comparison without legal conclusions"',
            '  },',
            '  "overlap_features": ["features present in both"],',
            '  "missing_features": ["features absent from patent"],',
            '  "potential_differentiators": ["features or distinctions not mapped in reviewed citation records"],',
            '  "confidence": 0.0-1.0',
            '}',
            '',
            'OVERLAP RISK LEVELS:',
            '- high_overlap: Available patent data maps most core features',
            '- moderate_overlap: Available patent data maps multiple important features',
            '- related: Same field or component-level overlap, but not a close feature map',
            '- low_overlap: Minimal available-patent-data overlap',
            '',
            'Relevance should reflect threat to the invention as a whole. A patent that only teaches a component, material, sensor, clamp, UI, generic algorithm, carrier, excipient, circuit element, or standard process step should be described as a component-level or background reference and should not receive high relevance unless it also shares the same core mechanism.',
            'Use the supplied feature mapping as the main evidence basis; do not re-map features from scratch unless the supplied mapping is internally inconsistent.',
            'Do not describe an unmapped feature as unique. Use potential differentiator or not expressly taught in the reviewed citation record.',
            'Unknown features should reduce confidence, not increase novelty strength.',
            'A component-level reference can be important for inventive-step review even when it is not a full invention-level overlap.',
            'If a patent maps only implementation or generic_weak features, keep threat level related or low_overlap unless the mapped feature is central to the invention.',
            'If a patent maps multiple core_technical or novelty_candidate features, mark moderate_overlap or high_overlap as appropriate.',
            'Be HONEST and STRAIGHTFORWARD. If a patent is highly relevant, say so clearly.',
            'Focus on actionable insights for attorney review and claim positioning.',
            'JSON only; follow input PN order.',
            '',
            itemsText
          ].join('\n');

          const llmBatch = await llmGateway.executeLLMOperation(
            { headers: requestHeaders || {} },
            { taskCode: TaskCode.LLM5_NOVELTY_ASSESS, stageCode: 'NOVELTY_COMPARISON', prompt: batchPrompt }
          );

          let parsedArr: any[] | null = null;
          if (llmBatch.success && llmBatch.response?.output) {
            try { const pr = this.parseLLMResponse(llmBatch.response.output); if (Array.isArray(pr)) parsedArr = pr; } catch {}
            if (!parsedArr) {
              try {
                const raw = String(llmBatch.response.output).trim();
                const codeMatch = raw.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/i);
                const content = codeMatch ? codeMatch[1] : (raw.startsWith('[') ? raw : '');
                if (content) {
                  const tmp = JSON.parse(content);
                  if (Array.isArray(tmp)) parsedArr = tmp;
                }
              } catch {}
            }
          }

          for (let i = 0; i < batch.length; i++) {
            const p = batch[i];
            const pn = String(p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const title = p.title || titleByPn.get(pn);
            const abstract = abstractByPn.get(pn) || '';
            const present = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
            const partial = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
            const absent = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Absent').map((c: FeatureMapCell) => c.feature);
            const maxAbstract = abstract ? String(abstract).replace(/\s+/g, ' ').trim() : '';

            let item: PerPatentRemark | null = null;
            const fromParsed = Array.isArray(parsedArr) ? parsedArr[i] : undefined;
            if (fromParsed && (fromParsed.pn || fromParsed.remarks || fromParsed.summary)) {
              try {
                item = {
                  pn,
                  title: fromParsed.title || title || undefined,
                  abstract: maxAbstract || undefined,
                  remarks: fromParsed.remarks || fromParsed.summary || '',
                  overlap_features: Array.isArray(fromParsed.overlap_features) ? fromParsed.overlap_features : present,
                  missing_features: Array.isArray(fromParsed.missing_features) ? fromParsed.missing_features : absent,
                  potential_differentiators: Array.isArray(fromParsed.potential_differentiators) ? fromParsed.potential_differentiators : (Array.isArray(fromParsed.novelty_points) ? fromParsed.novelty_points : []),
                  novelty_points: Array.isArray(fromParsed.novelty_points) ? fromParsed.novelty_points : (Array.isArray(fromParsed.potential_differentiators) ? fromParsed.potential_differentiators : []),
                  confidence: typeof fromParsed.confidence === 'number' ? fromParsed.confidence : undefined,
                  // Enhanced detailed analysis fields
                  relevance: typeof fromParsed.relevance === 'number' ? fromParsed.relevance : undefined,
                  novelty_threat: ['high_overlap', 'moderate_overlap', 'related', 'low_overlap', 'anticipates', 'obvious', 'adjacent', 'remote'].includes(fromParsed.novelty_threat)
                    ? fromParsed.novelty_threat : undefined,
                  summary: fromParsed.summary || fromParsed.remarks || undefined,
                  detailedAnalysis: fromParsed.detailedAnalysis ? {
                    relevant_parts: Array.isArray(fromParsed.detailedAnalysis.relevant_parts) 
                      ? fromParsed.detailedAnalysis.relevant_parts : [],
                    irrelevant_parts: Array.isArray(fromParsed.detailedAnalysis.irrelevant_parts) 
                      ? fromParsed.detailedAnalysis.irrelevant_parts : [],
                    novelty_comparison: fromParsed.detailedAnalysis.novelty_comparison || ''
                  } : undefined
                };
              } catch {}
            }
            if (!item) {
              const lines: string[] = [];
              if (present.length) lines.push(`Overlaps on: ${present.slice(0, 4).join(', ')}${present.length > 4 ? '...' : ''}.`);
              if (absent.length) lines.push(`Missing vs idea: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? '...' : ''}.`);
              if (partial.length) lines.push(`Partially aligned: ${partial.slice(0, 3).join(', ')}${partial.length > 3 ? '...' : ''}.`);
              if (lines.length === 0) lines.push('Full-text review is required before assigning overlap weight.');
              // Compute relevance score for fallback
              const total = Math.max(1, features.length);
              const relevanceScore = (present.length + partial.length * 0.5) / total;
              const threatLevel = relevanceScore >= 0.7 ? 'high_overlap' : relevanceScore >= 0.5 ? 'moderate_overlap' : relevanceScore >= 0.3 ? 'related' : 'low_overlap';
              item = { 
                pn, 
                title, 
                abstract: maxAbstract || undefined, 
                remarks: lines.join(' '), 
                overlap_features: present, 
                missing_features: absent, 
                potential_differentiators: absent.filter((feature: string) => !this.isGenericNoveltyFeature(feature)).slice(0, 3),
                novelty_points: absent.filter((feature: string) => !this.isGenericNoveltyFeature(feature)).slice(0, 3),
                confidence: undefined,
                relevance: relevanceScore,
                novelty_threat: threatLevel,
                summary: lines.join(' '),
                detailedAnalysis: {
                  relevant_parts: present.map((f: string) => `Available patent data maps to: ${f}`),
                  irrelevant_parts: absent.map((f: string) => `Available patent data does not map: ${f}`),
                  novelty_comparison: `This citation ${present.length > 0 ? `has available-patent-data overlap on ${present.length} feature(s)` : 'has minimal available-patent-data overlap'} with the invention. ${absent.length > 0 ? `${absent.length} potential differentiator(s) need full patent document review.` : ''}`
                }
              };
            }
            // Compute per-patent decision
            {
              const total = Math.max(1, features.length);
              const presentCount = present.length;
              const partialCount = partial.length;
              const coverage = presentCount / total;
              const critical = (config.stage35a?.criticalFeatures || []);
              const allCriticalPresent = critical.length > 0 ? critical.every(cf => present.includes(cf)) : false;
              const decision: 'high_overlap' | 'mapped_overlap' | 'potential_novelty_space' = (allCriticalPresent && coverage >= 0.6)
                ? 'high_overlap'
                : ((presentCount + partialCount) / total >= 0.4 ? 'mapped_overlap' : 'potential_novelty_space');
              (item as any).decision = decision;
            }
            perPatentRemarks.push(item);
          }
        }
      } catch (batchError) {
        console.warn('[Stage3.5c] Batch mode failed, falling back to perâ€‘patent calls:', batchError);
      }

      // If batch produced results for all, skip single-call fallback
      if (perPatentRemarks.length < limit) {
        for (let i = perPatentRemarks.length; i < limit; i++) {
          const p = rankedFeatureMaps[i];
          const pn = String(p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const title = p.title || titleByPn.get(pn);
          const abstract = abstractByPn.get(pn) || '';

        // Summarize local present/absent lists deterministically
        const present = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
        const partial = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
        const absent = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Absent').map((c: FeatureMapCell) => c.feature);

        // Build detailed prompt for single patent analysis
        const maxAbstract = abstract ? String(abstract).replace(/\s+/g, ' ').trim() : '';
        const prompt = [
          'You are a senior patent analyst providing detailed prior art assessment for inventor review.',
          'Given invention features and a single prior-art patent with feature mapping, output ONLY JSON.',
          '',
          'Output structure:',
          '{',
          '  "pn": "patent number",',
          '  "title": "patent title",',
          '  "relevance": 0.0-1.0 (mapped relevance based on supplied feature data),',
          '  "novelty_threat": "high_overlap|moderate_overlap|related|low_overlap",',
          '  "summary": "2-3 sentence analysis",',
          '  "detailedAnalysis": {',
          '    "relevant_parts": ["overlapping elements"],',
          '    "irrelevant_parts": ["differentiators not mapped in the reviewed citation record"],',
          '    "novelty_comparison": "reviewed citation record comparison without legal conclusions"',
          '  },',
          '  "overlap_features": ["features in both"],',
          '  "missing_features": ["features absent"],',
          '  "potential_differentiators": ["features or distinctions not mapped in reviewed citation records"],',
          '  "confidence": 0.0-1.0',
          '}',
          '',
          'Relevance should reflect threat to the invention as a whole. A patent that only teaches a component, material, sensor, clamp, UI, generic algorithm, carrier, excipient, circuit element, or standard process step should be described as a component-level or background reference and should not receive high relevance unless it also shares the same core mechanism.',
          'Use the supplied feature mapping as the main evidence basis; do not re-map features from scratch unless the supplied mapping is internally inconsistent.',
          'Do not describe an unmapped feature as unique. Use potential differentiator or not expressly taught in the reviewed citation record.',
          'Unknown features should reduce confidence, not increase novelty strength.',
          'A component-level reference can be important for inventive-step review even when it is not a full invention-level overlap.',
          'If a patent maps only implementation or generic_weak features, keep threat level related or low_overlap unless the mapped feature is central to the invention.',
          'If a patent maps multiple core_technical or novelty_candidate features, mark moderate_overlap or high_overlap as appropriate.',
          'Be evidence-driven. If the patent has high mapped overlap, say so clearly.',
          '',
          `PN: ${pn}`,
          `Title: ${title || 'Untitled'}`,
          `Abstract: ${maxAbstract || 'N/A'}`,
          `Features: ${JSON.stringify(features)}`,
          `Present: ${JSON.stringify(present)}`,
          `Partial: ${JSON.stringify(partial)}`,
          `Absent: ${JSON.stringify(absent)}`,
          'JSON only.'
        ].join('\n');

        let remarksItem: PerPatentRemark | null = null;
        try {
          const llmResult = await llmGateway.executeLLMOperation(
            { headers: requestHeaders || {} },
            {
              taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
              stageCode: 'NOVELTY_COMPARISON',
              prompt
            }
          );
          if (llmResult.success && llmResult.response?.output) {
            try {
              const parsed = this.parseLLMResponse(llmResult.response.output);
              remarksItem = {
                pn,
                title: parsed.title || title || undefined,
                abstract: maxAbstract || undefined,
                remarks: parsed.remarks || parsed.summary || '',
                overlap_features: Array.isArray(parsed.overlap_features) ? parsed.overlap_features : present,
                missing_features: Array.isArray(parsed.missing_features) ? parsed.missing_features : absent,
                potential_differentiators: Array.isArray(parsed.potential_differentiators) ? parsed.potential_differentiators : (Array.isArray(parsed.novelty_points) ? parsed.novelty_points : []),
                novelty_points: Array.isArray(parsed.novelty_points) ? parsed.novelty_points : (Array.isArray(parsed.potential_differentiators) ? parsed.potential_differentiators : []),
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
                // Enhanced detailed analysis fields
                relevance: typeof parsed.relevance === 'number' ? parsed.relevance : undefined,
                novelty_threat: ['high_overlap', 'moderate_overlap', 'related', 'low_overlap', 'anticipates', 'obvious', 'adjacent', 'remote'].includes(parsed.novelty_threat)
                  ? parsed.novelty_threat : undefined,
                summary: parsed.summary || parsed.remarks || undefined,
                detailedAnalysis: parsed.detailedAnalysis ? {
                  relevant_parts: Array.isArray(parsed.detailedAnalysis.relevant_parts) 
                    ? parsed.detailedAnalysis.relevant_parts : [],
                  irrelevant_parts: Array.isArray(parsed.detailedAnalysis.irrelevant_parts) 
                    ? parsed.detailedAnalysis.irrelevant_parts : [],
                  novelty_comparison: parsed.detailedAnalysis.novelty_comparison || ''
                } : undefined
              };
            } catch {
              // fall through to deterministic fallback
            }
          }
        } catch {
          // ignore, use fallback
        }

        if (!remarksItem) {
          // Fallback deterministic remarks
          const lines: string[] = [];
          if (present.length) lines.push(`Overlaps on: ${present.slice(0, 4).join(', ')}${present.length > 4 ? '...' : ''}.`);
          if (absent.length) lines.push(`Missing vs idea: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? '...' : ''}.`);
          if (partial.length) lines.push(`Partially aligned: ${partial.slice(0, 3).join(', ')}${partial.length > 3 ? '...' : ''}.`);
          if (lines.length === 0) lines.push('Full-text review is required before assigning overlap weight.');
          // Compute relevance score for fallback
          const total = Math.max(1, features.length);
          const relevanceScore = (present.length + partial.length * 0.5) / total;
          const threatLevel = relevanceScore >= 0.7 ? 'high_overlap' : relevanceScore >= 0.5 ? 'moderate_overlap' : relevanceScore >= 0.3 ? 'related' : 'low_overlap';
          remarksItem = {
            pn,
            title,
            abstract: maxAbstract || undefined,
            remarks: lines.join(' '),
            overlap_features: present,
            missing_features: absent,
            potential_differentiators: absent.filter((feature: string) => !this.isGenericNoveltyFeature(feature)).slice(0, 3),
            novelty_points: absent.filter((feature: string) => !this.isGenericNoveltyFeature(feature)).slice(0, 3),
            confidence: undefined,
            relevance: relevanceScore,
            novelty_threat: threatLevel,
            summary: lines.join(' '),
            detailedAnalysis: {
              relevant_parts: present.map((f: string) => `Available patent data maps to: ${f}`),
              irrelevant_parts: absent.map((f: string) => `Available patent data does not map: ${f}`),
                  novelty_comparison: `This citation ${present.length > 0 ? `has available-patent-data overlap on ${present.length} feature(s)` : 'has minimal available-patent-data overlap'} with the invention. ${absent.length > 0 ? `${absent.length} potential differentiator(s) need full patent document review.` : ''}`
            }
          };
        }
        // Add deterministic decision to single-call fallback item
        {
          const total = Math.max(1, features.length);
          const presentCount = present.length;
          const partialCount = partial.length;
          const coverage = presentCount / total;
          const critical = (config.stage35a?.criticalFeatures || []);
          const allCriticalPresent = critical.length > 0 ? critical.every(cf => present.includes(cf)) : false;
          const decision: 'high_overlap' | 'mapped_overlap' | 'potential_novelty_space' = (allCriticalPresent && coverage >= 0.6)
            ? 'high_overlap'
            : ((presentCount + partialCount) / total >= 0.4 ? 'mapped_overlap' : 'potential_novelty_space');
          (remarksItem as any).decision = decision;
        }
          perPatentRemarks.push(remarksItem);
        }
      }

      // Merge remarks into stage4Results
      const mergedStage4: any = {
        ...(aggregationResult || {}),
        per_patent_remarks: perPatentRemarks,
        per_patent_remarks_source: 'stage35c',
        stage35c_complete: true,
        stage35c_completed_at: new Date().toISOString()
      };
      const postRemarksCancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postRemarksCancellation.success) return postRemarksCancellation;

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          // keep status as STAGE_3_5_COMPLETED; do not mark completed here
          stage4Results: mergedStage4 as any
        }
      });

      return {
        success: true,
        searchId,
        status: (searchRun.status as any),
        currentStage: (searchRun.currentStage as any),
        results: mergedStage4
      };
    } catch (error) {
      console.error('Stage 3.5c execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 3.5c execution failed' };
    }
  }

  // Legacy method for backward compatibility - now delegates to 3.5a + 3.5b
  async executeStage35(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    // First execute 3.5a
    const stage35aResult = await this.executeStage35a(searchId, userId, requestHeaders);
    if (!stage35aResult.success) {
      return stage35aResult;
    }

    // Then execute 3.5b
    return await this.executeStage35b(searchId, userId, requestHeaders);
  }

  /**
   * Get novelty search history for a user, optionally filtered by project
   */
  async getNoveltySearchHistory(userId: string, projectId?: string): Promise<any[]> {
    try {
      const whereClause: any = {
        userId,
        status: {
          in: [
            NoveltySearchStatus.STAGE_1_COMPLETED,
            NoveltySearchStatus.STAGE_3_5_COMPLETED,
            NoveltySearchStatus.COMPLETED
          ]
        }
      };

      if (projectId) {
        whereClause.projectId = projectId;
      }

      const searches = await prisma.noveltySearchRun.findMany({
        where: whereClause,
        include: {
          project: {
            select: {
              id: true,
              name: true
            }
          },
          patent: {
            select: {
              id: true,
              title: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 50 // Limit to last 50 searches
      });

      // Format the results for the frontend
      return searches.map(search => ({
        id: search.id,
        title: search.title,
        inventionDescription: search.inventionDescription.substring(0, 200) + (search.inventionDescription.length > 200 ? '...' : ''),
        status: search.status,
        currentStage: search.currentStage,
        createdAt: search.createdAt,
        completedAt: search.stage4CompletedAt,
        project: search.project,
        patent: search.patent,
        hasReport: !!search.reportUrl,
        reportUrl: search.reportUrl,
        results: {
          stage0: search.stage0Results,
          stage1: search.stage1Results ? {
            patentCount: this.getStage1CandidatePool(search.stage1Results as any).length
          } : null,
          stage35: search.stage35Results ? {
            assessmentCount: Array.isArray(search.stage35Results) ? search.stage35Results.length : 0
          } : null,
          stage4: search.stage4Results
        }
      }));

    } catch (error) {
      console.error('Error fetching novelty search history:', error);
      return [];
    }
  }

  /**
   * Execute Stage 4: Report Generation
   */
  /**
   * Resume a failed novelty search from the last completed stage
   */
  async resumeNoveltySearch(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run with all results
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Check if search can be resumed (not completed and not actively running)
      if (searchRun.status === NoveltySearchStatus.COMPLETED) {
        return { success: false, error: 'Search is already completed' };
      }

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);

      // Determine which stage to resume from based on current status
      let resumeFromStage: NoveltySearchStage;
      let newStatus: NoveltySearchStatus;

      switch (searchRun.status) {
        case NoveltySearchStatus.FAILED:
        case NoveltySearchStatus.PENDING:
          resumeFromStage = NoveltySearchStage.STAGE_0;
          newStatus = NoveltySearchStatus.PENDING;
          break;
        case NoveltySearchStatus.STAGE_0_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_1;
          newStatus = NoveltySearchStatus.STAGE_0_COMPLETED;
          break;
        case NoveltySearchStatus.STAGE_1_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_3_5;
          newStatus = NoveltySearchStatus.STAGE_1_COMPLETED;
          break;
        case NoveltySearchStatus.STAGE_3_5_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_4;
          newStatus = NoveltySearchStatus.STAGE_3_5_COMPLETED;
          break;
        default:
          return { success: false, error: 'Invalid search state for resume' };
      }

      // Reset the search to resumable state
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: newStatus,
          currentStage: resumeFromStage,
          // Clear any error state
          ...(resumeFromStage === NoveltySearchStage.STAGE_0 && { stage0Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_1 && { stage1Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_3_5 && { stage35Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_4 && { stage4Results: undefined }),
        }
      });

      // Execute the stage to resume from
      return await this.executeStage(searchId, resumeFromStage, userId, requestHeaders);

    } catch (error) {
      console.error('Resume search error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Resume search failed'
      };
    }
  }

  /**
   * Execute a specific stage (used for resume functionality)
   */
  async executeStage(searchId: string, stage: NoveltySearchStage, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    switch (stage) {
      case NoveltySearchStage.STAGE_0:
        return await this.executeStage0(searchId, userId, requestHeaders);
      case NoveltySearchStage.STAGE_1:
        return await this.executeStage1(searchId, userId, requestHeaders);
      case NoveltySearchStage.STAGE_3_5:
        return await this.executeStage35(searchId, userId, requestHeaders); // This now does 3.5a + 3.5b
      case NoveltySearchStage.STAGE_4:
        return await this.executeStage4(searchId, userId, requestHeaders);
      default:
        return { success: false, error: 'Invalid stage' };
    }
  }

  /**
   * Execute Stage 0: Idea Normalization
   */
  async executeStage0(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);

      // Create a minimal user object for stage 0 execution
      // Since we already validated the userId, we can create a basic user object
      const user = { id: userId } as User;

      // Create a request-like object from search data
      // For resume, we don't have the original JWT token, but since we validated userId,
      // we can create a minimal request object
      const request = {
        title: searchRun.title,
        inventionDescription: searchRun.inventionDescription,
        jurisdiction: searchRun.jurisdiction,
        jwtToken: '', // Will be handled by requestHeaders in LLM call
      } as NoveltySearchRequest;

      // Execute stage 0
      const stage0Result = await this.performStage0(searchId, request, config, user, requestHeaders);
      const postStage0Cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postStage0Cancellation.success) return postStage0Cancellation;

      if (!stage0Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage0Result.error };
      }

      // Update with stage 0 results
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: NoveltySearchStatus.STAGE_0_COMPLETED,
          currentStage: NoveltySearchStage.STAGE_1,
          stage0CompletedAt: new Date(),
          stage0Results: stage0Result.data as any
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: stage0Result.data
      };

    } catch (error) {
      console.error('Stage 0 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 0 execution failed'
      };
    }
  }

  private getNoveltyCompletionEmailSentAt(stage4Results: unknown): string | null {
    const data = (stage4Results || {}) as any;
    return data?.notification?.completionEmailSentAt || data?.completionEmailSentAt || null;
  }

  async completeNoMatchNoveltySearch(searchId: string, userId: string): Promise<NoveltySearchResponse> {
    const cancellation = await this.ensureSearchNotCancelled(searchId);
    if (!cancellation.success) return cancellation;

    const searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
    if (!searchRun) return { success: false, error: 'Novelty search not found' };

    const stage4Results = {
      decision: 'Low Evidence',
      confidence: 'Low',
      noRelevantMatches: true,
      executive_summary: {
        summary: 'The configured search completed without identifying sufficiently relevant prior-art records for detailed feature mapping.',
      },
      concluding_remarks: {
        summary: 'No high-overlap candidate was identified among the screened preliminary records. This is not a legal conclusion and does not establish novelty.',
      },
      per_patent_remarks: [],
      risks: [
        'A no-match result may reflect terminology, corpus, jurisdiction, translation, classification, or source-data limitations.',
      ],
      recommendations: [
        'Review the generated query and extracted features.',
        'Consider broader terminology, classifications, jurisdictions, and full-document searching.',
        'Have a patent professional review the search scope before relying on the result.',
      ],
      report_metadata: { outcome: 'no_relevant_matches', generatedAt: new Date().toISOString() },
    };

    const completionWrite = await (prisma as any).noveltySearchRun.updateMany({
      where: {
        id: searchId,
        OR: [
          { backgroundJob: { is: null } },
          { backgroundJob: { is: { status: { not: 'CANCELLED' } } } },
        ],
      },
      data: {
        status: NoveltySearchStatus.COMPLETED,
        currentStage: NoveltySearchStage.STAGE_4,
        stage4CompletedAt: new Date(),
        stage4Results: stage4Results as any,
        reportUrl: null,
      },
    });
    if (completionWrite.count !== 1) {
      return { success: false, error: 'Novelty search was cancelled' };
    }

    return {
      success: true,
      searchId,
      status: NoveltySearchStatus.COMPLETED,
      currentStage: NoveltySearchStage.STAGE_4,
      results: stage4Results,
    };
  }

  async sendNoveltyCompletionEmail(searchRun: any, userId: string): Promise<{ sentAt: string; reportUrl: string } | null> {
    if (this.getNoveltyCompletionEmailSentAt(searchRun.stage4Results)) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true }
    });
    if (!user?.email) return null;

    const reportUrl = buildAuthenticatedNoveltyReportUrl(searchRun.id);
    const title = String(searchRun.title || 'Novelty search report').replace(/[\r\n]+/g, ' ').trim().slice(0, 180) || 'Novelty search report';
    const safeTitle = escapeEmailHtml(title);

    try {
      const result = await sendEmail({
        to: user.email,
        toName: user.name || undefined,
        subject: `Novelty search report ready: ${title}`,
        html: `
          <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 12px">Your novelty search report is ready</h2>
            <p>The novelty search for <strong>${safeTitle}</strong> has completed.</p>
            <p>Open the protected link below to view or download the final PDF report. If your session has expired, you will be asked to sign in first.</p>
            <p><a href="${reportUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">View final PDF report</a></p>
          </div>
        `,
        text: `Your novelty search report is ready for ${title}. Sign in if requested, then view the final PDF report: ${reportUrl}`
      });
      if (result?.sent === false) return null;

      return { sentAt: new Date().toISOString(), reportUrl };
    } catch (error) {
      console.warn('[NoveltySearch] Failed to send completion email:', error);
      return null;
    }
  }

  async executeStage4(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const cancellation = await this.ensureSearchNotCancelled(searchId);
      if (!cancellation.success) return cancellation;

      // Get search run with all results
      let searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Allow resuming from any previous stage (don't enforce strict sequential progression for resume)
      // if (searchRun.currentStage !== NoveltySearchStage.STAGE_4) {
      //   return { success: false, error: 'Invalid stage progression' };
      // }

      const config = this.mergeConfig(searchRun.config as unknown as Partial<NoveltySearchConfig>);

      const stage35Data = searchRun.stage35Results as unknown as FeatureMapBatchResult | null;
      const stage4Data = searchRun.stage4Results as unknown as any;
      const hasFeatureMap = !!(stage35Data && Array.isArray(stage35Data.feature_map) && stage35Data.feature_map.length > 0);
      const hasAggregation = !!(stage4Data?.per_patent_coverage || stage4Data?.per_feature_uniqueness || stage4Data?.feature_coverage_summary);
      if (!hasFeatureMap || !hasAggregation || !this.hasDetailedStage35cRemarks(stage4Data)) {
        const deepAnalysis = await this.executeStage3(searchId, userId, requestHeaders);
        if (!deepAnalysis.success) {
          return {
            success: false,
            error: deepAnalysis.error || 'Deep Analysis must complete before report generation'
          };
        }
        searchRun = await prisma.noveltySearchRun.findFirst({
          where: { id: searchId, userId }
        });
        if (!searchRun) {
          return { success: false, error: 'Novelty search not found after Deep Analysis' };
        }
        const postDeepAnalysisCancellation = await this.ensureSearchNotCancelled(searchId);
        if (!postDeepAnalysisCancellation.success) return postDeepAnalysisCancellation;
      }

      // Perform Stage 4 report generation
      const stage4Result = await this.performStage4(searchRun, config, requestHeaders);
      const postReportCancellation = await this.ensureSearchNotCancelled(searchId);
      if (!postReportCancellation.success) return postReportCancellation;

      if (!stage4Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage4Result.error };
      }

      // Preserve 3.5c remarks in final Stage 4 results
      let finalStage4Data: any = stage4Result.data;
      try {
        const existing = (searchRun.stage4Results as any) || {};
        finalStage4Data = { ...existing, ...finalStage4Data };
        if (Array.isArray(existing.per_patent_remarks) && existing.per_patent_remarks.length > 0) {
          finalStage4Data = { ...finalStage4Data, per_patent_remarks: existing.per_patent_remarks };
        }
      } catch {}

      const completionWrite = await (prisma as any).noveltySearchRun.updateMany({
        where: {
          id: searchId,
          OR: [
            { backgroundJob: { is: null } },
            { backgroundJob: { is: { status: { not: 'CANCELLED' } } } },
          ],
        },
        data: {
          status: NoveltySearchStatus.COMPLETED,
          stage4CompletedAt: new Date(),
          stage4Results: finalStage4Data as any,
          reportUrl: stage4Result.reportUrl
        }
      });
      if (completionWrite.count !== 1) {
        return { success: false, error: 'Novelty search was cancelled' };
      }

      const backgroundJob = await (prisma as any).noveltySearchJob.findUnique({ where: { searchId } });
      if (!backgroundJob) {
        const completionEmail = await this.sendNoveltyCompletionEmail(searchRun, userId);
        if (completionEmail) {
          finalStage4Data = {
            ...finalStage4Data,
            notification: {
              ...(finalStage4Data?.notification || {}),
              completionEmailSentAt: completionEmail.sentAt,
              completionEmailReportUrl: completionEmail.reportUrl,
            },
          };
          await prisma.noveltySearchRun.update({
            where: { id: searchId },
            data: { stage4Results: finalStage4Data as any },
          });
        }

        // Legacy interactive runs retain their existing completion accounting.
        await prisma.user.update({
          where: { id: userId },
          data: { noveltySearchesCompleted: { increment: 1 } }
        });
      }

      // USAGE TRACKING: Record completed search toward quota
      // Get user's tenantId for tracking
      const userForTracking = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true }
      });

      if (userForTracking?.tenantId && !backgroundJob) {
        try {
          await trackServiceUsage({
            tenantId: userForTracking.tenantId,
            userId,
            serviceType: 'NOVELTY_SEARCH',
            operationId: searchId,
            operationType: 'novelty_search_complete',
            isCompleted: true,
            metadata: {
              patentId: searchRun.patentId,
              projectId: searchRun.projectId,
              completedAt: new Date().toISOString()
            }
          });
          console.log(`📈 [NoveltySearch] Usage tracked for search ${searchId}`);
        } catch (trackingError) {
          // Don't fail the search if tracking fails, but log it
          console.error(`⚠️ [NoveltySearch] Failed to track usage for search ${searchId}:`, trackingError);
        }
      }

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.COMPLETED,
        results: finalStage4Data
      };

    } catch (error) {
      console.error('Stage 4 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 4 execution failed'
      };
    }
  }

  // Implementation of individual stages below...

  /**
   * Filter patents for relevance to invention before including in report
   * Uses the Super Admin model configured for NOVELTY_RELEVANCE_SCORING.
   */
  private async filterRelevantPatentsForReport(
    stage0Data: NormalizedIdea,
    stage35Data: AssessmentResult[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<AssessmentResult[]> {
    if (!Array.isArray(stage35Data) || stage35Data.length === 0) {
      return [];
    }

    console.log(`ðŸ” Assessing relevance of ${stage35Data.length} patents to invention...`);

    const relevantPatents: AssessmentResult[] = [];

    // Process patents in batches to avoid overwhelming the LLM
    const batchSize = 3;
    for (let i = 0; i < stage35Data.length; i += batchSize) {
      const batch = stage35Data.slice(i, i + batchSize);
      console.log(`ðŸ“‹ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(stage35Data.length / batchSize)} (${batch.length} patents)`);

      for (const patent of batch) {
        try {
          const isRelevant = await this.assessPatentRelevance(
            stage0Data,
            patent,
            config,
            requestHeaders
          );

          if (isRelevant) {
            relevantPatents.push(patent);
            console.log(` Patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'} is relevant - included in report`);
          } else {
            console.log(`âŒ Patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'} is not relevant - excluded from report`);
          }
        } catch (error) {
          console.warn(`âš ï¸ Failed to assess relevance for patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'}, including by default:`, error);
          relevantPatents.push(patent); // Include by default if assessment fails
        }
      }

      // Removed intentional delay between batches for faster processing
    }

    return relevantPatents;
  }

  /**
   * Assess if a patent is relevant using the configured stage model.
   */
  private async assessPatentRelevance(
    stage0Data: NormalizedIdea,
    patent: AssessmentResult,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<boolean> {
    // Build relevance assessment prompt
    const relevancePrompt = `You are a patent attorney conducting a novelty-oriented relevance review.

INVENTION FEATURES (from user idea):
${JSON.stringify(stage0Data.inventionFeatures || [])}

PATENT TO ASSESS:
- Publication Number: ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'}
- Title: ${(patent as any).title || 'Not available'}
- Abstract: ${(patent as any).abstract || 'Not available'}

TASK:
Determine if this patent is RELEVANT to the invention by identifying overlap between the supplied patent data and the invention features.

RELEVANCE CRITERIA:
- Supplied patent data indicates presence of at least one invention feature with technical proximity
- If none of the features appear present, mark as not relevant
- A patent is not relevant merely because it discloses one generic component. If only one generic feature overlaps, return is_relevant=false unless the same object, same operation, or same technical problem is also present.
- In the reasoning field, do not name the source-field limitation or use early-stage-review wording. Use reviewed citation record if scope must be mentioned.

OUTPUT FORMAT:
Respond with ONLY a JSON object:
{
  "is_relevant": boolean,
  "confidence": "HIGH|MEDIUM|LOW",
  "reasoning": "brief explanation (max 50 words)"
}

RESPONSE:`;

    try {
      // Use admin-configured model via NOVELTY_RELEVANCE_SCORING stage
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_RELEVANCE_SCORING',
          prompt: relevancePrompt
        }
      );

      if (!llmResult.success) {
        console.warn('Relevance assessment failed, defaulting to relevant');
        return true; // Default to relevant if assessment fails
      }

      if (!llmResult.response) {
        console.warn('No response from relevance assessment, defaulting to relevant');
        return true; // Default to relevant if no response
      }

      const response = this.parseLLMResponse(llmResult.response.output);

      // Check if the response indicates relevance
      if (response && typeof response.is_relevant === 'boolean') {
        return response.is_relevant;
      }

      // If parsing fails, check for keywords in the response
      const output = llmResult.response.output.toLowerCase();
      if (output.includes('"is_relevant": true') || output.includes('"is_relevant":true')) {
        return true;
      }
      if (output.includes('"is_relevant": false') || output.includes('"is_relevant":false')) {
        return false;
      }

      // Default to relevant if we can't determine
      console.warn('Could not parse relevance response, defaulting to relevant');
      return true;

    } catch (error) {
      console.warn('Relevance assessment error, defaulting to relevant:', error instanceof Error ? error.message : String(error));
      return true; // Default to relevant if assessment fails
    }
  }


  private async performStage0(
    searchId: string,
    request: NoveltySearchRequest,
    config: NoveltySearchConfig,
    user: User,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: NormalizedIdea; error?: string }> {
    try {
      console.log('ðŸ§  Starting Stage 0: Idea Normalization');

      const includeEpoKeywords = searchSourceIncludesEpo(config.searchSource?.mode);
      const includePapers = Boolean(config.searchSource?.includePapers);

      if (config.searchSource?.searchMode === 'manual') {
        const filters = config.searchSource.filters || {};
        const filterValues = Object.values(filters)
          .flatMap((value: any) => Array.isArray(value) ? value : [value])
          .map((value: any) => String(value || '').trim())
          .filter(Boolean);
        const searchText = filterValues.join(' ').replace(/\s+/g, ' ').trim();
        const titleKeywords = this.normalizeEpoKeywordList((filters as any).titleContains);
        const abstractKeywords = this.normalizeEpoKeywordList((filters as any).abstractContains);
        const combinedKeywords = this.normalizeEpoKeywordList((filters as any).anyTextContains);
        const featureSeeds = filterValues
          .flatMap(value => value.split(/[,;\n]/))
          .map(value => value.trim())
          .filter(value => value.length > 2);

        return {
          success: true,
          data: {
            searchQuery: searchText || 'manual fielded patent search',
            inventionFeatures: Array.from(new Set(featureSeeds)).slice(0, 8),
            featureDetails: Array.from(new Set(featureSeeds)).slice(0, 8).map(feature => ({
              feature,
              user_disclosure: feature,
              technical_role: 'Manual search feature/filter supplied by the user.',
              source_excerpt: ''
            })),
            title: request.title || 'Manual Patent Search',
            inventionText: request.inventionDescription || '',
            inventionType: ['GENERAL'],
            ...(includeEpoKeywords ? {
              epoTitleKeywords: titleKeywords,
              epoAbstractKeywords: abstractKeywords,
              epoCombinedKeywords: combinedKeywords,
            } : {}),
            ...(includePapers ? {
              paperSearchQuery: config.searchSource?.paperSearchQuery || searchText || request.title,
              paperKeywords: Array.from(new Set<string>(featureSeeds)).slice(0, 10),
              paperSearchQueries: Array.from(new Set<string>(featureSeeds)).slice(0, 6),
              googleScholarSearchQuery: config.searchSource?.paperSearchQuery || searchText || request.title,
              academicDatabaseSearchQuery: config.searchSource?.paperSearchQuery || searchText || request.title,
              paperYearFrom: Number((config.searchSource?.paperFilters as any)?.yearFrom) || 1900,
              paperYearTo: Number((config.searchSource?.paperFilters as any)?.yearTo) || new Date().getFullYear(),
            } : {}),
            architecturalInnovation: '',
            claimConcepts: [],
            noveltyFocusInteractions: [],
            queryPlan: {
              searchMode: 'manual',
              fieldFilters: filters,
            },
          },
        };
      }

      // Build prompt
      console.log('ðŸ“ Stage 0 Input - Title:', request.title, 'Description length:', request.inventionDescription?.length);

      const basePrompt = config.stage0.customPrompt || (
        includeEpoKeywords
          ? NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2
          : removeEpoKeywordInstructions(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2)
      );
      let prompt = basePrompt
        .replace('{title}', request.title || 'Untitled Invention')
        .replace('{rawIdea}', request.inventionDescription || 'No description provided');
      if (includePapers) {
        prompt += `\n\nAlso include these top-level JSON fields for scholarly-publication retrieval:\n"paperSearchQuery": "one concise source-neutral scholarly literature query",\n"googleScholarSearchQuery": "a concise Google Scholar / SerpApi query using quoted technical phrases where useful",\n"academicDatabaseSearchQuery": "a concise query for Semantic Scholar, Crossref, OpenAlex, PubMed, arXiv, and CORE",\n"paperSearchQueries": ["3-6 short alternative search strings covering object, mechanism, and technical relationship"],\n"paperKeywords": ["4-10 short editable technical phrases"],\n"paperYearFrom": 1900,\n"paperYearTo": ${new Date().getFullYear()}\nRules:\n- Keep dates broad for novelty searching. Use 1900 through ${new Date().getFullYear()} unless the disclosure expressly states a legally relevant prior-art cutoff.\n- Do not invent author names, paper titles, dates, or unsupported facts.\n- Do not use wildcards or long Boolean strings.\n- Query variants must remain faithful to the submitted disclosure.`;
      }

      console.log('[NoveltyPipeline] stage_summary', {
        stage: 'stage0_prompt_ready',
        searchId,
        disclosureLength: request.inventionDescription?.length || 0,
      });

      // Execute LLM call for query generation/normalization using admin-configured model
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_QUERY_GENERATION',  // Stage 0: Query/Feature Generation
          prompt
        }
      );

      if (!llmResult.success) {
        return { success: false, error: llmResult.error instanceof Error ? llmResult.error.message : String(llmResult.error) };
      }

      // Parse response
      const normalizedData = this.parseLLMResponse(llmResult.response?.output || '');

      // Extract search query and invention features
      const extractedFields: NormalizedIdea = {
        searchQuery: normalizedData?.searchQuery || normalizedData?.query || '',
        title: request.title || '',
        inventionText: request.inventionDescription || '',
        inventionFeatures: Array.isArray(normalizedData?.invention_features)
          ? (normalizedData.invention_features as string[]).filter(Boolean)
          : undefined,
        featureDetails: Array.isArray(normalizedData?.feature_details)
          ? (normalizedData.feature_details as InventionFeatureDetail[]).filter((detail: any) => detail && typeof detail.feature === 'string')
          : [],
        inventionType: Array.isArray(normalizedData?.inventionType) 
          ? normalizedData.inventionType 
          : (normalizedData?.inventionType ? [normalizedData.inventionType] : ['GENERAL']),
            cpcCodes: Array.isArray(normalizedData?.cpcCodes) ? normalizedData.cpcCodes.filter(Boolean) : [],
            ipcCodes: Array.isArray(normalizedData?.ipcCodes) ? normalizedData.ipcCodes.filter(Boolean) : [],
            ...(includeEpoKeywords ? {
              epoTitleKeywords: this.normalizeEpoKeywordList(normalizedData?.epoTitleKeywords ?? normalizedData?.epo_title_keywords),
              epoAbstractKeywords: this.normalizeEpoKeywordList(normalizedData?.epoAbstractKeywords ?? normalizedData?.epo_abstract_keywords),
              epoCombinedKeywords: this.normalizeEpoKeywordList(normalizedData?.epoCombinedKeywords ?? normalizedData?.epo_combined_keywords),
            } : {}),
            ...(includePapers ? {
              paperSearchQuery: this.normalizeStage0Scalar(
                normalizedData?.paperSearchQuery ?? normalizedData?.paper_search_query ?? normalizedData?.searchQuery ?? '',
                500
              ),
              paperKeywords: this.normalizeEpoKeywordList(normalizedData?.paperKeywords ?? normalizedData?.paper_keywords),
              paperSearchQueries: this.normalizeEpoKeywordList(normalizedData?.paperSearchQueries ?? normalizedData?.paper_search_queries),
              googleScholarSearchQuery: this.normalizeStage0Scalar(
                normalizedData?.googleScholarSearchQuery ?? normalizedData?.google_scholar_search_query ?? normalizedData?.paperSearchQuery ?? '',
                500
              ),
              academicDatabaseSearchQuery: this.normalizeStage0Scalar(
                normalizedData?.academicDatabaseSearchQuery ?? normalizedData?.academic_database_search_query ?? normalizedData?.paperSearchQuery ?? '',
                500
              ),
              paperYearFrom: (() => {
                const year = Number(normalizedData?.paperYearFrom ?? normalizedData?.paper_year_from);
                return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() ? year : 1900;
              })(),
              paperYearTo: (() => {
                const year = Number(normalizedData?.paperYearTo ?? normalizedData?.paper_year_to);
                return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() ? year : new Date().getFullYear();
              })(),
            } : {}),
            noveltyFocus: Array.isArray(normalizedData?.novelty_focus) ? normalizedData.novelty_focus.filter(Boolean) : [],
        noveltyFocusInteractions: Array.isArray(normalizedData?.novelty_focus_interactions)
          ? normalizedData.novelty_focus_interactions
          : [],
        architecturalInnovation: typeof normalizedData?.architectural_innovation === 'string'
          ? normalizedData.architectural_innovation
          : (typeof normalizedData?.architecturalInnovation === 'string' ? normalizedData.architecturalInnovation : ''),
        claimConcepts: Array.isArray(normalizedData?.claim_concepts)
          ? normalizedData.claim_concepts
          : (Array.isArray(normalizedData?.claimConcepts) ? normalizedData.claimConcepts : []),
        searchExclusions: Array.isArray(normalizedData?.search_exclusions) ? normalizedData.search_exclusions.filter(Boolean) : [],
        googleConceptGroups: this.normalizeGoogleConceptGroups(
          normalizedData?.google_concept_groups ?? normalizedData?.googleConceptGroups
        ),
        confidence: typeof normalizedData?.confidence === 'number' ? normalizedData.confidence : undefined,
        warnings: Array.isArray(normalizedData?.warnings) ? normalizedData.warnings.filter(Boolean) : []
      };

      if (!extractedFields.searchQuery) {
        console.warn('No search query found in LLM response, using fallback');
        extractedFields.searchQuery = normalizeRetrievalText(
          `${request.title || ''} ${request.inventionDescription || ''}`,
          35
        ) || 'related technology';
      }

      if (!extractedFields.inventionFeatures || extractedFields.inventionFeatures.length === 0) {
        // Preserve technical context in the fallback instead of treating isolated
        // words as invention features.
        const clauses = `${request.title || ''}. ${request.inventionDescription || ''}`
          .split(/[.;\n]+/)
          .map(value => normalizeRetrievalText(value, 22))
          .filter(value => value.length >= 12);
        extractedFields.inventionFeatures = Array.from(new Set(clauses)).slice(0, 8);
        if (extractedFields.inventionFeatures.length === 0) {
          extractedFields.inventionFeatures = [extractedFields.searchQuery];
        }
      }

      const normalizedStage0 = this.normalizeStage0Idea(extractedFields, request.inventionDescription || '');

      console.log('[NoveltyPipeline] stage_summary', {
        stage: 'stage0_completed',
        searchId,
        searchQueryLength: normalizedStage0.searchQuery.length,
        featureCount: normalizedStage0.inventionFeatures?.length || 0,
        claimConceptCount: normalizedStage0.claimConcepts?.length || 0,
      });
      return { success: true, data: normalizedStage0 };

    } catch (error) {
      console.error('Stage 0 error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Stage 0 failed: ${errorMessage}`
      };
    }
  }

  private async performStage1(
    searchRun: any,
    stage0Data: NormalizedIdea,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      console.log('🔍 Starting Stage 1: Initial Screening');

      // Get patents from PQAI API using searchQuery
      console.log(`🔍 STAGE 1: Starting PQAI search with query: "${stage0Data.searchQuery}"`);
      console.log(`📊 Requesting up to ${config.stage1.maxPatents} patents from PQAI`);

      const jurisdiction = (config.jurisdiction || searchRun?.jurisdiction || 'IN').toUpperCase();
      const sourceMode = config.searchSource?.mode || (jurisdiction === 'IN' ? 'INDIAN_ONLY' : 'PQAI_ONLY');
      const includeEpoKeywords = searchSourceIncludesEpo(sourceMode);
      const providerIds = config.searchSource?.providerIds;
      const includePatents = config.searchSource?.includePatents !== false && (!Array.isArray(providerIds) || providerIds.length > 0);
      const includePapers = Boolean(config.searchSource?.includePapers);
      const searchMode = config.searchSource?.searchMode === 'manual' ? 'manual' : 'intelligent';
      const stage0SearchQuery = String(stage0Data.searchQuery || '').trim();
      const stage0Features = Array.isArray(stage0Data.inventionFeatures) ? stage0Data.inventionFeatures.filter(Boolean) : [];
      const stage0FeatureDetails = this.normalizeFeatureDetails(stage0Data, stage0Data.inventionText || searchRun?.inventionDescription || '');
      const stage0CpcCodes = Array.isArray(stage0Data.cpcCodes) ? stage0Data.cpcCodes.filter(Boolean) : [];
      const stage0IpcCodes = Array.isArray(stage0Data.ipcCodes) ? stage0Data.ipcCodes.filter(Boolean) : [];
      const stage0EpoTitleKeywords = includeEpoKeywords ? this.normalizeEpoKeywordList((stage0Data as any).epoTitleKeywords) : [];
      const stage0EpoAbstractKeywords = includeEpoKeywords ? this.normalizeEpoKeywordList((stage0Data as any).epoAbstractKeywords) : [];
      const stage0EpoCombinedKeywords = includeEpoKeywords ? this.normalizeEpoKeywordList((stage0Data as any).epoCombinedKeywords) : [];
      const stage0SearchExclusions = Array.isArray(stage0Data.searchExclusions) ? stage0Data.searchExclusions.filter(Boolean) : [];
      const stage1Filters = withStage0Exclusions(config.searchSource?.filters || {}, stage0SearchExclusions);
      // Google Patents boolean concept groups from Stage 0. Exclusions ride along as an
      // excluded group so the Google query builder emits -"term" clauses (previously the
      // Stage 0 exclusions never reached Google at all).
      const stage0ConceptGroups: PatentSearchConceptGroup[] = [
        ...this.normalizeGoogleConceptGroups(stage0Data.googleConceptGroups),
        ...(stage0SearchExclusions.length
          ? [{ label: 'stage0-exclusions', terms: stage0SearchExclusions.slice(0, 4), excluded: true } as PatentSearchConceptGroup]
          : []),
      ];
      // Two or more required groups → precise (A1 OR A2) AND (B1 OR B2) query.
      // Fewer → leave precision unset so the builder keeps its broad OR behavior.
      const stage0RequiredGroupCount = stage0ConceptGroups.filter(group => !group.excluded && group.required !== false).length;
      const stage0QueryPlan: Partial<PatentSearchQueryPlan> | undefined = searchMode === 'manual'
        ? undefined
        : {
          originalQuery: stage0SearchQuery,
          normalizedQuery: stage0SearchQuery,
          searchQuery: stage0SearchQuery,
          semanticQuery: [stage0SearchQuery, ...stage0Features].join(' ').trim(),
          inventionFeatures: stage0Features,
          technicalKeywords: Array.from(new Set(stage0SearchQuery.split(/\s+/).filter(word => word.length > 3))).slice(0, 20),
          synonyms: [],
          mustHaveTerms: [],
          excludedTerms: stage0SearchExclusions,
          cpcCodes: stage0CpcCodes,
          ipcCodes: stage0IpcCodes,
          classificationHints: Array.from(new Set([...stage0CpcCodes, ...stage0IpcCodes])),
          ...(stage0ConceptGroups.length ? {
            patentSearchConceptGroups: stage0ConceptGroups,
            ...(stage0RequiredGroupCount >= 2 ? { searchPrecision: 'refined' as const } : {}),
          } : {}),
          ...(includeEpoKeywords ? {
            epoTitleKeywords: stage0EpoTitleKeywords,
            epoAbstractKeywords: stage0EpoAbstractKeywords,
            epoCombinedKeywords: stage0EpoCombinedKeywords,
          } : {}),
          fieldFilters: stage1Filters,
          explicitFilters: stage1Filters,
          searchVariants: stage0SearchQuery ? [stage0SearchQuery] : [],
          retrievalQueries: buildIndianCorpusRetrievalQueries(stage0SearchQuery, stage0Features, stage0FeatureDetails),
          llmExpanded: false,
          confidence: 0.9,
          warnings: ['Using Stage 0 query plan; Stage 1 LLM query expansion disabled.'],
        };

      const patentSearchPromise = includePatents
        ? patentSearchOrchestrator.search({
          searchMode,
          query: searchMode === 'manual' ? '' : stage0SearchQuery,
          title: searchRun?.title || '',
          inventionText: searchRun?.inventionDescription || '',
          filters: stage1Filters,
          providerIds,
          // Country scope drives which live providers are eligible if the corpus comes
          // back empty; fall back to the run's jurisdiction when no countries are set.
          jurisdictions: Array.isArray(stage1Filters?.countries) && stage1Filters.countries.length
            ? stage1Filters.countries
            : [jurisdiction],
          sourceMode,
          llmExpansion: false,
          queryPlan: stage0QueryPlan,
          limit: config.stage1.maxPatents,
          candidateLimit: config.stage1.candidateLimit,
          requestHeaders,
        })
        : Promise.resolve(null);
      const paperSearchQuery = this.normalizeStage0Scalar(
        config.searchSource?.paperSearchQuery || stage0Data.paperSearchQuery || stage0Data.paperKeywords?.join(' ') || stage0SearchQuery,
        500
      );
      const literatureSearchPromise = includePapers
        ? literatureSearchService.search(paperSearchQuery, {
          ...(config.searchSource?.paperFilters || {}),
          sources: config.searchSource?.paperSources,
          limit: config.searchSource?.paperFilters?.limit || Math.min(config.stage1.maxPatents, 50),
          sourceQueries: {
            google_scholar: stage0Data.googleScholarSearchQuery || paperSearchQuery,
            semantic_scholar: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
            crossref: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
            openalex: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
            pubmed: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
            arxiv: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
            core: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
          },
        })
        : Promise.resolve(null);
      const [searchResponse, literatureResponse] = await Promise.all([patentSearchPromise, literatureSearchPromise]);
      const patentCandidates = searchResponse
        ? (searchResponse.candidateResults || searchResponse.results).map(candidate => ({ ...candidate, referenceType: 'patent' }))
        : [];
      const paperCandidates = literatureResponse
        ? literatureResponse.results.map(normalizeLiteratureCandidate)
        : [];
      const retrievalCandidates = [...patentCandidates, ...paperCandidates]
        .sort((a: any, b: any) => Number(b.relevanceScore || b.retrievalScore || 0) - Number(a.relevanceScore || a.retrievalScore || 0));
      const priorArtResults: any[] = [];
      const pqaiResults: any[] = [];

      // Return raw PQAI results for UI
      console.log('[NoveltyPipeline] stage1_provider_retrieval_completed', JSON.stringify(compactLogDetails({
        searchId: searchRun?.id,
        stage0SearchQuery,
        stage0Features,
        requestedProviderIds: providerIds,
        resolvedProviders: [
          ...(searchResponse?.providerStats.map(stat => stat.providerId) || []),
          ...(literatureResponse?.providerStats.map(stat => `paper:${stat.providerId}`) || []),
        ],
        providerStats: searchResponse?.providerStats || [],
        literatureProviderStats: literatureResponse?.providerStats || [],
        diagnostics: searchResponse?.diagnostics,
        warnings: [...(searchResponse?.warnings || []), ...(literatureResponse?.warnings || [])],
        candidateCount: retrievalCandidates.length,
        candidates: retrievalCandidates.map(candidate => ({
          publicationNumber: candidate.publicationNumber,
          title: candidate.title,
          relevanceScore: candidate.relevanceScore,
          sourceProvider: candidate.sourceProvider,
          sourceProviders: candidate.sourceProviders,
        })),
      })));
      return {
        success: true,
        data: {
          priorArtResults,
          pqaiResults,
          visiblePriorArtResults: [],
          retrievalCandidates,
          rawPriorArtResults: retrievalCandidates,
          candidateResults: retrievalCandidates,
          patentResults: patentCandidates,
          paperResults: paperCandidates,
          patentCount: patentCandidates.length,
          paperCount: paperCandidates.length,
          retrievedCount: retrievalCandidates.length,
          hiddenCandidateCount: retrievalCandidates.length,
          hasMoreCandidates: retrievalCandidates.length > 0,
          minimumVisibleConfidence: config.stage15.minimumVisibleConfidence,
          nextBatchCursor: 0,
          queryPlan: {
            ...(searchResponse?.queryPlan || stage0QueryPlan || {}),
            ...(includePapers ? {
              paperSearchQuery,
              paperKeywords: stage0Data.paperKeywords || [],
              paperSearchQueries: stage0Data.paperSearchQueries || [],
              googleScholarSearchQuery: stage0Data.googleScholarSearchQuery || paperSearchQuery,
              academicDatabaseSearchQuery: stage0Data.academicDatabaseSearchQuery || paperSearchQuery,
              paperYearFrom: config.searchSource?.paperFilters?.yearFrom ?? stage0Data.paperYearFrom,
              paperYearTo: config.searchSource?.paperFilters?.yearTo ?? stage0Data.paperYearTo,
              paperSources: config.searchSource?.paperSources || [],
              paperFilters: config.searchSource?.paperFilters || {},
            } : {}),
          },
          providerStats: [
            ...(searchResponse?.providerStats || []),
            ...(literatureResponse?.providerStats.map(stat => ({ ...stat, providerId: `paper:${stat.providerId}`, label: `Scholarly papers - ${stat.providerId}` })) || []),
          ],
          literatureProviderStats: literatureResponse?.providerStats || [],
          searchWarnings: [...(searchResponse?.warnings || []), ...(literatureResponse?.warnings || [])],
          searchDiagnostics: searchResponse?.diagnostics,
          searchSource: {
            mode: sourceMode,
            providerIds: providerIds || searchResponse?.providerStats.map(stat => stat.providerId) || [],
            includePatents,
            includePapers,
            paperSources: config.searchSource?.paperSources || [],
            searchMode,
          },
        },
      };

    } catch (error) {
      console.error('Stage 1 provider search failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Provider patent search failed'
      };
    }
  }

  private formatRetrievalHints(patent: any): string {
    const matchedFeatures = Array.isArray(patent?.matchedFeatures)
      ? patent.matchedFeatures.map((feature: any) => String(feature || '').trim()).filter(Boolean).slice(0, 6)
      : [];
    const retrievalScore = typeof patent?.retrievalScore === 'number'
      ? patent.retrievalScore
      : (typeof patent?.scores?.retrieval === 'number' ? patent.scores.retrieval : undefined);
    const retrievalMatches = Array.isArray(patent?.retrievalMatches)
      ? patent.retrievalMatches.slice(0, 4).map((match: any) => {
        const queryType = String(match?.queryType || 'query');
        const rank = typeof match?.rank === 'number' ? `rank ${match.rank}` : '';
        const score = typeof match?.score === 'number' ? `score ${match.score.toFixed(3)}` : '';
        const labels = Array.isArray(match?.featureLabels) && match.featureLabels.length
          ? `features: ${match.featureLabels.join(', ')}`
          : '';
        return [queryType, rank, score, labels].filter(Boolean).join(' ');
      }).filter(Boolean)
      : [];

    return [
      typeof retrievalScore === 'number' ? `retrieval_score=${retrievalScore.toFixed(3)}` : '',
      matchedFeatures.length ? `candidate_feature_hints=${matchedFeatures.join(' | ')}` : '',
      retrievalMatches.length ? `top_embedding_matches=${retrievalMatches.join(' ; ')}` : '',
    ].filter(Boolean).join('; ');
  }

  private canonicalPatentNumber(value: any): string {
    const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (compact.startsWith('PAPER')) return compact;
    const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/);
    return kindSuffixMatch?.[1] || compact;
  }

  private getStage1CandidatePool(stage1Data: any): any[] {
    const candidates = stage1Data?.retrievalCandidates || stage1Data?.candidateResults || stage1Data?.rawPriorArtResults;
    if (Array.isArray(candidates)) return candidates;
    const fallback = stage1Data?.priorArtResults || stage1Data?.pqaiResults;
    return Array.isArray(fallback) ? fallback : [];
  }

  private canReuseStage15Gate(stage1Data: any, cacheKey: string): boolean {
    const gate = stage1Data?.aiRelevance;
    return Boolean(gate?.byPn && gate.cacheKey === cacheKey && gate.gateStatus === 'complete');
  }

  private getGateRecordForPublication(
    byPn: Record<string, PriorArtGateRecord | undefined>,
    pn: string
  ): PriorArtGateRecord | undefined {
    if (!pn) return undefined;
    return byPn[pn] || byPn[pn.toUpperCase()] || byPn[canonicalPriorArtNumber(pn)];
  }

  private summarizeStage15GateCounts(candidatePool: any[], byPn: Record<string, PriorArtGateRecord | undefined>) {
    let attemptedGateCount = 0;
    let reviewedCount = 0;
    let gateErrorCount = 0;

    for (const candidate of candidatePool) {
      const pn = getPriorArtPublicationNumber(candidate);
      const gate = this.getGateRecordForPublication(byPn, pn);
      if (!gate) continue;
      attemptedGateCount += 1;
      if (gate.reviewStatus === 'gate_error') gateErrorCount += 1;
      else reviewedCount += 1;
    }

    return {
      retrievedCount: candidatePool.length,
      attemptedGateCount,
      reviewedCount,
      gateErrorCount,
      unreviewedCount: Math.max(0, candidatePool.length - attemptedGateCount),
    };
  }

  private buildStage15DecisionLists(
    candidatePool: any[],
    byPn: Record<string, PriorArtGateRecord | undefined>,
    borderlineQuota: number
  ) {
    const accepted: string[] = [];
    const component: string[] = [];
    const borderline: string[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();

    const add = (target: string[], bucket: string, pn: string) => {
      const key = canonicalPriorArtNumber(pn) || pn.toUpperCase();
      if (!key || seen.has(`${bucket}:${key}`)) return;
      seen.add(`${bucket}:${key}`);
      target.push(pn);
    };

    for (const candidate of candidatePool) {
      const pn = getPriorArtPublicationNumber(candidate);
      if (!pn) continue;
      const gate = this.getGateRecordForPublication(byPn, pn);
      if (!gate) continue;
      const decision = normalizeRerankDecision(gate.rerankDecision || gate.decision);
      if (gate.reviewStatus === 'gate_error' && decision === 'reject') continue;
      if (decision === 'accept') add(accepted, 'accepted', pn);
      else if (decision === 'component') add(component, 'component', pn);
      else if (decision === 'borderline') add(borderline, 'borderline', pn);
      else add(rejected, 'rejected', pn);
    }

    return {
      accepted,
      component,
      borderline: borderline.slice(0, Math.max(0, borderlineQuota)),
      rejected,
    };
  }

  private fallbackCandidatesForGateFailure(candidatePool: any[], limit: number) {
    return candidatePool.slice(0, Math.max(0, limit)).map(candidate => ({
      ...candidate,
      rerankDecision: 'borderline',
      rerankScore: 0.2,
      evidence_quality: 'low',
      rerankReason: 'AI relevance gate did not complete; candidate retained as low-confidence review fallback.',
    }));
  }

  private mergeStage15Visibility(stage1Data: any, gateData: any, config: NoveltySearchConfig) {
    const candidatePool = this.getStage1CandidatePool(stage1Data);
    const visibleLimit = Math.max(
      DEFAULT_VISIBLE_PRIOR_ART_LIMIT,
      Number(gateData?.visibleResultLimit || config.stage15.visibleLimit || DEFAULT_VISIBLE_PRIOR_ART_LIMIT)
    );
    const minimumVisibleConfidence = Number(
      gateData?.minimumVisibleConfidence ||
      config.stage15.minimumVisibleConfidence ||
      DEFAULT_MINIMUM_VISIBLE_CONFIDENCE
    );
    const visibility = buildVisiblePriorArtResults({
      candidates: candidatePool,
      byPn: gateData?.byPn || {},
      minimumVisibleConfidence,
      visibleLimit,
    });
    const gateCounts = this.summarizeStage15GateCounts(candidatePool, gateData?.byPn || {});
    const fallbackCandidates = gateData?.gateStatus === 'failed'
      ? this.fallbackCandidatesForGateFailure(candidatePool, config.stage15.visibleLimit || DEFAULT_VISIBLE_PRIOR_ART_LIMIT)
      : [];

    return {
      ...(stage1Data || {}),
      aiRelevance: {
        ...(gateData || {}),
        visiblePublicationNumbers: visibility.visiblePublicationNumbers,
        visibleCount: visibility.visiblePriorArtResults.length,
        highConfidenceCount: visibility.highConfidenceCount,
        hiddenCandidateCount: visibility.hiddenCandidateCount,
        retrievedCount: gateData?.retrievedCount ?? gateCounts.retrievedCount,
        attemptedGateCount: gateData?.attemptedGateCount ?? gateCounts.attemptedGateCount,
        reviewedCount: gateData?.reviewedCount ?? gateCounts.reviewedCount,
        gateErrorCount: gateData?.gateErrorCount ?? gateCounts.gateErrorCount,
        unreviewedCount: gateData?.unreviewedCount ?? gateCounts.unreviewedCount,
        minimumVisibleConfidence,
      },
      retrievalCandidates: candidatePool,
      gatedCandidates: visibility.gatedCandidates,
      visiblePriorArtResults: visibility.visiblePriorArtResults,
      fallbackCandidates,
      visibleResultLimit: visibleLimit,
      minimumVisibleConfidence,
      nextBatchCursor: gateData?.nextBatchCursor ?? gateData?.consideredCount ?? 0,
      hasMoreCandidates: Boolean(gateData?.hasMoreCandidates),
      hiddenCandidateCount: visibility.hiddenCandidateCount,
      retrievedCount: gateData?.retrievedCount ?? gateCounts.retrievedCount,
      attemptedGateCount: gateData?.attemptedGateCount ?? gateCounts.attemptedGateCount,
      reviewedCount: gateData?.reviewedCount ?? gateCounts.reviewedCount,
      gateErrorCount: gateData?.gateErrorCount ?? gateCounts.gateErrorCount,
      unreviewedCount: gateData?.unreviewedCount ?? gateCounts.unreviewedCount,
      visibleCount: visibility.visiblePriorArtResults.length,
      priorArtResults: visibility.visiblePriorArtResults,
      pqaiResults: visibility.visiblePriorArtResults,
    };
  }

  private selectRelevantPatentsForDeepAnalysis(stage1Data: any, maxCandidates = 20): any[] {
    const gate = stage1Data?.aiRelevance;
    const candidatePool = this.getStage1CandidatePool(stage1Data);
    const safeMaxCandidates = Math.max(0, Math.trunc(maxCandidates || 0));
    const BORDERLINE_FILL_RATIO = 0.35;
    const MIN_DEEP_ANALYSIS_TARGET = 15;
    const MAX_DEEP_ANALYSIS_TARGET = 40;
    const MAX_BORDERLINE_FILL = 10;
    const deepAnalysisTarget = (acceptedCount: number, componentCount: number, borderlineCount: number) => {
      const reviewableCount = Math.max(0, acceptedCount + componentCount + borderlineCount);
      if (reviewableCount === 0 || safeMaxCandidates === 0) return 0;
      const relativeTarget = Math.ceil(reviewableCount * BORDERLINE_FILL_RATIO);
      const boundedTarget = Math.min(
        MAX_DEEP_ANALYSIS_TARGET,
        Math.max(MIN_DEEP_ANALYSIS_TARGET, relativeTarget)
      );
      return Math.min(safeMaxCandidates, boundedTarget);
    };
    const annotate = (candidate: any, record?: PriorArtGateRecord, score = 0) => ({
      ...candidate,
      rerankScore: score,
      rerankDecision: normalizeRerankDecision(record?.rerankDecision || record?.decision),
      matchCategory: matchCategoryFromDecision(record?.rerankDecision || record?.decision),
      matchCategoryLabel: matchCategoryLabel(record?.rerankDecision || record?.decision),
      evidence_quality: record?.evidence_quality,
      matched_features: record?.matched_features,
      missing_features: record?.missing_features,
      rerankReason: record?.reason,
    });
    const selectedKeys = new Set<string>();
    const selectByDecision = (decisionName: 'accept' | 'component' | 'borderline', limit = safeMaxCandidates - selectedKeys.size) => {
      if (!(candidatePool.length > 0 && gate?.byPn && gate?.gateStatus !== 'failed')) return [];
      if (limit <= 0) return [];
      return candidatePool
        .map((candidate, index) => {
          const pn = getPriorArtPublicationNumber(candidate);
          const record = pn ? this.getGateRecordForPublication(gate.byPn, pn) : undefined;
          const score = Number(record?.rerankScore ?? record?.score ?? 0);
          const key = this.canonicalPatentNumber(pn) || String(pn || '').toUpperCase();
          return { candidate, index, record, score, key };
        })
        .filter(item => {
          if (!item.record) return false;
          const decision = normalizeRerankDecision(item.record.rerankDecision || item.record.decision);
          if (item.record.reviewStatus === 'gate_error' && decision !== 'borderline') return false;
          if (decision !== decisionName) return false;
          return Boolean(item.key && !selectedKeys.has(item.key));
        })
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .slice(0, Math.max(0, Math.min(limit, safeMaxCandidates - selectedKeys.size)))
        .map(item => {
          if (item.key) selectedKeys.add(item.key);
          return annotate(item.candidate, item.record, item.score);
        });
    };

    const accepted = selectByDecision('accept');
    const component = selectByDecision('component');
    const gateAcceptedCount = Array.isArray(gate?.accepted) ? gate.accepted.length : accepted.length;
    const gateComponentCount = Array.isArray(gate?.component) ? gate.component.length : component.length;
    // gate.borderline is intentionally a UI-sized list. Count every reviewed
    // borderline decision in byPn so that the historical quota of five does
    // not silently cap deep analysis at five patents.
    const gateBorderlineCount = candidatePool.reduce((count, candidate) => {
      const pn = getPriorArtPublicationNumber(candidate);
      const record = pn ? this.getGateRecordForPublication(gate?.byPn || {}, pn) : undefined;
      return normalizeRerankDecision(record?.rerankDecision || record?.decision) === 'borderline'
        ? count + 1
        : count;
    }, 0);
    const targetCount = deepAnalysisTarget(gateAcceptedCount, gateComponentCount, gateBorderlineCount);
    const borderlineNeeded = Math.max(0, targetCount - accepted.length - component.length);
    const borderline = selectByDecision('borderline', Math.min(MAX_BORDERLINE_FILL, borderlineNeeded));
    const categorySelected = [...accepted, ...component, ...borderline].slice(0, safeMaxCandidates);
    if (categorySelected.length > 0) return categorySelected;

    const visibleResults = Array.isArray(stage1Data?.visiblePriorArtResults)
      ? stage1Data.visiblePriorArtResults
      : (Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : []);
    const results = visibleResults.length
      ? visibleResults
      : (gate?.gateStatus === 'failed' && Array.isArray(stage1Data?.fallbackCandidates) ? stage1Data.fallbackCandidates : []);
    if (results.length === 0) return [];

    const acceptedPns = Array.isArray(gate?.accepted) ? gate.accepted : [];
    const componentPns = Array.isArray(gate?.component) ? gate.component : [];
    const borderlinePns = Array.isArray(gate?.borderline) ? gate.borderline : [];
    const selected: any[] = [];
    const seen = new Set<string>();

    const addBySet = (values: any[], limit = safeMaxCandidates - selected.length) => {
      if (limit <= 0) return;
      const exact = new Set(values.map(value => String(value || '').toUpperCase()));
      const canonical = new Set(values.map(value => this.canonicalPatentNumber(value)).filter(Boolean));
      for (const patent of results) {
        if (selected.length >= safeMaxCandidates || limit <= 0) break;
        const pn = patent.publicationNumber || patent.publication_number || patent.pn || patent.id || '';
        const key = this.canonicalPatentNumber(pn) || String(pn).toUpperCase();
        if (!key || seen.has(key)) continue;
        if (exact.has(String(pn).toUpperCase()) || canonical.has(this.canonicalPatentNumber(pn))) {
          selected.push(patent);
          seen.add(key);
          limit -= 1;
        }
      }
    };

    addBySet(acceptedPns);
    if (selected.length < safeMaxCandidates) addBySet(componentPns);
    const fallbackTargetCount = deepAnalysisTarget(acceptedPns.length, componentPns.length, borderlinePns.length);
    const fallbackBorderlineNeeded = Math.max(0, fallbackTargetCount - selected.length);
    if (selected.length < safeMaxCandidates) addBySet(borderlinePns, Math.min(MAX_BORDERLINE_FILL, fallbackBorderlineNeeded));

    if (selected.length === 0) {
      return results.slice(0, safeMaxCandidates);
    }

    return selected;
  }

  private buildNoveltySignalsFromAnalysis(featureMaps: PatentFeatureMap[], remarks: PerPatentRemark[], inventionFeatures: string[]) {
    const closest = [...remarks]
      .sort((a: any, b: any) => Number(b?.relevance || 0) - Number(a?.relevance || 0))
      .slice(0, 5)
      .map((remark: any) => String(remark.pn || '').trim())
      .filter(Boolean);

    const covered = inventionFeatures.filter(feature => featureMaps.some(map =>
      (map.feature_analysis || []).some(cell => cell.feature === feature && cell.status === 'Present')
    ));
    const potentialDifferentiators = inventionFeatures.filter(feature => !this.isGenericNoveltyFeature(feature) && !featureMaps.some(map =>
      (map.feature_analysis || []).some(cell => cell.feature === feature && (cell.status === 'Present' || cell.status === 'Partial'))
    ));
    const weak = inventionFeatures.filter(feature => featureMaps.some(map =>
      (map.feature_analysis || []).some(cell => cell.feature === feature && cell.status === 'Unknown')
    ));

    return {
      closest_mapped_references: closest,
      closest_blocking_references: closest,
      features_fully_covered: covered,
      potential_differentiators: potentialDifferentiators,
      features_still_unique: potentialDifferentiators,
      weak_evidence_areas: weak,
      recommended_next_actions: [
        closest.length ? 'Review closest mapped references in detail before drafting claims.' : 'Broaden the search corpus before relying on novelty.',
        potentialDifferentiators.length ? 'Focus attorney review on potential differentiators not mapped in closest references.' : 'Identify additional technical differentiators before filing.'
      ]
    };
  }

  private normalizeStage0Scalar(value: unknown, maxLength = 1000): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private normalizeStage0Score(value: unknown): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    const scaled = n > 1 && n <= 100 ? n / 100 : n;
    return Math.round(Math.max(0, Math.min(1, scaled)) * 100) / 100;
  }

  /**
   * Normalize LLM-supplied Google Patents concept groups into the shape the
   * Google Patents boolean query builder consumes. Strips boolean syntax,
   * bounds group/term counts, and drops empty groups.
   */
  private normalizeGoogleConceptGroups(value: unknown, maxGroups = 4, maxTerms = 5): PatentSearchConceptGroup[] {
    if (!Array.isArray(value)) return [];
    const groups: PatentSearchConceptGroup[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const terms = (Array.isArray((raw as any).terms) ? (raw as any).terms : [])
        .map((term: unknown) => String(term || '')
          .replace(/["()*?]/g, ' ')      // strip boolean/query syntax the builder rejects
          .replace(/\s+/g, ' ')
          .trim())
        .filter((term: string) => {
          const words = term.split(/\s+/).filter(Boolean).length;
          return term.length >= 3 && term.length <= 120 && words >= 1 && words <= 6;
        })
        .slice(0, maxTerms);
      if (!terms.length) continue;
      const label = this.normalizeStage0Scalar((raw as any).label || '', 80);
      groups.push({
        ...(label ? { label } : {}),
        terms: Array.from(new Set(terms)),
        required: (raw as any).required !== false,
        excluded: (raw as any).excluded === true,
      });
      if (groups.length >= maxGroups) break;
    }
    return groups;
  }

  private normalizeEpoKeywordList(value: unknown, maxItems = 8): string[] {
    const values = Array.isArray(value)
      ? value.flatMap(item => String(item || '').split(/[,;\n]/))
      : (typeof value === 'string' ? value.split(/[,;\n]/) : []);
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const item of values) {
      const raw = String(item || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.split(/\s+/).filter(Boolean).length > 10) continue;
      const text = normalizeRetrievalText(raw, 10);
      if (!text || text.length < 3 || text.length > 120) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      keywords.push(text);
      if (keywords.length >= maxItems) break;
    }
    return keywords;
  }

  private normalizedFeatureKey(value: unknown): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(detects?|detected|detecting|detection)\b/g, 'identify')
      .replace(/\b(identifies|identified|identifying|identification)\b/g, 'identify')
      .replace(/\b(adjusts?|adjusted|adjusting|adjustment)\b/g, 'adjust')
      .replace(/\b(characterizes?|characterized|characterizing|characterization)\b/g, 'characterize')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private featureReferenceScore(candidate: string, feature: string): number {
    const a = this.normalizedFeatureKey(candidate);
    const b = this.normalizedFeatureKey(feature);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length > 12 && b.includes(a)) return 0.92;
    if (b.length > 12 && a.includes(b)) return 0.92;
    const aTokens = new Set(a.split(/\s+/).filter(token => token.length > 2));
    const bTokens = new Set(b.split(/\s+/).filter(token => token.length > 2));
    if (!aTokens.size || !bTokens.size) return 0;
    const intersection = Array.from(aTokens).filter(token => bTokens.has(token)).length;
    const union = new Set([...Array.from(aTokens), ...Array.from(bTokens)]).size;
    return intersection / Math.max(1, union);
  }

  private repairFeatureReference(value: unknown, features: string[]): { feature?: string; repaired: boolean; confidence: number } {
    const raw = this.normalizeStage0Scalar(value, 1000);
    if (!raw) return { repaired: false, confidence: 0 };
    const exact = features.find(feature => this.normalizedFeatureKey(feature) === this.normalizedFeatureKey(raw));
    if (exact) return { feature: exact, repaired: exact !== raw, confidence: 1 };
    const ranked = features
      .map(feature => ({ feature, confidence: this.featureReferenceScore(raw, feature) }))
      .sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0];
    if (best && best.confidence >= 0.82) {
      return { feature: best.feature, repaired: true, confidence: best.confidence };
    }
    return { repaired: false, confidence: best?.confidence || 0 };
  }

  private normalizeFeatureDetailForFeature(feature: string, raw: any = {}): InventionFeatureDetail {
    const featureType = String(raw?.feature_type || raw?.featureType || '').toLowerCase();
    const normalizedType = featureType === 'core_technical' || featureType === 'implementation' || featureType === 'novelty_candidate' || featureType === 'generic_weak'
      ? featureType as InventionFeatureDetail['feature_type']
      : undefined;
    return {
      ...raw,
      feature,
      feature_type: normalizedType,
      user_disclosure: this.normalizeStage0Scalar(raw?.user_disclosure ?? raw?.userDisclosure ?? feature, 1600),
      technical_role: this.normalizeStage0Scalar(raw?.technical_role ?? raw?.technicalRole ?? 'Technical feature extracted from the user disclosure.', 1000),
      source_excerpt: this.normalizeStage0Scalar(raw?.source_excerpt ?? raw?.sourceExcerpt ?? '', 800),
      claimableText: this.normalizeStage0Scalar(raw?.claimableText ?? raw?.claimable_text ?? '', 1200),
      embeddingSearchText: normalizeRetrievalText(raw?.embeddingSearchText ?? raw?.embedding_search_text ?? '', 30),
      featureConfidence: this.normalizeStage0Score(raw?.featureConfidence ?? raw?.feature_confidence),
    };
  }

  private normalizeClaimConcepts(rawConcepts: unknown, features: string[], warnings: string[]): ClaimConcept[] {
    if (!Array.isArray(rawConcepts)) {
      if (features.length >= 4) warnings.push('Stage 0 did not provide claim concepts for a multi-feature invention.');
      return [];
    }

    const concepts: ClaimConcept[] = [];
    rawConcepts.slice(0, 6).forEach((raw: any, conceptIndex) => {
      const linkedRaw = Array.isArray(raw?.linkedFeatures) ? raw.linkedFeatures : (Array.isArray(raw?.linked_features) ? raw.linked_features : []);
      const linkedFeatures: string[] = [];
      for (const linked of linkedRaw) {
        const repaired = this.repairFeatureReference(linked, features);
        if (repaired.feature && !linkedFeatures.includes(repaired.feature)) {
          linkedFeatures.push(repaired.feature);
          if (repaired.repaired) {
            warnings.push(`Claim concept "${raw?.title || conceptIndex + 1}" linked feature "${String(linked).trim()}" was repaired to "${repaired.feature}".`);
          }
        } else {
          warnings.push(`Claim concept "${raw?.title || conceptIndex + 1}" linked feature "${String(linked).trim()}" could not be matched to an extracted feature and was removed.`);
        }
      }
      if (linkedFeatures.length === 0) {
        warnings.push(`Claim concept "${raw?.title || conceptIndex + 1}" was removed because it had no valid linked features.`);
        return;
      }
      const importance = String(raw?.importance || '').toLowerCase();
      concepts.push({
        title: this.normalizeStage0Scalar(raw?.title || `Claim concept ${conceptIndex + 1}`, 220),
        linkedFeatures,
        claimableSummary: this.normalizeStage0Scalar(raw?.claimableSummary ?? raw?.claimable_summary ?? raw?.summary ?? '', 1200),
        importance: importance === 'primary' || importance === 'secondary' || importance === 'fallback' ? importance : (conceptIndex === 0 ? 'primary' : 'secondary'),
        riskIfMissing: this.normalizeStage0Scalar(raw?.riskIfMissing ?? raw?.risk_if_missing ?? '', 1000),
      });
    });

    if (features.length >= 4 && concepts.length === 0) {
      warnings.push('Stage 0 claim concepts were missing or invalid for a multi-feature invention.');
    }
    if (concepts.length > 4) {
      warnings.push('Stage 0 returned more than four claim concepts; only the first four valid concepts were retained.');
    }
    return concepts.slice(0, 4);
  }

  private normalizeNoveltyFocusInteractions(rawInteractions: unknown, features: string[], warnings: string[]): NoveltyFocusInteraction[] {
    if (!Array.isArray(rawInteractions)) return [];
    return rawInteractions.slice(0, 4).map((raw: any, index) => {
      const linkedRaw = Array.isArray(raw?.linkedFeatures) ? raw.linkedFeatures : (Array.isArray(raw?.linked_features) ? raw.linked_features : []);
      const linkedFeatures: string[] = linkedRaw
        .map((linked: unknown) => {
          const repaired = this.repairFeatureReference(linked, features);
          if (repaired.feature && repaired.repaired) {
            warnings.push(`Novelty focus interaction ${index + 1} linked feature "${String(linked).trim()}" was repaired to "${repaired.feature}".`);
          } else if (!repaired.feature) {
            warnings.push(`Novelty focus interaction ${index + 1} linked feature "${String(linked).trim()}" could not be matched and was removed.`);
          }
          return repaired.feature;
        })
        .filter((feature: string | undefined): feature is string => Boolean(feature));
      const type = String(raw?.type || '').toLowerCase();
      const normalizedType: NoveltyFocusInteraction['type'] = type === 'feature_interaction' || type === 'single_feature' || type === 'architecture' ? type : 'feature_interaction';
      return {
        type: normalizedType,
        description: this.normalizeStage0Scalar(raw?.description || raw?.summary || '', 1000),
        linkedFeatures: Array.from(new Set(linkedFeatures)),
      };
    }).filter(item => item.description || item.linkedFeatures.length);
  }

  private normalizeStage0Idea(stage0Data: NormalizedIdea, inventionDisclosure = ''): NormalizedIdea {
    const warnings = Array.from(new Set([
      ...(Array.isArray(stage0Data.warnings) ? stage0Data.warnings.map(warning => this.normalizeStage0Scalar(warning, 500)).filter(Boolean) : []),
    ]));
    const features = Array.isArray(stage0Data.inventionFeatures)
      ? Array.from(new Set(stage0Data.inventionFeatures.map(feature => this.normalizeStage0Scalar(feature, 1000)).filter(Boolean)))
      : [];
    const supplied = Array.isArray(stage0Data.featureDetails) ? stage0Data.featureDetails : [];
    const byFeature = new Map<string, InventionFeatureDetail>();
    for (const detail of supplied) {
      const repaired = this.repairFeatureReference(detail?.feature, features);
      if (!repaired.feature) continue;
      byFeature.set(repaired.feature, this.normalizeFeatureDetailForFeature(repaired.feature, detail));
      if (repaired.repaired) warnings.push(`Feature detail "${String(detail?.feature || '').trim()}" was repaired to "${repaired.feature}".`);
    }
    const featureDetails = features.map(feature => byFeature.get(feature) || this.normalizeFeatureDetailForFeature(feature, {
      feature,
      user_disclosure: feature,
      technical_role: 'Technical feature extracted from the user disclosure.',
      source_excerpt: this.findDisclosureExcerpt(inventionDisclosure, feature),
    }));
    const conceptSource = (stage0Data as any).claimConcepts ?? (stage0Data as any).claim_concepts;
    const interactionSource = (stage0Data as any).noveltyFocusInteractions ?? (stage0Data as any).novelty_focus_interactions;
    const hasEpoKeywordFields = Object.prototype.hasOwnProperty.call(stage0Data as any, 'epoTitleKeywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'epo_title_keywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'epoAbstractKeywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'epo_abstract_keywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'epoCombinedKeywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'epo_combined_keywords');
    const hasPaperFields = Object.prototype.hasOwnProperty.call(stage0Data as any, 'paperSearchQuery') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'paper_search_query') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'paperKeywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'paper_keywords') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'paperSearchQueries') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'googleScholarSearchQuery') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'academicDatabaseSearchQuery') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'paperYearFrom') ||
      Object.prototype.hasOwnProperty.call(stage0Data as any, 'paperYearTo');
    return {
      ...stage0Data,
      inventionFeatures: features,
      featureDetails,
      ...(hasEpoKeywordFields ? {
        epoTitleKeywords: this.normalizeEpoKeywordList((stage0Data as any).epoTitleKeywords ?? (stage0Data as any).epo_title_keywords),
        epoAbstractKeywords: this.normalizeEpoKeywordList((stage0Data as any).epoAbstractKeywords ?? (stage0Data as any).epo_abstract_keywords),
        epoCombinedKeywords: this.normalizeEpoKeywordList((stage0Data as any).epoCombinedKeywords ?? (stage0Data as any).epo_combined_keywords),
      } : {}),
      ...(hasPaperFields ? {
        paperSearchQuery: this.normalizeStage0Scalar((stage0Data as any).paperSearchQuery ?? (stage0Data as any).paper_search_query ?? '', 500),
        paperKeywords: this.normalizeEpoKeywordList((stage0Data as any).paperKeywords ?? (stage0Data as any).paper_keywords),
        paperSearchQueries: this.normalizeEpoKeywordList((stage0Data as any).paperSearchQueries ?? (stage0Data as any).paper_search_queries),
        googleScholarSearchQuery: this.normalizeStage0Scalar((stage0Data as any).googleScholarSearchQuery ?? (stage0Data as any).google_scholar_search_query ?? (stage0Data as any).paperSearchQuery ?? '', 500),
        academicDatabaseSearchQuery: this.normalizeStage0Scalar((stage0Data as any).academicDatabaseSearchQuery ?? (stage0Data as any).academic_database_search_query ?? (stage0Data as any).paperSearchQuery ?? '', 500),
        paperYearFrom: (() => {
          const year = Number((stage0Data as any).paperYearFrom ?? (stage0Data as any).paper_year_from);
          return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() ? year : 1900;
        })(),
        paperYearTo: (() => {
          const year = Number((stage0Data as any).paperYearTo ?? (stage0Data as any).paper_year_to);
          return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() ? year : new Date().getFullYear();
        })(),
      } : {}),
      architecturalInnovation: this.normalizeStage0Scalar((stage0Data as any).architecturalInnovation ?? (stage0Data as any).architectural_innovation ?? '', 500),
      googleConceptGroups: this.normalizeGoogleConceptGroups(
        (stage0Data as any).googleConceptGroups ?? (stage0Data as any).google_concept_groups
      ),
      claimConcepts: this.normalizeClaimConcepts(conceptSource, features, warnings),
      noveltyFocusInteractions: this.normalizeNoveltyFocusInteractions(interactionSource, features, warnings),
      noveltyFocus: Array.isArray(stage0Data.noveltyFocus)
        ? Array.from(new Set(stage0Data.noveltyFocus.map(feature => this.repairFeatureReference(feature, features).feature).filter(Boolean) as string[])).slice(0, 4)
        : [],
      warnings: Array.from(new Set(warnings)),
    };
  }

  private normalizeFeatureDetails(stage0Data: NormalizedIdea, inventionDisclosure = ''): InventionFeatureDetail[] {
    const features = Array.isArray(stage0Data.inventionFeatures) ? stage0Data.inventionFeatures : [];
    const supplied = Array.isArray(stage0Data.featureDetails) ? stage0Data.featureDetails : [];
    const byFeature = new Map<string, InventionFeatureDetail>();

    for (const detail of supplied) {
      const feature = String(detail?.feature || '').trim();
      if (!feature) continue;
      byFeature.set(feature, this.normalizeFeatureDetailForFeature(feature, detail));
    }

    return features.map(feature => byFeature.get(feature) || {
      feature,
      user_disclosure: feature,
      technical_role: 'Technical feature extracted from the user disclosure.',
      source_excerpt: this.findDisclosureExcerpt(inventionDisclosure, feature),
    });
  }

  private findDisclosureExcerpt(disclosure: string, feature: string): string {
    const text = String(disclosure || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const featureTokens = String(feature || '').toLowerCase().split(/\s+/).filter(token => token.length > 3);
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const match = sentences.find(sentence => {
      const lower = sentence.toLowerCase();
      return featureTokens.some(token => lower.includes(token));
    });
    return String(match || text).slice(0, 240);
  }

  private normalizeScore(value: any): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    const scaled = n > 1 && n <= 100 ? n / 100 : n;
    return Math.max(0, Math.min(1, scaled));
  }

  private roundScore(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
  }

  private textSpecificityScore(value: string): number {
    const tokens = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 3 && !['patent', 'feature', 'disclosure', 'supporting', 'available', 'identified'].includes(token));
    return Math.min(1, Array.from(new Set(tokens)).length / 28);
  }

  private featureOverlapScore(feature: string, disclosure: string): number {
    const text = String(disclosure || '').toLowerCase();
    const featureTokens = Array.from(new Set(String(feature || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 3)));
    if (featureTokens.length === 0) return 0;
    const matched = featureTokens.filter(token => text.includes(token));
    return matched.length / featureTokens.length;
  }

  private defaultFeatureExtentScore(
    status: FeatureMapCell['status'],
    feature: string,
    confidence: number | undefined,
    patentDisclosure: string,
    evidenceQuote?: string
  ): number {
    const evidenceText = [patentDisclosure, evidenceQuote].filter(Boolean).join(' ');
    const specificity = this.textSpecificityScore(evidenceText);
    const overlap = this.featureOverlapScore(feature, evidenceText);
    const rowConfidence = typeof confidence === 'number' ? confidence : 0.5;

    if (status === 'Present') {
      return this.roundScore(0.70 + overlap * 0.18 + specificity * 0.08 + rowConfidence * 0.04);
    }
    if (status === 'Partial') {
      return this.roundScore(0.32 + overlap * 0.24 + specificity * 0.12 + rowConfidence * 0.06);
    }
    if (status === 'Absent') {
      return this.roundScore(0.04 + Math.min(overlap, 0.5) * 0.12);
    }
    return this.roundScore(0.14 + overlap * 0.12 + specificity * 0.08);
  }

  private mergeConsolidatedAnalysisBatches(parsedBatches: any[]) {
    const merged = {
      aiRelevance: { accepted: [] as string[], component: [] as string[], borderline: [] as string[], rejected: [] as string[], byPn: {} as Record<string, any> },
      feature_map: [] as any[],
      per_patent_remarks: [] as any[],
      novelty_signals: {
        closest_mapped_references: [] as string[],
        closest_blocking_references: [] as string[],
        features_fully_covered: [] as string[],
        potential_differentiators: [] as string[],
        features_still_unique: [] as string[],
        weak_evidence_areas: [] as string[],
        recommended_next_actions: [] as string[],
      },
      quality_flags: { low_evidence: false, ambiguous_abstracts: false, language_mismatch: false },
      stats: { patents_analyzed: 0, features_considered: 0 },
    };

    const uniquePush = (target: string[], values: any[]) => {
      const seen = new Set(target.map(value => String(value)));
      for (const value of values || []) {
        const text = String(value || '').trim();
        if (text && !seen.has(text)) {
          seen.add(text);
          target.push(text);
        }
      }
    };

    for (const parsed of parsedBatches) {
      if (!parsed || typeof parsed !== 'object') continue;
      uniquePush(merged.aiRelevance.accepted, Array.isArray(parsed.aiRelevance?.accepted) ? parsed.aiRelevance.accepted : []);
      uniquePush(merged.aiRelevance.component, Array.isArray(parsed.aiRelevance?.component) ? parsed.aiRelevance.component : []);
      uniquePush(merged.aiRelevance.borderline, Array.isArray(parsed.aiRelevance?.borderline) ? parsed.aiRelevance.borderline : []);
      uniquePush(merged.aiRelevance.rejected, Array.isArray(parsed.aiRelevance?.rejected) ? parsed.aiRelevance.rejected : []);
      Object.assign(merged.aiRelevance.byPn, parsed.aiRelevance?.byPn || {});
      if (Array.isArray(parsed.feature_map)) merged.feature_map.push(...parsed.feature_map);
      if (Array.isArray(parsed.per_patent_remarks)) merged.per_patent_remarks.push(...parsed.per_patent_remarks);
      const closestMapped = [
        ...(Array.isArray(parsed.novelty_signals?.closest_mapped_references) ? parsed.novelty_signals.closest_mapped_references : []),
        ...(Array.isArray(parsed.novelty_signals?.closest_blocking_references) ? parsed.novelty_signals.closest_blocking_references : [])
      ];
      const potentialDifferentiators = [
        ...(Array.isArray(parsed.novelty_signals?.potential_differentiators) ? parsed.novelty_signals.potential_differentiators : []),
        ...(Array.isArray(parsed.novelty_signals?.features_still_unique) ? parsed.novelty_signals.features_still_unique : [])
      ];
      uniquePush(merged.novelty_signals.closest_mapped_references, closestMapped);
      uniquePush(merged.novelty_signals.closest_blocking_references, closestMapped);
      uniquePush(merged.novelty_signals.features_fully_covered, parsed.novelty_signals?.features_fully_covered || []);
      uniquePush(merged.novelty_signals.potential_differentiators, potentialDifferentiators);
      uniquePush(merged.novelty_signals.features_still_unique, potentialDifferentiators);
      uniquePush(merged.novelty_signals.weak_evidence_areas, parsed.novelty_signals?.weak_evidence_areas || []);
      uniquePush(merged.novelty_signals.recommended_next_actions, parsed.novelty_signals?.recommended_next_actions || []);
      merged.quality_flags.low_evidence = merged.quality_flags.low_evidence || Boolean(parsed.quality_flags?.low_evidence);
      merged.quality_flags.ambiguous_abstracts = merged.quality_flags.ambiguous_abstracts || Boolean(parsed.quality_flags?.ambiguous_abstracts);
      merged.quality_flags.language_mismatch = merged.quality_flags.language_mismatch || Boolean(parsed.quality_flags?.language_mismatch);
      merged.stats.patents_analyzed += Number(parsed.stats?.patents_analyzed || 0);
      merged.stats.features_considered = Math.max(merged.stats.features_considered, Number(parsed.stats?.features_considered || 0));
    }

    return merged;
  }

  // Verbatim check for evidence quotes: a quote is only trusted when it can be found
  // (after normalization) inside the supplied patent title, abstract, or claims text.
  private evidenceQuoteVerifies(quote: string, patentSource: { title?: string; abstract?: string; claimsText?: string }): boolean {
    const normalizedQuote = this.normalizeEvidenceForVerification(String(quote || ''));
    if (!normalizedQuote) return false;
    const normalizedTitle = this.normalizeEvidenceForVerification(String(patentSource?.title || ''));
    const normalizedAbstract = this.normalizeEvidenceForVerification(String(patentSource?.abstract || ''));
    const normalizedClaims = this.normalizeEvidenceForVerification(String(patentSource?.claimsText || ''));
    return normalizedAbstract.includes(normalizedQuote) ||
      normalizedTitle.includes(normalizedQuote) ||
      Boolean(normalizedClaims && normalizedClaims.includes(normalizedQuote));
  }

  private normalizePatentComparisonRows(
    rows: any,
    patentMap: PatentFeatureMap,
    stage0Data: NormalizedIdea,
    patentSource?: { title?: string; abstract?: string; claimsText?: string },
  ): PatentFeatureComparisonRow[] {
    const features = Array.isArray(stage0Data.inventionFeatures) ? stage0Data.inventionFeatures : [];
    const details = this.normalizeFeatureDetails(stage0Data, stage0Data.inventionText || '');
    const detailByFeature = new Map(details.map(detail => [detail.feature, detail]));
    const cells = Array.isArray(patentMap.feature_analysis) ? patentMap.feature_analysis : [];
    const cellByFeature = new Map(cells.map(cell => [cell.feature, cell]));
    const supplied = Array.isArray(rows) ? rows : [];
    const suppliedByFeature = new Map<string, any>();
    const evidenceQuoteFrom = (...values: any[]): string => {
      for (const value of values) {
        if (typeof value === 'string') {
          const text = value.trim();
          if (text) return text;
        }
        if (value && typeof value === 'object') {
          const text = String(value.quote || value.text || value.passage || value.snippet || '').trim();
          if (text) return text;
        }
      }
      return '';
    };
    const evidenceSourceFrom = (value: any): any => {
      if (!value || typeof value !== 'object') return undefined;
      return value.field || value.source || value.evidence_source;
    };
    for (const row of supplied) {
      const feature = String(row?.feature || '').trim();
      if (feature) suppliedByFeature.set(feature, row);
    }

    return features.map((feature, index) => {
      const suppliedRow = suppliedByFeature.get(feature) || {};
      const detail = detailByFeature.get(feature);
      const cell = cellByFeature.get(feature);
      // The comparison rows come straight from the LLM and previously bypassed the
      // evidence verification applied to feature-map cells. When the source patent
      // text is available, reject any supplied quote that is not verbatim from the
      // title/abstract: an unverifiable quote must never carry a Present/Partial
      // claim into the report, so the row falls back to the already-verified cell.
      const suppliedQuote = evidenceQuoteFrom(suppliedRow.evidence_quote, suppliedRow.evidence);
      const suppliedQuoteRejected = Boolean(
        patentSource && suppliedQuote && !this.evidenceQuoteVerifies(suppliedQuote, patentSource)
      );
      const suppliedStatus = this.normalizeFeatureStatus(suppliedRow.status || cell?.status);
      const status = suppliedQuoteRejected && (suppliedStatus === 'Present' || suppliedStatus === 'Partial')
        ? this.normalizeFeatureStatus(cell?.status || 'Unknown')
        : suppliedStatus;
      const evidenceQuote = suppliedQuoteRejected
        ? evidenceQuoteFrom(cell?.quote, cell?.evidence)
        : (suppliedQuote || evidenceQuoteFrom(cell?.quote, cell?.evidence));
      const evidenceSource = this.normalizeEvidenceSource(
        suppliedQuoteRejected
          ? (cell?.evidence_source || cell?.field || evidenceSourceFrom(cell?.evidence))
          : (suppliedRow.evidence_source || evidenceSourceFrom(suppliedRow.evidence) || cell?.evidence_source || cell?.field || evidenceSourceFrom(cell?.evidence)),
        status
      );
      const rawConfidence = this.normalizeScore(suppliedRow.confidence ?? cell?.confidence);
      const confidence = suppliedQuoteRejected && typeof rawConfidence === 'number'
        ? Math.min(rawConfidence, 0.4)
        : rawConfidence;
      const patentDisclosure = String(
        suppliedRow.patent_disclosure ||
        cell?.patent_disclosure ||
        cell?.quote ||
        cell?.reason ||
        (status === 'Present' || status === 'Partial'
          ? 'Available patent data contains related disclosure.'
          : 'No supporting patent data was identified for this feature.')
      ).trim();
      const suppliedExtentScore = this.normalizeScore(
        suppliedQuoteRejected
          ? (cell?.extent_score ?? (cell as any)?.extentScore)
          : (suppliedRow.extent_score ??
            suppliedRow.extentScore ??
            cell?.extent_score ??
            (cell as any)?.extentScore)
      );
      const extentScore = suppliedExtentScore ?? this.defaultFeatureExtentScore(
        status,
        feature,
        confidence,
        patentDisclosure,
        evidenceQuote
      );
      const userDisclosure = String(
        suppliedRow.user_invention_disclosure ||
        cell?.user_invention_disclosure ||
        detail?.user_disclosure ||
        detail?.source_excerpt ||
        feature
      ).trim();
      const noveltyImpact = String(
        suppliedRow.novelty_impact ||
        cell?.novelty_impact ||
        this.defaultNoveltyImpact(status, feature)
      ).trim();
      const crispRemark = String(
        suppliedRow.crisp_remark ||
        cell?.crisp_remark ||
        this.defaultCrispRemark(status, feature, patentDisclosure, evidenceQuote)
      ).trim();
      const professionalRemark = String(
        suppliedRow.professional_remark ||
        cell?.professional_remark ||
        crispRemark ||
        noveltyImpact ||
        this.defaultProfessionalRemark(status, feature, patentDisclosure, evidenceQuote)
      ).trim();

      return {
        feature_id: String(suppliedRow.feature_id || cell?.feature_id || `KF${index + 1}`),
        feature,
        user_invention_disclosure: userDisclosure,
        patent_disclosure: patentDisclosure,
        status,
        evidence_quote: evidenceQuote,
        evidence_source: evidenceSource,
        extent_score: extentScore,
        confidence,
        crisp_remark: crispRemark,
        attorney_remark: String(
          suppliedRow.attorney_remark ||
          cell?.attorney_remark ||
          this.defaultAttorneyRemark(status, feature, patentMap.pn)
        ).trim(),
        novelty_impact: noveltyImpact,
        claim_review_note: String(
          suppliedRow.claim_review_note ||
          cell?.claim_review_note ||
          this.defaultClaimReviewNote(status, feature)
        ).trim(),
        professional_remark: professionalRemark,
      };
    });
  }

  private applyComparisonRowsToFeatureMap(patentMap: PatentFeatureMap, rows: PatentFeatureComparisonRow[]): void {
    if (!patentMap || !Array.isArray(patentMap.feature_analysis) || !Array.isArray(rows)) return;
    const rowByFeature = new Map(rows.map(row => [row.feature, row]));
    for (const cell of patentMap.feature_analysis) {
      const row = rowByFeature.get(cell.feature);
      if (!row) continue;
      cell.feature_id = row.feature_id;
      cell.user_invention_disclosure = row.user_invention_disclosure;
      cell.patent_disclosure = row.patent_disclosure;
      cell.evidence_source = row.evidence_source;
      cell.crisp_remark = row.crisp_remark;
      cell.attorney_remark = row.attorney_remark;
      cell.novelty_impact = row.novelty_impact;
      cell.claim_review_note = row.claim_review_note;
      cell.professional_remark = row.professional_remark;
      if (row.evidence_quote && !cell.quote) cell.quote = row.evidence_quote;
      if (typeof row.extent_score === 'number') cell.extent_score = row.extent_score;
      if (typeof row.confidence === 'number') cell.confidence = row.confidence;
      if (!cell.field && row.evidence_source !== 'none') cell.field = row.evidence_source;
    }
  }

  private normalizeFeatureStatus(value: any): FeatureMapCell['status'] {
    const text = String(value || '').toLowerCase();
    if (text === 'present') return 'Present';
    if (text === 'partial') return 'Partial';
    if (text === 'absent') return 'Absent';
    return 'Unknown';
  }

  private normalizeEvidenceSource(value: any, status: FeatureMapCell['status']): PatentFeatureComparisonRow['evidence_source'] {
    const text = String(value || '').toLowerCase();
    if (text.includes('claim')) return 'claims';
    if (text.includes('title') && text.includes('abstract')) return 'title/abstract';
    if (text.includes('title')) return 'title';
    if (text.includes('abstract')) return 'abstract';
    return (status === 'Present' || status === 'Partial') ? 'title/abstract' : 'none';
  }

  private defaultNoveltyImpact(status: FeatureMapCell['status'], feature: string): string {
    if (status === 'Present') return `Overlap risk: this reference appears to disclose ${feature}; attorney review should identify claim distinctions.`;
    if (status === 'Partial') return `Partial overlap: this reference is related but lacks at least one element of ${feature}.`;
    if (status === 'Absent') return `Potential differentiator: this feature was not expressly taught in the reviewed citation record.`;
    return `Full-text review should verify whether this feature is taught before assigning claim weight.`;
  }

  private defaultAttorneyRemark(status: FeatureMapCell['status'], feature: string, pn?: string): string {
    const reference = pn ? `Reference ${pn}` : 'This reference';
    if (status === 'Present') return `${reference} appears to disclose the same feature in the reviewed citation record: ${feature}.`;
    if (status === 'Partial') return `${reference} is technically related to ${feature}, but at least one required element is not apparent from the reviewed citation record.`;
    if (status === 'Absent') return `${reference} does not expressly teach ${feature}; treat this as a potential distinction, not confirmed novelty.`;
    return `${reference} requires full-text review before ${feature} can be compared reliably.`;
  }

  private defaultCrispRemark(
    status: FeatureMapCell['status'],
    feature: string,
    patentDisclosure = '',
    evidenceQuote = ''
  ): string {
    const disclosure = String(evidenceQuote || patentDisclosure || '').replace(/\s+/g, ' ').trim();
    const shortDisclosure = disclosure
      ? disclosure.length > 90 ? `${disclosure.slice(0, 87).trim()}...` : disclosure
      : '';
    if (status === 'Present') {
      return shortDisclosure
        ? `Mapped overlap: ${shortDisclosure}`
        : `Mapped overlap: this reference discloses ${feature}.`;
    }
    if (status === 'Partial') {
      return `Partial overlap: related disclosure exists, but the full ${feature} is not mapped.`;
    }
    if (status === 'Absent') {
      return `Potential distinction: ${feature} is not disclosed by this reference.`;
    }
    return `Verification needed: available data does not reliably address ${feature}.`;
  }

  private defaultProfessionalRemark(
    status: FeatureMapCell['status'],
    feature: string,
    patentDisclosure = '',
    evidenceQuote = ''
  ): string {
    const disclosure = String(evidenceQuote || patentDisclosure || '').replace(/\s+/g, ' ').trim();
    const shortDisclosure = disclosure.length > 120 ? `${disclosure.slice(0, 117).trim()}...` : disclosure;
    if (status === 'Present') {
      return shortDisclosure
        ? `The reference appears to teach this feature through ${shortDisclosure}. Review the claim wording for narrower technical distinctions before relying on this element.`
        : `The reference appears to teach ${feature}. Review the claim wording for narrower technical distinctions before relying on this element.`;
    }
    if (status === 'Partial') {
      return shortDisclosure
        ? `The reference is directionally related through ${shortDisclosure}, but it does not clearly teach the complete submitted mechanism. Preserve the missing technical element as a claim-review focus.`
        : `The reference is directionally related to ${feature}, but it does not clearly teach the complete submitted mechanism. Preserve the missing technical element as a claim-review focus.`;
    }
    if (status === 'Absent') {
      return `The reviewed citation does not disclose ${feature} in the mapped patent data. This point may support differentiation if confirmed across the closest references and reflected in the invention disclosure.`;
    }
    return `The available record does not allow a reliable comparison for ${feature}. Verify the full patent document before assigning claim weight to this point.`;
  }

  private defaultClaimReviewNote(status: FeatureMapCell['status'], feature: string): string {
    if (status === 'Present') return `Avoid relying on ${feature} alone for independent-claim novelty; identify narrower technical distinctions.`;
    if (status === 'Partial') return `Draft claims around the missing element of ${feature} and verify the full patent documents before relying on it.`;
    if (status === 'Absent') return `Consider emphasizing ${feature}, subject to full patent document prior-art review and enablement support.`;
    return `Request full patent documents or additional inventor detail before forming a claim strategy around ${feature}.`;
  }

  private hasNoHighConfidencePriorArt(stage1Data: any): boolean {
    const visible = Array.isArray(stage1Data?.visiblePriorArtResults)
      ? stage1Data.visiblePriorArtResults
      : (Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : []);
    const reviewableCandidates = this.selectRelevantPatentsForDeepAnalysis(stage1Data, 1);
    return visible.length === 0 &&
      stage1Data?.aiRelevance?.gateStatus === 'complete' &&
      this.getStage1CandidatePool(stage1Data).length > 0 &&
      reviewableCandidates.length === 0;
  }

  private buildNoHighConfidenceStageData(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any
  ): { stage35Data: FeatureMapBatchResult; stage4Data: AggregationResult } {
    const inventionFeatures = Array.isArray(stage0Data?.inventionFeatures) ? stage0Data.inventionFeatures : [];
    const candidatePool = this.getStage1CandidatePool(stage1Data);
    const reviewedCount = Number(stage1Data?.aiRelevance?.reviewedCount ?? stage1Data?.reviewedCount ?? stage1Data?.aiRelevance?.consideredCount ?? 0) || 0;
    const retrievedCount = Number(stage1Data?.aiRelevance?.retrievedCount ?? stage1Data?.retrievedCount ?? candidatePool.length) || candidatePool.length;
    const message = 'No high-overlap candidate was identified among screened preliminary records from the selected sources.';
    const perFeatureUniqueness = inventionFeatures.map(feature => ({
      feature,
      present_in: 0,
      partial_in: 0,
      absent_in: 0,
      uniqueness: 0,
    }));

    const stage35Data: FeatureMapBatchResult = {
      feature_map: [],
      quality_flags: {
        low_evidence: false,
        ambiguous_abstracts: false,
        language_mismatch: false,
      },
      stats: {
        patents_analyzed: 0,
        avg_abstract_length_words: 0,
      },
      noHighConfidencePriorArt: true,
      message,
      retrievedCount,
      reviewedCount,
    };

    const stage4Data: AggregationResult = {
      idea_id: searchId,
      per_patent_coverage: [],
      per_feature_uniqueness: perFeatureUniqueness,
      integration_check: {
        any_single_patent_covers_majority: false,
        explanation: message,
      },
      novelty_score: 0,
      claimConceptMapping: [],
      decision: 'Low Evidence',
      confidence: 'Low',
      risk_factors: [
        `${reviewedCount} candidate${reviewedCount === 1 ? '' : 's'} reviewed by the AI relevance gate.`,
        `${retrievedCount} candidate${retrievedCount === 1 ? '' : 's'} retrieved from the selected patent nationalities.`,
        'No accepted candidate met the visible confidence threshold; broaden sources or review lower-confidence candidates before relying on novelty.',
      ],
      per_patent_remarks: [],
      noHighConfidencePriorArt: true,
      message,
    };

    return { stage35Data, stage4Data };
  }

  private buildStageProgressSnapshot(input: {
    stage: NoveltyStageProgress['stage'];
    status?: NoveltyStageProgress['status'];
    analyzedPatents?: number;
    totalPatents?: number;
    processedBatches?: number;
    batchCount?: number;
    failedBatches?: number;
  }): NoveltyStageProgress {
    const status = input.status || 'running';
    const totalPatents = Math.max(0, Math.trunc(Number(input.totalPatents || 0)));
    const analyzedPatents = Math.min(
      totalPatents,
      Math.max(0, Math.trunc(Number(input.analyzedPatents || 0)))
    );
    const rawPercent = totalPatents > 0 ? Math.round((analyzedPatents / totalPatents) * 100) : 0;
    const percent = status === 'complete'
      ? 100
      : status === 'failed'
        ? rawPercent
        : Math.min(99, rawPercent);
    const label = input.stage === 'relevance_review' ? 'Relevance review' : 'Deep Analysis';

    return {
      stage: input.stage,
      status,
      analyzedPatents,
      totalPatents,
      processedBatches: input.processedBatches,
      batchCount: input.batchCount,
      failedBatches: input.failedBatches,
      percent,
      message: totalPatents > 0
        ? `${label}: ${analyzedPatents} of ${totalPatents} patents analyzed.`
        : `${label}: preparing patents for analysis.`,
      updatedAt: new Date().toISOString(),
    };
  }

  private async persistStage15Progress(
    searchId: string,
    stage1Data: any,
    candidatePool: any[],
    activeCandidates: any[],
    byPn: Record<string, PriorArtGateRecord | undefined>,
    config: NoveltySearchConfig,
    progressMeta: {
      processedBatches: number;
      batchCount: number;
      failedBatches: number;
      status?: NoveltyStageProgress['status'];
    }
  ) {
    try {
      const activeCounts = this.summarizeStage15GateCounts(activeCandidates, byPn);
      const overallCounts = this.summarizeStage15GateCounts(candidatePool, byPn);
      const progress = this.buildStageProgressSnapshot({
        stage: 'relevance_review',
        status: progressMeta.status || 'running',
        analyzedPatents: activeCounts.attemptedGateCount,
        totalPatents: activeCandidates.length,
        processedBatches: progressMeta.processedBatches,
        batchCount: progressMeta.batchCount,
        failedBatches: progressMeta.failedBatches,
      });
      const existingGate = stage1Data?.aiRelevance || {};
      const progressGate = {
        ...existingGate,
        byPn,
        gateStatus: progress.status === 'running' ? 'running' : existingGate.gateStatus,
        consideredCount: overallCounts.reviewedCount,
        reviewedCandidateCount: overallCounts.reviewedCount,
        retrievedCount: overallCounts.retrievedCount,
        attemptedGateCount: overallCounts.attemptedGateCount,
        reviewedCount: overallCounts.reviewedCount,
        gateErrorCount: overallCounts.gateErrorCount,
        unreviewedCount: overallCounts.unreviewedCount,
        totalCandidates: overallCounts.retrievedCount,
        progress,
      };
      const merged = this.mergeStage15Visibility(stage1Data, progressGate, config);
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: { stage1Results: merged as any }
      });
    } catch (error) {
      console.warn('[NoveltyProgress] Failed to persist Stage 1.5 progress:', error);
    }
  }

  private async persistDeepAnalysisProgress(
    searchId: string,
    progress: NoveltyStageProgress,
    options: {
      featureMaps?: PatentFeatureMap[];
      qualityFlags?: FeatureMapBatchResult['quality_flags'];
      extra?: Record<string, any>;
    } = {}
  ) {
    try {
      const featureMaps = Array.isArray(options.featureMaps) ? options.featureMaps : [];
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          stage35Results: {
            feature_map: featureMaps,
            quality_flags: options.qualityFlags || {
              low_evidence: false,
              ambiguous_abstracts: false,
              language_mismatch: false,
            },
            stats: {
              patents_analyzed: progress.analyzedPatents,
              avg_abstract_length_words: 0,
            },
            ...(options.extra || {}),
            progress,
          } as any,
        }
      });
    } catch (error) {
      console.warn('[NoveltyProgress] Failed to persist Deep Analysis progress:', error);
    }
  }

  private async performConsolidatedDeepAnalysis(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: { stage35Data: FeatureMapBatchResult; stage4Data: AggregationResult & Record<string, any>; aiRelevance?: any }; error?: string }> {
    const inventionFeatures = Array.isArray(stage0Data.inventionFeatures) ? stage0Data.inventionFeatures : [];
    if (inventionFeatures.length === 0) return { success: false, error: 'No invention features available.' };
    if (this.hasNoHighConfidencePriorArt(stage1Data)) {
      return {
        success: true,
        data: this.buildNoHighConfidenceStageData(searchId, stage0Data, stage1Data),
      };
    }

    if (config.consolidatedAnalysis?.enabled === false) {
      return { success: false, error: 'Consolidated analysis is disabled by configuration.' };
    }

    const searchRun = await prisma.noveltySearchRun.findUnique({
      where: { id: searchId },
      select: { title: true, inventionDescription: true }
    }).catch(() => null);
    const inventionTitle = stage0Data.title || searchRun?.title || '';
    const inventionDisclosure = stage0Data.inventionText || searchRun?.inventionDescription || '';
    const featureDetails = this.normalizeFeatureDetails(stage0Data, inventionDisclosure);

    const configuredMax = Number(config.consolidatedAnalysis?.maxPatentsForAttorneyReport || config.consolidatedAnalysis?.maxCandidates || 60);
    const maxCandidates = Math.min(Math.max(Number.isFinite(configuredMax) ? configuredMax : 60, 1), 60);
    const adaptiveMode = config.adaptiveAnalysis?.mode || 'observe';
    const screeningClusters = this.buildScreeningQueryClusters(stage0Data);
    if (adaptiveMode !== 'off' && stage1Data?.hasMoreCandidates) {
      const promotedStage1 = this.promotePotentialTierCandidatesForGate(stage1Data, stage0Data, screeningClusters);
      const previousCursor = Number(stage1Data?.aiRelevance?.nextBatchCursor ?? stage1Data?.nextBatchCursor ?? 0);
      const gateCeiling = Math.min(
        this.getStage1CandidatePool(promotedStage1).length,
        Number(config.adaptiveAnalysis?.gateCeiling || 180)
      );
      if (previousCursor < gateCeiling && promotedStage1.preStopTierScan?.promotedTier12Count > 0) {
        const nextGate = await this.performStage15(searchId, stage0Data, promotedStage1, config, requestHeaders, { appendNextBatch: true });
        if (nextGate.success && nextGate.data) {
          stage1Data = this.mergeStage15Visibility(promotedStage1, nextGate.data, config);
          console.info('[AdaptiveScreening]', JSON.stringify({
            event: 'pre_stop_tier_scan_gated',
            searchId,
            promotedTier12Count: promotedStage1.preStopTierScan.promotedTier12Count,
            previousCursor,
            nextCursor: stage1Data?.aiRelevance?.nextBatchCursor ?? stage1Data?.nextBatchCursor,
          }));
        }
      }
    }
    const selected = this.selectRelevantPatentsForDeepAnalysis(stage1Data, maxCandidates);
    if (selected.length === 0) return { success: false, error: 'No relevant candidates available for consolidated analysis.' };

    const initialProfile = this.adaptiveComplexityProfile(stage0Data, []);
    const configuredBatchSize = Math.max(1, Math.min(12, Math.trunc(config.consolidatedAnalysis?.batchSize || 8)));
    const batchSize = adaptiveMode === 'off' ? configuredBatchSize : initialProfile.batchSize;
    const adaptiveMaximum = adaptiveMode === 'enforce'
      ? Math.min(maxCandidates, initialProfile.maximum, Number(config.adaptiveAnalysis?.deepAnalysisCeiling || 60))
      : maxCandidates;
    const normalizedPatentsUnordered = this.normalizePatentsForFeatureMappingV2(selected, selected.length).slice(0, adaptiveMaximum);
    const normalizedPatents = adaptiveMode === 'off'
      ? normalizedPatentsUnordered
      : this.orderAdaptiveCandidates(normalizedPatentsUnordered, stage0Data, screeningClusters, batchSize);
    // Claims-aware deep analysis: hydrate claims text for the primary candidates from
    // the local corpus so the mapping can cite claim language — claims define the
    // protected scope and are stronger evidence than abstract wording. Coverage is
    // partial (see local-patent-claims-service); references without claims are mapped
    // on title/abstract alone and are not distinguished anywhere downstream.
    const claimsTopN = Math.max(0, Math.min(40, Number(process.env.NOVELTY_CLAIMS_TOP_REFS || '6') || 6));
    if (claimsTopN > 0) {
      await this.hydrateClaimsForTopCandidates(normalizedPatents, claimsTopN);
    }
    const concurrency = Math.max(1, Math.min(NOVELTY_LLM_MAX_CONCURRENCY, Math.trunc(config.consolidatedAnalysis?.concurrency || NOVELTY_LLM_CONCURRENCY)));
    // Only 'enforce' must run sequentially, so its saturation check can early-stop
    // after each batch. 'off' and 'observe' process every batch anyway → run in parallel.
    const executionConcurrency = adaptiveMode === 'enforce' ? 1 : concurrency;
    const batches = this.createBatches(normalizedPatents, batchSize);
    const parsedBatches: any[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThoughtTokens = 0;
    let modelClass = '';

    await this.persistDeepAnalysisProgress(
      searchId,
      this.buildStageProgressSnapshot({
        stage: 'deep_analysis',
        analyzedPatents: 0,
        totalPatents: normalizedPatents.length,
        processedBatches: 0,
        batchCount: batches.length,
        failedBatches: 0,
      }),
      {
        extra: {
          attorneyReportPatentLimit: maxCandidates,
          consolidatedBatchCount: batches.length,
        }
      }
    );

    const buildPrompt = (batch: any[]) => {
      const patentBatchText = batch.map((patent, index) => {
        // Untrimmed: the mapping stage must see the full abstract, both so the
        // deciding sentence is never cut and so verbatim evidence quotes verify.
        const abstractWords = String(patent.abstract || '').replace(/\s+/g, ' ').trim();
        return [
          `Reference ${index + 1}:`,
          `Reference ID: ${patent.canonicalPn}`,
          `Type: ${patent.referenceType === 'paper' ? 'Scholarly paper' : 'Patent'}`,
          `Title: ${patent.title}`,
          `Abstract: ${abstractWords || 'N/A'}`,
          ...(patent.claimsText ? [`Claims (excerpt): ${String(patent.claimsText).replace(/\s+/g, ' ').trim()}`] : []),
          ...(patent.referenceType === 'paper' ? [
            `Authors: ${(patent.authors || []).join(', ') || 'N/A'}`,
            `Year/Venue: ${patent.year || ''} ${patent.venue || ''}`.trim(),
            `DOI/URL: ${patent.doi || patent.sourceUrl || patent.link || 'N/A'}`,
            `Source: ${(patent.sourceProviders || [patent.sourceProvider]).filter(Boolean).join(', ') || 'N/A'}`,
          ] : []),
          `Retrieval hints: ${this.formatRetrievalHints(patent) || 'none'}`,
          '---'
        ].join('\n');
      }).join('\n');

      return CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT
        .replace('{invention_features}', JSON.stringify(inventionFeatures))
        .replace('{feature_details}', JSON.stringify(featureDetails))
        .replace('{invention_title}', inventionTitle || 'Untitled invention')
        .replace('{invention_disclosure}', String(inventionDisclosure || '').replace(/\s+/g, ' ').slice(0, 5000))
        .replace('{patent_batch}', patentBatchText);
    };

    const executeBatchAttempt = async (batch: any[], batchIndex: number, prompt: string) => {
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_CONSOLIDATED_ANALYSIS',
          prompt,
          parameters: {
            temperature: 0,
            reasoning_effort: 'low',
          },
        }
      );

      const response = llmResult.response;
      const output = String(response?.output || '').trim();
      if (!llmResult.success || !response || !output) {
        const metadata = response?.metadata || {};
        const model = metadata.modelUsed || response?.modelClass;
        const details = [
          model ? `model=${model}` : '',
          metadata.finishReason ? `finish=${metadata.finishReason}` : '',
          typeof response?.outputTokens === 'number' ? `outputTokens=${response.outputTokens}` : '',
          typeof metadata.thoughtTokens === 'number' ? `thoughtTokens=${metadata.thoughtTokens}` : ''
        ].filter(Boolean).join(', ');
        throw new Error(llmResult.error?.message || `Consolidated analysis batch ${batchIndex + 1} returned empty output${details ? ` (${details})` : ''}.`);
      }

      let parsed: any;
      try {
        parsed = this.parseLLMResponse(output);
      } catch {
        throw new Error(`Consolidated analysis batch ${batchIndex + 1} returned invalid JSON.`);
      }
      if (!parsed || !Array.isArray(parsed.feature_map) || parsed.feature_map.length === 0) {
        throw new Error(`Consolidated analysis batch ${batchIndex + 1} did not return a feature map.`);
      }
      if (!Array.isArray(parsed.per_patent_remarks) || parsed.per_patent_remarks.length === 0) {
        throw new Error(`Consolidated analysis batch ${batchIndex + 1} did not return per-patent remarks.`);
      }

      totalInputTokens += Number((response as any).inputTokens ?? response.metadata?.inputTokens ?? 0);
      totalOutputTokens += Number(response.outputTokens || 0);
      totalThoughtTokens += Number(response.metadata?.thoughtTokens || 0);
      modelClass = modelClass || response.modelClass || '';
      return parsed;
    };

    // A failing batch no longer aborts the whole consolidated stage: retry the LLM
    // call once, then fall back to a deterministic Unknown map for just that batch so
    // the successfully analyzed batches are kept. Only a run where EVERY batch fails
    // still returns failure (and routes to the legacy 3.5a/3.5c chain as before).
    const CONSOLIDATED_BATCH_ATTEMPTS = 2;
    const processBatch = async (batch: any[], batchIndex: number) => {
      const prompt = buildPrompt(batch);
      let lastError: unknown;
      for (let attempt = 1; attempt <= CONSOLIDATED_BATCH_ATTEMPTS; attempt++) {
        try {
          const parsed = await executeBatchAttempt(batch, batchIndex, prompt);
          parsedBatches[batchIndex] = { parsed, prompt, patentCount: batch.length };
          return;
        } catch (error) {
          lastError = error;
          console.warn(`[ConsolidatedAnalysis] Batch ${batchIndex + 1} attempt ${attempt}/${CONSOLIDATED_BATCH_ATTEMPTS} failed:`, error instanceof Error ? error.message : error);
        }
      }
      const fallback = this.createUnknownFeatureMap(batch, inventionFeatures);
      parsedBatches[batchIndex] = {
        parsed: {
          feature_map: fallback.feature_map,
          per_patent_remarks: [],
          quality_flags: fallback.quality_flags,
          stats: fallback.stats,
        },
        prompt,
        patentCount: batch.length,
        fallback: true,
        error: lastError instanceof Error ? lastError.message : String(lastError || 'Unknown batch failure'),
      };
    };

    try {
      for (let index = 0; index < batches.length; index += executionConcurrency) {
        await Promise.all(batches.slice(index, index + executionConcurrency).map((batch, offset) => processBatch(batch, index + offset)));
        const processedBatchCount = parsedBatches.filter(Boolean).length;
        const analyzedPatents = parsedBatches.reduce((sum, item) => sum + Number(item?.patentCount || 0), 0);
        let adaptiveProgress: AdaptiveScreeningProgress | undefined;
        if (adaptiveMode !== 'off') {
          const cumulativeParsed = this.mergeConsolidatedAnalysisBatches(parsedBatches.filter(Boolean).map(item => item.parsed));
          const cumulativeRawMaps = this.validateAndRepairFeatureMaps(
            cumulativeParsed.feature_map,
            normalizedPatents.slice(0, analyzedPatents),
            inventionFeatures
          );
          const cumulativeMaps = cumulativeRawMaps.map(map => {
            const patent = normalizedPatents.find(item => item.canonicalPn === map.pn) || {};
            const gate = this.getGateRecordForPublication(stage1Data?.aiRelevance?.byPn || {}, map.pn);
            return this.decorateTitleAbstractScreeningMap(
              map,
              patent,
              stage0Data,
              gate,
              screeningClusters,
              config.stage35a.criticalFeatures || []
            );
          });
          adaptiveProgress = this.buildAdaptiveScreeningProgress({
            maps: cumulativeMaps,
            stage0Data,
            stage1Data,
            clusters: screeningClusters,
            config,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            thoughtTokens: totalThoughtTokens,
            batchesCompleted: processedBatchCount,
          });
          console.info('[AdaptiveScreening]', JSON.stringify({
            event: 'wave_completed',
            searchId,
            ...adaptiveProgress,
          }));
        }
        await this.persistDeepAnalysisProgress(
          searchId,
          this.buildStageProgressSnapshot({
            stage: 'deep_analysis',
            analyzedPatents,
            totalPatents: normalizedPatents.length,
            processedBatches: processedBatchCount,
            batchCount: batches.length,
            failedBatches: parsedBatches.filter(item => item?.fallback).length,
          }),
          {
            extra: {
              attorneyReportPatentLimit: maxCandidates,
              consolidatedBatchCount: batches.length,
              ...(adaptiveProgress ? { adaptiveScreening: adaptiveProgress } : {}),
            }
          }
        );
        if (adaptiveProgress?.terminalStopReason) {
          console.info('[AdaptiveScreening]', JSON.stringify({
            event: 'enforced_stop',
            searchId,
            stopReason: adaptiveProgress.terminalStopReason,
            analyzedCount: adaptiveProgress.analyzedCount,
          }));
          break;
        }
      }
    } catch (error) {
      const processedBatchCount = parsedBatches.filter(Boolean).length;
      const analyzedPatents = parsedBatches.reduce((sum, item) => sum + Number(item?.patentCount || 0), 0);
      await this.persistDeepAnalysisProgress(
        searchId,
        this.buildStageProgressSnapshot({
          stage: 'deep_analysis',
          status: 'failed',
          analyzedPatents,
          totalPatents: normalizedPatents.length,
          processedBatches: processedBatchCount,
          batchCount: batches.length,
          failedBatches: Math.max(1, batches.length - processedBatchCount),
        }),
        {
          extra: {
            attorneyReportPatentLimit: maxCandidates,
            consolidatedBatchCount: batches.length,
          }
        }
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    const processedBatchEntries = parsedBatches.filter(Boolean);
    const fallbackBatchEntries = processedBatchEntries.filter(item => item.fallback);
    if (fallbackBatchEntries.length > 0 && fallbackBatchEntries.length >= processedBatchEntries.length) {
      // Every batch failed even after retries: preserve the pre-existing behavior of
      // routing the whole run to the legacy 3.5a/3.5c fallback chain.
      return {
        success: false,
        error: `Consolidated analysis failed for all ${fallbackBatchEntries.length} processed batches. Last error: ${fallbackBatchEntries[fallbackBatchEntries.length - 1]?.error || 'unknown'}`
      };
    }
    if (fallbackBatchEntries.length > 0) {
      console.warn(`[ConsolidatedAnalysis] ${fallbackBatchEntries.length}/${processedBatchEntries.length} batches fell back to deterministic Unknown maps after retries.`);
    }

    const parsed = this.mergeConsolidatedAnalysisBatches(processedBatchEntries.map(item => item.parsed));
    const rawFeatureMaps = this.validateAndRepairFeatureMaps(parsed.feature_map, normalizedPatents, inventionFeatures);
    const featureMaps = rawFeatureMaps.map(map => {
      const patent = normalizedPatents.find(item => item.canonicalPn === map.pn) || {};
      const gate = this.getGateRecordForPublication(stage1Data?.aiRelevance?.byPn || {}, map.pn);
      return this.decorateTitleAbstractScreeningMap(
        map,
        patent,
        stage0Data,
        gate,
        screeningClusters,
        config.stage35a.criticalFeatures || []
      );
    });
    if (featureMaps.length === 0) {
      return { success: false, error: 'Consolidated feature map did not match selected patents.' };
    }

    const remarkByPn = new Map<string, any>();
    for (const remark of parsed.per_patent_remarks) {
      const key = this.canonicalPatentNumber(remark?.pn);
      if (key) remarkByPn.set(key, remark);
    }
    const patentByCanonicalPn = new Map(normalizedPatents.map((item: any) => [item.canonicalPn, item]));
    const remarks: PerPatentRemark[] = featureMaps.map((map: any) => {
      const key = this.canonicalPatentNumber(map.pn);
      const parsedRemark = remarkByPn.get(key);
      if (parsedRemark) {
        const comparisonRows = this.normalizePatentComparisonRows(
          parsedRemark.comparison_rows,
          map,
          stage0Data,
          patentByCanonicalPn.get(map.pn) || patentByCanonicalPn.get(key)
        );
        this.applyComparisonRowsToFeatureMap(map, comparisonRows);
        return {
          pn: map.pn,
          title: parsedRemark.title || map.title,
          abstract: parsedRemark.abstract,
          remarks: parsedRemark.remarks || parsedRemark.summary || '',
          overlap_features: Array.isArray(parsedRemark.overlap_features) ? parsedRemark.overlap_features : [],
          missing_features: Array.isArray(parsedRemark.missing_features) ? parsedRemark.missing_features : [],
          potential_differentiators: Array.isArray(parsedRemark.potential_differentiators)
            ? parsedRemark.potential_differentiators
            : (Array.isArray(parsedRemark.novelty_points) ? parsedRemark.novelty_points : []),
          novelty_points: Array.isArray(parsedRemark.novelty_points)
            ? parsedRemark.novelty_points
            : (Array.isArray(parsedRemark.potential_differentiators) ? parsedRemark.potential_differentiators : []),
          confidence: typeof parsedRemark.confidence === 'number' ? parsedRemark.confidence : undefined,
          relevance: typeof parsedRemark.relevance === 'number' ? parsedRemark.relevance : undefined,
          novelty_threat: ['high_overlap', 'moderate_overlap', 'related', 'low_overlap', 'anticipates', 'obvious', 'adjacent', 'remote'].includes(parsedRemark.novelty_threat)
            ? parsedRemark.novelty_threat
            : undefined,
          summary: parsedRemark.summary || parsedRemark.remarks || undefined,
          comparison_rows: comparisonRows,
          detailedAnalysis: parsedRemark.detailedAnalysis,
          decision: parsedRemark.decision
        } as PerPatentRemark;
      }
      const fallbackRemark = this.buildDeterministicPerPatentRemarks(stage0Data, { feature_map: [map], quality_flags: { low_evidence: false, ambiguous_abstracts: false, language_mismatch: false }, stats: { patents_analyzed: 1, avg_abstract_length_words: 0 } }, 1)[0];
      this.applyComparisonRowsToFeatureMap(map, fallbackRemark?.comparison_rows || []);
      return fallbackRemark;
    });

    if (remarks.some(remark => !remark || !remark.pn || !(remark.summary || remark.remarks || remark.detailedAnalysis))) {
      return { success: false, error: 'Consolidated remarks failed validation.' };
    }

    const parsedQualityFlags = parsed.quality_flags && typeof parsed.quality_flags === 'object'
      ? {
        low_evidence: Boolean(parsed.quality_flags.low_evidence),
        ambiguous_abstracts: Boolean(parsed.quality_flags.ambiguous_abstracts),
        language_mismatch: Boolean(parsed.quality_flags.language_mismatch)
      }
      : this.calculateQualityFlags(featureMaps, normalizedPatents);
    const deterministicEvidenceQuality = this.titleAbstractEvidenceQuality(featureMaps, stage0Data, screeningClusters);
    const qualityFlags = {
      ...parsedQualityFlags,
      low_evidence: parsedQualityFlags.low_evidence || deterministicEvidenceQuality.low || stage1Data?.aiRelevance?.gateStatus !== 'complete',
    };
    const stats = {
      ...this.calculateFeatureMappingStats(featureMaps, normalizedPatents),
      ...(parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}),
      patents_analyzed: featureMaps.length
    };
    const executedBatchCount = parsedBatches.filter(Boolean).length;
    const adaptiveScreening = this.buildAdaptiveScreeningProgress({
      maps: featureMaps,
      stage0Data,
      stage1Data,
      clusters: screeningClusters,
      config,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      thoughtTokens: totalThoughtTokens,
      batchesCompleted: executedBatchCount,
    });
    console.info('[AdaptiveScreening]', JSON.stringify({
      event: 'evaluation_completed',
      searchId,
      ...adaptiveScreening,
    }));
    const stage35Data: FeatureMapBatchResult = {
      feature_map: featureMaps,
      quality_flags: qualityFlags,
      stats,
      adaptiveScreening,
      attorneyReportPatentLimit: maxCandidates,
      consolidatedBatchCount: executedBatchCount,
      progress: this.buildStageProgressSnapshot({
        stage: 'deep_analysis',
        status: 'complete',
        analyzedPatents: featureMaps.length,
        totalPatents: normalizedPatents.length,
        processedBatches: executedBatchCount,
        batchCount: batches.length,
        failedBatches: 0,
      })
    } as FeatureMapBatchResult & Record<string, any>;

    const aggregation = await this.performStage35b(searchId, stage0Data, stage35Data, config, requestHeaders);
    if (!aggregation.success || !aggregation.data) {
      return { success: false, error: aggregation.error || 'Consolidated aggregation failed.' };
    }

    const noveltySignals = parsed.novelty_signals && typeof parsed.novelty_signals === 'object'
      ? parsed.novelty_signals
      : this.buildNoveltySignalsFromAnalysis(featureMaps, remarks, inventionFeatures);
    const stage4Data = {
      ...(aggregation.data as any),
      per_patent_remarks: remarks,
      novelty_signals: noveltySignals,
      per_patent_remarks_source: 'consolidated_deep_analysis',
      consolidated_deep_analysis_complete: true,
      consolidated_deep_analysis_completed_at: new Date().toISOString(),
      consolidated_batch_count: executedBatchCount,
      attorney_report_patent_count: featureMaps.length,
      adaptiveScreening,
      screeningStopReason: adaptiveScreening.terminalStopReason,
      projectedScreeningStopReason: adaptiveScreening.projectedStopReason,
      combinationRiskSignal: Number((aggregation.data as any).distributed_component_coverage || 0) >= 0.5,
      stage35c_complete: true
    } as AggregationResult & Record<string, any>;

    await prisma.noveltySearchLLMCall.create({
      data: {
        searchId,
        stage: NoveltySearchStage.STAGE_3_5,
        taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
        prompt: parsedBatches.map(item => item.prompt).join('\n\n--- BATCH BREAK ---\n\n'),
        response: parsed as any,
        tokensUsed: totalOutputTokens,
        modelClass,
      },
    });

    return {
      success: true,
      data: {
        stage35Data,
        stage4Data,
        aiRelevance: stage1Data?.aiRelevance,
      }
    };
  }

  /**
   * Stage 1.5: AI relevance gate on retrieved patent results.
   * Produces a compact accept/borderline/reject list and a byPn map of scores.
   */
  private parseStage15GateResponse(output: string): any[] | null {
    const text = String(output || '').trim();
    if (!text) return null;

    const normalize = (value: any): any[] | null => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') {
        for (const key of ['results', 'items', 'candidates', 'patents', 'data']) {
          if (Array.isArray(value[key])) return value[key];
        }
      }
      return null;
    };

    const sanitize = (candidate: string) => candidate
      .trim()
      .replace(/^\uFEFF/, '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');

    const tryParse = (candidate: string): any[] | null => {
      try {
        return normalize(JSON.parse(candidate));
      } catch {
        try {
          return normalize(JSON.parse(sanitize(candidate)));
        } catch {
          return null;
        }
      }
    };

    const candidates = [text];
    const fence = text.match(/```(?:json|jsonc)?\s*\n?([\s\S]*?)\n?\s*```/i);
    if (fence?.[1]) candidates.unshift(fence[1].trim());

    for (const candidate of candidates) {
      const direct = tryParse(candidate);
      if (direct) return direct;

      const arrayText = this.extractBalancedJSONArray(candidate);
      if (arrayText) {
        const parsedArray = tryParse(arrayText);
        if (parsedArray) return parsedArray;
      }
    }

    try {
      return normalize(this.parseLLMResponse(output));
    } catch {
      return null;
    }
  }

  private extractBalancedJSONArray(text: string): string | null {
    const start = text.indexOf('[');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '[') depth += 1;
      if (ch === ']') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return null;
  }

  private coerceGateScore(record: any): number {
    const raw = record?.score ?? record?.rerankScore ?? record?.relevanceScore ?? record?.relevance;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  }

  private indexStage15ParsedRows(parsed: any[]): Record<string, any> {
    const batchMap: Record<string, any> = {};
    if (!Array.isArray(parsed)) return batchMap;

    for (const row of parsed) {
      const pn = row?.pn || row?.publicationNumber || row?.publication_number || row?.id;
      const k = String(pn || '').toUpperCase();
      if (k) batchMap[k] = row;
      const canonical = canonicalPriorArtNumber(pn);
      if (canonical) batchMap[canonical] = row;
    }

    return batchMap;
  }

  private isBroadStage15Feature(value: string): boolean {
    const tokens = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) return true;

    const genericTerms = new Set([
      'app',
      'algorithm',
      'coating',
      'composition',
      'controller',
      'device',
      'film',
      'layer',
      'marker',
      'method',
      'module',
      'platform',
      'polymer',
      'sensor',
      'server',
      'system',
    ]);
    const fillerTerms = new Set([
      'a',
      'an',
      'and',
      'based',
      'for',
      'in',
      'of',
      'optional',
      'the',
      'with',
    ]);
    const meaningful = tokens.filter(token => !genericTerms.has(token) && !fillerTerms.has(token));
    return meaningful.length === 0;
  }

  private buildStage15AtomicFeatures(stage0Data: NormalizedIdea): string[] {
    const seen = new Set<string>();
    const features: Array<{ text: string; importance: 'core' | 'major' | 'peripheral' }> = [];
    const add = (value: unknown, importance: 'core' | 'major' | 'peripheral' = 'major') => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key) || this.isBroadStage15Feature(text)) return false;
      seen.add(key);
      features.push({ text, importance });
      return true;
    };

    (Array.isArray(stage0Data.featureDetails) ? stage0Data.featureDetails : []).forEach(detail => {
      const featureType = String(detail?.feature_type || '').toLowerCase();
      const importance = featureType === 'core_technical'
        ? 'core'
        : featureType === 'generic_weak'
          ? 'peripheral'
          : 'major';
      add(detail?.feature, importance);
    });
    let acceptedFallbackFeatureCount = 0;
    (Array.isArray(stage0Data.inventionFeatures) ? stage0Data.inventionFeatures : []).forEach(feature => {
      const added = add(feature, acceptedFallbackFeatureCount < 2 ? 'core' : 'major');
      if (added) acceptedFallbackFeatureCount += 1;
    });
    (Array.isArray(stage0Data.noveltyFocus) ? stage0Data.noveltyFocus : []).forEach(feature => add(feature, 'core'));

    return features.slice(0, 12).map((feature, index) => `F${index + 1} [${feature.importance}]: ${feature.text}`);
  }

  private async performStage15(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>,
    options?: { appendNextBatch?: boolean }
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const candidatePool = this.getStage1CandidatePool(stage1Data);
      if (candidatePool.length === 0) return { success: true, data: { accepted: [], component: [], borderline: [], rejected: [], byPn: {} } };

      const {
        thresholds,
        borderlineQuota,
        maxCandidates,
        batchSize,
        concurrency,
        timeoutMs,
        visibleLimit,
        minimumVisibleConfidence,
      } = config.stage15;
      const features = this.buildStage15AtomicFeatures(stage0Data);
      const existingGate = stage1Data?.aiRelevance || {};
      const existingByPn: Record<string, PriorArtGateRecord | undefined> = options?.appendNextBatch
        ? { ...(existingGate.byPn || {}) }
        : {};
      const previousVisibleLimit = Math.max(
        DEFAULT_VISIBLE_PRIOR_ART_LIMIT,
        Number(stage1Data?.visibleResultLimit || existingGate.visibleResultLimit || visibleLimit || DEFAULT_VISIBLE_PRIOR_ART_LIMIT)
      );
      const targetVisibleLimit = options?.appendNextBatch
        ? previousVisibleLimit + Math.max(1, visibleLimit || DEFAULT_VISIBLE_PRIOR_ART_LIMIT)
        : previousVisibleLimit;
      const highConfidenceAlreadyGated = buildVisiblePriorArtResults({
        candidates: candidatePool,
        byPn: existingByPn,
        minimumVisibleConfidence,
        visibleLimit: Number.MAX_SAFE_INTEGER,
      }).highConfidenceCount;

      let startIndex = options?.appendNextBatch
        ? Math.max(0, Math.min(candidatePool.length, Number(existingGate.nextBatchCursor ?? existingGate.consideredCount ?? 0)))
        : 0;

      if (options?.appendNextBatch && highConfidenceAlreadyGated > previousVisibleLimit) {
        startIndex = candidatePool.length;
      }

      const candidates = startIndex >= candidatePool.length
        ? []
        : candidatePool.slice(startIndex, Math.min(candidatePool.length, startIndex + Math.max(1, maxCandidates)));
      const cacheKey = this.createStage15CacheKey(stage0Data, candidates);
      if (!options?.appendNextBatch && this.canReuseStage15Gate(stage1Data, cacheKey)) {
        return { success: true, data: stage1Data.aiRelevance };
      }

      // Build batch prompt (10-20 items) so the model returns an array of results
      const buildBatchPrompt = (batch: any[]) => {
        const feats = JSON.stringify(features);
        const norm = (v: any, max = 800) => String(v || '').replace(/\s+/g, ' ').substring(0, max);
        // Abstracts are passed untrimmed: truncation can cut the exact sentence the
        // gate decision depends on, and patent abstracts are naturally bounded.
        const normFull = (v: any) => String(v || '').replace(/\s+/g, ' ').trim();
        const items = batch.map((it, idx) => {
          const pn = it.publication_number || it.publicationNumber || it.pn || it.id || '';
          const title = norm(it.title || '');
          const abstract = normFull(it.snippet || it.abstract || it.description || '');
          const retrievalHints = this.formatRetrievalHints(it);
          const referenceType = it.referenceType === 'paper' ? 'Scholarly paper' : 'Patent';
          const paperMetadata = it.referenceType === 'paper'
            ? `\nAuthors: ${norm((it.authors || []).join(', '), 300)}\nYear/Venue: ${norm(`${it.year || ''} ${it.venue || ''}`, 240)}\nDOI/URL: ${norm(it.doi || it.sourceUrl || it.link || '', 300)}\nSource: ${norm((it.sourceProviders || [it.sourceProvider]).join(', '), 200)}`
            : '';
          return `Item ${idx + 1}\nReference ID: ${pn}\nType: ${referenceType}\nTitle: ${title}\nAbstract: ${abstract}${paperMetadata}\nRetrieval hints: ${retrievalHints || 'none'}`;
        }).join("\n---\n");

        return [
          'You are a novelty relevance gate for patent and scholarly-paper prior art. Return ONLY a valid JSON array.',
          `Invention features: ${feats}`,
          '',
          'The invention features should be atomic, preferably with feature IDs and importance labels such as core, major, or peripheral.',
          'Example structure:',
          '- F1: core technical object/form factor',
          '- F2: core mechanism',
          '- F3: major subsystem/material/layer/module',
          '- F4: control/process/release/detection/verification mechanism',
          '- F5: optional or peripheral implementation detail',
          '',
          'Your job is to decide whether each prior-art reference should proceed to deep novelty mapping. This is not a final patentability opinion. Keep references that may be useful for novelty, inventive-step, component mapping, or bounded attorney review.',
          '',
          'Decision policy:',
          '- accept: the supplied patent data discloses the same or very close invention-level combination, including substantially the same technical purpose, same object/material/data target, and same operating mechanism.',
          '- component: the supplied patent data concretely discloses at least one meaningful atomic invention feature, subsystem, material structure, layer arrangement, module, process step, release mechanism, detection mechanism, indicator mechanism, compliance mechanism, control mechanism, verification mechanism, manufacturing step, or implementation detail, even if the full invention combination is missing.',
          '- borderline: the supplied patent data has a weak, adjacent, ambiguous, partial, or transferable relationship that may still help bounded attorney review.',
          '- reject: remote keyword hit, generic field reference, duplicate noise with no new useful detail, or no concrete technical overlap with any atomic invention feature.',
          '',
          'Score policy:',
          '- Score means usefulness for deep novelty mapping, including full invention overlap, concrete component overlap, and bounded attorney-review relevance.',
          '- Score does not mean only full-invention anticipation.',
          '- Component references may receive moderate or high scores if the disclosed component is technically meaningful.',
          '- Do not reject a concrete component disclosure merely because it lacks the full invention combination.',
          '- Full invention overlap is not required for component.',
          '- Same technical purpose, same object/material/data target, and same operating mechanism are required only for accept, not for component.',
          '- If the supplied patent data concretely supports one or more atomic invention features, classify as component unless the overlap is merely generic.',
          '- If the overlap is generic only, such as device, system, composition, layer, module, sensor, controller, polymer, marker, app, server, algorithm, coating, film, dosage form, platform, or method without meaningful technical role or mechanism, classify as borderline or reject.',
          '',
          'Suggested score calibration:',
          '- accept: 0.70-1.00 for same or close full invention-level combination.',
          '- component: 0.40-0.85 for concrete technical component overlap. Component can overlap with accept scores.',
          '- borderline: 0.20-0.45 for adjacent, weak, ambiguous, or transferable overlap.',
          '- reject: 0.00-0.25 for remote, generic, duplicate noise, or no concrete atomic feature support.',
          '',
          'Component-salvage rule:',
          '- Keep as component if the supplied patent data concretely discloses an atomic invention feature, subsystem, material structure, layer arrangement, module architecture, process step, release mechanism, detection mechanism, indicator mechanism, compliance mechanism, control mechanism, verification marker, manufacturing method, or implementation detail.',
          '- A component decision means the reference is useful for mapping one part of the invention; it does not mean the full invention is disclosed or anticipated.',
          '- A reference may be component even when it belongs to a different embodiment, product type, form factor, or application area, provided the disclosed technical mechanism clearly maps to an atomic invention feature.',
          '- Do not keep as component merely because the reference shares a broad field, environment, purpose, or keyword.',
          '',
          'Form-factor and object-target rule:',
          '- If the reference uses a different form factor, product type, material target, data target, biological target, or operating environment, downgrade by at least one level unless the supplied patent data discloses a technical mechanism that directly maps to an atomic invention feature.',
          '- A different form factor with the same component performing the same technical function may be component.',
          '- A different form factor with only broad purpose similarity should be borderline or reject.',
          '- Do not label a different-form-factor reference as accept unless the core feature combination and operating mechanism are still substantially the same.',
          '',
          'Generic example classifications:',
          '- Reference discloses the same product/system/process with the same core feature combination and same operating mechanism: accept, because it may anticipate the invention-level concept.',
          '- Reference discloses the same technical problem and same solution architecture, but misses one optional or peripheral feature: accept or high component, depending on how central the missing feature is.',
          '- Reference discloses one major subsystem, layer, module, material, chemical composition, control step, sensor arrangement, release mechanism, detection mechanism, verification mechanism, or manufacturing step from the invention: component, even if the full invention is absent.',
          '- Reference discloses a known implementation detail that could be combined with other references to challenge inventive step: component, provided the supplied patent data concretely supports the detail.',
          '- Reference discloses the same result or purpose but uses a different object, material target, data target, mechanism, or technical route: borderline, unless a concrete atomic feature is still present.',
          '- Reference uses similar words from the same broad field but does not disclose any concrete atomic invention feature: reject.',
          '- Reference discloses only a generic version of a term such as device, system, composition, layer, module, sensor, controller, polymer, marker, app, server, algorithm, or coating without technical role or mechanism: reject or borderline.',
          '- Reference is from an adjacent field and has a transferable mechanism that maps to one atomic feature: borderline or component, depending on how clearly the mechanism is disclosed.',
          '- Reference is from an adjacent field and only shares a broad purpose or keyword: reject.',
          '- Reference discloses a diagnostic, testing, packaging, monitoring, or support tool related to the same environment but not the invention object or mechanism: borderline or reject.',
          '- Reference discloses the same material or component but for a completely different function with no clear transferability: borderline or reject.',
          '- Reference discloses the same component performing the same function in a different form factor: component, but not accept unless the invention-level combination is also present.',
          '- Reference discloses a broad platform that could include the invention but does not concretely disclose the relevant features in the supplied patent data: borderline or reject.',
          '- Reference discloses a narrower embodiment of one invention feature with strong technical detail: component, even if its score is below accept range.',
          '- Reference appears to be a duplicate family member of an already accepted/component reference: component or borderline, but assign lower score unless it adds new technical detail.',
          '',
          'Evidence quality:',
          '- high: supplied patent data explicitly names the matched atomic technical feature or a close technical synonym.',
          '- medium: supplied patent data clearly implies the matched feature through a described technical mechanism.',
          '- low: broad field similarity, ambiguous wording, indirect relation, or weak transferable analogy only.',
          '',
          'Deep mapping rule:',
          '- accept and component decisions should proceed to deep mapping.',
          '- borderline decisions may proceed to bounded deep mapping, preferably capped by score, evidence quality, or top-N selection.',
          '- reject decisions should not proceed to deep mapping.',
          '- Decision should dominate score. Do not discard component references only because their score is below the accept range.',
          '- Reject only when the supplied patent data lacks concrete support for any atomic invention feature.',
          '',
          'Output requirements:',
          'Each array element must be:',
          '{"pn":"<id>","score":0..1,"decision":"accept|component|borderline|reject","matched_features":["feature_id_or_exact_feature_label"],"missing_features":["feature_id_or_exact_feature_label"],"reason":"<=18 words","evidence_quality":"high|medium|low"}',
          '',
          'Rules:',
          '- Use only the supplied reference data fields.',
          '- Retrieval hints are not evidence; use them only to focus review.',
          '- Do not copy hinted matched features unless the supplied patent data supports them.',
          '- In reason, do not name the source-field limitation or use early-stage-review wording. Use reviewed citation record if scope must be mentioned.',
          '- matched_features must contain only feature IDs or exact feature labels from the provided invention feature list.',
          '- Do not invent new feature names in matched_features.',
          '- Use reasonable technical synonyms when matching features.',
          '- Prefer rejecting remote keyword hits, but do not reject concrete component disclosures merely because they lack the full invention combination.',
          '- Keep JSON compact.',
          '- Do not include prose outside the JSON array.',
          '- Follow input order.',
          '',
          items
        ].join('\n');
      };

      const byPn: Record<string, PriorArtGateRecord> = { ...(existingByPn as Record<string, PriorArtGateRecord>) };
      const safeBatchSize = Math.max(1, Math.trunc(batchSize || 12));
      const safeConcurrency = Math.max(1, Math.min(NOVELTY_LLM_MAX_CONCURRENCY, Math.trunc(concurrency || NOVELTY_LLM_CONCURRENCY)));
      const budgetMs = Math.max(10000, Math.trunc(timeoutMs || 90000));
      const startedAt = Date.now();
      const batches = this.createBatches(candidates, safeBatchSize);
      let failedBatches = 0;
      let processedBatches = 0;
      let timedOut = false;

      await this.persistStage15Progress(searchId, stage1Data, candidatePool, candidates, byPn, config, {
        processedBatches,
        batchCount: batches.length,
        failedBatches,
      });

      const markBatchGateError = (
        batch: any[],
        gateError: NonNullable<PriorArtGateRecord['gateError']>,
        reason: string
      ) => {
        for (const item of batch) {
          const pnRaw = getPriorArtPublicationNumber(item) || 'Unknown';
          const record: PriorArtGateRecord = {
            pn: pnRaw,
            score: 0.2,
            rerankScore: 0.2,
            decision: 'borderline',
            matched_features: [],
            missing_features: features,
            reason,
            evidence_quality: 'low',
            reviewStatus: 'gate_error',
            gateError,
          };
          byPn[String(pnRaw)] = record;
          byPn[String(pnRaw).toUpperCase()] = record;
          const canonical = canonicalPriorArtNumber(pnRaw);
          if (canonical) byPn[canonical] = record;
        }
      };

      const processBatch = async (batch: any[]) => {
        const remainingMs = budgetMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          timedOut = true;
          failedBatches += 1;
          markBatchGateError(batch, 'timeout', 'AI relevance gate timed out before this batch could be reviewed.');
          return;
        }

        let parsed: any[] | null = null;
        try {
          const prompt = buildBatchPrompt(batch);
          const perCallTimeoutMs = Math.max(
            1000,
            Math.min(remainingMs, Math.max(45000, Math.floor(budgetMs * 0.75)))
          );
          const res = await Promise.race([
            llmGateway.executeLLMOperation(
              { headers: requestHeaders || {} },
              {
                taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
                stageCode: 'NOVELTY_COMPARISON',
                prompt,
                parameters: {
                  reasoning_effort: 'low',
                  temperature: 0,
                },
              }
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('LLM call timeout')), perCallTimeoutMs)
            )
          ]) as { success: boolean; response?: any; error?: any };
          if (res.success && res.response?.output) {
            parsed = this.parseStage15GateResponse(res.response.output);
          }
        } catch (error) {
          console.warn(`Stage 1.5 batch LLM call failed for batch of ${batch.length} items:`, error);
          failedBatches += 1;
          const isTimeout = error instanceof Error && /timeout/i.test(error.message);
          markBatchGateError(
            batch,
            isTimeout ? 'timeout' : 'llm_error',
            isTimeout ? 'AI relevance gate timed out for this batch.' : 'AI relevance gate failed for this batch.'
          );
          return;
        }
        if (!parsed) {
          failedBatches += 1;
          markBatchGateError(batch, 'parse_error', 'AI relevance gate returned unparseable JSON for this batch.');
          return;
        }

        // Index parsed results by pn for quick lookup
        const batchMap = this.indexStage15ParsedRows(parsed);

        // Consolidate each item. Missing or malformed LLM rows are retained as low-confidence review items.
        for (const item of batch) {
          const pnRaw = getPriorArtPublicationNumber(item) || 'Unknown';
          const k = String(pnRaw).toUpperCase();
          const found = batchMap[k] || batchMap[canonicalPriorArtNumber(pnRaw)];
          if (!found) {
            const record: PriorArtGateRecord = {
              pn: String(pnRaw),
              score: 0.2,
              rerankScore: 0.2,
              decision: 'borderline',
              matched_features: [],
              missing_features: features,
              reason: 'AI relevance gate missed this row; retain for bounded review.',
              evidence_quality: 'low',
              reviewStatus: 'gate_error',
              gateError: 'missing_candidate_row',
            };
            byPn[String(pnRaw)] = record;
            byPn[k] = record;
            const canonical = canonicalPriorArtNumber(pnRaw);
            if (canonical) byPn[canonical] = record;
            continue;
          }
          const rawDecision = typeof found?.decision === 'string' && found.decision.trim()
            ? found.decision
            : (typeof found?.rerankDecision === 'string' && found.rerankDecision.trim() ? found.rerankDecision : '');
          const rawScore = found?.score ?? found?.rerankScore ?? found?.relevanceScore ?? found?.relevance;
          const decision = rawDecision ? normalizeRerankDecision(rawDecision) : 'borderline';
          const score = rawScore === undefined || rawScore === null || rawScore === ''
            ? (decision === 'borderline' ? 0.2 : 0)
            : this.coerceGateScore(found);
          const record: PriorArtGateRecord = {
            pn: String(pnRaw),
            score,
            rerankScore: score,
            decision,
            matched_features: Array.isArray(found?.matched_features) ? found.matched_features : [],
            missing_features: Array.isArray(found?.missing_features) ? found.missing_features : [],
            reason: typeof found?.reason === 'string' ? found.reason : 'AI relevance gate did not return evidence for this candidate.',
            evidence_quality: typeof found?.evidence_quality === 'string' ? found.evidence_quality : 'low',
            reviewStatus: 'reviewed',
          };
          byPn[String(pnRaw)] = record;
          byPn[k] = record;
          const canonical = canonicalPriorArtNumber(pnRaw);
          if (canonical) byPn[canonical] = record;
        }
        processedBatches += 1;
      };

      for (let index = 0; index < batches.length; index += safeConcurrency) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= budgetMs) {
          timedOut = true;
          for (const batch of batches.slice(index)) {
            failedBatches += 1;
            markBatchGateError(batch, 'timeout', 'AI relevance gate timed out before this batch could be reviewed.');
          }
          break;
        }
        await Promise.all(batches.slice(index, index + safeConcurrency).map(processBatch));
        await this.persistStage15Progress(searchId, stage1Data, candidatePool, candidates, byPn, config, {
          processedBatches,
          batchCount: batches.length,
          failedBatches,
        });
      }

      const nextBatchCursor = Math.min(candidatePool.length, startIndex + candidates.length);
      const decisionLists = this.buildStage15DecisionLists(candidatePool, byPn, borderlineQuota);
      const visibility = buildVisiblePriorArtResults({
        candidates: candidatePool,
        byPn,
        minimumVisibleConfidence,
        visibleLimit: targetVisibleLimit,
      });
      const totalBatches = batches.length;
      const gateStatus = totalBatches > 0 && failedBatches >= totalBatches
        ? 'failed'
        : (failedBatches > 0 || timedOut ? 'partial' : 'complete');
      const hasMoreCandidates = nextBatchCursor < candidatePool.length || visibility.highConfidenceCount > visibility.visiblePriorArtResults.length;
      const gateCounts = this.summarizeStage15GateCounts(candidatePool, byPn);
      const activeCounts = this.summarizeStage15GateCounts(candidates, byPn);

      return {
        success: true,
        data: {
          accepted: decisionLists.accepted,
          component: decisionLists.component,
          borderline: decisionLists.borderline,
          rejected: decisionLists.rejected,
          byPn,
          thresholds,
          consideredCount: gateCounts.reviewedCount,
          reviewedCandidateCount: gateCounts.reviewedCount,
          retrievedCount: gateCounts.retrievedCount,
          attemptedGateCount: gateCounts.attemptedGateCount,
          reviewedCount: gateCounts.reviewedCount,
          gateErrorCount: gateCounts.gateErrorCount,
          unreviewedCount: gateCounts.unreviewedCount,
          totalCandidates: gateCounts.retrievedCount,
          boundedToTopCandidates: nextBatchCursor < candidatePool.length,
          cacheKey,
          gateStatus,
          failedBatches,
          processedBatches,
          batchCount: totalBatches,
          nextBatchCursor,
          hasMoreCandidates,
          minimumVisibleConfidence,
          visibleResultLimit: targetVisibleLimit,
          visiblePublicationNumbers: visibility.visiblePublicationNumbers,
          visibleCount: visibility.visiblePriorArtResults.length,
          highConfidenceCount: visibility.highConfidenceCount,
          hiddenCandidateCount: visibility.hiddenCandidateCount,
          progress: this.buildStageProgressSnapshot({
            stage: 'relevance_review',
            status: 'complete',
            analyzedPatents: activeCounts.attemptedGateCount,
            totalPatents: candidates.length,
            processedBatches,
            batchCount: totalBatches,
            failedBatches,
          }),
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Stage 1.5 gating failed' };
    }
  }

  private async performStage35a(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: FeatureMapBatchResult; error?: string }> {
    try {
      console.log('ðŸ”¬ Starting Stage 3.5a: Feature Mapping Engine');

      const pqaiResults = this.selectRelevantPatentsForDeepAnalysis(
        stage1Data,
        Math.max(1, config.stage35a.maxRefsTotal || 20)
      );
      const inventionFeatures = stage0Data.inventionFeatures || [];

      if (pqaiResults.length === 0) {
        if (this.hasNoHighConfidencePriorArt(stage1Data)) {
          return {
            success: true,
            data: this.buildNoHighConfidenceStageData(searchId, stage0Data, stage1Data).stage35Data,
          };
        }
        return { success: false, error: 'No high-confidence prior art results available for feature mapping' };
      }

      if (inventionFeatures.length === 0) {
        return { success: false, error: 'No invention features available for mapping' };
      }

      // Stage 1.5 already orders candidates by match quality:
      // direct invention-level matches first, then component/feature-level matches,
      // then borderline references. Keep that ordering and only enforce the
      // configured mapping cap here.
      const totalPatents = pqaiResults.length;
      const selectedCount = Math.min(
        totalPatents,
        Math.max(1, Math.min(Math.trunc(config.stage35a.maxRefsTotal || 20), 20))
      );

      console.log(`ðŸŽ¯ PATENT SELECTION LOGIC:`);
      console.log(`   - Total patents available: ${totalPatents}`);
      console.log(`   - Stage 1.5 ordered direct, component, then borderline matches`);
      console.log(`   - Mapping cap applied: ${selectedCount} patents`);
      console.log(`   - Selection percentage: ${((selectedCount/totalPatents)*100).toFixed(1)}%`);

      const gate = (stage1Data && (stage1Data as any).aiRelevance) ? (stage1Data as any).aiRelevance : null;
      console.log('[Stage3.5a][Selection]', {
        totalPatents,
        selectedCount,
        acceptedCount: Array.isArray(gate?.accepted) ? gate.accepted.length : 0,
        componentCount: Array.isArray(gate?.component) ? gate.component.length : 0,
        borderlineCount: Array.isArray(gate?.borderline) ? gate.borderline.length : 0,
      });

      const selectedPatents: any[] = pqaiResults.slice(0, selectedCount);

      console.log(`\nðŸ“‹ SELECTED PATENTS FOR STAGE 3.5a ANALYSIS:`);
      selectedPatents.forEach((patent: any, index: number) => {
        const score = patent.relevanceScore;
        const scorePercent = score ? `${(score * 100).toFixed(1)}%` : 'N/A';
        console.log(`   ${index + 1}. ${patent.publicationNumber} - Relevance: ${scorePercent}`);
        console.log(`      Title: "${patent.title?.substring(0, 60)}${patent.title?.length > 60 ? '...' : ''}"`);
      });

      // Log relevance scores statistics for selected patents
      const scores = selectedPatents.map((p: any) => p.relevanceScore || 0).filter((s: number) => s > 0);
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum: number, score: number) => sum + score, 0) / scores.length;
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);

        console.log(`\nðŸ“Š SELECTED PATENTS STATISTICS:`);
        console.log(`   - Average relevance score: ${(avgScore * 100).toFixed(1)}%`);
        console.log(`   - Score range: ${(minScore * 100).toFixed(1)}% - ${(maxScore * 100).toFixed(1)}%`);
        console.log(`   - Score distribution: ${scores.map((s: number) => (s * 100).toFixed(1) + '%').join(', ')}`);
      }

      console.log(`\nProceeding to Stage 3.5a feature mapping with ${selectedPatents.length} patent(s)`);

      // Normalize and canonicalize selected patents
      const normalizedPatents = this.normalizePatentsForFeatureMappingV2(selectedPatents, selectedCount);

      // Same claims hydration as the consolidated path: this legacy route only runs when
      // consolidated analysis fails, and a fallback must not silently produce weaker
      // evidence than the primary route it stands in for.
      const stage35aClaimsTopN = Math.max(0, Math.min(40, Number(process.env.NOVELTY_CLAIMS_TOP_REFS || '6') || 6));
      if (stage35aClaimsTopN > 0) {
        await this.hydrateClaimsForTopCandidates(normalizedPatents, stage35aClaimsTopN);
      }

      // Process in batches with concurrency
      const batchSize = config.stage35a.batchSize;
      const batches = this.createBatches(normalizedPatents, batchSize);

      console.log(`ðŸ“¦ Processing ${normalizedPatents.length} patents in ${batches.length} batches of ${batchSize}`);

      const allFeatureMaps: PatentFeatureMap[] = [];
      const concurrencyLimit = Math.max(1, Math.min(NOVELTY_LLM_MAX_CONCURRENCY, Math.trunc(config.stage35a.concurrency || NOVELTY_LLM_CONCURRENCY)));
      let failedBatches = 0;

      await this.persistDeepAnalysisProgress(
        searchId,
        this.buildStageProgressSnapshot({
          stage: 'deep_analysis',
          analyzedPatents: 0,
          totalPatents: normalizedPatents.length,
          processedBatches: 0,
          batchCount: batches.length,
          failedBatches,
        })
      );

      // Process batches with controlled concurrency
      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const batchSlice = batches.slice(i, i + concurrencyLimit);
        console.log(`💾 Processing batch group ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(batches.length / concurrencyLimit)}`);

        const batchPromises = batchSlice.map(async (batch, batchIndex) => {
          const batchNumber = i + batchIndex;
          return await this.processFeatureMappingBatch(
            searchId,
            batch,
            inventionFeatures,
            config,
            requestHeaders,
            batchNumber
          );
        });

        const batchResults = await Promise.all(batchPromises);

        // Collect successful results
        for (const result of batchResults) {
          if (result.success && result.featureMaps) {
            allFeatureMaps.push(...result.featureMaps);
          } else {
            failedBatches += 1;
          }
        }

        await this.persistDeepAnalysisProgress(
          searchId,
          this.buildStageProgressSnapshot({
            stage: 'deep_analysis',
            analyzedPatents: allFeatureMaps.length,
            totalPatents: normalizedPatents.length,
            processedBatches: Math.min(batches.length, i + batchSlice.length),
            batchCount: batches.length,
            failedBatches,
          }),
          { featureMaps: allFeatureMaps }
        );
      }

      // Preserve the LLM's semantic decision. Deterministic code supplies only a
      // neutral overlap label when the model omitted one.
      try {
        const total = Math.max(1, inventionFeatures.length);
        for (const pm of allFeatureMaps) {
          const present = (pm.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
          const partial = (pm.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
          if (!(pm as any).decision && !(pm as any).model_decision) {
            const overlap = (present.length + partial.length * 0.5) / total;
            (pm as any).decision = overlap >= 0.6
              ? 'high_overlap'
              : overlap >= 0.35
                ? 'mapped_overlap'
                : 'potential_novelty_space';
          }
          if ((pm as any).remarks) {
            // Normalize whitespace only; do not trim content so full LLM remarks are preserved
            (pm as any).remarks = String((pm as any).remarks).replace(/\s+/g, ' ').trim();
          }
        }
      } catch {}

      const screeningClusters = this.buildScreeningQueryClusters(stage0Data);
      for (let index = 0; index < allFeatureMaps.length; index += 1) {
        const map = allFeatureMaps[index];
        const patent = normalizedPatents.find(item => item.canonicalPn === map.pn) || {};
        const gateRecord = this.getGateRecordForPublication(stage1Data?.aiRelevance?.byPn || {}, map.pn);
        allFeatureMaps[index] = this.decorateTitleAbstractScreeningMap(
          map,
          patent,
          stage0Data,
          gateRecord,
          screeningClusters,
          config.stage35a.criticalFeatures || []
        );
      }

      // Store results in database
      await this.storeFeatureMapResults(searchId, allFeatureMaps);

      // Calculate quality flags and stats
      const calculatedQualityFlags = this.calculateQualityFlags(allFeatureMaps, normalizedPatents);
      const deterministicEvidenceQuality = this.titleAbstractEvidenceQuality(allFeatureMaps, stage0Data, screeningClusters);
      const qualityFlags = {
        ...calculatedQualityFlags,
        low_evidence: calculatedQualityFlags.low_evidence || deterministicEvidenceQuality.low || stage1Data?.aiRelevance?.gateStatus !== 'complete',
      };
      const stats = this.calculateFeatureMappingStats(allFeatureMaps, normalizedPatents);
      const adaptiveScreening = this.buildAdaptiveScreeningProgress({
        maps: allFeatureMaps,
        stage0Data,
        stage1Data,
        clusters: screeningClusters,
        config,
        inputTokens: 0,
        outputTokens: 0,
        thoughtTokens: 0,
        batchesCompleted: batches.length,
      });

      const result: FeatureMapBatchResult = {
        feature_map: allFeatureMaps,
        quality_flags: qualityFlags,
        stats: stats,
        adaptiveScreening,
        progress: this.buildStageProgressSnapshot({
          stage: 'deep_analysis',
          status: 'complete',
          analyzedPatents: allFeatureMaps.length,
          totalPatents: normalizedPatents.length,
          processedBatches: batches.length,
          batchCount: batches.length,
          failedBatches,
        })
      };

      console.log(` Stage 3.5a completed: mapped ${allFeatureMaps.length} patents to ${inventionFeatures.length} features`);
      return { success: true, data: result };

    } catch (error) {
      console.error('Stage 3.5a error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5a failed'
      };
    }
  }

  private async performStage35b(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage35aData: FeatureMapBatchResult,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: AggregationResult; error?: string }> {
    try {
      console.log('ðŸ“Š Starting Stage 3.5b: Aggregation & Risk Analysis');

      const inventionFeatures = stage0Data.inventionFeatures || [];
      const featureMaps = stage35aData.feature_map;
      if (featureMaps.length === 0) {
        if (stage35aData.noHighConfidencePriorArt) {
          const retrievedCount = Number(stage35aData.retrievedCount || 0) || 0;
          return {
            success: true,
            data: this.buildNoHighConfidenceStageData(searchId, stage0Data, {
              visiblePriorArtResults: [],
              aiRelevance: {
                gateStatus: 'complete',
                retrievedCount,
                reviewedCount: Number(stage35aData.reviewedCount || 0) || 0,
              },
              retrievalCandidates: Array.from({ length: retrievedCount }, (_, index) => ({ publicationNumber: `NO_MATCH_${index}` })),
            }).stage4Data,
          };
        }
        return { success: false, error: 'No feature mapping data available for aggregation' };
      }

      const featureTypes = this.buildFeatureTypeMap(stage0Data, inventionFeatures);

      // Compute per-patent coverage
      const perPatentCoverage = this.computePerPatentCoverage(featureMaps, inventionFeatures, featureTypes);
      const closestMappedReferences = this.closestMappedPatentPns(perPatentCoverage, 3);

      // Compute per-feature uniqueness
      const perFeatureUniqueness = this.computePerFeatureUniqueness(featureMaps, inventionFeatures, featureTypes, closestMappedReferences);

      const unknownStats = this.unknownEvidenceStats(featureMaps, inventionFeatures, featureTypes, closestMappedReferences);
      const qualityFlags = {
        ...stage35aData.quality_flags,
        low_evidence: Boolean(
          stage35aData.quality_flags?.low_evidence ||
          unknownStats.overallUnknownRatio >= 0.4 ||
          unknownStats.importantUnknownRatio >= 0.25 ||
          unknownStats.closestImportantUnknownRatio >= 0.25
        ),
      };

      // Integration check
      const integrationCheck = this.performIntegrationCheck(featureMaps, inventionFeatures, config.stage35a.criticalFeatures);
      const highMappedOverlap = this.findHighMappedOverlapReference(featureMaps, inventionFeatures, featureTypes);

      // Compute novelty score
      const noveltyScore = this.computeNoveltyScore(perFeatureUniqueness, config.stage35a.criticalFeatures);
      const singleReferenceMaxCoverage = perPatentCoverage.reduce(
        (max, row) => Math.max(max, Number(row.coverage_ratio || 0)),
        0
      );
      const importantFeatures = inventionFeatures.filter(feature => this.isImportantFeature(feature, featureTypes));
      const distributedComponentFeatures = perFeatureUniqueness
        .filter(row => this.isImportantFeature(row.feature, featureTypes) && (row.present_in || 0) + (row.partial_in || 0) > 0)
        .map(row => row.feature);
      const distributedComponentCoverage = importantFeatures.length
        ? Math.round((distributedComponentFeatures.length / importantFeatures.length) * 100) / 100
        : 0;
      const combinationSensitiveDifferentiators = perFeatureUniqueness
        .filter(row => row.combination_sensitive_differentiator && !this.isGenericNoveltyFeature(row.feature))
        .map(row => row.feature);
      const claimConceptMapping = this.buildClaimConceptMapping(stage0Data, featureMaps);
      const mappedImportantPatentCount = featureMaps.filter(patentMap =>
        importantFeatures.some(feature => this.isMappedCell(this.cellForFeature(patentMap, feature)))
      ).length;
      const distributedComponentRisks = (!highMappedOverlap && mappedImportantPatentCount >= 2 && distributedComponentCoverage >= 0.5)
        ? [`Separate references collectively map ${distributedComponentFeatures.length}/${Math.max(importantFeatures.length, 1)} important feature(s), creating component-combination risk for claim drafting.`]
        : [];

      // Determine decision and confidence
      const { decision, confidence } = this.computeDecisionAndConfidence(
        noveltyScore,
        integrationCheck,
        perFeatureUniqueness,
        featureMaps.length,
        qualityFlags,
        config.stage35a.criticalFeatures,
        {
          highMappedOverlap,
          featureTypes,
          noveltyScore
        }
      );

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(
        featureMaps,
        perFeatureUniqueness,
        qualityFlags,
        inventionFeatures,
        integrationCheck,
        decision,
        {
          highMappedOverlap,
          distributedComponentRisks,
          featureTypes
        }
      );
      for (const risk of distributedComponentRisks) {
        if (!riskFactors.includes(risk)) riskFactors.push(risk);
      }

      // Build per-patent remarks from Stage 3.5a maps so Stage 4 and the UI
      // can reuse them without extra LLM calls (each remark kept short and dense).
      const perPatentRemarks: PerPatentRemark[] = featureMaps.map((pm: PatentFeatureMap) => {
        const rawPn = pm.pn || '';
        const pn = String(rawPn).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const coverageEntry = perPatentCoverage.find(c => c.pn === rawPn || c.pn === pn);

        const present = (pm.feature_analysis || [])
          .filter((c: FeatureMapCell) => c.status === 'Present')
          .map((c: FeatureMapCell) => c.feature);
        const partial = (pm.feature_analysis || [])
          .filter((c: FeatureMapCell) => c.status === 'Partial')
          .map((c: FeatureMapCell) => c.feature);
        const absent = (pm.feature_analysis || [])
          .filter((cell: FeatureMapCell) => cell.status === 'Absent')
          .map((cell: FeatureMapCell) => cell.feature);

        let remarks = (pm as any).remarks as string | undefined;
        if (remarks) {
          // Preserve full Stage 3.5a remarks; only normalize whitespace
          remarks = String(remarks).replace(/\s+/g, ' ').trim() || undefined;
        } else {
          const lines: string[] = [];
          if (present.length) {
            lines.push(`Overlaps on: ${present.slice(0, 4).join(', ')}${present.length > 4 ? '…' : ''}.`);
          }
          if (absent.length) {
            lines.push(`Missing vs idea: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? '…' : ''}.`);
          }
          if (partial.length) {
            lines.push(`Partially aligned: ${partial.slice(0, 3).join(', ')}${partial.length > 3 ? '…' : ''}.`);
          }
          if (lines.length === 0) {
            lines.push('Full-text review is required before assigning overlap weight.');
          }
          remarks = lines.join(' ');
        }

        const decisionLabel = (pm as any).decision || (pm as any).model_decision;
        const confidenceValue =
          typeof coverageEntry?.coverage_ratio === 'number' ? coverageEntry.coverage_ratio : undefined;

        const remark: PerPatentRemark = {
          pn,
          title: pm.title,
          remarks: remarks || '',
          overlap_features: present,
          missing_features: absent,
          potential_differentiators: absent.filter((feature: string) => !this.isGenericNoveltyFeature(feature)).slice(0, 4),
          novelty_points: [],
          confidence: confidenceValue,
          decision: decisionLabel
        };
        return remark;
      });

      const aggregationResult = {
        idea_id: searchId,
        per_patent_coverage: perPatentCoverage,
        per_feature_uniqueness: perFeatureUniqueness,
        per_feature_coverage_gap: perFeatureUniqueness,
        integration_check: integrationCheck,
        novelty_score: noveltyScore,
        mapped_differentiation_score: noveltyScore,
        single_reference_max_coverage: Math.round(singleReferenceMaxCoverage * 100) / 100,
        distributed_component_coverage: distributedComponentCoverage,
        distributed_component_features: distributedComponentFeatures,
        distributed_component_risk_ratio: distributedComponentCoverage,
        distributed_component_risks: distributedComponentRisks,
        closest_mapped_references: closestMappedReferences,
        combination_sensitive_differentiators: combinationSensitiveDifferentiators,
        claimConceptMapping,
        decision,
        mapped_overlap_assessment: decision,
        confidence,
        risk_factors: riskFactors,
        per_patent_remarks: perPatentRemarks,
        per_patent_remarks_source: 'stage35b_deterministic',
        stage35c_complete: false
      } as AggregationResult;

      // Generate computational feature matrix
      console.log('ðŸ“Š Generating computational feature matrix...');
      const featureMatrix = this.generateFeatureMatrix(
        featureMaps,
        inventionFeatures,
        stage35aData.stats
      );

      if (featureMatrix) {
        // Add matrix to aggregation result for Stage 4
        aggregationResult.feature_matrix = featureMatrix;
        console.log(' Feature matrix generated with', featureMatrix.cells.length, 'cells');
      }

      // Store aggregation snapshot
      await this.storeAggregationSnapshot(searchId, aggregationResult, stage35aData.stats, qualityFlags);

      console.log(` Stage 3.5b completed: ${decision} (score: ${noveltyScore.toFixed(2)}, confidence: ${confidence})`);
      return { success: true, data: aggregationResult };

    } catch (error) {
      console.error('Stage 3.5b error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5b aggregation failed'
      };
    }
  }

  /**
   * Generate computational feature matrix from Stage 3.5a results
   */
  private generateFeatureMatrix(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    stage35aStats: any
  ): FeatureMatrix | null {
    try {
      console.log('ðŸ”¢ Building feature matrix for', featureMaps.length, 'patents and', inventionFeatures.length, 'features');

      const cells: FeatureMatrixCell[] = [];
      const patents: string[] = [];
      const patentTitles: Record<string, string> = {};

      // Process each patent
      for (const patentMap of featureMaps) {
        const patentNumber = patentMap.pn;
        patents.push(patentNumber);
        patentTitles[patentNumber] = patentMap.title || 'Unknown Title';

        // Process each feature for this patent
        for (const feature of inventionFeatures) {
          const featureCell = patentMap.feature_analysis?.find(cell => cell.feature === feature);

          if (featureCell) {
            const evidence = typeof featureCell.evidence === 'string'
              ? featureCell.evidence
              : featureCell.quote || '';
            const reason = featureCell.reason || '';
            const confidence = featureCell.confidence;

            cells.push({
              patentNumber,
              feature,
              status: featureCell.status,
              confidence,
              evidence,
              reason
            });
          } else {
            // No analysis available for this feature-patent combination
            cells.push({
              patentNumber,
              feature,
              status: 'Unknown',
              reason: 'No analysis available'
            });
          }
        }
      }

      // Calculate LLM usage from Stage 3.5a stats
      const llmUsage = {
        totalCalls: stage35aStats?.patents_analyzed || featureMaps.length,
        totalInputTokens: 0, // Would need to aggregate from actual LLM calls
        totalOutputTokens: 0, // Would need to aggregate from actual LLM calls
        totalCost: 0 // Would need to calculate based on model and tokens
      };

      const matrix: FeatureMatrix = {
        patents,
        features: inventionFeatures,
        cells,
        patentTitles,
        llmUsage
      };

      console.log('ðŸ“Š Matrix generated:', {
        patents: patents.length,
        features: inventionFeatures.length,
        totalCells: cells.length,
        presentCount: cells.filter(c => c.status === 'Present').length,
        partialCount: cells.filter(c => c.status === 'Partial').length,
        absentCount: cells.filter(c => c.status === 'Absent').length
      });

      return matrix;

    } catch (error) {
      console.error('âŒ Error generating feature matrix:', error);
      return null;
    }
  }

  /**
   * Generate fallback narrative when LLM fails
   */
  private generateFallbackNarrative(
    aggregationResult: AggregationResult,
    perFeatureUniqueness: any[],
    integrationCheck: any,
    decision: string
  ): any {
    const score = (aggregationResult.novelty_score * 100).toFixed(1);
    const potentialDifferentiators = this.getPotentialDifferentiatorsFromAggregation(aggregationResult);
    const totalFeatures = perFeatureUniqueness.length;

    return {
      integration: integrationCheck.any_single_patent_covers_majority === false
        ? "No reviewed patent record maps a majority of the identified features; this is an evidence-limited differentiation signal, not a novelty conclusion."
        : "At least one reviewed patent record maps a majority of the identified features, creating elevated overlap risk.",

      feature_insights: `Analysis identifies ${potentialDifferentiators.length} of ${totalFeatures} potential differentiator(s) after closest-reference and generic-component filters.`,

      verdict: `The mapped differentiation indicator is ${score}% with ${aggregationResult.confidence.toLowerCase()} confidence. Review the cited patent records and full patent documents before drawing filing conclusions.`
    };
  }

  /**
   * Prepare inputs for report generation
   */
  private prepareReportInputs(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    featureMapCells: any[],
    config: NoveltySearchConfig
  ): any {
    // Get top patents by coverage for metadata
    const topPatents = aggregationResult.per_patent_coverage
      .sort((a, b) => b.coverage_ratio - a.coverage_ratio)
      .slice(0, 10);

    const patent_metadata = topPatents.map(patent => {
      const cell = featureMapCells.find(c => c.publicationNumber === patent.pn);
      return {
        publication_number: patent.pn,
        title: cell?.title || 'Unknown Title',
        abstract: (cell?.abstract || '').substring(0, 300),
        year: cell?.year || '',
        country: patent.pn.substring(0, 2),
        inventors: cell?.inventors || []
      };
    });

    return {
      patent_metadata,
      feature_map_cells: featureMapCells,
      stage0_data: stage0Data
    };
  }

  /**
   * Generate fallback report data when LLM fails
   */
  private generateFallbackReportData(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    config: NoveltySearchConfig,
    selectedPatents?: any[]
  ): any {
    const score = (aggregationResult.novelty_score * 100).toFixed(1);
    const potentialDifferentiators = this.getPotentialDifferentiatorsFromAggregation(aggregationResult);
    const totalFeatures = aggregationResult.per_feature_uniqueness.length;
    const selectedCount = selectedPatents?.length || 0;

    // Generate citations table from selected patents
    const citationsTable = selectedPatents?.map((patent, index) => ({
      s_no: index + 1,
      citation_no: patent.patentNumber,
      title: `Patent ${patent.patentNumber}`, // Fallback title
      publication_date: "Unknown",
      link: `https://patents.google.com/patent/${patent.patentNumber}`
    })) || [];

    return {
      // Include search query from stage 0 data
      search_query: stage0Data?.searchQuery || '',
      table_of_contents: {
        title: "Table Of Contents",
        sections: [
          {"number": "01", "title": "Report", "page": "3", "link": "#report"},
          {"number": "1.1", "title": "Search Scope and Methodology", "page": "3", "link": "#metadata"},
          {"number": "1.2", "title": "Key Features", "page": "4", "link": "#key-features"},
          {"number": "1.3", "title": "Summary", "page": "5", "link": "#summary"},
          {"number": "1.4", "title": "Key Feature Analysis", "page": "6", "link": "#feature-analysis"},
          {"number": "02", "title": "Citations Details", "page": "7", "link": "#citations"},
          {"number": "2.1", "title": "Details of Relevant Patent Citations", "page": "7", "link": "#patent-details"}
        ]
      },
      report_metadata: {
        title: "Patent Intelligence Report",
        search_id: searchRun.id,
        date: new Date().toISOString().split('T')[0],
        analyst: "SpotIPR AI",
        total_patents_analyzed: aggregationResult.per_patent_coverage.length.toString(),
        selected_patents_count: selectedCount.toString()
      },
      section_1_1_search_metadata: {
        anchor: "metadata",
        search_id: searchRun.id,
        search_date: searchRun.createdAt,
        jurisdiction: config.jurisdiction,
        total_patents_found: aggregationResult.per_patent_coverage.length,
        selection_criteria: `Top 25% most relevant patents selected for detailed analysis (${selectedCount} patents)`
      },
      section_1_2_key_features: {
        anchor: "key-features",
        title: "Key Features Generated from Submitted Disclosure",
        features_table: (stage0Data.inventionFeatures || []).map((feature, index) => ({
          number: index + 1,
          description: feature
        }))
      },
      section_1_3_summary: {
        anchor: "summary",
        title: "Summary",
        description: `Based on the submitted invention disclosure, candidate patent citations are mapped from reviewed patent records. Further, ${selectedCount} other patent citations are shortlisted for attorney review.`,
        citations_table: citationsTable
      },
      section_1_4_feature_analysis: {
        anchor: "feature-analysis",
        title: "Key Feature Analysis",
        description: "The broad key features are prepared based on the submitted invention information. The analysis maps reviewed patent records against extracted features and does not provide a legal conclusion.",
        feature_matrix: {
          patent_numbers: selectedPatents?.map(p => p.patentNumber) || [],
          features: (stage0Data.inventionFeatures || []).map((feature, index) => ({
            name: `KF${index + 1}`,
            description: feature
          })),
          overlap_data: selectedPatents?.map(patent => ({
            patent: patent.patentNumber,
            ...Object.fromEntries(
              (stage0Data.inventionFeatures || []).map((feature, index) => [
                `kf${index + 1}`,
              patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage ?
                `${(patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage || 0).toFixed(1)}%` :
                  "0.0%"
              ])
            )
          })) || []
        }
      },
      section_2_1_patent_details: {
        anchor: "patent-details",
        title: "Details of Relevant Patent Citations",
        patents: selectedPatents?.map(patent => ({
          patent_number: patent.patentNumber,
          anchor: `patent_${patent.patentNumber}`,
          basic_info: {
            title: `Patent ${patent.patentNumber}`,
            publication_number: patent.patentNumber,
            filing_date: "Unknown",
            publication_date: "Unknown",
            applicant: "Unknown",
            inventor: "Unknown",
            cpc_codes: [],
            abstract: "Patent details require review in the source record."
          },
          feature_comparison: {
            title: "Feature-by-Feature Analysis",
            comparisons: (stage0Data.inventionFeatures || []).map(feature => ({
              feature: feature,
              patent_implementation: "Detailed implementation should be verified in the source record.",
              searched_idea: feature,
              similarity: "Unknown",
              novelty_impact: "Mapped-overlap analysis should be verified in the source record."
            }))
          },
          attorney_analysis: {
            title: "Claim-Positioning Observations",
            relation_to_idea: "Detailed relationship should be verified in the source record.",
            existing_coverage: "Feature mapping prepared for attorney review.",
            novel_elements: "Potential differentiators should be verified in the source record.",
            recommendations: "Please regenerate report for detailed analysis"
          }
        })) || []
      },
      concluding_remarks: {
        title: "Claim-Positioning Observations",
        overall_novelty_assessment: aggregationResult.decision,
        key_strengths: [
          `Mapped differentiation score: ${score}%`,
          `${potentialDifferentiators.length} out of ${totalFeatures} features were flagged as possible differentiators for attorney review`
        ],
        key_risks: [
          "Full patent documents should be reviewed before relying on differentiators",
          "Detailed claim-level analysis remains required",
          ...(aggregationResult.distributed_component_risks || [])
        ],
        strategic_recommendations: aggregationResult.decision === 'Novel' ?
          ["Prepare attorney review around mapped differentiators", "Validate with full patent documents, including claims and detailed description/specification"] :
          ["Narrow disclosure to potential differentiators", "Request attorney review before filing decisions"],
        filing_advice: aggregationResult.decision === 'Novel' ?
          "Potential novelty space identified from reviewed patent records; validate with full patent document review." :
          "Mapped overlap exists in the reviewed patent records; review full patent documents, including claims and detailed description/specification, before filing decisions."
      }
    };
  }

  /**
   * Enhance LLM-generated report with deterministic data and professional patent analysis remarks
   */
  private enhanceReportWithDeterministicData(
    llmReport: any,
    aggregationResult: AggregationResult,
    reportInputs: any
  ): any {
    // Build deterministic summary explaining why novelty exists
    const totalFeatures = aggregationResult.per_feature_uniqueness.length;
    const moderateUnique = aggregationResult.per_feature_uniqueness
      .filter(f => f.uniqueness > 0.5 && f.uniqueness <= 0.8);
    const lowUnique = aggregationResult.per_feature_uniqueness
      .filter(f => f.uniqueness <= 0.5);
    const potentialDifferentiators = this.getPotentialDifferentiatorsFromAggregation(aggregationResult);
    const topDifferentiatorNames = potentialDifferentiators.slice(0, 3);
    const integration = aggregationResult.integration_check;
    const score = aggregationResult.novelty_score;
    const decision = aggregationResult.decision;

    // Professional integration analysis
    const integrationLine = integration?.any_single_patent_covers_majority === false
      ? 'No single reviewed patent record maps a majority of the extracted features; this is an evidence-limited differentiation signal, not a legal novelty conclusion.'
      : (integration?.explanation || 'Several references exhibit partial feature overlap; patentability depends on the claim scope and the specific combination of elements.');

    // Professional executive summary
    const deterministicSummary = this.buildProfessionalExecutiveSummary(
      totalFeatures, potentialDifferentiators.length, moderateUnique.length, lowUnique.length,
      topDifferentiatorNames, integrationLine, decision, score, aggregationResult.confidence
    );

    const existingExec = llmReport?.executive_summary || {};
    const existingCards = existingExec.visual_cards && typeof existingExec.visual_cards === 'object'
      ? { ...existingExec.visual_cards }
      : {};
    if (existingCards["Unique Features"] && !existingCards["Potential Differentiators"]) {
      existingCards["Potential Differentiators"] = existingCards["Unique Features"];
    }
    delete existingCards["Unique Features"];
    const finalExec = {
      ...existingExec,
      summary: existingExec.summary || existingExec.text || deterministicSummary,
      novelty_score: (score * 100).toFixed(1) + "%",
      confidence: aggregationResult.confidence,
      visual_cards: {
        ...existingCards,
        "Mapped Differentiation": (score * 100).toFixed(1) + "%",
        "Patents Analyzed": aggregationResult.per_patent_coverage.length.toString(),
        "Potential Differentiators": `${potentialDifferentiators.length} of ${totalFeatures}`,
        "Confidence": aggregationResult.confidence
      }
    };

    // Enhanced professional concluding remarks
    const existingRemarks = llmReport?.concluding_remarks || {};
    const professionalRemarks = this.buildProfessionalConcludingRemarks(
      existingRemarks, aggregationResult, topDifferentiatorNames, potentialDifferentiators,
      moderateUnique, lowUnique, integrationLine, reportInputs
    );

    // Ensure deterministic data overrides any LLM hallucinations
    return {
      ...llmReport,
      // Include search query from stage 0 data
      search_query: reportInputs.stage0_data?.searchQuery || '',
      executive_summary: finalExec,
      feature_differentiation_table: aggregationResult.per_feature_uniqueness.map(f => ({
        feature: f.feature,
        mapped_differentiation: ((f.coverage_gap ?? f.uniqueness) * 100).toFixed(1) + "%",
        feature_seen_anywhere: Boolean(f.feature_seen_anywhere),
        feature_gap_against_closest_refs: Boolean(f.feature_gap_against_closest_refs),
        color: (f.coverage_gap ?? f.uniqueness) > 0.8 ? "#4CAF50" : (f.coverage_gap ?? f.uniqueness) > 0.6 ? "#FFC107" : "#E53935"
      })),
      feature_uniqueness_table: aggregationResult.per_feature_uniqueness.map(f => ({
        feature: f.feature,
        uniqueness: (f.uniqueness * 100).toFixed(1) + "%",
        color: f.uniqueness > 0.8 ? "#4CAF50" : f.uniqueness > 0.6 ? "#FFC107" : "#E53935"
      })),
      concluding_remarks: professionalRemarks,
      // Add patent metadata
      relevant_patent_summaries: reportInputs.patent_metadata
    };
  }

  /**
   * Build professional executive summary suitable for inventor review
   */
  private buildProfessionalExecutiveSummary(
    totalFeatures: number, differentiatorCount: number, modCount: number, lowCount: number,
    topDifferentiatorNames: string[], integrationLine: string, decision: string,
    score: number, confidence: string
  ): string {
    const scorePercent = (score * 100).toFixed(1);
    
    let verdictPhrase = '';
    let actionPhrase = '';
    
    if (decision === 'Novel') {
      verdictPhrase = 'The reviewed patent records show a larger apparent differentiation window';
      actionPhrase = 'Recommend attorney review of the differentiators before any filing decision.';
    } else if (decision === 'Partially Novel') {
      verdictPhrase = 'The reviewed patent records show mixed mapped overlap with identifiable differentiation points';
      actionPhrase = 'Recommend focusing attorney review on potential differentiators and overlapping elements.';
    } else if (decision === 'Not Novel') {
      verdictPhrase = 'Significant mapped overlap has been identified in the reviewed patent records';
      actionPhrase = 'Recommend re-evaluating the technical scope and identifying distinctions not captured in the reviewed patent records.';
    } else {
      verdictPhrase = 'The reviewed patent records establish a preliminary mapped-overlap picture for attorney review';
      actionPhrase = 'Confirm the closest references against full patent documents before making decisions.';
    }

    let featureAnalysis = `Feature-level analysis across ${totalFeatures} key invention features indicates: `;
    if (differentiatorCount > 0) {
      featureAnalysis += `${differentiatorCount} potential differentiator(s) remain after closest-reference and generic-component filters`;
      if (topDifferentiatorNames.length > 0) {
        featureAnalysis += `, notably ${topDifferentiatorNames.slice(0, 2).join(' and ')}`;
      }
      featureAnalysis += '. ';
    }
    if (modCount > 0) {
      featureAnalysis += `${modCount} feature(s) show moderate differentiation (50-80%). `;
    }
    if (lowCount > 0) {
      featureAnalysis += `${lowCount} feature(s) have substantial mapped overlap requiring attorney review. `;
    }

    return `${verdictPhrase} with a calculated mapped-differentiation score of ${scorePercent}% (${confidence.toLowerCase()} confidence). ${featureAnalysis}${integrationLine} ${actionPhrase}`;
  }

  /**
   * Build comprehensive professional concluding remarks for patent analysis report
   */
  private buildProfessionalConcludingRemarks(
    existingRemarks: any,
    aggregationResult: AggregationResult,
    topDifferentiatorNames: string[],
    potentialDifferentiators: string[],
    moderateUnique: any[],
    lowUnique: any[],
    integrationLine: string,
    reportInputs: any
  ): any {
    const decision = aggregationResult.decision;
    const score = aggregationResult.novelty_score;
    const confidence = aggregationResult.confidence;

    // Build professional key strengths based on analysis
    const keyStrengths: string[] = [];
    if (potentialDifferentiators.length > 0) {
      keyStrengths.push(`${potentialDifferentiators.length} potential differentiator(s) remain after closest-reference and generic-component filters`);
      if (topDifferentiatorNames.length > 0) {
        keyStrengths.push(`Primary differentiators identified: ${topDifferentiatorNames.join(', ')}`);
      }
    }
    if (aggregationResult.integration_check?.any_single_patent_covers_majority === false) {
      keyStrengths.push('No single mapped citation covers the majority of features in the reviewed patent records');
    }
    if (score >= 0.7 && potentialDifferentiators.length > 0) {
      keyStrengths.push('Mapped-differentiation score exceeds 70% with mapped differentiators still present');
    }
    if (confidence === 'High') {
      keyStrengths.push('Higher confidence in the automated mapping based on broader candidate coverage');
    }

    // Build professional key risks
    const keyRisks: string[] = [];
    if (lowUnique.length > 0) {
      keyRisks.push(`${lowUnique.length} feature(s) have substantial mapped overlap - consider narrower claim positioning`);
      const riskFeatures = lowUnique.slice(0, 2).map(f => f.feature);
      if (riskFeatures.length > 0) {
        keyRisks.push(`Features requiring attention: ${riskFeatures.join(', ')}`);
      }
    }
    if (decision === 'Not Novel' || decision === 'Partially Novel') {
      keyRisks.push('Prior art citations may be combined under obviousness analysis (35 U.S.C. § 103)');
    }
    if (confidence === 'Low') {
      keyRisks.push('Limited prior art coverage may indicate undiscovered references - consider supplemental search');
    }
    if (aggregationResult.per_patent_coverage.some(p => p.coverage_ratio > 0.7)) {
      keyRisks.push('One or more references show high feature coverage (>70%) - review for potential anticipation');
    }
    for (const risk of aggregationResult.distributed_component_risks || []) {
      if (risk) keyRisks.push(risk);
    }
    const deterministicRisks = this.mergeRiskLists(keyRisks, aggregationResult.risk_factors);
    const existingRisks = Array.isArray(existingRemarks.key_risks)
      ? existingRemarks.key_risks.filter((risk: any) => !(deterministicRisks.length > 0 && this.isNoRiskBoilerplate(risk)))
      : [];
    const finalRisks = this.mergeRiskLists(deterministicRisks, existingRisks).map((risk: string) => String(risk)
      .replace(/substantial prior art overlap.*claim narrowing/i, 'substantial mapped overlap - consider narrower claim positioning')
      .replace(/Prior art citations may be combined under obviousness analysis.*$/i, 'Multiple mapped citations cover related features; attorney review should assess combination risk')
      .replace(/review for potential anticipation/i, 'review for high mapped coverage in the reviewed patent records')
    );

    // Build strategic recommendations for inventors
    const recommendations: string[] = [];
    if (decision === 'Novel') {
      recommendations.push('Prepare attorney review around the identified potential differentiators');
      recommendations.push('Validate differentiators against full patent documents, including claims and detailed description/specification, before filing decisions');
      recommendations.push('Run a separate freedom-to-operate review for commercial implementation');
    } else if (decision === 'Partially Novel') {
      recommendations.push('Focus claim-positioning review on the filtered potential differentiators');
      recommendations.push('Document alternative embodiments and implementation variants');
      recommendations.push('Consider design-around opportunities for features with mapped overlap');
      recommendations.push('Document technical advantages of the specific combination');
    } else {
      recommendations.push('Re-evaluate invention disclosure with focus on concrete technical distinctions');
      recommendations.push('Consider pivoting to unexplored aspects of the technology');
      recommendations.push('Document any unexpected results or technical advantages for attorney review');
      recommendations.push('Consult with patent counsel before proceeding');
    }

    // Build mapped-overlap filing advice without legal patentability conclusions.
    const filingAdvice = decision === 'Novel'
      ? 'Differentiators remain for attorney review. Validate them against full patent documents before any filing decision.'
      : decision === 'Partially Novel'
        ? 'The reviewed patent records show both overlap and potential differentiators. Work with patent counsel to evaluate claim positioning around the filtered differentiators.'
        : decision === 'Not Novel'
          ? 'Significant mapped overlap suggests the current disclosure needs refinement. Identify additional technical distinctions and review full records with counsel.'
          : 'The reviewed patent records are not enough for a reliable assessment. Consider expanded search and full patent document review before making filing decisions.';

    // Build "why novelty exists" explanation
    const uniqueFeaturesText = topDifferentiatorNames.length > 0
      ? topDifferentiatorNames.slice(0, 3).join(', ')
      : 'key technical features';
    const visibleWhyNovel = potentialDifferentiators.length > 0
      ? `The apparent differentiation window is primarily supported by ${potentialDifferentiators.length} potential differentiator(s): ${uniqueFeaturesText}. ${integrationLine} Attorney review should validate whether the specific configuration and technical integration remain distinct in full records.`
      : `The assessment is based on overall feature mapping from reviewed patent records. ${integrationLine}`;

    const closestMappedReferences = Array.isArray(aggregationResult.closest_mapped_references)
      ? aggregationResult.closest_mapped_references
      : (Array.isArray(existingRemarks.closest_mapped_references)
        ? existingRemarks.closest_mapped_references
        : (Array.isArray(existingRemarks.closest_blocking_references) ? existingRemarks.closest_blocking_references : []));
    const distributedComponentRisks = Array.isArray(aggregationResult.distributed_component_risks)
      ? aggregationResult.distributed_component_risks
      : (Array.isArray(existingRemarks.distributed_component_risks) ? existingRemarks.distributed_component_risks : []);
    const safeExistingStrengths = Array.isArray(existingRemarks.key_strengths)
      ? existingRemarks.key_strengths.filter((strength: any) => {
        const text = String(strength || '');
        return text && !/unknown|novelty_points|unique/i.test(text);
      })
      : [];

    // Build inventor action items
    const inventorActions: string[] = [];
    if (lowUnique.length > 0) {
      inventorActions.push(`Review overlapping features (${lowUnique.map(f => f.feature).slice(0, 2).join(', ')}) and document any technical distinctions not captured in the analysis`);
    }
    if (decision !== 'Novel') {
      inventorActions.push('Provide additional technical details that may distinguish from cited prior art');
      inventorActions.push('Identify any performance improvements, efficiency gains, or unexpected results');
    }
    inventorActions.push('Review cited prior art references and note any mischaracterizations');
    inventorActions.push('Document the problem being solved and why prior art solutions are inadequate');

    return {
      ...existingRemarks,
      title: 'Claim-Positioning Observations',
      overall_novelty_assessment: existingRemarks.overall_novelty_assessment || decision,
      novelty_score_summary: `${(score * 100).toFixed(1)}% mapped-differentiation score with ${confidence.toLowerCase()} confidence`,
      why_novelty_exists: existingRemarks.why_novelty_exists || visibleWhyNovel,
      closest_mapped_references: closestMappedReferences,
      distributed_component_risks: distributedComponentRisks,
      potential_differentiators: potentialDifferentiators,
      key_strengths: keyStrengths.length > 0 ? keyStrengths : safeExistingStrengths,
      key_risks: finalRisks,
      strategic_recommendations: existingRemarks.strategic_recommendations?.length > 0 ? existingRemarks.strategic_recommendations : recommendations,
      filing_advice: existingRemarks.filing_advice || filingAdvice,
      inventor_action_items: inventorActions,
      analysis_date: new Date().toISOString().split('T')[0],
      disclaimer: 'This analysis is AI-generated and should be reviewed by a qualified patent attorney before making legal or business decisions. Patent law is complex and fact-specific; this report does not constitute legal advice.'
    };
  }

  // Stage 4 Helper Methods

  private async getFeatureMapCellsWithOverrides(searchId: string): Promise<any[]> {
    // Get cells with overrides applied
    const cells = await (prisma as any).featureMapCell.findMany({
      where: { searchId },
      include: {
        overrides: true // Include any overrides
      }
    });

    // Apply overrides
    return cells.map((cell: any) => {
      const override = cell.overrides?.[0]; // Latest override if any
      if (override) {
        return {
          ...cell,
          status: override.overriddenStatus,
          evidence: override.evidence || cell.evidence,
          overridden: true,
          overrideReason: override.reason
        };
      }
      return { ...cell, overridden: false };
    });
  }

  private selectTopPatentsForDetailedAnalysis(
    perPatentCoverage: PerPatentCoverage[],
    featureMapCells: any[],
    inventionFeatures: string[],
    stage1PQAI?: any[]
  ): any[] {
    // Compute global feature scarcity to prioritize patents covering rarer features
    const featureStats = new Map<string, { present: number; partial: number }>();
    for (const cell of featureMapCells || []) {
      const f = (cell.feature_text || cell.feature || '').toLowerCase();
      if (!f) continue;
      const s = (cell.status || '').toString();
      const entry = featureStats.get(f) || { present: 0, partial: 0 };
      if (s === 'Present') entry.present += 1;
      else if (s === 'Partial') entry.partial += 1;
      featureStats.set(f, entry);
    }
    const scarcityWeight = (feat: string): number => {
      const key = (feat || '').toLowerCase();
      const st = featureStats.get(key) || { present: 0, partial: 0 };
      // Rarer features get higher weight; clamp to [0.2, 1.0]
      const raw = 1 / (1 + st.present + 0.5 * st.partial);
      return Math.max(0.2, Math.min(1.0, raw));
    };
    // Pre-index PQAI results by publication number for relevance/abstract lookup
    const pqaiByPn = new Map<string, any>();
    if (Array.isArray(stage1PQAI)) {
      for (const r of stage1PQAI) {
        const pn = r.publicationNumber || r.pn || r.patent_number || r.publication_number;
        if (pn) pqaiByPn.set(pn, r);
      }
    }

    // Calculate relevance score for each patent based on coverage ratio and feature overlap
    const featureCount = inventionFeatures.length || 0;

    const scored = perPatentCoverage
      // Filter to only patents with at least one Present or Partial feature
      .filter(p => (p.present_count || 0) + (p.partial_count || 0) > 0)
      .map(patent => {
      // Find feature mappings for this patent
      const patentMappings = featureMapCells.filter(cell =>
        (cell.patent_publication_number || cell.publicationNumber) === patent.pn
      );

      // Calculate average feature overlap percentage
      const featureOverlaps = inventionFeatures.map(feature => {
        const mapping = patentMappings.find((m: any) =>
          m.feature_text?.toLowerCase() === feature.toLowerCase()
        );
        return mapping ? (mapping.overlap_percentage || 0) : 0;
      });

      const avgFeatureOverlap = featureOverlaps.reduce((sum, overlap) => sum + overlap, 0) / featureOverlaps.length;

      // Combine coverage ratio and feature overlap for final score
      const relevanceScore = (patent.coverage_ratio * 0.6) + (avgFeatureOverlap * 0.4);

      const pq = pqaiByPn.get(patent.pn) || {};
      const pqaiRelevance = pq.relevanceScore || pq.score || pq.relevance || 0;
      const abstract = pq.abstract || pq.snippet || pq.description || '';

      const presentPartial = (patent.present_count || 0) + (patent.partial_count || 0);
      const allFeaturesCovered = featureCount > 0 && presentPartial >= featureCount;

      return {
        patentNumber: patent.pn,
        coverageRatio: patent.coverage_ratio,
        avgFeatureOverlap: avgFeatureOverlap,
        relevanceScore: relevanceScore,
        pqaiRelevance,
        abstract,
        allFeaturesCovered,
        mappings: patentMappings
      };
    });

    // If multiple patents cover all features, keep only top 2 by PQAI relevance to save tokens
    const fullCover = scored.filter(s => s.allFeaturesCovered);
    if (fullCover.length >= 2) {
      const topByPQAI = [...fullCover].sort((a, b) => (b.pqaiRelevance || 0) - (a.pqaiRelevance || 0)).slice(0, 2);
      console.log(`🎯 All-feature coverage detected. Limiting to top ${topByPQAI.length} by PQAI relevance.`);
      return topByPQAI;
    }

    // Otherwise, if we have > 2 intersecting patents, select up to 2 that maximize unique feature coverage (Present>Partial)
    if (scored.length > 2) {
      const featureSet = new Set(inventionFeatures.map(f => f.toLowerCase()));
      const covered = new Set<string>();

      // Helper to compute marginal gain for a patent given currently covered features
      const marginalGain = (pat: any): number => {
        let gain = 0;
        for (const m of pat.mappings as any[]) {
          const feat = (m.feature_text || '').toLowerCase();
          if (!feat || !featureSet.has(feat) || covered.has(feat)) continue;
          const status = (m.status || '').toString();
          const w = scarcityWeight(feat);
          if (status === 'Present') gain += 1.0 * w;
          else if (status === 'Partial') gain += 0.5 * w;
        }
        // Lightly include PQAI relevance as tie-breaker signal
        gain += (pat.pqaiRelevance || 0) * 0.05;
        return gain;
      };

      const pool = [...scored].sort((a, b) => b.relevanceScore - a.relevanceScore);
      const chosen: any[] = [];
      for (let i = 0; i < 2 && pool.length > 0; i++) {
        // Pick patent with highest marginal coverage gain; tie-break by relevance
        pool.sort((a, b) => {
          const ga = marginalGain(a), gb = marginalGain(b);
          if (gb !== ga) return gb - ga;
          return (b.relevanceScore || 0) - (a.relevanceScore || 0);
        });
        const pick = pool.shift();
        if (!pick) break;
        chosen.push(pick);
        // Update covered features with this pick
        for (const m of pick.mappings as any[]) {
          const feat = (m.feature_text || '').toLowerCase();
          if (!feat) continue;
          const status = (m.status || '').toString();
          if (status === 'Present' || status === 'Partial') covered.add(feat);
        }
      }
      console.log(`ðŸ§  Greedy selection picked ${chosen.length} patents to maximize evidence coverage.`);
      return chosen;
    }

    // If 1â€“2 intersecting patents, return them as-is
    const patentScores = scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log(`ðŸ“Š Passing ${patentScores.length} intersecting patents to Stage 4 (out of filtered set).`);
    return patentScores;
  }

  private buildFeaturePatentMatrix(
    inventionFeatures: string[],
    featureMapCells: any[],
    maxRefs: number
  ): any {
    // Group cells by publication number and sort by coverage
    const patentGroups: { [pn: string]: any } = {};

    for (const cell of featureMapCells) {
      if (!patentGroups[cell.publicationNumber]) {
        patentGroups[cell.publicationNumber] = {
          pn: cell.publicationNumber,
          cells: [],
          presentCount: 0,
          totalCount: inventionFeatures.length
        };
      }

      patentGroups[cell.publicationNumber].cells.push({
        feature: cell.feature,
        status: cell.status,
        evidence: cell.evidence
      });

      if (cell.status === 'Present') {
        patentGroups[cell.publicationNumber].presentCount++;
      }
    }

    // Sort patents by coverage ratio and take top N
    const sortedPatents = Object.values(patentGroups)
      .map((p: any) => ({
        ...p,
        coverageRatio: p.presentCount / p.totalCount
      }))
      .sort((a: any, b: any) => b.coverageRatio - a.coverageRatio)
      .slice(0, maxRefs);

    return {
      rows: inventionFeatures,
      cols: sortedPatents.map((p: any) => p.pn),
      cells: sortedPatents.map((p: any) =>
        inventionFeatures.map(feature => {
          const cell = p.cells.find((c: any) => c.feature === feature);
          return cell ? cell.status : 'Unknown';
        })
      ),
      coverageRatios: sortedPatents.map((p: any) => p.coverageRatio)
    };
  }

  private getTopReferences(perPatentCoverage: PerPatentCoverage[], maxRefs: number): any[] {
    return perPatentCoverage
      .sort((a, b) => b.coverage_ratio - a.coverage_ratio)
      .slice(0, maxRefs)
      .map(coverage => ({
        pn: coverage.pn,
        coverage_ratio: coverage.coverage_ratio,
        year: '2023', // Would need to get from PQAI data
        country: 'US', // Would need to get from PQAI data
        assignee: 'Unknown' // Would need to get from PQAI data
      }));
  }

  /**
   * Select patents for Stage 4 using a costâ€‘effective greedy coverage heuristic:
   * - Treat all features equally; prefer Present over Partial.
   * - Cover each feature with Present if any Present exists in the dataset; otherwise allow Partial.
   * - Rank pool by coverage+overlap; then iteratively add the patent with highest marginal gain.
   * - Add one extra precision patent if only Partial is possible for remaining features.
   */
  private selectPatentsByGreedyCoverage(
    perPatentCoverage: PerPatentCoverage[],
    featureMapCells: any[],
    inventionFeatures: string[],
    stage1PQAI?: any[]
  ): any[] {
    const pqaiByPn = new Map<string, any>();
    if (Array.isArray(stage1PQAI)) {
      for (const r of stage1PQAI) {
        const pn = r.publicationNumber || r.pn || r.patent_number || r.publication_number || r.id;
        if (pn) pqaiByPn.set(pn, r);
      }
    }

    // Index mappings per PN
    const mappingsByPn: Record<string, any[]> = {};
    for (const cell of featureMapCells || []) {
      const pn = cell.patent_publication_number || cell.publicationNumber;
      if (!pn) continue;
      (mappingsByPn[pn] ||= []).push(cell);
    }

    // Determine which features have any Present evidence at all
    const presentPossible: Record<string, boolean> = {};
    for (const f of inventionFeatures) presentPossible[f.toLowerCase()] = false;
    for (const cell of featureMapCells || []) {
      const f = (cell.feature_text || cell.feature || '').toLowerCase();
      if (!f) continue;
      if ((cell.status || '').toString() === 'Present') presentPossible[f] = true;
    }

    // Score pool for ordering
    const scored = perPatentCoverage
      .filter(p => (p.present_count || 0) + (p.partial_count || 0) > 0)
      .map(p => {
        const maps = mappingsByPn[p.pn] || [];
        const pq = pqaiByPn.get(p.pn) || {};
        const pqaiRelevance = pq.relevanceScore || pq.score || pq.relevance || 0;
        const abstract = pq.abstract || pq.snippet || pq.description || '';
        const title = pq.title || pq.invention_title || 'Untitled Patent';
        const link = pq.link || `https://patents.google.com/patent/${p.pn}`;
        const overlaps = inventionFeatures.map(feat => {
          const m = maps.find(mm => ((mm.feature_text || mm.feature || '') as string).toLowerCase() === feat.toLowerCase());
          return m ? (m.overlap_percentage || 0) : 0;
        });
        const avgFeatureOverlap = overlaps.length ? overlaps.reduce((a,b)=>a+b,0)/overlaps.length : 0;
        const relevanceScore = (p.coverage_ratio * 0.6) + (avgFeatureOverlap * 0.4);
        return {
          patentNumber: p.pn,
          coverageRatio: p.coverage_ratio,
          avgFeatureOverlap,
          relevanceScore,
          pqaiRelevance,
          abstract,
          title,
          mappings: maps,
          link
        };
      })
      .sort((a,b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

    const uncovered = new Set(inventionFeatures.map(f => f.toLowerCase()));
    const selected: any[] = [];

    const marginalGain = (pat: any): {gain: number; details: {feat: string; kind: 'P'|'Pt'}[]} => {
      let gain = 0; const details: any[] = [];
      for (const m of pat.mappings as any[]) {
        const feat = ((m.feature_text || m.feature || '') as string).toLowerCase();
        if (!uncovered.has(feat)) continue;
        const status = (m.status || '').toString();
        if (status === 'Present') { gain += 1; details.push({feat, kind: 'P'}); }
        else if (status === 'Partial' && !presentPossible[feat]) { gain += 0.5; details.push({feat, kind: 'Pt'}); }
      }
      gain += (pat.pqaiRelevance || 0) * 0.01; // tiny tieâ€‘break
      return { gain, details };
    };

    while (uncovered.size > 0) {
      let best: any = null; let bestGain = -1; let bestDetails: any[] = [];
      for (const cand of scored) {
        if (selected.find(s => s.patentNumber === cand.patentNumber)) continue;
        const { gain, details } = marginalGain(cand);
        if (gain > bestGain || (gain === bestGain && (cand.relevanceScore||0) > (best?.relevanceScore||0))) {
          best = cand; bestGain = gain; bestDetails = details;
        }
      }
      if (!best || bestGain <= 0) break; // no more gains
      selected.push(best);
      for (const d of bestDetails) uncovered.delete(d.feat);
      // Reasonable stop: if selected reaches 5 and majority covered, let Stage 4 narrate residuals
      if (selected.length >= 5 && uncovered.size <= Math.ceil(inventionFeatures.length * 0.1)) break;
    }

    // One extra precision pick for Partialâ€‘only residuals
    if (uncovered.size > 0) {
      let best: any = null; let bestPt = -1;
      for (const cand of scored) {
        if (selected.find(s => s.patentNumber === cand.patentNumber)) continue;
        let count = 0;
      for (const m of cand.mappings as any[]) {
          const feat = ((m.feature_text || m.feature || '') as string).toLowerCase();
          if (!uncovered.has(feat)) continue;
          if ((m.status || '').toString() === 'Partial' && !presentPossible[feat]) count++;
      }
        if (count > bestPt) { bestPt = count; best = cand; }
      }
      if (best && bestPt > 0) selected.push(best);
    }

    if (selected.length === 0 && scored.length > 0) {
      // Safety net: ensure at least top 2 are passed if greedy found no gains due to schema mismatches
      console.warn(' Greedy selector produced empty set; falling back to top-2 by relevance.');
      return scored.slice(0, Math.min(2, scored.length));
    }

    console.log(` Selected ${selected.length} patents for Stage 4 by greedy feature coverage.`);
    return selected;
  }

  private async generateReportContent(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    featureMatrix: any,
    topReferences: any[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<any> {
    const reportData = {
      idea_id: searchRun.id,
      report: {
        executive_summary: `Novelty assessment completed with ${aggregationResult.decision} determination (score: ${aggregationResult.novelty_score.toFixed(2)}, confidence: ${aggregationResult.confidence}).`,
        metrics: {
          novelty_score: aggregationResult.novelty_score,
          decision: aggregationResult.decision,
          confidence: aggregationResult.confidence
        },
        feature_matrix: featureMatrix,
        top_references: topReferences,
        final_remarks: `Analysis prepared for ${aggregationResult.per_patent_coverage.length} references. Review full patent documents, including claims and detailed description/specification, before making final patentability conclusions.`,
        appendices: {
          prior_art_metadata: [], // Would populate from PQAI data
          methodology: `Feature mapping used Present/Partial/Absent assessment with ${config.stage35a.batchSize} patents per batch.`,
          quality_flags: aggregationResult.integration_check
        }
      }
    };

    return reportData;
  }

  private buildReportProsePrompt(searchRun: any, aggregationResult: AggregationResult, reportData: any): string {
    return `Generate a brief executive summary and final remarks for this novelty assessment report.

INPUT DATA:
- Decision: ${aggregationResult.decision}
- Novelty Score: ${aggregationResult.novelty_score}
- Confidence: ${aggregationResult.confidence}
- Risk Factors: ${aggregationResult.risk_factors.join(', ')}
- Integration Check: ${aggregationResult.integration_check.any_single_patent_covers_majority ?
    `Patent ${aggregationResult.integration_check.integration_pn} covers majority` :
    aggregationResult.integration_check.explanation}

OUTPUT JSON:
{
  "executive_summary": "2-3 sentence summary of findings",
  "final_remarks": "1-2 sentence conclusion",
  "recommendations": {
    "prosecution_strategy": ["2-3 key recommendations"],
    "next_steps": ["1-2 immediate actions"]
  }
}`;
  }

  // Stage 3.5b Helper Methods

  private normalizeAggregationFeatureType(value: unknown): InventionFeatureDetail['feature_type'] | undefined {
    const text = String(value || '').toLowerCase();
    if (text === 'novelty_candidate' || text === 'core_technical' || text === 'implementation' || text === 'generic_weak') {
      return text as InventionFeatureDetail['feature_type'];
    }
    return undefined;
  }

  private buildFeatureTypeMap(stage0Data: NormalizedIdea, inventionFeatures: string[]): Map<string, InventionFeatureDetail['feature_type']> {
    const details = Array.isArray(stage0Data.featureDetails) ? stage0Data.featureDetails : [];
    const typeByFeature = new Map<string, InventionFeatureDetail['feature_type']>();
    for (const detail of details) {
      const feature = String(detail?.feature || '').trim();
      if (!feature) continue;
      const type = this.normalizeAggregationFeatureType(detail?.feature_type);
      if (type) typeByFeature.set(feature, type);
    }
    for (const feature of inventionFeatures) {
      if (!typeByFeature.has(feature)) {
        typeByFeature.set(feature, this.isGenericNoveltyFeature(feature) ? 'generic_weak' : 'core_technical');
      }
    }
    return typeByFeature;
  }

  private screeningTokens(value: unknown): string[] {
    const stop = new Set([
      'about', 'after', 'also', 'based', 'being', 'between', 'comprising', 'configured', 'device', 'from',
      'having', 'including', 'method', 'module', 'process', 'system', 'that', 'their', 'thereof', 'these',
      'this', 'through', 'using', 'wherein', 'which', 'with', 'without',
    ]);
    return Array.from(new Set(String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 4 && !stop.has(token))));
  }

  private buildScreeningQueryClusters(stage0Data: NormalizedIdea): ScreeningQueryCluster[] {
    const clusters: ScreeningQueryCluster[] = [];
    const seen = new Set<string>();
    const add = (label: unknown, critical: boolean) => {
      const text = String(label || '').replace(/\s+/g, ' ').trim();
      const terms = this.screeningTokens(text).slice(0, 12);
      const key = terms.join('|');
      if (!text || terms.length === 0 || seen.has(key) || clusters.length >= 6) return;
      seen.add(key);
      clusters.push({ id: `QC${clusters.length + 1}`, label: text.slice(0, 180), terms, critical });
    };

    for (const concept of stage0Data.claimConcepts || []) {
      add(`${concept.title} ${concept.claimableSummary}`, concept.importance === 'primary');
    }
    for (const interaction of stage0Data.noveltyFocusInteractions || []) {
      add(interaction.description, true);
    }
    for (const detail of stage0Data.featureDetails || []) {
      if (detail.feature_type === 'novelty_candidate' || detail.feature_type === 'core_technical') {
        add(`${detail.feature} ${detail.technical_role || ''}`, detail.feature_type === 'novelty_candidate');
      }
    }
    if (clusters.length === 0) add(stage0Data.searchQuery, true);
    return clusters;
  }

  private screeningEvidenceQuote(text: string, terms: string[]): string {
    const sentences = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
    const ranked = sentences.map(sentence => {
      const lower = sentence.toLowerCase();
      return { sentence, hits: terms.filter(term => lower.includes(term)).length };
    }).sort((a, b) => b.hits - a.hits);
    return ranked[0]?.hits ? ranked[0].sentence.slice(0, 260) : '';
  }

  private classifyDomainTier(
    patent: any,
    stage0Data: NormalizedIdea,
    clusters: ScreeningQueryCluster[]
  ): { tier: DomainTier; reason: string; quote: string; clusterIds: string[] } {
    const title = String(patent?.title || '');
    const abstract = String(patent?.abstract || '');
    const text = `${title} ${abstract}`.toLowerCase();
    const featureDetails = stage0Data.featureDetails || [];
    const domainTerms = Array.from(new Set([
      ...this.screeningTokens(stage0Data.title || ''),
      ...this.screeningTokens(stage0Data.searchQuery),
      ...featureDetails
        .filter(detail => detail.feature_type === 'core_technical' || detail.feature_type === 'novelty_candidate')
        .flatMap(detail => this.screeningTokens(`${detail.feature} ${detail.technical_role || ''}`)),
    ])).slice(0, 40);
    const matchedDomainTerms = domainTerms.filter(term => text.includes(term));
    const domainRatio = domainTerms.length ? matchedDomainTerms.length / domainTerms.length : 0;
    const genericTerms = ['artificial intelligence', 'machine learning', 'sensor', 'wireless', 'cloud', 'internet of things', 'iot', 'drone', 'predictive', 'monitoring', 'analytics'];
    const genericHits = genericTerms.filter(term => text.includes(term));
    const clusterIds = clusters.filter(cluster => {
      const hits = cluster.terms.filter(term => text.includes(term)).length;
      return hits >= Math.min(2, Math.max(1, Math.ceil(cluster.terms.length * 0.3)));
    }).map(cluster => cluster.id);
    const stageClassifications = new Set([...(stage0Data.cpcCodes || []), ...(stage0Data.ipcCodes || [])].map(code => String(code).slice(0, 4).toUpperCase()));
    const patentClassifications = [
      ...(Array.isArray(patent?.classifications) ? patent.classifications : []),
      ...(Array.isArray(patent?.cpcCodes) ? patent.cpcCodes : []),
      ...(Array.isArray(patent?.ipcCodes) ? patent.ipcCodes : []),
    ].map(code => String(code).slice(0, 4).toUpperCase());
    const classificationMatch = patentClassifications.some(code => stageClassifications.has(code));

    let tier: DomainTier;
    let reason: string;
    if (clusterIds.length > 0 && domainRatio >= 0.45 && matchedDomainTerms.length >= 3) {
      tier = 1;
      reason = 'Same target domain and technical-purpose anchors are explicit in the title/abstract record.';
    } else if ((clusterIds.length > 0 && domainRatio >= 0.25) || (classificationMatch && matchedDomainTerms.length >= 2)) {
      tier = 2;
      reason = 'Adjacent domain record with matching mechanism, purpose, or patent classification.';
    } else if (matchedDomainTerms.length >= 2 || classificationMatch) {
      tier = 3;
      reason = 'Related platform or subsystem, but the target application is not fully aligned.';
    } else if (genericHits.length >= 2) {
      tier = 4;
      reason = 'Overlap is primarily generic technology terminology.';
    } else {
      tier = 5;
      reason = 'Only weak analogy or isolated keyword overlap was identified.';
    }
    return {
      tier,
      reason,
      quote: this.screeningEvidenceQuote(abstract || title, matchedDomainTerms.length ? matchedDomainTerms : genericHits),
      clusterIds,
    };
  }

  private cooperativeRelationshipEvidence(stage0Data: NormalizedIdea, abstract: string): { present: boolean; quote: string } {
    const normalizedAbstract = String(abstract || '').toLowerCase();
    if (!normalizedAbstract || normalizedAbstract === 'no abstract available.') return { present: false, quote: '' };
    const interactions = stage0Data.noveltyFocusInteractions || [];
    for (const interaction of interactions) {
      const relationshipTerms = this.screeningTokens(interaction.description);
      const relationshipHits = relationshipTerms.filter(term => normalizedAbstract.includes(term));
      const linkedCovered = (interaction.linkedFeatures || []).every(feature => {
        const terms = this.screeningTokens(feature);
        return terms.some(term => normalizedAbstract.includes(term));
      });
      if (linkedCovered && relationshipHits.length >= Math.min(3, Math.max(1, Math.ceil(relationshipTerms.length * 0.35)))) {
        return { present: true, quote: this.screeningEvidenceQuote(abstract, relationshipHits) };
      }
    }
    return { present: false, quote: '' };
  }

  private orderAdaptiveCandidates(
    candidates: any[],
    stage0Data: NormalizedIdea,
    clusters: ScreeningQueryCluster[],
    batchSize: number
  ): any[] {
    if (candidates.length <= batchSize) return candidates;
    const ordered = candidates.slice(0, batchSize);
    const pending = candidates.slice(batchSize);
    const seenSources = new Set<string>(ordered.flatMap(candidate => candidate.sourceProviders || [candidate.sourceProvider]).filter(Boolean));
    const seenJurisdictions = new Set<string>(ordered.map(candidate => String(candidate.jurisdiction || '')).filter(Boolean));
    const seenFamilies = new Set<string>(ordered.map(candidate => this.canonicalPatentNumber(getPriorArtPublicationNumber(candidate))).filter(Boolean));
    const noveltyFeatures = (stage0Data.featureDetails || []).filter(detail => detail.feature_type === 'novelty_candidate').map(detail => detail.feature);

    while (pending.length > 0) {
      const ranked = pending.map((candidate, index) => {
        const sources = (candidate.sourceProviders || [candidate.sourceProvider]).filter(Boolean);
        const jurisdiction = String(candidate.jurisdiction || '');
        const family = this.canonicalPatentNumber(getPriorArtPublicationNumber(candidate));
        const domain = this.classifyDomainTier(candidate, stage0Data, clusters);
        const matchedFeatures = Array.isArray(candidate.matchedFeatures) ? candidate.matchedFeatures : [];
        const noveltyHit = noveltyFeatures.some(feature => matchedFeatures.includes(feature) || String(candidate.abstract || '').toLowerCase().includes(feature.toLowerCase()));
        const score =
          (sources.some((source: string) => !seenSources.has(source)) ? 5 : 0) +
          (jurisdiction && !seenJurisdictions.has(jurisdiction) ? 3 : 0) +
          (family && !seenFamilies.has(family) ? 2 : 0) +
          (domain.tier <= 2 ? 4 : domain.tier === 3 ? 2 : 0) +
          (noveltyHit ? 4 : 0) +
          Number(candidate.rerankScore ?? candidate.relevanceScore ?? 0);
        return { candidate, index, score };
      }).sort((a, b) => b.score - a.score || a.index - b.index);
      const next = ranked[0];
      pending.splice(next.index, 1);
      ordered.push(next.candidate);
      for (const source of next.candidate.sourceProviders || [next.candidate.sourceProvider]) if (source) seenSources.add(source);
      if (next.candidate.jurisdiction) seenJurisdictions.add(String(next.candidate.jurisdiction));
      const family = this.canonicalPatentNumber(getPriorArtPublicationNumber(next.candidate));
      if (family) seenFamilies.add(family);
    }
    return ordered;
  }

  private promotePotentialTierCandidatesForGate(
    stage1Data: any,
    stage0Data: NormalizedIdea,
    clusters: ScreeningQueryCluster[]
  ) {
    const candidates = this.getStage1CandidatePool(stage1Data);
    const byPn = stage1Data?.aiRelevance?.byPn || {};
    const reviewed: any[] = [];
    const tier12: any[] = [];
    const remaining: any[] = [];
    for (const candidate of candidates) {
      const pn = getPriorArtPublicationNumber(candidate);
      if (this.getGateRecordForPublication(byPn, pn)) reviewed.push(candidate);
      else if (this.classifyDomainTier(candidate, stage0Data, clusters).tier <= 2) tier12.push(candidate);
      else remaining.push(candidate);
    }
    return {
      ...stage1Data,
      retrievalCandidates: [...reviewed, ...tier12, ...remaining],
      preStopTierScan: {
        scannedCount: candidates.length,
        promotedTier12Count: tier12.length,
        completedAt: new Date().toISOString(),
      },
    };
  }

  private decorateTitleAbstractScreeningMap(
    patentMap: PatentFeatureMap,
    patent: any,
    stage0Data: NormalizedIdea,
    gate: PriorArtGateRecord | undefined,
    clusters: ScreeningQueryCluster[],
    configuredCriticalFeatures: string[]
  ): PatentFeatureMap {
    const features = stage0Data.inventionFeatures || [];
    const featureTypes = this.buildFeatureTypeMap(stage0Data, features);
    const importantFeatures = features.filter(feature => this.isImportantFeature(feature, featureTypes));
    const criticalFeatures = new Set([
      ...configuredCriticalFeatures,
      ...features.filter(feature => featureTypes.get(feature) === 'core_technical'),
    ]);
    const positiveCells = patentMap.feature_analysis.filter(cell => cell.status === 'Present' || cell.status === 'Partial');
    const genericMappedFeatureCount = positiveCells.filter(cell => featureTypes.get(cell.feature) === 'generic_weak').length;
    const noveltyCandidateMappedFeatureCount = positiveCells.filter(cell => featureTypes.get(cell.feature) === 'novelty_candidate' && cell.status === 'Present').length;
    const domainSpecificMappedFeatureCount = positiveCells.filter(cell => {
      const type = featureTypes.get(cell.feature);
      return (type === 'core_technical' || type === 'implementation') && cell.status === 'Present';
    }).length;
    const mappedWeight = importantFeatures.reduce((sum, feature) => {
      const cell = patentMap.feature_analysis.find(item => item.feature === feature);
      const factor = cell?.status === 'Present' ? 1 : cell?.status === 'Partial' ? 0.5 : 0;
      return sum + this.featureWeight(feature, featureTypes) * factor;
    }, 0);
    const totalWeight = importantFeatures.reduce((sum, feature) => sum + this.featureWeight(feature, featureTypes), 0);
    const importantFeatureCoverage = totalWeight > 0 ? this.roundScore(mappedWeight / totalWeight) : 0;
    const importantUnknownCount = importantFeatures.filter(feature => {
      const cell = patentMap.feature_analysis.find(item => item.feature === feature);
      return !cell || cell.status === 'Unknown';
    }).length;
    const importantUnknownRatio = importantFeatures.length ? importantUnknownCount / importantFeatures.length : 0;
    const criticalAbstractPresent = Array.from(criticalFeatures).every(feature => {
      const cell = patentMap.feature_analysis.find(item => item.feature === feature);
      return cell?.status === 'Present' && cell.evidence_source === 'abstract' && Boolean(cell.quote);
    });
    const relationship = this.cooperativeRelationshipEvidence(stage0Data, String(patent?.abstract || ''));
    const domain = this.classifyDomainTier(patent, stage0Data, clusters);
    const genericFeatureOnlyMatch = positiveCells.length > 0 && genericMappedFeatureCount === positiveCells.length;
    const genericityRiskReasons: string[] = [];
    if (genericFeatureOnlyMatch) genericityRiskReasons.push('All positively mapped features are generic.');
    if (genericMappedFeatureCount > domainSpecificMappedFeatureCount + noveltyCandidateMappedFeatureCount) {
      genericityRiskReasons.push('Generic mapped features outnumber domain-specific and novelty-candidate mappings.');
    }
    if (domain.tier >= 4) genericityRiskReasons.push('Domain classification is generic or weakly analogous.');
    const genericityRiskLevel: GenericityRiskLevel = genericFeatureOnlyMatch || genericityRiskReasons.length >= 2
      ? 'HIGH'
      : genericityRiskReasons.length === 1 ? 'MEDIUM' : 'LOW';
    const mappingConfidences = positiveCells.map(cell => Number(cell.mappingConfidence ?? cell.confidence ?? 0)).filter(Number.isFinite);
    const mappingAverage = mappingConfidences.length
      ? mappingConfidences.reduce((sum, value) => sum + value, 0) / mappingConfidences.length
      : 0;
    const gateScore = Number(gate?.rerankScore ?? gate?.score ?? 0);
    const screeningConfidence = this.roundScore(0.55 * gateScore + 0.35 * mappingAverage + 0.10 * (relationship.present ? 1 : 0));
    const legalEvidenceStrength = positiveCells.length
      ? Math.min(...positiveCells.map(cell => Number(cell.legalEvidenceStrength ?? 0.65)))
      : 0;
    const gateDecision = normalizeRerankDecision(gate?.rerankDecision || gate?.decision);
    const relationshipRequired = (stage0Data.noveltyFocusInteractions || []).length > 0;
    const highOverlap = gateDecision === 'accept' && domain.tier <= 2 && criticalAbstractPresent && importantFeatureCoverage >= 0.90 &&
      importantUnknownRatio === 0 && (noveltyCandidateMappedFeatureCount >= 1 || domainSpecificMappedFeatureCount >= 1) &&
      (!relationshipRequired || relationship.present) &&
      !genericFeatureOnlyMatch && genericityRiskLevel !== 'HIGH';
    const matchCategory: PatentScreeningMatchCategory = highOverlap
      ? 'HIGH_ABSTRACT_OVERLAP'
      : positiveCells.some(cell => this.isImportantFeature(cell.feature, featureTypes))
        ? 'COMPONENT_LEVEL_OVERLAP'
        : domain.tier <= 3 ? 'ADJACENT_DOMAIN_ANALOGY' : domain.tier === 4 ? 'WEAK_ANALOGY' : 'NOT_RELEVANT';

    return {
      ...patentMap,
      screeningConfidence,
      evidenceDepth: patent?.abstract && patent?.title ? 'TITLE_AND_ABSTRACT' : patent?.abstract ? 'ABSTRACT_ONLY' : patent?.title ? 'TITLE_ONLY' : 'NONE',
      legalEvidenceStrength,
      domainTier: domain.tier,
      domainTierReason: domain.reason,
      domainTierEvidenceQuote: domain.quote,
      matchCategory,
      genericMappedFeatureCount,
      domainSpecificMappedFeatureCount,
      noveltyCandidateMappedFeatureCount,
      genericityRiskLevel,
      genericityRiskReasons,
      genericFeatureOnlyMatch,
      cooperativeRelationshipPresentInSameAbstract: relationship.present,
      cooperativeRelationshipEvidenceQuote: relationship.quote,
      importantFeatureCoverage,
      importantUnknownRatio,
      queryClusterIds: domain.clusterIds,
    };
  }

  private adaptiveComplexityProfile(stage0Data: NormalizedIdea, maps: PatentFeatureMap[]) {
    const featureTypes = this.buildFeatureTypeMap(stage0Data, stage0Data.inventionFeatures || []);
    const importantCount = (stage0Data.inventionFeatures || []).filter(feature => this.isImportantFeature(feature, featureTypes)).length;
    const conceptCount = (stage0Data.claimConcepts || []).length + (stage0Data.noveltyFocusInteractions || []).length;
    const genericRatio = maps.length
      ? maps.filter(map => map.genericityRiskLevel === 'HIGH' || (map.domainTier || 5) >= 4).length / maps.length
      : 0;
    if (genericRatio > 0.6) return { complexity: 'crowded' as const, batchSize: 8, minimum: 40, maximum: 60 };
    const units = importantCount + conceptCount * 2 + (Number(stage0Data.confidence || 1) < 0.7 ? 2 : 0);
    if (units <= 6) return { complexity: 'simple' as const, batchSize: 4, minimum: 16, maximum: 24 };
    if (units <= 12) return { complexity: 'moderate' as const, batchSize: 6, minimum: 24, maximum: 40 };
    return { complexity: 'complex' as const, batchSize: 8, minimum: 32, maximum: 60 };
  }

  private titleAbstractEvidenceQuality(
    maps: PatentFeatureMap[],
    stage0Data: NormalizedIdea,
    clusters: ScreeningQueryCluster[]
  ): { low: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const featureTypes = this.buildFeatureTypeMap(stage0Data, stage0Data.inventionFeatures || []);
    const important = (stage0Data.inventionFeatures || []).filter(feature => this.isImportantFeature(feature, featureTypes));
    const critical = (stage0Data.inventionFeatures || []).filter(feature => featureTypes.get(feature) === 'core_technical');
    const positive = maps.flatMap(map => map.feature_analysis).filter(cell => cell.status === 'Present' || cell.status === 'Partial');
    const titleOnly = positive.filter(cell => cell.evidenceDepth === 'TITLE_ONLY' || cell.evidence_source === 'title');
    if (positive.length > 0 && titleOnly.length / positive.length > 0.4) reasons.push('More than 40% of positive mappings are title-only.');
    const importantCells = maps.flatMap(map => important.map(feature => map.feature_analysis.find(cell => cell.feature === feature)));
    if (importantCells.length > 0 && importantCells.filter(cell => !cell || cell.status === 'Unknown').length / importantCells.length > 0.3) {
      reasons.push('More than 30% of important feature mappings are Unknown.');
    }
    if (maps.some(map => critical.some(feature => {
      const cell = map.feature_analysis.find(item => item.feature === feature);
      return cell?.evidenceDepth === 'TITLE_ONLY' || cell?.evidence_source === 'title';
    }))) reasons.push('At least one critical feature is supported only by title text.');
    if (maps.some(map => map.matchCategory === 'HIGH_ABSTRACT_OVERLAP' && !map.cooperativeRelationshipEvidenceQuote && map.noveltyCandidateMappedFeatureCount === 0)) {
      reasons.push('A high-overlap candidate lacks an exact abstract relationship or novelty-feature quote.');
    }
    if (maps.length > 0 && maps.filter(map => (map.domainTier || 5) >= 3 || map.genericityRiskLevel === 'HIGH').length / maps.length > 0.6) {
      reasons.push('More than 60% of analyzed candidates are generic or Tier 3-5 analogies.');
    }
    const represented = new Set(maps.flatMap(map => map.queryClusterIds || []));
    if (clusters.some(cluster => cluster.critical && !represented.has(cluster.id))) reasons.push('A critical query cluster lacks a sufficiently specific analyzed abstract.');
    return { low: reasons.length > 0, reasons };
  }

  private adaptiveCoveragePlateauBatches(
    maps: PatentFeatureMap[],
    stage0Data: NormalizedIdea,
    batchSize: number
  ): number {
    const featureTypes = this.buildFeatureTypeMap(stage0Data, stage0Data.inventionFeatures || []);
    const important = new Set((stage0Data.inventionFeatures || []).filter(feature => this.isImportantFeature(feature, featureTypes)));
    const covered = new Set<string>();
    let trailingPlateaus = 0;
    for (const batch of this.createBatches(maps, Math.max(1, batchSize))) {
      const before = covered.size;
      for (const map of batch) {
        for (const cell of map.feature_analysis) {
          if (important.has(cell.feature) && cell.status === 'Present') covered.add(cell.feature);
        }
      }
      trailingPlateaus = covered.size === before ? trailingPlateaus + 1 : 0;
    }
    return trailingPlateaus;
  }

  private buildAdaptiveScreeningProgress(params: {
    maps: PatentFeatureMap[];
    stage0Data: NormalizedIdea;
    stage1Data: any;
    clusters: ScreeningQueryCluster[];
    config: NoveltySearchConfig;
    inputTokens: number;
    outputTokens: number;
    thoughtTokens: number;
    batchesCompleted: number;
  }): AdaptiveScreeningProgress {
    const { maps, stage0Data, stage1Data, clusters, config } = params;
    const adaptive = config.adaptiveAnalysis || this.defaultConfig.adaptiveAnalysis!;
    const candidates = this.getStage1CandidatePool(stage1Data);
    const gateByPn = stage1Data?.aiRelevance?.byPn || {};
    const profile = this.adaptiveComplexityProfile(stage0Data, maps);
    const quality = this.titleAbstractEvidenceQuality(maps, stage0Data, clusters);
    const decisive = maps.find(map => map.matchCategory === 'HIGH_ABSTRACT_OVERLAP' &&
      Number(map.screeningConfidence || 0) >= Number(adaptive.screeningConfidenceThreshold || 0.75) &&
      Number(map.importantFeatureCoverage || 0) >= Number(adaptive.importantCoverageThreshold || 0.90));
    const qaInvalidatedAcceptedCandidate = maps.some(map => {
      const gate = this.getGateRecordForPublication(gateByPn, map.pn);
      return normalizeRerankDecision(gate?.rerankDecision || gate?.decision) === 'accept' &&
        map.matchCategory !== 'HIGH_ABSTRACT_OVERLAP' &&
        map.feature_analysis.some(cell => cell.qaDowngraded);
    });
    const decisiveIndex = decisive ? maps.findIndex(map => map.pn === decisive.pn) : -1;
    const confirmationBatchCompleted = decisiveIndex >= 0 && maps.length - decisiveIndex - 1 >= Math.min(profile.batchSize, Math.max(0, candidates.length - decisiveIndex - 1));
    const confirmationStable = Boolean(decisive && confirmationBatchCompleted && maps.some(map => map.pn === decisive.pn && map.matchCategory === 'HIGH_ABSTRACT_OVERLAP'));
    const queryClusterCoverage = Object.fromEntries(clusters.map(cluster => {
      const gated = candidates.filter(candidate => {
        const domain = this.classifyDomainTier(candidate, stage0Data, clusters);
        const pn = getPriorArtPublicationNumber(candidate);
        return domain.clusterIds.includes(cluster.id) && Boolean(this.getGateRecordForPublication(gateByPn, pn));
      }).length;
      const analyzed = maps.filter(map => (map.queryClusterIds || []).includes(cluster.id)).length;
      return [cluster.id, { gated, analyzed }];
    }));
    const ungatedTier12 = candidates.filter(candidate => {
      const domain = this.classifyDomainTier(candidate, stage0Data, clusters);
      const pn = getPriorArtPublicationNumber(candidate);
      return domain.tier <= 2 && !this.getGateRecordForPublication(gateByPn, pn);
    });
    const uncoveredCriticalCluster = clusters.some(cluster => cluster.critical && (queryClusterCoverage[cluster.id]?.analyzed || 0) === 0);
    const clustersInsufficient = clusters.some(cluster => {
      const coverage = queryClusterCoverage[cluster.id];
      return coverage.gated < 3 && coverage.gated < candidates.filter(candidate => this.classifyDomainTier(candidate, stage0Data, clusters).clusterIds.includes(cluster.id)).length;
    });
    const remainingReviewable = candidates.filter(candidate => {
      const pn = getPriorArtPublicationNumber(candidate);
      const gate = this.getGateRecordForPublication(gateByPn, pn);
      const decision = normalizeRerankDecision(gate?.rerankDecision || gate?.decision);
      return decision === 'accept' || (decision === 'component' && Number(gate?.rerankScore ?? gate?.score ?? 0) >= Number(adaptive.componentScoreThreshold || 0.55));
    }).filter(candidate => !maps.some(map => this.canonicalPatentNumber(map.pn) === this.canonicalPatentNumber(getPriorArtPublicationNumber(candidate))));
    const plateau = this.adaptiveCoveragePlateauBatches(maps, stage0Data, profile.batchSize);
    const saturation = maps.length >= profile.minimum && plateau >= Number(adaptive.saturationPlateauBatches || 2) &&
      ungatedTier12.length === 0 && !clustersInsufficient && !uncoveredCriticalCluster && remainingReviewable.length === 0 && !quality.low;
    const gatedCount = Number(stage1Data?.aiRelevance?.reviewedCount || stage1Data?.reviewedCount || 0);
    const hardCeiling = gatedCount >= Number(adaptive.gateCeiling || 180) ||
      maps.length >= Math.min(profile.maximum, Number(adaptive.deepAnalysisCeiling || 60));
    const exhausted = maps.length >= candidates.length || (remainingReviewable.length === 0 && !stage1Data?.hasMoreCandidates && candidates.length <= maps.length);

    let projectedStopReason: AdaptiveStopReason | undefined;
    if (qaInvalidatedAcceptedCandidate && !decisive) projectedStopReason = 'safe_report_due_to_qa_failure';
    else if (decisive && confirmationStable) projectedStopReason = 'abstract_level_high_overlap_candidate_confirmed';
    else if (hardCeiling) projectedStopReason = 'hard_ceiling_reached';
    else if (saturation) projectedStopReason = 'coverage_saturation';
    else if (exhausted) projectedStopReason = 'candidate_pool_exhausted';
    else if ((ungatedTier12.length > 0 || clustersInsufficient || uncoveredCriticalCluster) && maps.length >= profile.minimum) projectedStopReason = 'provider_or_cluster_coverage_incomplete';

    const terminalStopReason = adaptive.mode === 'enforce' && projectedStopReason && projectedStopReason !== 'provider_or_cluster_coverage_incomplete'
      ? projectedStopReason
      : undefined;
    const estimatedTokensPerPatent = maps.length > 0
      ? (params.inputTokens + params.outputTokens + params.thoughtTokens) / maps.length
      : 0;
    return {
      mode: adaptive.mode,
      complexity: profile.complexity,
      gatedCount,
      analyzedCount: maps.length,
      remainingCount: Math.max(0, candidates.length - maps.length),
      batchesCompleted: params.batchesCompleted,
      projectedStopReason,
      terminalStopReason,
      decisivePatentNumber: decisive?.pn,
      confirmationBatchCompleted,
      confirmationStable,
      evidenceQualityLow: quality.low,
      evidenceQualityReasons: quality.reasons,
      queryClusterCoverage,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      thoughtTokens: params.thoughtTokens,
      projectedTokensSaved: projectedStopReason
        ? Math.max(0, Math.round((candidates.length - maps.length) * estimatedTokensPerPatent))
        : 0,
    };
  }

  private featureWeight(feature: string, featureTypes?: Map<string, InventionFeatureDetail['feature_type']>): number {
    const type = featureTypes?.get(feature) || (this.isGenericNoveltyFeature(feature) ? 'generic_weak' : 'core_technical');
    if (type === 'novelty_candidate') return 1.25;
    if (type === 'core_technical') return 1.0;
    if (type === 'implementation') return 0.6;
    return 0.15;
  }

  private isImportantFeature(feature: string, featureTypes?: Map<string, InventionFeatureDetail['feature_type']>): boolean {
    const type = featureTypes?.get(feature) || (this.isGenericNoveltyFeature(feature) ? 'generic_weak' : 'core_technical');
    return type === 'novelty_candidate' || type === 'core_technical';
  }

  private isStrongPartial(cell?: FeatureMapCell): boolean {
    if (!cell || cell.status !== 'Partial') return false;
    return Number(cell.extent_score || 0) >= 0.55 || Number(cell.confidence || 0) >= 0.65;
  }

  private isMappedCell(cell?: FeatureMapCell): boolean {
    return !!cell && (cell.status === 'Present' || cell.status === 'Partial');
  }

  private isStrongMappedCell(cell?: FeatureMapCell): boolean {
    return !!cell && (cell.status === 'Present' || this.isStrongPartial(cell));
  }

  private cellForFeature(patentMap: PatentFeatureMap, feature: string): FeatureMapCell | undefined {
    return (patentMap.feature_analysis || []).find(cell => cell.feature === feature);
  }

  private mappedFactor(cell?: FeatureMapCell): number {
    if (!cell) return 0;
    if (cell.status === 'Present') return 1;
    if (cell.status === 'Partial') return 0.5;
    return 0;
  }

  private featureCellEvidence(cell?: FeatureMapCell): string {
    if (!cell) return '';
    return [
      cell.quote,
      typeof cell.evidence === 'string' ? cell.evidence : '',
      cell.patent_disclosure,
      cell.reason,
      cell.attorney_remark,
      cell.professional_remark,
    ].filter(Boolean).join(' ');
  }

  private meaningfulRelationshipTokens(value: string): string[] {
    const stop = new Set(['with', 'that', 'from', 'this', 'into', 'based', 'using', 'where', 'while', 'each', 'such', 'their', 'there', 'feature', 'claim', 'concept']);
    return Array.from(new Set(String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 3 && !stop.has(token))))
      .slice(0, 24);
  }

  private relationshipMappedByEvidence(concept: ClaimConcept, patentMap: PatentFeatureMap): { mapped: boolean; evidence: string } {
    const relationshipText = [concept.title, concept.claimableSummary].filter(Boolean).join(' ');
    const relationshipTokens = this.meaningfulRelationshipTokens(relationshipText);
    const relationshipVerbs = relationshipTokens.filter(token =>
      /^(adjust|control|drive|select|compute|detect|monitor|verify|validat|store|record|trigger|correlat|adapt|characteriz|identify|classif|generate)/.test(token)
    );
    const cells = concept.linkedFeatures.map(feature => this.cellForFeature(patentMap, feature)).filter(Boolean) as FeatureMapCell[];
    const evidenceText = [
      patentMap.title,
      (patentMap as any).abstract,
      patentMap.remarks,
      ...cells.map(cell => this.featureCellEvidence(cell)),
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const lowerEvidence = evidenceText.toLowerCase();
    const mappedFeatureCount = concept.linkedFeatures.filter(feature => this.isMappedCell(this.cellForFeature(patentMap, feature))).length;
    const tokenHits = relationshipTokens.filter(token => lowerEvidence.includes(token)).length;
    const verbHit = relationshipVerbs.length === 0 || relationshipVerbs.some(token => lowerEvidence.includes(token));
    const relationshipMapped = mappedFeatureCount >= Math.min(2, concept.linkedFeatures.length) &&
      tokenHits >= Math.min(4, Math.max(2, Math.ceil(relationshipTokens.length * 0.25))) &&
      verbHit;

    if (relationshipMapped) {
      const supporting = cells
        .map(cell => this.featureCellEvidence(cell))
        .find(text => text && this.meaningfulRelationshipTokens(text).some(token => relationshipTokens.includes(token)));
      return {
        mapped: true,
        evidence: normalizeRetrievalText(supporting || evidenceText, 42),
      };
    }

    return {
      mapped: false,
      evidence: mappedFeatureCount > 0
        ? `Feature overlap is present, but the reviewed citation evidence does not show the cooperative relationship: ${concept.claimableSummary || concept.title}.`
        : `No reviewed citation evidence maps the linked features for this claim concept.`,
    };
  }

  private buildClaimConceptMapping(stage0Data: NormalizedIdea, featureMaps: PatentFeatureMap[]): ClaimConceptMapping[] {
    const concepts = Array.isArray(stage0Data.claimConcepts) ? stage0Data.claimConcepts : [];
    if (!concepts.length) return [];

    return concepts.map(concept => {
      const totalFeatures = Math.max(1, concept.linkedFeatures.length);
      const perPatent = featureMaps.map(patentMap => {
        const mappedFeatures = concept.linkedFeatures.filter(feature => this.isMappedCell(this.cellForFeature(patentMap, feature)));
        const weighted = concept.linkedFeatures.reduce((sum, feature) => sum + this.mappedFactor(this.cellForFeature(patentMap, feature)), 0);
        const relationship = this.relationshipMappedByEvidence(concept, patentMap);
        return {
          pn: patentMap.pn,
          mappedFeatures,
          coverage: this.roundScore(weighted / totalFeatures),
          relationshipMapped: relationship.mapped,
          relationshipEvidence: relationship.evidence,
        };
      }).sort((a, b) => {
        if (Number(b.relationshipMapped) !== Number(a.relationshipMapped)) return Number(b.relationshipMapped) - Number(a.relationshipMapped);
        return b.coverage - a.coverage;
      });
      const best = perPatent[0];
      const distributedMapped = concept.linkedFeatures.filter(feature =>
        featureMaps.some(patentMap => this.isMappedCell(this.cellForFeature(patentMap, feature)))
      ).length;
      const distributedCoverage = this.roundScore(distributedMapped / totalFeatures);
      const coverage = best?.coverage || 0;
      const relationshipMapped = Boolean(best?.relationshipMapped && coverage >= 0.75);
      const relationshipRisk: ClaimConceptMapping['relationshipRisk'] = relationshipMapped
        ? 'high'
        : coverage >= 0.75 || distributedCoverage >= 0.75
          ? 'moderate'
          : 'low';
      const reason = relationshipMapped
        ? `A single reviewed citation maps the linked features and the cooperative relationship.`
        : coverage >= 0.75
          ? `A citation maps most linked features, but the cooperative relationship is not fully disclosed.`
          : distributedCoverage >= 0.75
            ? `Linked features are distributed across references without one citation mapping the full cooperative relationship.`
            : `No reviewed citation maps most linked features or their cooperative relationship.`;

      return {
        claimConceptTitle: concept.title,
        linkedFeatures: concept.linkedFeatures,
        mappedFeatures: best?.mappedFeatures.length || 0,
        totalFeatures,
        coverage,
        distributedCoverage,
        bestReference: best?.pn,
        relationshipMapped,
        relationshipEvidence: best?.relationshipEvidence || '',
        relationshipRisk,
        risk: relationshipRisk,
        reason,
      };
    });
  }

  private weightedCoverageForPatent(
    patentMap: PatentFeatureMap,
    inventionFeatures: string[],
    featureTypes?: Map<string, InventionFeatureDetail['feature_type']>,
    importantOnly = false
  ): number {
    let totalWeight = 0;
    let mappedWeight = 0;
    for (const feature of inventionFeatures) {
      if (importantOnly && !this.isImportantFeature(feature, featureTypes)) continue;
      const weight = this.featureWeight(feature, featureTypes);
      totalWeight += weight;
      mappedWeight += weight * this.mappedFactor(this.cellForFeature(patentMap, feature));
    }
    return totalWeight > 0 ? this.roundScore(mappedWeight / totalWeight) : 0;
  }

  private closestMappedPatentPns(
    perPatentCoverage: PerPatentCoverage[],
    limit = 3
  ): string[] {
    return [...perPatentCoverage]
      .sort((a, b) => (
        Number(b.important_coverage_ratio ?? b.coverage_ratio ?? 0) - Number(a.important_coverage_ratio ?? a.coverage_ratio ?? 0)
      ) || (Number(b.coverage_ratio || 0) - Number(a.coverage_ratio || 0)))
      .slice(0, Math.max(0, limit))
      .map(row => row.pn)
      .filter(Boolean);
  }

  private findHighMappedOverlapReference(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    featureTypes?: Map<string, InventionFeatureDetail['feature_type']>
  ): { pn: string; importantCoverage: number; noveltyMapped: boolean; coreCoverage: number } | null {
    const importantFeatures = inventionFeatures.filter(feature => this.isImportantFeature(feature, featureTypes));
    const noveltyFeatures = inventionFeatures.filter(feature => featureTypes?.get(feature) === 'novelty_candidate');
    const coreFeatures = inventionFeatures.filter(feature => (featureTypes?.get(feature) || 'core_technical') === 'core_technical');
    let best: { pn: string; importantCoverage: number; noveltyMapped: boolean; coreCoverage: number } | null = null;
    for (const patentMap of featureMaps) {
      const importantCoverage = this.weightedCoverageForPatent(patentMap, inventionFeatures, featureTypes, true);
      const noveltyMapped = noveltyFeatures.some(feature => this.isStrongMappedCell(this.cellForFeature(patentMap, feature)));
      const coreCoverage = coreFeatures.length > 0
        ? this.roundScore(coreFeatures.filter(feature => this.isStrongMappedCell(this.cellForFeature(patentMap, feature))).length / coreFeatures.length)
        : 0;
      const allImportantFallback = importantFeatures.length === 0 && this.weightedCoverageForPatent(patentMap, inventionFeatures, featureTypes) >= 0.65;
      if (
        (importantCoverage >= 0.65 && (noveltyMapped || coreCoverage >= 0.8)) ||
        allImportantFallback
      ) {
        const candidate = { pn: patentMap.pn, importantCoverage, noveltyMapped, coreCoverage };
        if (!best || candidate.importantCoverage > best.importantCoverage) {
          best = candidate;
        }
      }
    }
    return best;
  }

  private unknownEvidenceStats(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    featureTypes?: Map<string, InventionFeatureDetail['feature_type']>,
    closestPns: string[] = []
  ): { overallUnknownRatio: number; importantUnknownRatio: number; closestImportantUnknownRatio: number } {
    let total = 0;
    let unknown = 0;
    let importantTotal = 0;
    let importantUnknown = 0;
    let closestImportantTotal = 0;
    let closestImportantUnknown = 0;
    const closest = new Set(closestPns);
    for (const patentMap of featureMaps) {
      const isClosest = closest.has(patentMap.pn);
      for (const feature of inventionFeatures) {
        const cell = this.cellForFeature(patentMap, feature);
        total += 1;
        if (!cell || cell.status === 'Unknown') unknown += 1;
        if (this.isImportantFeature(feature, featureTypes)) {
          importantTotal += 1;
          if (!cell || cell.status === 'Unknown') importantUnknown += 1;
          if (isClosest) {
            closestImportantTotal += 1;
            if (!cell || cell.status === 'Unknown') closestImportantUnknown += 1;
          }
        }
      }
    }
    return {
      overallUnknownRatio: total > 0 ? unknown / total : 0,
      importantUnknownRatio: importantTotal > 0 ? importantUnknown / importantTotal : 0,
      closestImportantUnknownRatio: closestImportantTotal > 0 ? closestImportantUnknown / closestImportantTotal : 0,
    };
  }

  private computePerPatentCoverage(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    featureTypes?: Map<string, InventionFeatureDetail['feature_type']>
  ): PerPatentCoverage[] {
    return featureMaps.map(patentMap => {
      const cells = patentMap.feature_analysis;
      const presentCount = cells.filter(c => c.status === 'Present').length;
      const partialCount = cells.filter(c => c.status === 'Partial').length;
      const absentCount = cells.filter(c => c.status === 'Absent').length;
      const coverageRatio = this.weightedCoverageForPatent(patentMap, inventionFeatures, featureTypes);
      const importantCoverageRatio = this.weightedCoverageForPatent(patentMap, inventionFeatures, featureTypes, true);
      const presentOnlyRatio = inventionFeatures.length > 0 ? presentCount / inventionFeatures.length : 0;

      return {
        pn: patentMap.pn,
        present_count: presentCount,
        partial_count: partialCount,
        absent_count: absentCount,
        coverage_ratio: Math.round(coverageRatio * 100) / 100,
        present_only_ratio: Math.round(presentOnlyRatio * 100) / 100,
        important_coverage_ratio: importantCoverageRatio
      };
    });
  }

  private computePerFeatureUniqueness(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    featureTypes?: Map<string, InventionFeatureDetail['feature_type']>,
    closestMappedPns: string[] = []
  ): PerFeatureUniqueness[] {
    const closestSet = new Set(closestMappedPns);
    return inventionFeatures.map(feature => {
      const totalPatents = featureMaps.length;
      const presentIn = featureMaps.filter(p => this.cellForFeature(p, feature)?.status === 'Present').length;
      const partialIn = featureMaps.filter(p => this.cellForFeature(p, feature)?.status === 'Partial').length;
      const absentIn = featureMaps.filter(p => this.cellForFeature(p, feature)?.status === 'Absent').length;
      const unknownIn = featureMaps.filter(p => {
        const status = this.cellForFeature(p, feature)?.status;
        return !status || status === 'Unknown';
      }).length;
      const mappedIn = presentIn + partialIn;
      const closestMaps = featureMaps.filter(p => closestSet.has(p.pn));
      const closestStrongMapped = closestMaps.some(p => this.isStrongMappedCell(this.cellForFeature(p, feature)));

      // Unknown evidence must not increase apparent uniqueness.
      const coverageGap = totalPatents > 0 ? absentIn / totalPatents : 0;
      const featureSeenAnywhere = mappedIn > 0;
      const featureGapAgainstClosestRefs = closestMaps.length > 0 && !closestStrongMapped;
      const combinationSensitive = featureGapAgainstClosestRefs && featureSeenAnywhere;

      return {
        feature,
        present_in: presentIn,
        partial_in: partialIn,
        absent_in: absentIn,
        uniqueness: Math.round(coverageGap * 100) / 100,
        unknown_in: unknownIn,
        mapped_in: mappedIn,
        coverage_gap: Math.round(coverageGap * 100) / 100,
        feature_seen_anywhere: featureSeenAnywhere,
        feature_gap_against_closest_refs: featureGapAgainstClosestRefs,
        combination_sensitive_differentiator: combinationSensitive,
        feature_type: featureTypes?.get(feature),
        weight: this.featureWeight(feature, featureTypes)
      };
    });
  }

  private performIntegrationCheck(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    criticalFeatures: string[]
  ): IntegrationCheck {
    const majorityThreshold = Math.floor(inventionFeatures.length / 2) + 1;

    for (const patentMap of featureMaps) {
      const presentFeatures = patentMap.feature_analysis.filter(c => c.status === 'Present').length;
      const partialFeatures = patentMap.feature_analysis.filter(c => c.status === 'Partial').length;
      const coveredFeatures = presentFeatures + partialFeatures;

      if (coveredFeatures >= majorityThreshold) {
        return {
          any_single_patent_covers_majority: true,
          integration_pn: patentMap.pn,
          explanation: `Patent ${patentMap.pn} maps to ${coveredFeatures}/${inventionFeatures.length} features (${presentFeatures} Present, ${partialFeatures} Partial), which is a majority of the extracted features`
        };
      }
    }

    return {
      any_single_patent_covers_majority: false,
      explanation: 'No single patent maps to a majority of extracted features as Present or Partial'
    };
  }

  private checkUseCaseIntent(patentMap: PatentFeatureMap, inventionFeatures: string[]): boolean {
    // Simple heuristic: check if patent title/abstract contains words that suggest same application context
    // This is a simplified version - in practice might use more sophisticated NLP
    const patentText = `${patentMap.title} ${patentMap.feature_analysis.map(c => c.evidence).join(' ')}`.toLowerCase();

    // Look for common use-case words that suggest same technical field
    const useCaseWords = ['system', 'method', 'apparatus', 'device', 'process', 'using', 'for', 'to'];

    return useCaseWords.some(word => patentText.includes(word));
  }

  private computeNoveltyScore(perFeatureUniqueness: PerFeatureUniqueness[], criticalFeatures: string[]): number {
    if (!Array.isArray(perFeatureUniqueness) || perFeatureUniqueness.length === 0) {
      return 1;
    }

    let totalWeight = 0;
    let novelWeight = 0;

    for (const u of perFeatureUniqueness) {
      const isCritical = criticalFeatures.includes(u.feature);
      const weight = Math.max(Number(u.weight || 1), isCritical ? 1.25 : 0);
      totalWeight += weight;

      let noveltyFactor = 0;
      if (u.feature_gap_against_closest_refs === true) {
        if (u.feature_seen_anywhere) {
          // Seen in weaker/component references: still a closest-reference gap,
          // but not a "unique" feature. Treat as combination-sensitive.
          noveltyFactor = 0.35;
        } else {
          noveltyFactor = Number(u.coverage_gap ?? u.uniqueness ?? 0);
        }
      } else if (u.feature_gap_against_closest_refs === false) {
        noveltyFactor = 0;
      } else if (u.present_in > 0) {
        noveltyFactor = 0;
      } else if (u.partial_in > 0) {
        noveltyFactor = 0.5;
      } else {
        noveltyFactor = Number(u.coverage_gap ?? u.uniqueness ?? 0);
      }

      novelWeight += weight * noveltyFactor;
    }

    if (totalWeight === 0) return 1;

    const noveltyScore = novelWeight / totalWeight;
    return Math.round(noveltyScore * 100) / 100;
  }

  private computeDecisionAndConfidence(
    noveltyScore: number,
    integrationCheck: IntegrationCheck,
    perFeatureUniqueness: PerFeatureUniqueness[],
    patentsAnalyzed: number,
    qualityFlags: any,
    criticalFeatures: string[],
    context?: {
      highMappedOverlap?: { pn: string; importantCoverage: number; noveltyMapped: boolean; coreCoverage: number } | null;
      featureTypes?: Map<string, InventionFeatureDetail['feature_type']>;
      noveltyScore?: number;
    }
  ): { decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence'; confidence: 'High' | 'Medium' | 'Low' } {

    // Low Evidence takes precedence
    if (qualityFlags.low_evidence || patentsAnalyzed < 5) {
      return { decision: 'Low Evidence', confidence: 'Low' };
    }

    let decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';
    const importantRows = perFeatureUniqueness.filter(row => {
      const type = row.feature_type || context?.featureTypes?.get(row.feature);
      return type === 'novelty_candidate' || type === 'core_technical' || (!type && !this.isGenericNoveltyFeature(row.feature));
    });
    const importantScore = this.computeNoveltyScore(
      importantRows.length > 0 ? importantRows : perFeatureUniqueness,
      criticalFeatures
    );

    if (context?.highMappedOverlap) {
      decision = 'Not Novel';
    } else if (integrationCheck.any_single_patent_covers_majority) {
      // Integration passes - check if coverage is dense
      const denseCoverage = this.checkDenseCoverage(perFeatureUniqueness);
      decision = denseCoverage ? 'Not Novel' : 'Partially Novel';
    } else {
      if (importantScore >= 0.7) {
        decision = 'Novel';
      } else if (importantScore >= 0.35) {
        decision = 'Partially Novel';
      } else {
        decision = 'Not Novel';
      }

      if (decision === 'Not Novel' && noveltyScore >= 0.65) {
        decision = 'Partially Novel';
      }
    }

    // Compute confidence
    let confidence: 'High' | 'Medium' | 'Low' = 'Medium';

    if (patentsAnalyzed >= 20 && !qualityFlags.low_evidence && perFeatureUniqueness.filter(u => u.partial_in > 0).length <= Math.max(1, perFeatureUniqueness.length * 0.25)) {
      confidence = 'High';
    } else if (qualityFlags.ambiguous_abstracts || qualityFlags.language_mismatch) {
      confidence = 'Low';
    }

    return { decision, confidence };
  }

  private checkDenseCoverage(perFeatureUniqueness: PerFeatureUniqueness[]): boolean {
    // Dense coverage: â‰¥70% of features have present count â‰¥40% of patents
    const totalFeatures = perFeatureUniqueness.length;
    const denseFeatures = perFeatureUniqueness.filter(u =>
      (u.present_in / (u.present_in + u.partial_in + u.absent_in)) >= 0.4
    ).length;

    return (denseFeatures / totalFeatures) >= 0.7;
  }

  private identifyRiskFactors(
    featureMaps: PatentFeatureMap[],
    perFeatureUniqueness: PerFeatureUniqueness[],
    qualityFlags: any,
    inventionFeatures: string[],
    integrationCheck?: IntegrationCheck,
    decision?: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence',
    context?: {
      highMappedOverlap?: { pn: string; importantCoverage: number; noveltyMapped: boolean; coreCoverage: number } | null;
      distributedComponentRisks?: string[];
      featureTypes?: Map<string, InventionFeatureDetail['feature_type']>;
    }
  ): string[] {
    const risks: string[] = [];

    // Keyword echo risk
    const highKeywordEcho = perFeatureUniqueness.filter(u => u.uniqueness < 0.3).length > inventionFeatures.length * 0.5;
    if (highKeywordEcho) {
      risks.push('High keyword echo risk in multiple references');
    }

    // Generic features
    const genericFeatures = perFeatureUniqueness.filter(u => u.present_in > featureMaps.length * 0.8).length;
    if (genericFeatures > 0) {
      risks.push(`${genericFeatures} features are generic phrasing`);
    }

    // Quality flags
    if (qualityFlags.ambiguous_abstracts) {
      risks.push('Many references have ambiguous or short abstracts');
    }

    if (qualityFlags.low_evidence || featureMaps.length < 5) {
      risks.push('Full patent documents should be reviewed before relying on the mapped-differentiation assessment');
    }

    if (qualityFlags.language_mismatch) {
      risks.push('Multiple references appear to be in non-English languages');
    }

    if (context?.highMappedOverlap) {
      risks.push(`Closest mapped reference ${context.highMappedOverlap.pn} covers important features at ${(context.highMappedOverlap.importantCoverage * 100).toFixed(0)}% weighted coverage`);
    }

    if (integrationCheck?.any_single_patent_covers_majority && integrationCheck.integration_pn) {
      risks.push(`Closest reference ${integrationCheck.integration_pn} maps to a majority of extracted features`);
    }

    const closestMap = this.findClosestFeatureMap(featureMaps, inventionFeatures);
    if (closestMap) {
      const total = Math.max(1, inventionFeatures.length);
      const present = closestMap.feature_analysis.filter(cell => cell.status === 'Present').length;
      const partial = closestMap.feature_analysis.filter(cell => cell.status === 'Partial').length;
      const closestCoverage = this.weightedCoverageForPatent(closestMap, inventionFeatures, context?.featureTypes);
      if (closestCoverage >= 0.7) {
        risks.push(`Closest reference ${closestMap.pn} has high feature overlap (${present} Present, ${partial} Partial)`);
      }
    }

    // Domain saturation
    const lowUniquenessFeatures = perFeatureUniqueness.filter(u => u.uniqueness < 0.2).length;
    if (lowUniquenessFeatures > inventionFeatures.length * 0.3) {
      risks.push('Domain appears saturated with similar technology');
    }

    if (risks.length === 0 && (decision === 'Partially Novel' || decision === 'Not Novel')) {
      risks.push(`${decision} determination indicates material prior-art overlap requiring claim narrowing or technical differentiation`);
    }

    for (const risk of context?.distributedComponentRisks || []) {
      if (risk && !risks.includes(risk)) risks.push(risk);
    }

    return risks;
  }

  private async storeAggregationSnapshot(
    searchId: string,
    aggregationResult: AggregationResult,
    stats: any,
    qualityFlags: any
  ): Promise<void> {
    await (prisma as any).aggregationSnapshot.upsert({
      where: { searchId },
      update: {
        noveltyScore: aggregationResult.novelty_score,
        decision: aggregationResult.decision,
        confidence: aggregationResult.confidence,
        perPatentCoverage: aggregationResult.per_patent_coverage as any,
        perFeatureUniqueness: aggregationResult.per_feature_uniqueness as any,
        integrationCheck: aggregationResult.integration_check as any,
        qualityFlags,
        riskFactors: aggregationResult.risk_factors,
        stats,
        updatedAt: new Date()
      },
      create: {
        searchId,
        noveltyScore: aggregationResult.novelty_score,
        decision: aggregationResult.decision,
        confidence: aggregationResult.confidence,
        perPatentCoverage: aggregationResult.per_patent_coverage as any,
        perFeatureUniqueness: aggregationResult.per_feature_uniqueness as any,
        integrationCheck: aggregationResult.integration_check as any,
        qualityFlags,
        riskFactors: aggregationResult.risk_factors,
        stats,
      }
    });
  }


  private async performStage4(
    searchRun: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: any; reportUrl?: string; error?: string }> {
    try {
      console.log('ðŸ“„ Starting Stage 4: Report Generation');

      // Validate required data for Stage 4 report generation
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      if (!stage0Data || !stage0Data.inventionFeatures || stage0Data.inventionFeatures.length === 0) {
        return {
          success: false,
          error: 'Stage 0 results are required for report generation. Please ensure Stage 0 is completed.'
        };
      }

      const stage1Data = searchRun.stage1Results as unknown as any;
      const stage1CandidatePool = this.getStage1CandidatePool(stage1Data);
      if (!stage1Data || stage1CandidatePool.length === 0) {
        return {
          success: false,
          error: 'Stage 1 results are required for report generation. Please ensure Stage 1 is completed.'
        };
      }

      let aggregationResult = searchRun.stage4Results as unknown as AggregationResult | null;
      const featureMapData = searchRun.stage35Results as unknown as FeatureMapBatchResult | null;
      if (!featureMapData && !aggregationResult) {
        return {
          success: false,
          error: 'Stage 3.5 results are required for report generation. Please ensure Stage 3.5a is completed.'
        };
      }

      // If aggregation was not persisted earlier (no stage4Results), compute it now from 3.5a data
      if (!aggregationResult && featureMapData) {
        const agg = await this.performStage35b(searchRun.id, stage0Data, featureMapData, config, requestHeaders);
        if (!agg.success || !agg.data) {
          return { success: false, error: agg.error || 'Failed to aggregate feature mapping for report' };
        }
        aggregationResult = agg.data;
      }

      if (!aggregationResult) {
        return { success: false, error: 'Aggregation data missing. Please re-run Stage 3.5a.' };
      }

      let aggRes = aggregationResult as AggregationResult;
      if ((!Array.isArray((aggRes as any).per_patent_remarks) || (aggRes as any).per_patent_remarks.length === 0) && featureMapData) {
        const fallbackRemarks = this.buildDeterministicPerPatentRemarks(
          stage0Data,
          featureMapData,
          config.stage35c?.maxPatentsForRemarks || 8
        );
        aggRes = {
          ...(aggRes as any),
          per_patent_remarks: fallbackRemarks,
          per_patent_remarks_source: 'stage4_deterministic_fallback',
          stage35c_complete: false
        } as AggregationResult;
        aggregationResult = aggRes;
        await prisma.noveltySearchRun.update({
          where: { id: searchRun.id },
          data: { stage4Results: aggRes as any }
        });
      }

      // Get feature map cells from database (including any overrides)
      const featureMapCells = await this.getFeatureMapCellsWithOverrides(searchRun.id);

      // Select top patents for detailed analysis, filtered to those with â‰¥1 matching feature
      const selectedPatents = this.selectPatentsByGreedyCoverage(
        aggRes.per_patent_coverage,
        featureMapCells,
        stage0Data.inventionFeatures || [],
        Array.isArray(stage1Data?.pqaiResults) && stage1Data.pqaiResults.length > 0 ? stage1Data.pqaiResults : stage1CandidatePool
      );

      console.log(`ðŸ“Š Generating report with ${aggRes.decision} decision, score ${aggRes.novelty_score}`);

      // Build the feature-patent matrix for the report
      const featureMatrix = this.buildFeaturePatentMatrix(
        stage0Data.inventionFeatures || [],
        featureMapCells,
        config.stage4.maxRefsForReportMain
      );

      // Get top references sorted by coverage ratio
      const topReferences = this.getTopReferences(
        aggRes.per_patent_coverage,
        config.stage4.maxRefsForReportMain
      );

      // Prepare report inputs
      const reportInputs = this.prepareReportInputs(
        searchRun,
        stage0Data,
        aggRes,
        featureMapCells,
        config
      );

      // Prepare enhanced report inputs with selected patents
      const selectedPatentsSummary = selectedPatents.map(p => {
        const present = Array.isArray(p.mappings) ? p.mappings.filter((m: any) => (m.status || '').toString() === 'Present').length : 0;
        const partial = Array.isArray(p.mappings) ? p.mappings.filter((m: any) => (m.status || '').toString() === 'Partial').length : 0;
        return {
          patent_number: p.patentNumber,
          coverage_ratio: p.coverageRatio,
          avg_feature_overlap: Number((p.avgFeatureOverlap || 0).toFixed(3)),
          pqai_relevance: p.pqaiRelevance || 0,
          present_count: present,
          partial_count: partial
        };
      });

      const enhancedReportInputs = {
        invention_features: stage0Data.inventionFeatures || [],
        selected_patents: selectedPatentsSummary,
        search_metadata: {
          search_id: searchRun.id,
          search_date: searchRun.createdAt,
          jurisdiction: config.jurisdiction,
          total_patents_found: aggregationResult.per_patent_coverage.length,
          selected_patents_count: selectedPatents.length,
          // Added context to expand the Stage 4 summary
          pqai_initial_count: stage1CandidatePool.length,
          ai_relevance_accepted: Array.isArray(stage1Data?.aiRelevance?.accepted) ? stage1Data.aiRelevance.accepted.length : undefined,
          ai_relevance_component: Array.isArray(stage1Data?.aiRelevance?.component) ? stage1Data.aiRelevance.component.length : undefined,
          ai_relevance_borderline: Array.isArray(stage1Data?.aiRelevance?.borderline) ? stage1Data.aiRelevance.borderline.length : undefined
        },
        patent_details: selectedPatents.map(patent => ({
          patent_number: patent.patentNumber,
          title: patent.title || 'Untitled Patent',
          link: patent.link || `https://patents.google.com/patent/${patent.patentNumber}`,
          coverage_ratio: patent.coverageRatio,
          avg_feature_overlap: patent.avgFeatureOverlap,
          pqai_relevance: patent.pqaiRelevance || 0,
          abstract: ('' + (patent.abstract || '')).substring(0, 1800),
          mappings: patent.mappings
        })),
        feature_analysis_matrix: selectedPatents.map(patent => ({
          patent: patent.patentNumber,
          ...Object.fromEntries(
            (stage0Data.inventionFeatures || []).map((feature, index) => [
              `kf${index + 1}`,
              patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage || 0
            ])
          )
        })),
        structured_narrative: aggRes.structured_narrative || {}
      };

      // Execute LLM call for enhanced analytical report generation using attorney-style V3 prompt
      let basePrompt = STAGE4_REPORT_PROMPT_V3
        .replace('{invention_features}', JSON.stringify(enhancedReportInputs.invention_features))
        .replace('{selected_patents}', JSON.stringify(enhancedReportInputs.selected_patents))
        .replace('{search_metadata}', JSON.stringify(enhancedReportInputs.search_metadata))
        .replace('{feature_analysis_matrix}', JSON.stringify(enhancedReportInputs.feature_analysis_matrix))
        .replace('{structured_narrative}', JSON.stringify(enhancedReportInputs.structured_narrative))
        .replace(/SEARCH_ID/g, enhancedReportInputs.search_metadata.search_id)
        .replace(/GENERATION_DATE/g, new Date().toISOString().split('T')[0])
        .replace(/TOTAL_COUNT/g, enhancedReportInputs.search_metadata.total_patents_found.toString())
        .replace(/SELECTED_COUNT/g, enhancedReportInputs.search_metadata.selected_patents_count.toString())
        .replace(/SEARCH_DATE/g, enhancedReportInputs.search_metadata.search_date)
        .replace(/SEARCH_JURISDICTION/g, enhancedReportInputs.search_metadata.jurisdiction);

      // Provide abstracts/evidence for selected patents as additional context (do not echo back)
      basePrompt += "\n\nSupporting context (do not restate): PATENT_DETAILS_JSON=" + JSON.stringify(enhancedReportInputs.patent_details);

      // Expand summary to describe the full pipeline and selection logic for user confidence
      basePrompt += "\n\nOUTPUT CONTENT REQUIREMENTS:";
      basePrompt += "\n- In executive_summary.summary, state: initial PQAI results (search_metadata.pqai_initial_count); direct accepted, component/feature-level, and borderline counts from AI Relevance (if present); final selected_patents_count; and the selection logic (greedy feature coverage).";
      basePrompt += "\n- Under concluding_remarks, keep key_strengths/risks/recommendations and also include:";
      basePrompt += "\n  â€¢ 'advisory' field: Do NOT give legal conclusions; advise deep analysis of selected patents and next steps.";
      basePrompt += "\n  â€¢ 'patent_numbers' array listing the selected patent_number values for user review.";
      basePrompt += "\n- Add 'per_patent_analysis' array with detailed entries per selected/relevant patent using this format:";
      basePrompt += "\n  {";
      basePrompt += "\n    pn: patent_number,";
      basePrompt += "\n    title: patent_title,";
      basePrompt += "\n    relevance: 0.0-1.0 score (how relevant to our invention),";
      basePrompt += "\n    novelty_threat: 'high_overlap' | 'moderate_overlap' | 'related' | 'low_overlap',";
      basePrompt += "\n    summary: 1-2 sentence explanation of the reviewed citation record relationship to our invention,";
      basePrompt += "\n    detailedAnalysis: {";
      basePrompt += "\n      summary: brief overview,";
      basePrompt += "\n      relevant_parts: [specific overlapping elements from reviewed citation records],";
      basePrompt += "\n      irrelevant_parts: [elements not mapped in the reviewed citation record],";
      basePrompt += "\n      novelty_comparison: evidence-based comparison without legal conclusions";
      basePrompt += "\n    }";
      basePrompt += "\n  }";
      basePrompt += "\n  Only include patents with relevance >= 0.3 (filter out remote/irrelevant ones).";

      // Enforce a critical, examiner-style stance and explicit decision policy
      basePrompt += "\n\nCRITICAL STANCE AND DECISION RULES:";
      basePrompt += "\n- You are an objective, skeptical examiner. Do not justify the idea; challenge it.";
      basePrompt += "\n- Be evidence-driven; avoid advocacy language and generic fluff.";
      basePrompt += "\n- Treat unknown/insufficient-evidence cells as weaknesses that lower confidence.";
      basePrompt += "\n- Decision policy: If any single patent maps to >= 60% of features AND all critical features in the reviewed citation record, classify it as high mapped overlap unless a concrete, technical differentiator is clearly evidenced.";
      basePrompt += "\n- Do not repeat source-scope limitations in the body. Full patent document review will be stated in the report disclaimer.";
      basePrompt += "\n- If features are scattered across multiple patents without integration, state this plainly as distributed component coverage; do not describe scattered component coverage as one-reference anticipation of the full invention.";

      if (isIdeaBankGenerationEnabled()) {
      // Request new patent ideas for the Idea Bank using the same creative brief used in drafting's AI relevance review
      const __ideaGenRefs = (enhancedReportInputs.patent_details || [])
        .map((p: any) => `PN: ${p.patent_number}\nTitle: ${p.title}\nAbstract: ${String(p.abstract||'').slice(0,400)}`)
        .join('\n\n');

      basePrompt += `\n\nIDEA GENERATION (for idea_bank_suggestions):\n`;
      basePrompt += `You are a dual-headed entity:\n`;
      basePrompt += `- Left brain: ruthless patent examiner who kills any idea that is obvious under 35 U.S.C. §103 or abstract under §101.\n`;
      basePrompt += `- Right brain: visionary CTO who invents only “white-space” solutions that make the cited references obsolete.\n`;
      basePrompt += `Both brains must co-sign every concept or it is rejected.\n`;

      basePrompt += `\nINVENTION CONTEXT:\nTitle: ${String(searchRun.title || '')}\nSearch Query: ${String((stage0Data as any)?.searchQuery || '')}\n`;
      
      basePrompt += `\nCORE OBJECTIVE:\n`;
      basePrompt += `The user is looking for "White Space" inventions—areas where no patent currently exists.\n`;
      basePrompt += `Do not just improve the references. Make them obsolete.\n`;
      basePrompt += `Think from First Principles: What is the fundamental physics/logic limit here, and how do we bypass it?\n`;

      basePrompt += `\nINVENTION BRIEFING:\n`;
      basePrompt += `Generate exactly 5 patent-grade concepts that:\n`;
      basePrompt += `1. Are **orthogonal** to every mechanism disclosed in REFERENCES.\n`;
      basePrompt += `2. Contain at least one **physical structure** or **chemical composition** (no pure algorithms, no “AI to optimize”).\n`;
      basePrompt += `3. Can be **enabled** by a PHOSITA with only routine experimentation (no perpetual motion, no room-temperature superconductors unless you supply the formula).\n`;
      basePrompt += `4. Pass the **“cold shower” test**: if you woke up tomorrow and read the claim on the front page of TechCrunch, you would think “wow, that’s clever—and nobody did that before.”\n`;

      basePrompt += `\nCREATIVITY FILTERS (apply ≥1 per idea):\n`;
      basePrompt += `A. **Anti-Solution**: Invert the primary physical state (e.g., if it's rigid, make it fluid; if it's centralized, make it swarm-based).\n`;
      basePrompt += `B. **Resource Starvation**: Design for zero electricity, zero RF bandwidth, or zero rare-earth materials.\n`;
      basePrompt += `C. **Biomimicry**: Copy a biological mechanism that has **no** existing engineering analog in the field.\n`;
      basePrompt += `D. **Dimensional Shift**: Replace spatial hardware with temporal encoding, or vice-versa.\n`;
      basePrompt += `E. **Cross-Pollination**: Import a physical phenomenon from an unrelated domain (e.g., high-frequency trading latency-arbitrage → ultrasonic acoustic arbitrage in concrete sensing).\n`;

      basePrompt += `\nOUTPUT SCHEMA (embed inside the overall JSON under key 'idea_bank_suggestions'):\n`;
      basePrompt += `Array of 3-5 objects with fields:\n`;
      basePrompt += `{\n`;
      basePrompt += `  "title": "≤12 words, technical, no fluff",\n`;
      basePrompt += `  "core_principle": "One sentence problem statement anchored in white space, followed by: Unlike standard approaches that use X, this embodiment uses Y (2-3 sentences, physical detail)",\n`;
      basePrompt += `  "expected_advantage": "Concrete commercial scenario with $-size if possible",\n`;
      basePrompt += `  "tags": ["technical-domain", "application", "disruption-type", "cross-discipline"],\n`;
      basePrompt += `  "non_obvious_extension": "Exact sentence from REFERENCES that this idea avoids (Cross-ref Killshot)"\n`;
      basePrompt += `}\n`;

      basePrompt += `\nREFERENCE SNAPSHOTS (Analyze these to find what to AVOID or DISRUPT):\n${__ideaGenRefs}`;
      }

      // If no intersecting patents, add explicit instruction for the report
      if (!selectedPatents || selectedPatents.length === 0) {
        basePrompt += `\n\nNOTE_TO_MODEL: No prior art with intersecting features (Present/Partial) was found in Stage 3.5. Generate the report focusing on Stage 0 features, mapped-differentiation rationale, and explain that no overlapping evidence was identified.`;
      }

      // Stage 4 prompt is built below using filtered + trimmed remarks (Tier 1 optimization)

      const allRemarks: any[] = Array.isArray((aggregationResult as any)?.per_patent_remarks)
        ? (aggregationResult as any).per_patent_remarks
        : [];

      // Filter per_patent_remarks to only the top patents selected by greedy coverage
      // (typically 5-6) + any remaining with novelty_threat 'high'. The full set of 60
      // patents caused prompt payloads >300K tokens; the tail patents never appear in the
      // final report and just waste context.
      const selectedPNs = new Set(selectedPatents.map(p => p.patentNumber));
      const stage4RemarksForPrompt = allRemarks.filter(r => {
        const pn = r.pn || r.patent_number || '';
        return selectedPNs.has(pn) || r.novelty_threat === 'high';
      }).slice(0, Math.max(10, selectedPatents.length + 4));

      // Strip verbose/redundant fields from comparison_rows before serializing:
      // - user_invention_disclosure repeats the user's own text per feature per patent
      // - detailedAnalysis duplicates what comparison_rows already encode
      const trimmedRemarks = stage4RemarksForPrompt.map((remark: any) => {
        const { detailedAnalysis, ...rest } = remark;
        const rows = Array.isArray(rest.comparison_rows) ? rest.comparison_rows.map((row: any) => {
          const { user_invention_disclosure, crisp_remark, attorney_remark, novelty_impact, claim_review_note, ...kept } = row;
          return kept;
        }) : rest.comparison_rows;
        return { ...rest, comparison_rows: rows };
      });

      // Build a lightweight summary of ALL studied patents (including those not in the
      // detailed remarks) so the report can reference the full corpus of work.
      const studiedPatentsSummary = allRemarks
        .filter(r => !selectedPNs.has(r.pn || r.patent_number || ''))
        .map((r: any) => ({
          pn: r.pn || r.patent_number,
          title: r.title || '',
          relevance: r.relevance || 'low',
          novelty_threat: r.novelty_threat || 'none',
        }));

      const reportMetrics = {
        novelty_score: aggRes.novelty_score,
        decision: aggRes.decision,
        confidence: aggRes.confidence,
        closest_mapped_references: (aggRes as any).closest_mapped_references || [],
        distributed_component_risks: (aggRes as any).distributed_component_risks || [],
        potential_differentiators: this.getPotentialDifferentiatorsFromAggregation(aggRes),
        coverage_summary: (aggRes as any).feature_coverage_summary || null,
        total_patents_studied: allRemarks.length,
        patents_in_detail: stage4RemarksForPrompt.length
      };
      basePrompt = STAGE4_REPORT_PROMPT_FROM_REMARKS_V3
        + "\ninvention_features=" + JSON.stringify(stage0Data.inventionFeatures || [])
        + "\nper_patent_remarks=" + JSON.stringify(trimmedRemarks)
        + "\nsearch_metadata=" + JSON.stringify(enhancedReportInputs.search_metadata)
        + "\nmetrics=" + JSON.stringify(reportMetrics)
        + "\nadditional_patents_studied=" + JSON.stringify(studiedPatentsSummary);
      if (stage4RemarksForPrompt.length === 0) {
        basePrompt += "\nNOTE_TO_MODEL: No per-patent remarks were available. Produce a Requires Full-Text Review report and explain that novelty cannot be inferred from unmapped analysis.";
      }
      basePrompt = basePrompt
        .replace(/- Left brain: ruthless patent examiner[^\n]+/g, '- Left brain: skeptical technical reviewer who rejects ideas directly mapped by the references or unsupported by concrete technical detail.')
        .replace(/"non_obvious_extension": "Exact sentence from REFERENCES[^"]+"/g, '"non_obvious_extension": "Concrete technical distinction from REFERENCES"');

      // Use admin-configured model via NOVELTY_REPORT_GENERATION stage
      console.log(` [Stage4] Attempting report generation with admin-configured model`);
      let llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        { taskCode: TaskCode.LLM6_REPORT_GENERATION, stageCode: 'NOVELTY_REPORT_GENERATION', prompt: basePrompt }
      );

      // The gateway handles fallbacks via admin configuration, but log if first attempt fails
      if (!llmResult.success || !llmResult.response) {
        console.warn(`[Stage4] Report generation failed: ${llmResult.error?.message || 'Unknown error'}`);
      }

      if (!llmResult.success || !llmResult.response) {
        console.warn('LLM report generation failed, using fallback structure');
        return {
          success: true,
          data: this.generateFallbackReportData(searchRun, stage0Data, aggregationResult, config, selectedPatents),
          reportUrl: undefined
        };
      }

      // Parse the modern report structure (robust to truncation/non-JSON wrappers)
      let reportData: any;
      try {
        reportData = this.parseLLMResponse(llmResult.response.output);
      } catch (parseError) {
        console.warn('LLM report JSON parse failed, falling back to deterministic report:', parseError);
        return {
          success: true,
          data: this.generateFallbackReportData(searchRun, stage0Data, aggRes, config, selectedPatents),
          reportUrl: undefined
        };
      }

      // Domain validation: if LLM content appears off-topic vs Stage 0, drop LLM prose and use deterministic
      if (!this.validateReportDomain(stage0Data, reportData)) {
        console.warn('âš ï¸ LLM report appears off-topic. Using deterministic report content.');
        reportData = {};
      }

      // Enhance with deterministic data
      // Normalize and extract idea bank suggestions if present
      const extractIdeas = (data: any): Array<any> => {
        const raw = data?.idea_bank_suggestions || data?.new_ideas || data?.ideas || [];
        if (!Array.isArray(raw)) return [];
        return raw.map((ib: any) => ({
          title: String(ib.title || ib.ideaTitle || '').slice(0, 200),
          core_principle: String(ib.core_principle || ib.corePrinciple || '').slice(0, 2000),
          expected_advantage: String(ib.expected_advantage || '').slice(0, 500),
          tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
          non_obvious_extension: String(ib.non_obvious_extension || '').slice(0, 1000)
        })).filter((x: any) => x.title);
      };
      // Extract ideas from report (fallback if dedicated call fails)
      const ideaBankGenerationEnabled = isIdeaBankGenerationEnabled();
      const reportIdeas = ideaBankGenerationEnabled ? extractIdeas(reportData) : [];

      // === DEDICATED IDEA BANK GENERATION ===
      // Use IDEA_BANK_GENERATION stage for unified management with drafting pipeline
      // This allows admins to configure idea generation model from one place
      let ideaBank = reportIdeas; // Default to ideas from report
      
      if (ideaBankGenerationEnabled) {
        try {
          console.log('[Stage4] Generating ideas via dedicated IDEA_BANK_GENERATION stage...');
          const ideaGenResult = await this.generateIdeaBankSuggestions(
            searchRun,
            stage0Data,
            enhancedReportInputs.patent_details || [],
            requestHeaders
          );
          
          if (ideaGenResult && ideaGenResult.length > 0) {
            console.log(`[Stage4] Dedicated idea generation produced ${ideaGenResult.length} ideas`);
            ideaBank = ideaGenResult;
          } else if (reportIdeas.length > 0) {
            console.log(`[Stage4] Using ${reportIdeas.length} ideas from report (fallback)`);
          }
        } catch (ideaGenError) {
          console.warn('[Stage4] Dedicated idea generation failed, using report ideas:', ideaGenError);
          // Fall back to ideas extracted from report
        }
      } else {
        console.log('[Stage4] Idea Bank generation disabled; skipping idea suggestions.');
      }

      const finalReportData = {
        ...this.enhanceReportWithDeterministicData(reportData, aggRes, reportInputs),
        idea_bank_suggestions: ideaBank
      };

      // === TRIGGER UNIFIED IDEA BANK FUNNEL ASYNCHRONOUSLY ===
      // Old synchronous persistence removed - now using unified funnel with:
      // - Stream A: Cross-Domain Applications
      // - Stream B: Technology Combinations  
      // - Stream C: LLM Validation Layer (approves/rejects before persistence)
      if (ideaBankGenerationEnabled && searchRun.userId && aggRes.per_patent_coverage?.length > 0) {
        // Build prior art analysis in unified format for the funnel
        const priorArtForFunnel: PriorArtAnalysisItem[] = (enhancedReportInputs.patent_details || []).map((p: any, idx: number) => {
          const coverage = aggRes.per_patent_coverage?.[idx];
          const perPatentAnalysis = reportData?.concluding_remarks?.per_patent_analysis?.find(
            (a: any) => a.pn === p.patent_number || a.patent_number === p.patent_number
          );
          
          return {
            pn: p.patent_number || '',
            title: p.title || '',
            abstract: p.abstract || '',
            relevance: coverage?.coverage_ratio || 0.5,
            novelty_threat: perPatentAnalysis?.novelty_threat || 'related',
            summary: perPatentAnalysis?.summary || '',
            detailedAnalysis: {
              summary: perPatentAnalysis?.detailedAnalysis?.summary || '',
              relevant_parts: perPatentAnalysis?.detailedAnalysis?.relevant_parts || [],
              irrelevant_parts: perPatentAnalysis?.detailedAnalysis?.irrelevant_parts || [],
              novelty_comparison: perPatentAnalysis?.detailedAnalysis?.novelty_comparison || ''
            }
          } as PriorArtAnalysisItem;
        }).filter((p: PriorArtAnalysisItem) => p.pn && p.relevance >= 0.3);

        const funnelInput: IdeaFunnelInput = {
          source: 'novelty_search',
          invention: {
            title: searchRun.title || '',
            abstract: (stage0Data as any)?.abstract || '',
            features: stage0Data.inventionFeatures || [],
            searchQuery: stage0Data.searchQuery || ''
          },
          priorArtAnalysis: priorArtForFunnel,
          userId: searchRun.userId,
          searchRunId: searchRun.id,
          requestHeaders: requestHeaders || {}
        };

        console.log('[Stage4] Triggering Idea Bank Funnel asynchronously...');
        ideaBankFunnel.processIdeasAsync(funnelInput).catch(err => {
          console.error('[Stage4] Idea Bank Funnel failed:', err);
        });
      }

      // PDF export removed for novelty report path
      let reportUrl: string | undefined = undefined;

      // Record LLM call
      await prisma.noveltySearchLLMCall.create({
        data: {
          searchId: searchRun.id,
          stage: NoveltySearchStage.STAGE_4,
          taskCode: TaskCode.LLM6_REPORT_GENERATION,
          prompt: basePrompt,
          response: llmResult.response?.output,
          tokensUsed: llmResult.response?.outputTokens,
          modelClass: llmResult.response?.modelClass,
        },
      });

      console.log(' Stage 4 completed successfully');
      return { success: true, data: finalReportData, reportUrl };

    } catch (error) {
      console.error('Stage 4 error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 4 failed'
      };
    }
  }

  // === DEDICATED IDEA BANK GENERATION ===
  /**
   * Generate idea bank suggestions using the unified IDEA_BANK_GENERATION stage
   * This allows admins to configure the idea generation model from one place
   * Same model configuration is used by both drafting pipeline and novelty search
   */
  private async generateIdeaBankSuggestions(
    searchRun: any,
    stage0Data: NormalizedIdea,
    patentDetails: any[],
    requestHeaders?: Record<string, string>
  ): Promise<Array<{
    title: string;
    core_principle: string;
    expected_advantage: string;
    tags: string[];
    non_obvious_extension: string;
  }>> {
    if (!isIdeaBankGenerationEnabled()) {
      console.log('[IdeaBankGeneration] Disabled; skipping dedicated idea generation');
      return [];
    }

    const title = String(searchRun.title || '');
    const query = String((stage0Data as any)?.searchQuery || '');
    
    // Build reference snapshots for idea generation
    const candidatesText = patentDetails
      .slice(0, 10)
      .map((p: any) => `PN: ${p.patent_number}\nTitle: ${p.title}\nAbstract: ${String(p.abstract || '').slice(0, 400)}`)
      .join('\n\n');

    if (!candidatesText.trim()) {
      console.log('[IdeaBankGeneration] No patent references available, skipping idea generation');
      return [];
    }

    const ideaPrompt = `You are a dual-headed entity:
- Left brain: ruthless patent examiner who kills any idea that is obvious under 35 U.S.C. §103 or abstract under §101.
- Right brain: visionary CTO who invents only "white-space" solutions that make the cited references obsolete.

Both brains must co-sign every concept or it is rejected.

INVENTION CONTEXT:
Title: ${title}
Search Query: ${query}

CORE OBJECTIVE:
The user is looking for "White Space" inventions—areas where no patent currently exists.
Do not just improve the references. Make them obsolete.
Think from First Principles: What is the fundamental physics/logic limit here, and how do we bypass it?

INVENTION BRIEFING:
Generate exactly 5 patent-grade concepts that:
1. Are **orthogonal** to every mechanism disclosed in REFERENCES.
2. Contain at least one **physical structure** or **chemical composition** (no pure algorithms, no "AI to optimize").
3. Can be **enabled** by a PHOSITA with only routine experimentation (no perpetual motion, no room-temperature superconductors unless you supply the formula).
4. Pass the **"cold shower" test**: if you woke up tomorrow and read the claim on the front page of TechCrunch, you would think "wow, that's clever—and nobody did that before."

CREATIVITY FILTERS (apply ≥1 per idea):
A. **Anti-Solution**: Invert the primary physical state (e.g., if it's rigid, make it fluid; if it's centralized, make it swarm-based).
B. **Resource Starvation**: Design for zero electricity, zero RF bandwidth, or zero rare-earth materials.
C. **Biomimicry**: Copy a biological mechanism that has **no** existing engineering analog in the field.
D. **Dimensional Shift**: Replace spatial hardware with temporal encoding, or vice-versa.
E. **Cross-Pollination**: Import a physical phenomenon from an unrelated domain (e.g., high-frequency trading latency-arbitrage → ultrasonic acoustic arbitrage in concrete sensing).

OUTPUT SPECIFICATION:
Return ONLY valid JSON with exactly this schema.
{
  "idea_bank_suggestions": [
    {
      "title": "≤12 words, technical, no fluff",
      "core_principle": "One sentence problem statement anchored in white space, followed by: Unlike standard approaches that use X, this embodiment uses Y (2-3 sentences, physical detail)",
      "expected_advantage": "Concrete commercial scenario with $-size if possible",
      "tags": ["technical-domain", "application", "disruption-type", "cross-discipline"],
      "non_obvious_extension": "Exact sentence from REFERENCES that this idea avoids (Cross-ref Killshot)"
    }
  ]
}

GENERATE 5 RADICAL IDEAS.

REFERENCE SNAPSHOTS (Analyze these to find what to AVOID or DISRUPT):
${candidatesText}`;
    const safeIdeaPrompt = ideaPrompt
      .replace(/- Left brain: ruthless patent examiner[^\n]+/g, '- Left brain: skeptical technical reviewer who rejects ideas directly mapped by the references or unsupported by concrete technical detail.')
      .replace(/"non_obvious_extension": "Exact sentence from REFERENCES[^"]+"/g, '"non_obvious_extension": "Concrete technical distinction from REFERENCES"');

    // Use dedicated IDEA_BANK_GENERATION stage - unified with drafting pipeline
    // Admin can configure this model from Super Admin LLM Config panel
    const ideaResult = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: TaskCode.LLM6_REPORT_GENERATION,  // Task code for metering
        stageCode: 'IDEA_BANK_GENERATION',          // Unified stage for idea generation
        prompt: safeIdeaPrompt,
        idempotencyKey: crypto.randomUUID(),
        inputTokens: Math.ceil(safeIdeaPrompt.length / 4),
        parameters: {
          temperature: 0.9,  // High creativity for idea generation
          topP: 0.95
        },
        metadata: {
          searchRunId: searchRun.id,
          purpose: 'idea_bank_generation'
        }
      }
    );

    console.log('[IdeaBankGeneration] Model used:', ideaResult?.response?.modelClass || 'unknown');

    if (!ideaResult.success || !ideaResult.response) {
      console.warn('[IdeaBankGeneration] LLM call failed:', ideaResult.error?.message);
      return [];
    }

    try {
      const txt = (ideaResult.response.output || '').trim();
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      const json = start !== -1 && end !== -1 ? txt.substring(start, end + 1) : txt;
      const parsed = JSON.parse(json);
      const ideas = Array.isArray(parsed?.idea_bank_suggestions) ? parsed.idea_bank_suggestions : [];
      
      // Normalize and validate ideas
      return ideas.map((ib: any) => ({
        title: String(ib.title || '').slice(0, 200),
        core_principle: String(ib.core_principle || '').slice(0, 2000),
        expected_advantage: String(ib.expected_advantage || '').slice(0, 500),
        tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
        non_obvious_extension: String(ib.non_obvious_extension || '').slice(0, 1000)
      })).filter((x: any) => x.title);
    } catch (e) {
      console.warn('[IdeaBankGeneration] JSON parse failed:', e);
      return [];
    }
  }

  // Stage 3.5a Helper Methods
  /**
   * Validate that LLM report content is on-topic with Stage 0 invention
   */
  private validateReportDomain(stage0Data: NormalizedIdea, llmReport: any): boolean {
    try {
      const title = (stage0Data as any)?.title || '';
      const query = stage0Data?.searchQuery || '';
      const features: string[] = Array.isArray(stage0Data?.inventionFeatures) ? stage0Data.inventionFeatures : [];
      const topicTokens = (title + ' ' + query + ' ' + features.join(' ')).toLowerCase();

      // If no topic info, skip validation
      if (!topicTokens.trim()) return true;

      const text = JSON.stringify(llmReport || {}).toLowerCase();

      // Require at least two topic tokens to appear
      const topicHints = features.slice(0, 6).concat((query || '').split(/\s+/).slice(0, 6));
      const topicMatchCount = topicHints.filter(h => !!h && h.length > 3 && text.includes(h.toLowerCase())).length;

      // Flag common off-topic domains
      const offTopicKeywords = ['vehicle', 'autonomous vehicle', 'traffic', 'ride-share', 'road', 'fleet'];
      const offTopicHits = offTopicKeywords.filter(k => text.includes(k)).length;

      // Heuristic: if off-topic hits are high and topic matches are low => invalid
      if (offTopicHits >= 2 && topicMatchCount < 2) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  private normalizePatentsForFeatureMapping(pqaiResults: any[], maxRefsTotal: number): any[] {
    // Canonicalize PN (strip kind code), deduplicate, trim abstracts, drop entries without title/abstract
    const seen = new Set<string>();
    const normalized: any[] = [];

    for (const patent of pqaiResults.slice(0, maxRefsTotal)) {
      const pn = patent.publicationNumber || patent.publication_number || '';
      const canonicalPn = pn.replace(/[A-Z]\d*$/, ''); // Strip kind code for grouping

      if (!seen.has(canonicalPn) && patent.title && patent.abstract) {
        seen.add(canonicalPn);
        normalized.push({
          ...patent,
          canonicalPn,
          title: patent.title.substring(0, 200), // Truncate long titles
          abstract: patent.abstract.substring(0, 180) // Trim abstracts to ≤180 words
        });
      }
    }

    return normalized;
  }

  private normalizePatentsForFeatureMappingV2(pqaiResults: any[], maxRefsTotal: number): any[] {
    const seen = new Set<string>();
    const normalized: any[] = [];
    const take = Array.isArray(pqaiResults) ? pqaiResults.slice(0, maxRefsTotal) : [];

    for (const patent of take) {
      const pnAny = patent.publicationNumber || patent.publication_number || patent.pn || patent.id || '';
      const compactPn = String(pnAny).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const canonicalPn = compactPn.startsWith('PAPER') ? compactPn : compactPn.replace(/[A-Z]\d*$/, '');
      if (!canonicalPn) continue;
      if (seen.has(canonicalPn)) continue;

      const titleStr = String(
        patent.title || (typeof patent.snippet === 'string' ? patent.snippet.split('.')[0] : '') || patent.publication_title || 'Untitled Reference'
      );

      let abstractRaw: any = (
        patent.abstract ||
        patent.snippet ||
        patent.description ||
        patent.abstract_text ||
        patent.abstractText ||
        patent.abstract_en ||
        patent.abstractEnglish ||
        ''
      );
      if (Array.isArray(abstractRaw)) abstractRaw = abstractRaw.join(' ');
      let abstractStr = String(abstractRaw || '').trim();
      if (!abstractStr) abstractStr = 'No abstract available.';

      seen.add(canonicalPn);
      normalized.push({
        ...patent,
        canonicalPn,
        title: titleStr.substring(0, 200),
        abstract: abstractStr
      });
    }

    return normalized;
  }

  // Attach claims text from the local corpus to the primary candidates so the
  // consolidated prompt and evidence verification can quote claim language. Only the
  // top-N are hydrated: claims are long, and the references that actually drive the
  // novelty conclusion are the highest-ranked ones.
  private async hydrateClaimsForTopCandidates(normalizedPatents: any[], topN: number) {
    const maxChars = Math.max(1000, Number(process.env.NOVELTY_CLAIMS_MAX_CHARS || '3000') || 3000);
    const targets = normalizedPatents
      .slice(0, Math.max(0, topN))
      .filter(patent => patent && patent.referenceType !== 'paper' && !patent.claimsText);
    if (!targets.length) return;
    try {
      // Look up on the raw publication number (indexed) rather than the kind-stripped
      // canonical form, then key the result map back by canonical PN.
      const claims = await fetchLocalPatentClaims(targets.map(patent => String(
        patent.publicationNumber || patent.publication_number || patent.pn || patent.canonicalPn || ''
      )));
      let hydrated = 0;
      for (const patent of targets) {
        const text = claims.get(String(patent.canonicalPn || ''));
        if (text) {
          patent.claimsText = text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
          hydrated += 1;
        }
      }
      if (hydrated > 0) {
        console.info(`[ConsolidatedAnalysis] Hydrated claims text for ${hydrated}/${targets.length} top candidates.`);
      }
    } catch (error) {
      console.warn('[ConsolidatedAnalysis] Claims hydration failed; continuing with title/abstract evidence.',
        error instanceof Error ? error.message : error);
    }
  }

  private createBatches(patents: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let i = 0; i < patents.length; i += batchSize) {
      batches.push(patents.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processFeatureMappingBatch(
    searchId: string,
    batch: any[],
    inventionFeatures: string[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>,
    batchNumber: number = 0
  ): Promise<{ success: boolean; featureMaps?: PatentFeatureMap[]; error?: string }> {
    try {
      // Check cache first
      const batchHash = this.createBatchHash(batch, inventionFeatures);
      const ideaHash = this.createIdeaHash(inventionFeatures);
      const cached = await this.checkFeatureMappingCache(searchId, ideaHash, batchHash);

      if (cached) {
        console.log(`ðŸ’¾ Using cached results for batch ${batchNumber}`);
        return { success: true, featureMaps: cached };
      }

      // Format patent batch for prompt. The claims line is emitted only when the corpus
      // actually holds claims for that reference — never as a placeholder — so a
      // reference without claims is indistinguishable from one that never had a claims
      // field, and the model cannot report on gaps in our data.
      const patentBatchText = batch.map((patent, idx) => `
Reference ${idx + 1}:
Reference ID: ${patent.canonicalPn}
Type: ${patent.referenceType === 'paper' ? 'Scholarly paper' : 'Patent'}
Title: ${patent.title}
Abstract: ${patent.abstract}
${patent.claimsText ? `Claims (excerpt): ${String(patent.claimsText).replace(/\s+/g, ' ').trim()}\n` : ''}${patent.referenceType === 'paper' ? `Authors: ${(patent.authors || []).join(', ')}\nYear/Venue: ${patent.year || ''} ${patent.venue || ''}\nDOI/URL: ${patent.doi || patent.sourceUrl || patent.link || ''}\nSource: ${(patent.sourceProviders || [patent.sourceProvider]).filter(Boolean).join(', ')}` : ''}
Retrieval hints: ${this.formatRetrievalHints(patent) || 'none'}
---
      `).join('\n');

      // Build prompt
      const prompt = PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3
        .replace('{invention_features}', JSON.stringify(inventionFeatures))
        .replace('{patent_batch}', patentBatchText);

      // Call LLM with admin-configured model via stage
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_FEATURE_ANALYSIS',
          prompt
        }
      );

      if (!llmResult.success || !llmResult.response) {
        console.warn(`LLM call failed for batch ${batchNumber}`);
        const fallbackFeatureMaps = this.createDeterministicFeatureMap(batch, inventionFeatures);
        await this.cacheFeatureMappingResults(searchId, ideaHash, batchHash, fallbackFeatureMaps);
        return { success: true, featureMaps: fallbackFeatureMaps };
      }

      // Parse and validate response
      let parsedResult: FeatureMapBatchResult;
      try {
        parsedResult = this.parseLLMResponse(llmResult.response.output);
      } catch (parseError) {
        console.warn(`JSON parse failed for batch ${batchNumber}, attempting repair`);
        // Try one repair pass
        const repaired = this.repairFeatureMappingJSON(llmResult.response.output);
        if (repaired) {
          parsedResult = repaired;
        } else {
          // Mark cells as Unknown
          parsedResult = this.createUnknownFeatureMap(batch, inventionFeatures);
        }
      }

      // Validate and repair feature maps
      const validatedFeatureMaps = this.validateAndRepairFeatureMaps(parsedResult.feature_map, batch, inventionFeatures);

      // Cache the results
      await this.cacheFeatureMappingResults(searchId, ideaHash, batchHash, validatedFeatureMaps);

      // Record LLM call
      await prisma.noveltySearchLLMCall.create({
        data: {
          searchId,
          stage: NoveltySearchStage.STAGE_3_5, // Will be renamed in enum later
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          prompt,
          response: parsedResult as any,
          tokensUsed: llmResult.response.outputTokens,
          modelClass: llmResult.response.modelClass,
        },
      });

      return { success: true, featureMaps: validatedFeatureMaps };

    } catch (error) {
      console.error(`Batch ${batchNumber} processing error:`, error);
      return { success: true, featureMaps: this.createDeterministicFeatureMap(batch, inventionFeatures) };
    }
  }

  private async storeFeatureMapResults(searchId: string, featureMaps: PatentFeatureMap[]): Promise<void> {
    const cells: any[] = [];

    for (const patentMap of featureMaps) {
      for (const cell of patentMap.feature_analysis) {
        cells.push({
          searchId,
          publicationNumber: patentMap.pn,
          feature: cell.feature,
          status: cell.status,
          evidence: typeof cell.evidence === 'string'
            ? cell.evidence
            : (cell.quote || cell.reason || cell.patent_disclosure || ''),
          confidence: typeof cell.confidence === 'number' ? cell.confidence : 0.8
        });
      }
    }

    await (prisma as any).featureMapCell.deleteMany({ where: { searchId } });

    // Bulk insert
    if (cells.length > 0) {
      await (prisma as any).featureMapCell.createMany({
        data: cells,
        skipDuplicates: true
      });
    }
  }

  private calculateQualityFlags(featureMaps: PatentFeatureMap[], originalPatents: any[]): { low_evidence: boolean; ambiguous_abstracts: boolean; language_mismatch: boolean } {
    const patentsAnalyzed = featureMaps.length;
    const totalAbstractWords = originalPatents.reduce((sum, p) => sum + (p.abstract?.split(/\s+/).length || 0), 0);
    const avgAbstractLength = patentsAnalyzed > 0 ? totalAbstractWords / patentsAnalyzed : 0;

    // Check for non-English abstracts (simple heuristic)
    const nonEnglishCount = originalPatents.filter(p => {
      const abstract = String(p?.abstract || '');
      return /[^\x00-\x7F]/.test(abstract) || // Non-ASCII characters
        /^[^\w\s]*$/.test(abstract.replace(/\s/g, '')); // Very few word characters
    }).length;

    const languageMismatch = nonEnglishCount > originalPatents.length * 0.5;

    return {
      low_evidence: patentsAnalyzed < 5,
      ambiguous_abstracts: avgAbstractLength < 60,
      language_mismatch: languageMismatch
    };
  }

  private calculateFeatureMappingStats(featureMaps: PatentFeatureMap[], originalPatents: any[]): { patents_analyzed: number; avg_abstract_length_words: number } {
    const totalAbstractWords = originalPatents.reduce((sum, p) => sum + (p.abstract?.split(/\s+/).length || 0), 0);

    return {
      patents_analyzed: featureMaps.length,
      avg_abstract_length_words: featureMaps.length > 0 ? Math.round(totalAbstractWords / featureMaps.length) : 0
    };
  }

  private createBatchHash(batch: any[], inventionFeatures: string[], modelConfigKey = ''): string {
    const batchData = batch
      .map(p => `${p.canonicalPn}:${p.title || ''}:${p.abstract || ''}`)
      .join('|');
    const featuresData = inventionFeatures.join('|');
    return crypto
      .createHash('sha1')
      .update(`${FEATURE_MAPPING_CACHE_VERSION}||${modelConfigKey}||${batchData}||${featuresData}`)
      .digest('hex');
  }

  private createStage15CacheKey(stage0Data: NormalizedIdea, candidates: any[]): string {
    const features = this.buildStage15AtomicFeatures(stage0Data);
    const candidateData = candidates.map(item => {
      const pn = item.publication_number || item.publicationNumber || item.pn || item.id || '';
      const score = item.relevanceScore || item.score || item.relevance || 0;
      return `${pn}:${score}`;
    }).join('|');
    return crypto
      .createHash('sha1')
      .update(`${STAGE15_GATE_CACHE_VERSION}||${stage0Data?.searchQuery || ''}||${features.join('|')}||${candidateData}`)
      .digest('hex');
  }

  private createIdeaHash(inventionFeatures: string[]): string {
    return crypto.createHash('md5').update(inventionFeatures.join('|')).digest('hex');
  }

  private async checkFeatureMappingCache(searchId: string, ideaHash: string, batchHash: string): Promise<PatentFeatureMap[] | null> {
    try {
      const cacheEntry = await (prisma as any).featureMappingCache.findFirst({
        where: {
          ideaHash,
          batchHash,
          promptVersion: FEATURE_MAPPING_CACHE_VERSION,
          expiresAt: {
            gt: new Date() // Not expired
          }
        }
      });

      if (cacheEntry) {
        console.log(`ðŸ’¾ Cache hit for idea ${ideaHash.substring(0, 8)}, batch ${batchHash.substring(0, 8)}`);
        return cacheEntry.featureMaps as PatentFeatureMap[];
      }

      return null;
    } catch (error) {
      console.warn('Cache check failed:', error);
      return null;
    }
  }

  private async cacheFeatureMappingResults(searchId: string, ideaHash: string, batchHash: string, featureMaps: PatentFeatureMap[]): Promise<void> {
    try {
      // Cache for 24 hours
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await (prisma as any).featureMappingCache.upsert({
        where: {
          ideaHash_batchHash_promptVersion: {
            ideaHash,
            batchHash,
            promptVersion: FEATURE_MAPPING_CACHE_VERSION
          }
        },
        update: {
          featureMaps: featureMaps as any,
          expiresAt
        },
        create: {
          ideaHash,
          batchHash,
          promptVersion: FEATURE_MAPPING_CACHE_VERSION,
          featureMaps: featureMaps as any,
          expiresAt
        }
      });

      console.log(`ðŸ’¾ Cached results for idea ${ideaHash.substring(0, 8)}, batch ${batchHash.substring(0, 8)}`);
    } catch (error) {
      console.warn('Cache storage failed:', error);
      // Don't fail the operation if caching fails
    }
  }

  private repairFeatureMappingJSON(responseText: string): FeatureMapBatchResult | null {
    try {
      // Simple repair: try to extract JSON from markdown or add missing brackets
      let repaired = responseText.trim();

      // Remove markdown code blocks
      repaired = repaired.replace(/^```json\s*/, '').replace(/\s*```$/, '');

      // Try to parse
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  private createUnknownFeatureMap(batch: any[], inventionFeatures: string[]): FeatureMapBatchResult {
    const featureMaps: PatentFeatureMap[] = batch.map(patent => ({
      pn: patent.canonicalPn,
      title: patent.title,
      feature_analysis: inventionFeatures.map(feature => ({
        feature,
        status: 'Unknown' as const,
        extent_score: 0.2,
        evidence: 'LLM parsing failed'
      }))
    }));

    return {
      feature_map: featureMaps,
      quality_flags: { low_evidence: true, ambiguous_abstracts: false, language_mismatch: false },
      stats: { patents_analyzed: batch.length, avg_abstract_length_words: 0 }
    };
  }

  private createDeterministicFeatureMap(batch: any[], inventionFeatures: string[]): PatentFeatureMap[] {
    const tokenize = (value: string) => value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 3);

    const quoteFor = (text: string, tokens: string[]) => {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const match = sentences.find(sentence => {
        const lower = sentence.toLowerCase();
        return tokens.some(token => lower.includes(token));
      });
      return (match || text).slice(0, 220);
    };

    return batch.map(patent => {
      const title = String(patent.title || '');
      const abstract = String(patent.abstract || '');
      const combined = `${title} ${abstract}`;
      const combinedLower = combined.toLowerCase();
      const featureAnalysis: FeatureMapCell[] = inventionFeatures.map((feature, index) => {
        const featureText = String(feature || '').trim();
        const tokens = Array.from(new Set(tokenize(featureText)));
        const matched = tokens.filter(token => combinedLower.includes(token));
        const overlap = tokens.length > 0 ? matched.length / tokens.length : 0;
        const phraseMatch = featureText.length > 8 && combinedLower.includes(featureText.toLowerCase());
        const status: FeatureMapCell['status'] = phraseMatch || overlap >= 0.65
          ? 'Present'
          : overlap >= 0.25
            ? 'Partial'
            : 'Unknown';
        const hasSupportingEvidence = status === 'Present' || status === 'Partial';
        const quote = hasSupportingEvidence ? quoteFor(combined, matched.length ? matched : tokens) : undefined;
        const confidence = this.roundScore(status === 'Present'
          ? 0.60 + overlap * 0.30
          : status === 'Partial'
            ? 0.38 + overlap * 0.34
            : 0.35);
        const extentScore = status === 'Present'
          ? this.roundScore(0.72 + overlap * 0.23)
          : status === 'Partial'
            ? this.roundScore(0.34 + overlap * 0.36)
            : this.roundScore(Math.min(0.18, overlap * 0.20));

        return {
          feature: featureText,
          status,
          feature_id: `KF${index + 1}`,
          extent_score: extentScore,
          confidence,
          quote,
          field: hasSupportingEvidence ? 'title/abstract' : undefined,
          evidence_source: hasSupportingEvidence ? 'title/abstract' : 'none',
          reason: status === 'Unknown'
            ? 'Full-text review should verify whether this feature is taught.'
            : `Record-based token overlap matched ${matched.length} of ${Math.max(tokens.length, 1)} feature terms.`,
          crisp_remark: this.defaultCrispRemark(status, featureText, quote || ''),
          attorney_remark: this.defaultAttorneyRemark(status, featureText, patent.canonicalPn),
          novelty_impact: this.defaultNoveltyImpact(status, featureText),
          claim_review_note: this.defaultClaimReviewNote(status, featureText),
          professional_remark: this.defaultProfessionalRemark(status, featureText, quote || '', quote || '')
        };
      });

      const present = featureAnalysis.filter(cell => cell.status === 'Present');
      const partial = featureAnalysis.filter(cell => cell.status === 'Partial');
      const absent = featureAnalysis.filter(cell => cell.status === 'Absent');
      const total = Math.max(1, featureAnalysis.length);
      const coverageScore = (present.length + partial.length * 0.5) / total;

      return {
        pn: patent.canonicalPn,
        title,
        link: patent.link || patent.sourceUrl || null,
        coverage: {
          present: present.length,
          partial: partial.length,
          absent: absent.length,
          coverage_score: coverageScore
        },
        present,
        partial,
        absent,
        feature_analysis: featureAnalysis,
        remarks: coverageScore > 0
          ? `Record-based mapping found ${present.length} present and ${partial.length} partial feature overlap(s) in the reviewed patent record.`
          : 'Record-based mapping did not establish feature overlap from the reviewed patent record.',
        decision: coverageScore >= 0.6 ? 'high_overlap' : coverageScore >= 0.35 ? 'mapped_overlap' : 'potential_novelty_space'
      };
    });
  }

  private buildDeterministicPerPatentRemarks(
    stage0Data: NormalizedIdea,
    stage35aData: FeatureMapBatchResult,
    limit = 8
  ): PerPatentRemark[] {
    const features = Array.isArray(stage0Data.inventionFeatures) ? stage0Data.inventionFeatures : [];
    const maps = Array.isArray(stage35aData?.feature_map) ? stage35aData.feature_map : [];
    return [...maps]
      .sort((a: any, b: any) => Number(b?.coverage?.coverage_score || 0) - Number(a?.coverage?.coverage_score || 0))
      .slice(0, Math.max(0, limit))
      .map((patent: any) => {
        const cells = Array.isArray(patent.feature_analysis) ? patent.feature_analysis : [];
        const present = cells.filter((cell: FeatureMapCell) => cell.status === 'Present').map((cell: FeatureMapCell) => cell.feature);
        const partial = cells.filter((cell: FeatureMapCell) => cell.status === 'Partial').map((cell: FeatureMapCell) => cell.feature);
        const unknown = cells.filter((cell: FeatureMapCell) => cell.status === 'Unknown').map((cell: FeatureMapCell) => cell.feature);
        const missing: string[] = cells
          .filter((cell: FeatureMapCell) => cell.status === 'Absent')
          .map((cell: FeatureMapCell) => cell.feature);
        const potentialDifferentiators = missing
          .filter((feature: string) => !this.isGenericNoveltyFeature(feature))
          .slice(0, 4);
        const relevance = (present.length + partial.length * 0.5) / Math.max(1, features.length);
        const noveltyThreat = relevance >= 0.7 ? 'high_overlap' : relevance >= 0.5 ? 'moderate_overlap' : relevance >= 0.3 ? 'related' : 'low_overlap';
        const evidenceNote = unknown.length > 0 ? ` ${unknown.length} feature(s) require full-text review.` : '';

        return {
          pn: String(patent.pn || patent.publicationNumber || ''),
          title: patent.title,
          remarks: [
            present.length ? `Overlaps on ${present.slice(0, 4).join(', ')}.` : 'No fully overlapping features were found.',
            partial.length ? `Partial overlap on ${partial.slice(0, 3).join(', ')}.` : '',
            potentialDifferentiators.length ? `Potential differentiators include ${potentialDifferentiators.join(', ')}.` : 'No clear differentiators were identified from mapped features.',
            evidenceNote
          ].filter(Boolean).join(' '),
          overlap_features: [...present, ...partial],
          missing_features: missing,
          potential_differentiators: potentialDifferentiators,
          novelty_points: potentialDifferentiators,
          confidence: unknown.length > 0 ? 0.45 : 0.6,
          relevance,
          novelty_threat: noveltyThreat,
          summary: relevance >= 0.5
            ? 'Record-based analysis identifies this citation as a material mapped-overlap reference.'
            : 'Record-based analysis identifies narrower overlap with the invention.',
          comparison_rows: this.normalizePatentComparisonRows([], patent, stage0Data),
          detailedAnalysis: {
            relevant_parts: [...present, ...partial].map(feature => `Mapped overlap: ${feature}`),
            irrelevant_parts: missing.map(feature => `Not mapped in this reference: ${feature}`),
            novelty_comparison: unknown.length > 0
              ? 'Full-text review is required before treating unconfirmed support as a differentiator.'
              : 'Comparison is based on record-level feature mapping for attorney review.'
          },
          decision: relevance >= 0.6 ? 'high_overlap' : relevance >= 0.35 ? 'mapped_overlap' : 'potential_novelty_space'
        };
      });
  }

  private hasDetailedStage35cRemarks(stage4Data: any): boolean {
    const remarks = Array.isArray(stage4Data?.per_patent_remarks) ? stage4Data.per_patent_remarks : [];
    if (remarks.length === 0) return false;
    if (stage4Data?.stage35c_complete === true || stage4Data?.per_patent_remarks_source === 'stage35c') return true;
    if (
      stage4Data?.per_patent_remarks_source === 'stage35b_deterministic' ||
      stage4Data?.per_patent_remarks_source === 'stage4_deterministic_fallback'
    ) {
      return false;
    }

    return remarks.some((remark: any) => (
      remark?.detailedAnalysis ||
      typeof remark?.relevance === 'number' ||
      typeof remark?.novelty_threat === 'string'
    ));
  }

  private normalizeEvidenceForVerification(value: unknown): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateFeatureCellEvidence(cell: FeatureMapCell, patent: any): FeatureMapCell {
    if (cell.status !== 'Present' && cell.status !== 'Partial') return cell;

    const evidenceObject = cell.evidence && typeof cell.evidence === 'object' ? cell.evidence : null;
    const quote = String(
      cell.quote ||
      evidenceObject?.quote ||
      (typeof cell.evidence === 'string' ? cell.evidence : '') ||
      ''
    ).trim();
    const title = String(patent?.title || '');
    const abstract = String(patent?.abstract || '');
    const claimsText = String(patent?.claimsText || '');
    const normalizedQuote = this.normalizeEvidenceForVerification(quote);
    const normalizedTitle = this.normalizeEvidenceForVerification(title);
    const normalizedAbstract = this.normalizeEvidenceForVerification(abstract);
    const normalizedClaims = this.normalizeEvidenceForVerification(claimsText);
    const quoteInAbstract = Boolean(normalizedQuote && normalizedAbstract.includes(normalizedQuote));
    const quoteInTitle = Boolean(normalizedQuote && normalizedTitle.includes(normalizedQuote));
    const quoteInClaims = Boolean(normalizedQuote && normalizedClaims && normalizedClaims.includes(normalizedQuote));

    if (!normalizedQuote || (!quoteInAbstract && !quoteInTitle && !quoteInClaims)) {
      return {
        ...cell,
        status: 'Unknown',
        quote: undefined,
        field: undefined,
        evidence_source: 'none',
        evidenceDepth: 'NONE',
        legalEvidenceStrength: 0,
        mappingConfidence: Math.min(typeof cell.confidence === 'number' ? cell.confidence : 0.4, 0.4),
        qaDowngraded: true,
        extent_score: 0.2,
        confidence: Math.min(typeof cell.confidence === 'number' ? cell.confidence : 0.4, 0.4),
        reason: 'Supplied evidence quote was not found in the available title or abstract.',
      };
    }

    const originalConfidence = this.normalizeScore(cell.mappingConfidence ?? cell.confidence) ?? 0.7;
    if (cell.status === 'Present' && !quoteInAbstract && !quoteInClaims) {
      return {
        ...cell,
        status: 'Partial',
        quote,
        field: 'title',
        evidence_source: 'title',
        evidenceDepth: 'TITLE_ONLY',
        legalEvidenceStrength: 0.30,
        mappingConfidence: Math.min(originalConfidence, 0.60),
        qaDowngraded: true,
        extent_score: Math.min(this.normalizeScore(cell.extent_score) ?? 0.5, 0.5),
        reason: 'Title-only evidence cannot establish a Present feature in title/abstract screening.',
      };
    }

    // Claims are the strongest record-level evidence, then abstract, then title.
    const matchedField = quoteInClaims && !quoteInAbstract ? 'claims' : quoteInAbstract ? 'abstract' : 'title';
    return {
      ...cell,
      quote,
      field: matchedField,
      evidence_source: matchedField,
      evidenceDepth: matchedField === 'claims'
        ? 'CLAIMS_AND_SPECIFICATION'
        : quoteInAbstract ? (title ? 'TITLE_AND_ABSTRACT' : 'ABSTRACT_ONLY') : 'TITLE_ONLY',
      legalEvidenceStrength: matchedField === 'claims' ? 0.75 : quoteInAbstract ? 0.65 : 0.30,
      mappingConfidence: originalConfidence,
    };
  }

  private validateAndRepairFeatureMaps(featureMaps: PatentFeatureMap[], batch: any[], inventionFeatures: string[]): PatentFeatureMap[] {
    const validated: PatentFeatureMap[] = [];

    for (const patentMap of featureMaps) {
      // Find corresponding patent in batch
      const patent = batch.find(p => p.canonicalPn === patentMap.pn);
      if (!patent) continue;

      const validatedCells: FeatureMapCell[] = [];

      // Handle new format (separate present/partial/absent arrays)
      if (patentMap.present || patentMap.partial || patentMap.absent) {
        // Convert new format to old format for backward compatibility
        const allFeatures = [
          ...(patentMap.present || []).map(cell => ({ ...cell, status: 'Present' as const })),
          ...(patentMap.partial || []).map(cell => ({ ...cell, status: 'Partial' as const })),
          ...(patentMap.absent || []).map(cell => ({ ...cell, status: 'Absent' as const })),
          ...(((patentMap as any).unknown || []) as FeatureMapCell[]).map(cell => ({ ...cell, status: 'Unknown' as const }))
        ];

        for (const feature of inventionFeatures) {
          const cell = allFeatures.find(c => c.feature === feature);
          if (cell) {
            const convertedCell: FeatureMapCell = {
              feature: cell.feature,
              status: cell.status,
              feature_id: cell.feature_id,
              user_invention_disclosure: cell.user_invention_disclosure,
              patent_disclosure: cell.patent_disclosure,
              extent_score: this.normalizeScore((cell as any).extent_score ?? (cell as any).extentScore),
              confidence: cell.confidence,
              mappingConfidence: cell.mappingConfidence,
              evidenceDepth: cell.evidenceDepth,
              legalEvidenceStrength: cell.legalEvidenceStrength,
              quote: cell.quote,
              field: cell.field,
              evidence_source: cell.evidence_source,
              reason: cell.reason,
              crisp_remark: cell.crisp_remark,
              attorney_remark: cell.attorney_remark,
              novelty_impact: cell.novelty_impact,
              claim_review_note: cell.claim_review_note,
              professional_remark: cell.professional_remark
            };
            validatedCells.push(convertedCell);
          } else {
            // Create Unknown cell for missing features
            validatedCells.push({
              feature,
              status: 'Unknown',
              extent_score: 0.2,
              reason: 'Analysis not provided'
            });
          }
        }
      } else if (patentMap.feature_analysis) {
        // Handle old format (single feature_analysis array)
        for (const feature of inventionFeatures) {
          const cell = patentMap.feature_analysis.find(c => c.feature === feature);
          if (cell && ['Present', 'Partial', 'Absent', 'Unknown'].includes(cell.status)) {
            validatedCells.push(cell);
          } else {
            // Create Unknown cell
            validatedCells.push({
              feature,
              status: 'Unknown',
              extent_score: 0.2,
              reason: 'Analysis not provided'
            });
          }
        }
      } else {
        // No valid data
        for (const feature of inventionFeatures) {
          validatedCells.push({
            feature,
            status: 'Unknown',
            extent_score: 0.2,
            reason: 'Invalid or missing analysis'
          });
        }
      }

      const evidenceValidatedCells = validatedCells.map(cell => this.validateFeatureCellEvidence(cell, patent));
      const present = evidenceValidatedCells.filter(c => c.status === 'Present').length;
      const partial = evidenceValidatedCells.filter(c => c.status === 'Partial').length;
      const absent = evidenceValidatedCells.filter(c => c.status === 'Absent').length;
      const totalScore = evidenceValidatedCells.reduce((sum, cell) => {
        if (cell.status === 'Present') return sum + 1.0;
        if (cell.status === 'Partial') return sum + 0.5;
        return sum;
      }, 0);
      const coverageScore = evidenceValidatedCells.length > 0 ? totalScore / evidenceValidatedCells.length : 0;
      const coverage = { present, partial, absent, coverage_score: coverageScore };

      validated.push({
        ...patentMap,
        pn: patentMap.pn,
        title: patent.title,
        link: patentMap.link,
        coverage: coverage,
        present: patentMap.present,
        partial: patentMap.partial,
        absent: patentMap.absent,
        feature_analysis: evidenceValidatedCells,
        remarks: (patentMap as any).remarks,
        model_decision: (patentMap as any).model_decision,
        decision: (patentMap as any).decision
      });
    }

    return validated;
  }

  // Helper methods

  private async searchPQAI(query: string, maxResults: number = 50): Promise<any[]> {
    // EXACT COPY from drafting stage 3.5 implementation
    const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || ''
    if (!token) throw new Error('No PQAI API token configured. Set PQAI_API_TOKEN.')

    // PQAI endpoint: GET /search/102 with query parameters
    const baseUrl = 'https://api.projectpq.ai/search/102'

    // Simple normalization for PQAI (keep it compact as per Stage 1 design)
    let safeQuery = query
      .replace(/[\u2013\u2014]/g, '-')       // en/em dash → hyphen
      .replace(/[\u2018\u2019\u201C\u201D]/g, '"') // curly quotes → plain
      .replace(/[^\w\s-]/g, ' ')             // strip punctuation except hyphen
      .replace(/-/g, ' ')                      // turn hyphens into spaces to avoid tokenization issues
      .replace(/\s+/g, ' ')                   // collapse whitespace
      .trim()
    // Constrain to first 20 words (keep it compact per Stage 1 design and avoid PQAI server 500s)
    const words = safeQuery.split(/\s+/)
    if (words.length > 20) safeQuery = words.slice(0, 20).join(' ')

    const params = new URLSearchParams({
      q: safeQuery,
      n: String(Math.min(Math.max(10, maxResults), 50)),
      type: 'patent' // Only return patents, not research papers (NPL)
    })

    // Add token as query parameter for direct API
    params.set('token', token)

    const url = `${baseUrl}?${params.toString()}`

    // Debug: Log the final URL components
    console.log('PQAI Request Debug:', {
      baseUrl,
      queryLength: safeQuery.length,
      originalQueryLength: query.length,
      paramsCount: Array.from(params.entries()).length,
      hasToken: !!token,
      finalUrlLength: url.length,
      filters: 'type=patent' // Confirm patent-only filtering
    })

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    console.log('PQAI search:', {
      url: url.substring(0, 120) + '...',
      queryPreview: safeQuery.substring(0, 100) + '...',
      maxResults,
      hasToken: !!token,
      tokenLength: token.length
    })

    // Single API call per search with fetch + tighter headers and timeout
    let resp: Response | null = null
    try {
      const controller = new AbortController()
      const to = setTimeout(() => controller.abort(), 15000)

      // Configure fetch options to handle SSL certificate issues in development
      const fetchOptions: any = {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store'
      }

      // In Node.js environment, we can configure HTTPS agent for self-signed certificates
      if (typeof window === 'undefined') {
        // Server-side: Use Node.js HTTPS agent to handle self-signed certificates
        const https = require('https')
        fetchOptions.agent = new https.Agent({
          rejectUnauthorized: false // Allow self-signed certificates for development
        })
      }

      resp = await fetch(url, fetchOptions)
      clearTimeout(to)
      console.log('PQAI search result:', { status: resp.status, url: url.substring(0, 120) + '...' })
    } catch (e) {
      console.log('PQAI search network error:', e)
      throw new Error(`Network error contacting PQAI API: ${String(e)}`)
    }

    if (!resp || !resp.ok) {
      let errorMsg = 'PQAI API request failed'
      let details: string | undefined

      if (resp) {
        errorMsg += ` (HTTP ${resp.status})`

        if (resp.status === 500) {
          errorMsg = 'PQAI API server error - the service may be temporarily unavailable'
        } else if (resp.status === 401 || resp.status === 403) {
          errorMsg = 'PQAI API authentication failed - please check your API token'
        } else if (resp.status === 429) {
          errorMsg = 'PQAI API rate limit exceeded - please try again later'
        }
        try {
          const errorText = await resp.text()
          details = errorText || undefined
          if (errorText.includes('Server error while handling request')) {
            errorMsg = 'PQAI API is currently experiencing server issues. Please try again later.'
          }
        } catch {}
      }

      console.log('PQAI API error:', { status: resp?.status, error: errorMsg, details })
      throw new Error(errorMsg)
    }

    let dataJson: any = {}
    try { dataJson = await resp.json() } catch (e) { console.log('Failed to parse JSON response:', e) }

    console.log('PQAI API full response:', JSON.stringify(dataJson, null, 2))

    // Try multiple possible result locations
    let results = []
    if (Array.isArray(dataJson?.results)) {
      results = dataJson.results
    } else if (Array.isArray(dataJson?.data)) {
      results = dataJson.data
    } else if (Array.isArray(dataJson)) {
      results = dataJson
    }

    console.log('PQAI API success - results count:', results.length, 'response keys:', Object.keys(dataJson))
    console.log('First result sample:', results[0] ? Object.keys(results[0]) : 'No results')
    if (results[0]) {
      console.log('First result data:', JSON.stringify(results[0], null, 2))
      console.log('Patent number fields in first result:', {
        pn: results[0].pn,
        patent_number: results[0].patent_number,
        publication_number: results[0].publication_number,
        publication_id: results[0].publication_id,
        publicationId: results[0].publicationId,
        patentId: results[0].patentId,
        patent_id: results[0].patent_id,
        id: results[0].id
      })
    }

    // Check for unique patent numbers
    const patentNumbers = results.map((r: any) => r.publication_number || r.patent_number || r.pn || r.publication_id || r.publicationId || r.patentId || r.patent_id || r.id || 'N/A').filter((pn: any) => pn !== 'N/A')
    const uniquePatentNumbers = Array.from(new Set(patentNumbers))
    console.log('Patent numbers found:', patentNumbers.length, 'unique:', uniquePatentNumbers.length)
    if (patentNumbers.length !== uniquePatentNumbers.length) {
      console.log('WARNING: Duplicate patent numbers detected!')
    }

    // Normalize the results to a consistent format and extract actual relevance scores
    const normalizedResults = results.map((result: any) => {
      // Extract relevance score using the same pattern as drafting pipeline
      const relevanceScore = typeof result.score === 'number' ? result.score :
                            (typeof result.relevance === 'number' ? result.relevance : null)

      const publicationNumber = result.publication_number || result.patent_number || result.pn || result.id || 'Unknown';
      const link =
        result.link ||
        result.url ||
        result.patent_url ||
        result.google_patent_url ||
        `https://patents.google.com/patent/${publicationNumber}`;

      return {
        title: result.title || result.snippet?.split('.')[0] || 'Untitled Patent',
        publicationNumber,
        abstract: (result.snippet || result.abstract || result.description || result.abstract_text || result.abstractText || result.abstract_en || result.abstractEnglish || ''),
        year: result.year || result.filing_date?.substring(0, 4) || result.publication_date?.substring(0, 4) || null,
        inventors: Array.isArray(result.inventors) ? result.inventors : (result.inventors ? [result.inventors] : []),
        assignees: Array.isArray(result.assignees) ? result.assignees : (result.assignees ? [result.assignees] : []),
        cpcCodes: Array.isArray(result.cpc_codes) ? result.cpc_codes : [],
        ipcCodes: Array.isArray(result.ipc_codes) ? result.ipc_codes : [],
        relevanceScore: relevanceScore,
        rawScore: result.score || result.relevance, // Keep raw value for debugging
        link
      }
    })

    console.log('💾 Before sorting - first 5 relevance scores:')
    normalizedResults.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.publicationNumber} - Score: ${r.relevanceScore} (${r.relevanceScore ? (r.relevanceScore * 100).toFixed(1) + '%' : 'none'})`)
    })

    // Sort by relevance score (highest first) - PQAI may not return perfectly sorted results
    normalizedResults.sort((a: any, b: any) => {
      const scoreA = a.relevanceScore || 0
      const scoreB = b.relevanceScore || 0
      return scoreB - scoreA // Higher scores first
    })

    console.log(' After sorting by relevance - top 5:')
    normalizedResults.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.publicationNumber} - Score: ${r.relevanceScore} (${r.relevanceScore ? (r.relevanceScore * 100).toFixed(1) + '%' : 'none'})`)
    })

    return normalizedResults
  }

  private async getPatentDetails(publicationNumber: string): Promise<{
    title?: string;
    abstract?: string;
    claims?: string;
  }> {
    try {
      // Try to get from database first
      const patent = await prisma.priorArtPatent.findUnique({
        where: { publicationNumber },
        include: { details: true }
      });

      if (patent) {
        return {
          title: patent.title || undefined,
          abstract: patent.abstract || undefined,
          claims: patent.details?.claims as string || undefined
        };
      }

      // TODO: Fetch from PQAI or other patent databases
      return {};
    } catch (error) {
      console.error(`Failed to get patent details for ${publicationNumber}:`, error);
      return {};
    }
  }

}



