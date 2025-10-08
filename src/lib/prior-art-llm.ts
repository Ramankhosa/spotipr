import { llmGateway } from './metering/gateway';

// LLM Prompt Specification (per SRS §7)
export const PRIOR_ART_LLM_PROMPT = `You are a patent search strategist specializing in prior art analysis.

Your task is to read an invention brief and generate a structured JSON bundle for patent search queries. You must return ONLY valid JSON with no additional text, markdown, code blocks, or explanations.

INVENTION BRIEF:
{invention_brief}

CRITICAL OUTPUT REQUIREMENTS:
- Return ONLY valid JSON - no markdown, no code blocks, no explanations, no "Here is the JSON:" text
- Start your response directly with { and end with }
- Generate exactly 3 query variants with labels: "broad", "baseline", "narrow"
- Use Google Boolean syntax: parentheses (), AND, OR, quotes "", minus -
- Keep each query (q field) under 300 characters
- Focus on intelligent query generation - this is your main task!
- Include meaningful notes for each query variant explaining the strategy
- Extract core technical concepts and features from the invention brief
- Generate synonym_groups as arrays of related terms for better search recall
- Provide CPC_candidates and IPC_candidates in SerpAPI-compatible format (e.g., "A01B", "B65D1/00")
- CPC codes: Use section/subsection format like "A01B", "G06F"
- IPC codes: Use full classification format like "A01B1/00", "G06F17/30"

RESPONSE FORMAT: Start directly with JSON, no other text:

REQUIRED OUTPUT SCHEMA (Patent search intelligence with SerpAPI-compatible formats):
{
  "source_summary": {
    "title": "Brief descriptive title of the invention",
    "problem_statement": "What problem does this solve?",
    "solution_summary": "How does it solve the problem?"
  },
  "core_concepts": ["key technical concept 1", "key technical concept 2"],
  "technical_features": ["important feature 1", "important feature 2"],
  "synonym_groups": [
    ["sensor", "detector", "transducer"],
    ["package", "parcel", "container"],
    ["monitoring", "tracking", "surveillance"]
  ],
  "cpc_candidates": ["A01B", "B65D", "G01S"],
  "ipc_candidates": ["A01B1/00", "B65D1/00", "G01S1/00"],
  "query_variants": [
    {
      "label": "broad",
      "q": "Google patent search query using OR operators for broad recall",
      "notes": "Strategy explanation for broad search"
    },
    {
      "label": "baseline",
      "q": "Balanced query with mix of broad and specific terms",
      "notes": "Strategy explanation for baseline search"
    },
    {
      "label": "narrow",
      "q": "Specific query targeting unique aspects of the invention",
      "notes": "Strategy explanation for narrow search"
    }
  ]
}

NOTE: Other fields (synonyms, phrases, exclusions, classifications, dates, etc.) will be set with sensible defaults or configured by the analyst in advanced settings.`;

export interface PriorArtLLMRequest {
  inventionBrief: string;
  jwtToken: string;
  patentId: string;
}

export interface PriorArtLLMResponse {
  success: boolean;
  bundle?: any;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    modelClass: string;
  };
}

export class PriorArtLLMService {
  static async generateBundle(request: PriorArtLLMRequest): Promise<PriorArtLLMResponse> {
    try {
      // Prepare LLM request
      const prompt = PRIOR_ART_LLM_PROMPT.replace('{invention_brief}', request.inventionBrief);

      const llmRequest = {
        taskCode: 'LLM1_PRIOR_ART' as const,
        prompt,
        inputTokens: Math.ceil(prompt.length / 4), // Rough estimate
        idempotencyKey: `prior-art-${request.patentId}-${Date.now()}`
      };

      // Execute LLM call through gateway (handles policy checks internally)
      const headers = {
        'authorization': `Bearer ${request.jwtToken}`
      };

      const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'LLM request failed'
        };
      }

      // Parse and validate JSON response
      let bundle;
      try {
        console.log('🔍 Raw LLM response:', result.response.output);

        let jsonText = result.response.output.trim();

        // Try to extract JSON from markdown code blocks
        const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
        const match = jsonText.match(jsonBlockRegex);
        if (match) {
          jsonText = match[1].trim();
          console.log('📝 Extracted JSON from code block:', jsonText);
        }

        // Remove any leading/trailing text that might not be JSON
        // Look for the first '{' and last '}'
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');

        if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
          jsonText = jsonText.substring(startBrace, lastBrace + 1);
          console.log('✂️ Extracted JSON between braces:', jsonText);
        }

        bundle = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('❌ JSON parse error:', parseError);
        console.error('❌ Raw response that failed:', result.response.output);
        return {
          success: false,
          error: `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        };
      }

      // Validate essential fields from LLM
      if (!bundle.source_summary || !bundle.core_concepts || !bundle.technical_features ||
          !bundle.synonym_groups || !bundle.cpc_candidates || !bundle.ipc_candidates || !bundle.query_variants) {
        return {
          success: false,
          error: 'LLM response missing required fields'
        };
      }

      if (!Array.isArray(bundle.query_variants) || bundle.query_variants.length !== 3) {
        return {
          success: false,
          error: 'LLM must generate exactly 3 query variants'
        };
      }

      // Ensure exactly 3 variants with correct labels
      const requiredLabels = ['broad', 'baseline', 'narrow'];
      const actualLabels = bundle.query_variants.map((v: any) => v.label).sort();
      const sortedRequiredLabels = [...requiredLabels].sort();

      console.log('🔍 Required labels (original):', requiredLabels);
      console.log('🔍 Required labels (sorted):', sortedRequiredLabels);
      console.log('🔍 Actual labels (sorted):', actualLabels);
      console.log('🔍 Label types:', actualLabels.map((l: any) => typeof l));

      if (JSON.stringify(actualLabels) !== JSON.stringify(sortedRequiredLabels)) {
        console.error('❌ Label mismatch - required (sorted):', sortedRequiredLabels, 'actual (sorted):', actualLabels);
        return {
          success: false,
          error: 'LLM did not generate required query variants'
        };
      }

      // Add default values for fields not generated by LLM
      bundle = {
        ...bundle,
        phrases: [], // User can add in advanced settings
        exclude_terms: [], // User can add exclusions
        spec_limits: [], // Usually empty for patents
        domain_tags: [], // Can be auto-detected from technical_features
        date_window: null, // No date restrictions by default
        jurisdictions_preference: [], // Global search by default
        ambiguous_terms: [], // Usually empty
        sensitive_tokens: [], // Usually empty
        serpapi_defaults: {
          engine: undefined, // Default to both patents and scholar
          hl: 'en',
          no_cache: false
        },
        fields_for_details: ['title', 'abstract', 'claims', 'classifications', 'publication_date'],
        detail_priority_rules: 'Prioritize recent publications with high citation counts'
      };

      // Add default num and page to query variants
      bundle.query_variants = bundle.query_variants.map((variant: any) => ({
        ...variant,
        num: 20, // Default results per page
        page: 1  // Start from first page
      }));

      return {
        success: true,
        bundle,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4), // Estimate from prompt length
          outputTokens: result.response.outputTokens,
          modelClass: result.response.modelClass
        }
      };

    } catch (error) {
      console.error('Prior Art LLM generation error:', error);
      return {
        success: false,
        error: 'Failed to generate prior art bundle'
      };
    }
  }

  static validateLLMOutput(bundle: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields check
    const requiredFields = [
      'source_summary', 'core_concepts', 'query_variants', 'serpapi_defaults'
    ];

    for (const field of requiredFields) {
      if (!(field in bundle)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Query variants validation
    if (bundle.query_variants) {
      if (!Array.isArray(bundle.query_variants) || bundle.query_variants.length !== 3) {
        errors.push('Must have exactly 3 query variants');
      } else {
        const labels = bundle.query_variants.map((v: any) => v.label);
        const requiredLabels = ['broad', 'baseline', 'narrow'];
        const missingLabels = requiredLabels.filter(label => !labels.includes(label));
        if (missingLabels.length > 0) {
          errors.push(`Missing query variants: ${missingLabels.join(', ')}`);
        }
      }
    }

    // SerpAPI defaults validation
    if (bundle.serpapi_defaults?.engine !== undefined &&
        !['google_patents', 'google_scholar'].includes(bundle.serpapi_defaults.engine)) {
      errors.push('serpapi_defaults.engine must be "google_patents", "google_scholar", or undefined (for both)');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
