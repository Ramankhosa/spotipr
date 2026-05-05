export function buildIdeaNormalizationPrompt(params: {
  rawIdea: string
  title: string
  areaOfInvention?: string
  allowRefine?: boolean
}): string {
  const { rawIdea, title, areaOfInvention, allowRefine = true } = params
  const domainExpertise = (areaOfInvention && areaOfInvention.trim())
    ? ` with core expertise in ${areaOfInvention.trim()}`
    : ''
  const sourceMode = allowRefine ? 'STRUCTURE_ONLY' : 'PRESERVE'
  const modeRule = allowRefine
    ? '- Mode: STRUCTURE_ONLY. Structure and polish the wording without adding technical facts. You may organize the invention, but you must not add unsupported preferences, components, advantages, or claim elements. Do NOT add unsupported technical facts. Do NOT choose a preferred architecture unless the source states it.'
    : '- Mode: PRESERVE. Preserve the user-described invention faithfully with minimal paraphrase. Do not improve, complete, or optimize the idea.'

  return `You are an expert patent attorney specializing in source-faithful patent disclosure extraction across all domains (mechanical, electrical, software, biotech, chemistry, pharmaceuticals, medical devices, materials, civil, agriculture, aerospace, and general technology)${domainExpertise}.

Read the invention description and return ONLY one JSON object with the fields defined below.

Your task is NOT to summarize. Your task is to create a source-faithful patent fact ledger for downstream claims, figures, and specification drafting.

Rules (must follow strictly):
- Output MUST be a single JSON object, no code fences, no backticks, no prose.
- Use formal patent language, but preserve source-stated details and technical specificity.
- ${modeRule}
- Do NOT invent or add components, subcomponents, claims, benefits, use cases, mechanisms, materials, conditions, numerical values, or best methods not present in the source.
- Do NOT over-summarize explicit details into generic phrases.
- Do NOT merge separately stated components or subcomponents unless the source itself describes them as one component.
- Do NOT convert optional features, alternatives, examples, or embodiments into mandatory architecture.
- Preserve every source-stated component, subcomponent, alternative, example, embodiment, metadata field, threshold, range, unit, safety rule, fallback rule, expiry rule, confidence score, condition, and claim seed that is important for patent drafting.
- Preserve all numerical values exactly as stated, including units, ranges, inequality signs, concentrations, temperatures, pressures, voltages, times, percentages, ratios, pH, scores, and durations.
- If a field is not stated by the source, write "Not stated by source". Do not fill gaps with assumptions.
- Populate "bestMethod" ONLY if the source explicitly states a preferred/best mode, preferred implementation, or best method. Otherwise use "Not stated by source".
- Keep each top-level field as a string except: "components" (array of objects), "cpcCodes" (array of strings), "ipcCodes" (array of strings), "inventionType" (array of archetype tags), "claimableFeatures" (array of strings), "fallbackLimitations" (array of strings), "doNotClaim" (array of strings), "sourceFactLedger" (object of arrays), "scopeRecommendations" (object), and "normalizationReviewWarnings" (array of strings).
- Components: include every source-stated component/subcomponent that may support claims or figures. Use hierarchy when helpful. Do not cap the list. Keep metadata such as parent, level, inputs, outputs, dependencies, alternatives, conditions, and figure hints when stated.
- Include "inventionType" as the archetype classification (one or more of: MECHANICAL, ELECTRICAL, SOFTWARE, CHEMICAL, BIO, GENERAL). Allow multiple using either an array or a "+"-joined string (e.g., "MECHANICAL+SOFTWARE"); uppercase the values.
- Include "patentTypePrimary" as the best primary independent claim category, exactly one of: PRODUCT, SYSTEM, PROCESS, COMPOSITION.
- Patent type rules:
  - PRODUCT when the invention is a single physical article, device, apparatus, or product, even if it has multiple internal parts.
  - SYSTEM when the invention is multiple distinct devices, modules, entities, or subsystems cooperating together.
  - PROCESS when the inventive contribution is a method, workflow, control logic, treatment method, manufacturing method, data-processing method, or sequence of steps.
  - COMPOSITION when the inventive contribution is a chemical, pharmaceutical, biological, material, formulation, mixture, ingredient combination, or composition of matter.
  - Do NOT classify a device as SYSTEM merely because it has multiple internal parts.
  - Do NOT classify software or general patent wording as COMPOSITION because the word "solution" appears.
  - Choose based on where the source-stated inventive contribution appears to reside.
- Additionally, provide a single meaningful "searchQuery" sentence (<= 25 words) optimized for PQAI AI-based prior-art search. It MUST be a coherent plain-English sentence, not a bag of keywords; plain ASCII, no quotes, no brackets, no CPC/IPC codes, no labels.
- Include "coreInventiveConcept" as the minimum source-supported technical combination that could anchor Claim 1. If the source is thin, state that it is thin instead of inventing missing detail.
- Include "claimableFeatures" as source-stated features that can support dependent claims. Use concise phrases and keep source-specific details.
- Include "fallbackLimitations" for source-stated fallback rules, safety rules, thresholds, optional narrowing features, and conditions that may be useful if broad claims need review.
- Include "doNotClaim" for important missing, unsupported, expressly optional, or expressly excluded facts that claims should not present as required.
- Include "scopeRecommendations" using patent-drafting judgment for the detected patentTypePrimary, inventionType, fieldOfRelevance, and subfield. This is an LLM recommendation layer, not a code-derived list.
- Scope recommendation rules:
  - Stage 0 remains broad: include source-stated elements, steps, constituents, biological entities, ranges, data fields, environments, and use cases when relevant for audit.
  - For "claim": use "claim_1" only for source-supported core elements, steps, constituents, entities, or relationships needed for the broad independent claim. Use "dependent_claim" for optional features, fallback limits, ranges, conditions, subcomponents, or narrowing details. Use "none" for environment, use-case context, unsupported facts, missing facts, or items that should not be promoted into claims.
  - For "numbering": use "number" for elements that should be eligible for patent reference labels. Use "do_not_number" for ranges, conditions, pure data fields, environments, use cases, missing facts, unsupported facts, and non-visual abstractions.
  - For "figures": use "include" for preferred figure content, "optional" only where useful for clarity, and "do_not_show" for environment/use-case/missing/unsupported/non-invention items.
  - For "description": use "include" for invention-supporting disclosure, "optional" for contextual non-claim material, and "exclude" for unsupported or expressly non-invention material.
  - Recommendations must work across all patent types and fields, including mechanical, software, electrical, chemical, pharmaceutical, biotech, medical device, material, process, composition, diagnostic, therapeutic, and mixed inventions.
- Use double-quoted keys and strings; avoid line breaks mid-sentence when possible.

TITLE: ${title}

SOURCE HANDLING MODE: ${sourceMode}

INVENTION DESCRIPTION:
${rawIdea}

Respond in this exact JSON shape:
{
  "searchQuery": "meaningful plain-English search sentence (<= 25 words, ASCII, no quotes/brackets), suitable for PQAI AI-based patent search",
  "problem": "source-stated technical problem, or Not stated by source",
  "objectives": "source-stated objectives, or Not stated by source",
  "components": [{
    "name": "component/subcomponent name exactly supported by source",
    "type": "MAIN_CONTROLLER|SUBSYSTEM|MODULE|INTERFACE|SENSOR|ACTUATOR|PROCESSOR|MEMORY|DISPLAY|COMMUNICATION|POWER_SUPPLY|OTHER",
    "description": "technical role plus any source-stated constraints, values, alternatives, materials, or conditions",
    "inputs": "optional: source-stated inputs/signals/data, or Not stated by source",
    "outputs": "optional: source-stated outputs/actions/data, or Not stated by source",
    "dependencies": "optional: source-stated other components relied on, or Not stated by source",
    "figureHint": "optional: source-stated or directly implied drawing focus, or Not stated by source",
    "parent": "optional: parent component name if source supports hierarchy",
    "level": "optional: 0 for root modules, 1 for child, 2 for grandchild, etc.",
    "sequence": "optional: source-stated or source-order sequence (1-based)",
    "numberingHint": "optional: preferred hundreds bucket e.g., 100|200|300|400|500|600|700|800|900"
  }],
  "inventionType": ["MECHANICAL", "SOFTWARE"],
  "patentTypePrimary": "SYSTEM",
  "logic": "source-stated interaction, process flow, control logic, conditions, fallback behavior, and optional paths, or Not stated by source",
  "inputs": "source-stated inputs/signals/data required, or Not stated by source",
  "outputs": "source-stated outputs/actions/data produced, or Not stated by source",
  "variants": "source-stated embodiments, alternatives, optional features, examples, and use cases, or Not stated by source",
  "bestMethod": "source-stated preferred/best implementation only, or Not stated by source",
  "fieldOfRelevance": "primary domain (e.g., Mechanical, Electrical, Software, Medical Device, Biotech, Chemistry, Materials, Aerospace, Civil, Agriculture)",
  "subfield": "more specific area, or Not stated by source",
  "recommendedFocus": "drafting focus based only on source-stated invention facts",
  "complianceNotes": "source-stated regulatory, safety, standard, or compliance notes, or Not stated by source",
  "drawingsFocus": "figures should emphasize only source-supported components, flows, embodiments, and fallback paths",
  "claimStrategy": "high-level claim approach based only on source-stated facts and patent type",
  "coreInventiveConcept": "minimum source-supported inventive combination for Claim 1, or Not stated by source",
  "claimableFeatures": ["source-stated claimable features for dependent claims; empty array if none"],
  "fallbackLimitations": ["source-stated fallback rules, safety rules, thresholds, optional narrowing features, or conditions; empty array if none"],
  "doNotClaim": ["important missing or unsupported facts that must not be claimed as required; empty array if none"],
  "riskFlags": "source-stated uncertainties or missing enablement details to watch, or Not stated by source",
  "abstract": "<= 150-word abstract that begins exactly with the title; neutral tone; no unsupported advantages",
  "cpcCodes": ["primary CPC code like H04L 29/08", "optional secondary"],
  "ipcCodes": ["primary IPC code like G06F 17/30", "optional secondary"],
  "sourceHandlingMode": "${sourceMode}",
  "sourceFactLedger": {
    "componentsAndSubcomponents": ["every source-stated component/subcomponent detail relevant to claims or figures"],
    "materialsOrCompositions": ["materials, ingredients, formulations, biological entities, compounds, concentrations, excipients, cells, sequences"],
    "processSteps": ["source-stated method/process/manufacturing/preparation/control steps"],
    "numericValuesAndUnits": ["all source-stated numbers, units, ranges, thresholds, ratios, temperatures, voltages, times, scores, pH, concentrations"],
    "conditionsAndRules": ["if/when/unless rules, trigger conditions, operating conditions, decision conditions"],
    "alternativesAndEmbodiments": ["optional features, variants, alternatives, embodiments, modes"],
    "examplesAndUseCases": ["source-stated examples, scenarios, experimental examples, applications"],
    "safetyFallbackOrExpiryRules": ["safety rules, fallback logic, shutdowns, cutoffs, alerts, expiry or retention rules"],
    "dataFieldsOrMetadata": ["source-stated data fields, metadata, identifiers, payload fields, confidence scores, timestamps"],
    "claimSeeds": ["short claim-support phrases taken from source-stated inventive features"],
    "notStated": ["important patent facts that are not stated by source and must not be invented"]
  },
  "scopeRecommendations": {
    "version": 1,
    "generatedAt": "",
    "basis": {
      "patentTypePrimary": "PRODUCT|SYSTEM|PROCESS|COMPOSITION",
      "inventionType": ["MECHANICAL|ELECTRICAL|SOFTWARE|CHEMICAL|BIO|GENERAL"],
      "fieldOfRelevance": "same value as fieldOfRelevance",
      "subfield": "same value as subfield"
    },
    "elements": [{
      "id": "short_stable_snake_case_id",
      "label": "source-stated element, step, constituent, entity, condition, range, data field, environment, or use-case label",
      "sourceType": "component|subcomponent|process_step|method_step|constituent|compound|formulation|material|biological_entity|sequence|cell|protein|reagent|sample|assay_step|therapeutic_step|diagnostic_marker|manufacturing_step|condition|range|data_field|interface|use_case|environment|other",
      "recommended": {
        "claim": "claim_1|dependent_claim|none",
        "numbering": "number|do_not_number",
        "figures": "include|optional|do_not_show",
        "description": "include|optional|exclude"
      },
      "reason": "brief patent-drafting reason based on patent type, invention field, and source support",
      "sourceRefs": ["components[0]", "sourceFactLedger.componentsAndSubcomponents[0]", "claimableFeatures[0]"]
    }]
  },
  "normalizationReviewWarnings": []
}`
}
