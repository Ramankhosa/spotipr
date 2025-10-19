import { llmGateway, executePatentDrafting } from './metering/gateway';
import { prisma } from './prisma';
import crypto from 'crypto';

export interface IdeaNormalizationRequest {
  rawIdea: string;
  title: string;
  tenantId?: string;
}

export interface IdeaNormalizationResult {
  success: boolean;
  normalizedData?: any;
  extractedFields?: {
    problem?: string;
    objectives?: string;
    components?: any[];
    logic?: string;
    inputs?: string;
    outputs?: string;
    variants?: string;
      bestMethod?: string;
      fieldOfRelevance?: string;
      subfield?: string;
      recommendedFocus?: string;
      complianceNotes?: string;
      drawingsFocus?: string;
      claimStrategy?: string;
      riskFlags?: string;
  };
  llmPrompt?: string;
  llmResponse?: any;
  tokensUsed?: number;
  error?: string;
}

export interface ComponentValidationResult {
  valid: boolean;
  components?: any;
  errors?: string[];
}

export interface PlantUMLGenerationResult {
  success: boolean;
  plantumlCode?: string;
  checksum?: string;
  error?: string;
}

export interface AnnexureDraftResult {
  success: boolean;
  draft?: {
    title: string;
    fieldOfInvention?: string;
    background?: string;
    summary?: string;
    briefDescriptionOfDrawings?: string;
    detailedDescription?: string;
    bestMethod?: string;
    claims?: string;
    abstract?: string;
    listOfNumerals?: string;
    fullText: string;
  };
  isValid?: boolean;
  validationReport?: any;
  llmPrompt?: string;
  llmResponse?: any;
  tokensUsed?: number;
  error?: string;
}

export class DraftingService {

  /**
   * Get drafting history for a patent (placeholder implementation)
   */
  static async getDraftingHistory(patentId: string, userId: string): Promise<any[]> {
    try {
      // TODO: Implement proper drafting history retrieval
      // For now, return empty array
      return [];
    } catch (error) {
      console.error('Get drafting history error:', error);
      throw error;
    }
  }

  /**
   * Normalize raw invention idea using LLM
   */
  static async normalizeIdea(
    rawIdea: string,
    title: string,
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    areaOfInvention?: string
  ): Promise<IdeaNormalizationResult> {
    try {
      // Debug logging
      console.log('DraftingService.normalizeIdea called with:', {
        rawIdeaLength: rawIdea.length,
        title,
        tenantId
      });

      // Validate input length - limit to prevent token overflow
      if (rawIdea.length > 5000) {
        return {
          success: false,
          error: 'Idea text exceeds maximum length of 5,000 characters. Please shorten your description.'
        };
      }
      
          const domainExpertise = (areaOfInvention && areaOfInvention.trim()) ? ` with core expertise in ${areaOfInvention.trim()}` : '';

          const prompt = `You are an expert patent attorney specializing in drafting and structuring patent disclosures across all domains (mechanical, electrical, software, biotech, chemistry, medical devices, materials, aerospace, etc.)${domainExpertise}.

Task: Read the invention description and output ONLY a valid JSON object capturing the key drafting elements.

Rules (must follow strictly):
- Output MUST be a single JSON object, no code fences, no backticks, no prose.
- Use concise, formal patent language suitable for specification drafting.
- Keep each field as a single string (no arrays), except "components" which is an array of objects.
- Use double-quoted keys and strings; avoid line breaks mid-sentence when possible.
 - Keep content succinct; avoid redundancy and marketing language.
 - Components: return up to 8 items maximum by default (more only if essential). Use hierarchy when helpful (module → submodule → sub-submodule). Keep each item's description to one sentence.

TITLE: ${title}

INVENTION DESCRIPTION:
${rawIdea}

Respond in this exact JSON shape:
{
  "problem": "concise statement of the technical problem",
  "objectives": "succinct objectives of the invention",
  "components": [{
    "name": "component name",
    "type": "MAIN_CONTROLLER|SUBSYSTEM|MODULE|INTERFACE|SENSOR|ACTUATOR|PROCESSOR|MEMORY|DISPLAY|COMMUNICATION|POWER_SUPPLY|OTHER",
    "description": "technical role in the system",
    "inputs": "optional: key inputs/signals/data",
    "outputs": "optional: key outputs/actions/data",
    "dependencies": "optional: other components relied on",
    "figureHint": "optional: what to highlight in figures",
    "parent": "optional: parent component name if this is a submodule",
    "level": "optional: 0 for root modules, 1 for child, 2 for grandchild, etc.",
    "sequence": "optional: order within its level (1-based)",
    "numberingHint": "optional: preferred hundreds bucket e.g., 100|200|300|400|500|600|700|800|900"
  }],
  "logic": "how components interact to achieve the objectives",
  "inputs": "key inputs/signals/data required",
  "outputs": "key outputs/actions/data produced",
  "variants": "notable embodiments or alternatives",
  "bestMethod": "preferred implementation at filing date",
  "fieldOfRelevance": "primary domain (e.g., Mechanical, Electrical, Software, Medical Device, Biotech, Chemistry, Materials, Aerospace)",
  "subfield": "more specific area (e.g., fluid mechanics, image processing, polymer chemistry)",
  "recommendedFocus": "what to emphasize in drafting for this field",
  "complianceNotes": "regulatory or standards-related notes if relevant",
  "drawingsFocus": "what figures should emphasize given the field",
  "claimStrategy": "high-level claim drafting approach suited to this field",
  "riskFlags": "any potential enablement or patentability risks to watch"
}`;

      console.log('Calling LLM gateway with taskCode: LLM2_DRAFT');

      // Execute through LLM gateway
      const request = { headers: requestHeaders || {} };
      const llmResult = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        prompt,
        parameters: { tenantId },
        idempotencyKey: crypto.randomUUID()
      });

      console.log('LLM gateway result:', {
        success: llmResult.success,
        hasResponse: !!llmResult.response,
        error: llmResult.error?.message
      });

      if (!llmResult.success || !llmResult.response) {
        return {
          success: false,
          error: llmResult.error?.message || 'LLM processing failed'
        };
      }

      // Parse LLM response (robust JSON extraction)
      let normalizedData;
      try {
        const output = (llmResult.response.output || '').trim();
        console.log('Raw LLM output (first 500 chars):', output.substring(0, 500));
        console.log('Raw LLM output length:', output.length);

        let jsonText = output;

        // If fenced with backticks, strip the outer fence even if closing fence is missing
        const fenceStart = jsonText.indexOf('```');
        if (fenceStart !== -1) {
          jsonText = jsonText.slice(fenceStart + 3); // drop opening ```
          // drop optional language tag like 'json'
          jsonText = jsonText.replace(/^json\s*/i, '');
          const fenceEnd = jsonText.indexOf('```');
          if (fenceEnd !== -1) {
            jsonText = jsonText.slice(0, fenceEnd);
          }
        }

        // Trim to the JSON object boundaries
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (startBrace !== -1) {
          jsonText = lastBrace !== -1 && lastBrace > startBrace
            ? jsonText.slice(startBrace, lastBrace + 1)
            : jsonText.slice(startBrace);
        }

        // Cleanup common JSON issues
        jsonText = jsonText
          .replace(/`+/g, '') // remove stray backticks
          .replace(/,(\s*[}\]])/g, '$1') // remove trailing commas
          .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, ''); // remove control chars

        console.log('Extracted JSON string (first 500 chars):', jsonText.substring(0, 500));

        // First parse attempt
        try {
          normalizedData = JSON.parse(jsonText);
        } catch (firstErr) {
          // Fallback: attempt to quote unquoted keys
          const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
          normalizedData = JSON.parse(quotedKeys);
        }

        // Normalize component hierarchy if provided
        if (Array.isArray(normalizedData?.components)) {
          normalizedData.components = normalizedData.components.map((c: any, idx: number) => ({
            ...c,
            level: typeof c?.level === 'number' && c.level >= 0 ? c.level : 0,
            sequence: typeof c?.sequence === 'number' && c.sequence > 0 ? c.sequence : (idx + 1),
          }))
        }

        if (!normalizedData || typeof normalizedData !== 'object') {
          throw new Error('LLM did not return a valid object');
        }

      } catch (parseError) {
        console.error('LLM response parsing error:', parseError);
        console.error('Full LLM output:', llmResult.response.output);
        // Provide clearer error when response was truncated
        const truncated = llmResult.response.metadata?.finishReason === 'MAX_TOKENS';
        return {
          success: false,
          error: truncated
            ? 'LLM response was truncated and could not be parsed as JSON. Please try again with a shorter idea.'
            : `Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          llmResponse: llmResult.response,
        };
      }

      // Extract fields for easy database querying
      const extractedFields = {
        problem: normalizedData.problem,
        objectives: normalizedData.objectives,
        components: normalizedData.components,
        logic: normalizedData.logic,
        inputs: normalizedData.inputs,
        outputs: normalizedData.outputs,
        variants: normalizedData.variants,
        bestMethod: normalizedData.bestMethod,
        fieldOfRelevance: normalizedData.fieldOfRelevance,
        subfield: normalizedData.subfield,
        recommendedFocus: normalizedData.recommendedFocus,
        complianceNotes: normalizedData.complianceNotes,
        drawingsFocus: normalizedData.drawingsFocus,
        claimStrategy: normalizedData.claimStrategy,
        riskFlags: normalizedData.riskFlags
      };

      return {
        success: true,
        normalizedData,
        extractedFields,
        llmPrompt: prompt,
        llmResponse: llmResult.response,
        tokensUsed: llmResult.response.outputTokens
      };

    } catch (error) {
      console.error('Idea normalization error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Idea normalization failed'
      };
    }
  }

  /**
   * Validate and process component map with numeral assignment
   */
  static validateComponentMap(components: any[]): ComponentValidationResult {
    const errors: string[] = [];
    const processedComponents: any[] = [];

    if (!Array.isArray(components) || components.length === 0) {
      return { valid: false, errors: ['Components array is required and cannot be empty'] };
    }

    if (components.length > 100) {
      return { valid: false, errors: ['Maximum 100 components allowed'] };
    }

    // Build tree by parentId (optional)
    type Comp = { id?: string; name: string; description?: string; parentId?: string };
    const nodes: Record<string, any> = {};
    const roots: any[] = [];

    for (const comp of components as Comp[]) {
      if (!comp.name || typeof comp.name !== 'string') {
        errors.push('Component name is required and must be a string');
        continue;
      }
      const id = comp.id || crypto.randomUUID();
      nodes[id] = { id, name: comp.name.trim(), description: comp.description || '', parentId: (comp as any).parentId || null, children: [] };
    }

    // Link children
    Object.values(nodes).forEach((n: any) => {
      if (n.parentId && nodes[n.parentId]) {
        nodes[n.parentId].children.push(n);
      } else {
        roots.push(n);
      }
    });

    // Assign numerals in 100-blocks per root to avoid overlap
    const usedNumerals = new Set<number>();
    let rootIndex = 1; // 100, 200, ... 900

    const assignBlock = (node: any, base: number) => {
      let cursor = base;

      const dfs = (n: any) => {
        if (cursor > base + 99) {
          errors.push(`Too many subcomponents under root block ${base}`);
          return;
        }
        // Assign numeral
        while (usedNumerals.has(cursor) && cursor <= base + 99) cursor++;
        n.numeral = cursor;
        usedNumerals.add(cursor);
        cursor++;
        // Children
        if (Array.isArray(n.children) && n.children.length > 0) {
          // Stable order
          n.children.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
          n.children.forEach((c: any) => dfs(c));
        }
      };

      dfs(node);
    };

    // Sort roots by name for stability, assign blocks 100..900
    roots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    for (const root of roots) {
      let base = rootIndex * 100;
      if (base > 900) {
        // Fallback: find next free block within 100..999
        base = 100;
        while (base <= 900 && Array.from({ length: 100 }).some((_, i) => usedNumerals.has(base + i))) {
          base += 100;
        }
        if (base > 900) {
          errors.push('No available 100-blocks remain for numbering');
          break;
        }
      }
      assignBlock(root, base);
      rootIndex++;
    }

    // Flatten back into processed list
    const collect = (n: any) => {
      processedComponents.push({
        id: n.id,
        name: n.name,
        type: 'OTHER',
        description: n.description,
        numeral: n.numeral,
        range: `${Math.floor(n.numeral / 100) * 100}s`,
        parentId: n.parentId || undefined
      });
      n.children?.forEach((c: any) => collect(c));
    };
    roots.forEach((r) => collect(r));

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, components: processedComponents };
  }

  /**
   * Generate PlantUML code from figure plan and reference map
   */
  static async generatePlantUML(
    figurePlan: any,
    referenceMap: any
  ): Promise<PlantUMLGenerationResult> {
    try {
      // Build component lookup by numeral
      const componentLookup: Record<number, any> = {};
      if (referenceMap?.components) {
        for (const component of referenceMap.components) {
          componentLookup[component.numeral] = component;
        }
      }

      // Generate PlantUML code
      let plantumlCode = '@startuml\n';

      // Add title
      plantumlCode += `title ${figurePlan.title}\n\n`;

      // Add components as rectangles or other shapes
      if (figurePlan.nodes && Array.isArray(figurePlan.nodes)) {
        for (const nodeRef of figurePlan.nodes) {
          const component = componentLookup[nodeRef];
          if (component) {
            const shape = this.getShapeForComponent(component.type);
            plantumlCode += `${shape} "${component.name} (${component.numeral})" as C${component.numeral}\n`;
          }
        }
      }

      plantumlCode += '\n';

      // Add connections
      if (figurePlan.edges && Array.isArray(figurePlan.edges)) {
        for (const edge of figurePlan.edges) {
          const fromComponent = componentLookup[edge.from];
          const toComponent = componentLookup[edge.to];

          if (fromComponent && toComponent) {
            const label = edge.label ? ` : ${edge.label}` : '';
            plantumlCode += `C${fromComponent.numeral} --> C${toComponent.numeral}${label}\n`;
          }
        }
      }

      plantumlCode += '\n@enduml';

      // Generate checksum
      const checksum = crypto.createHash('sha256').update(plantumlCode).digest('hex');

      return {
        success: true,
        plantumlCode,
        checksum
      };

    } catch (error) {
      console.error('PlantUML generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PlantUML generation failed'
      };
    }
  }

  /**
   * Get appropriate PlantUML shape for component type
   */
  private static getShapeForComponent(type: string): string {
    const shapeMap: Record<string, string> = {
      MAIN_CONTROLLER: 'rectangle',
      SUBSYSTEM: 'rectangle',
      MODULE: 'component',
      INTERFACE: 'interface',
      SENSOR: 'circle',
      ACTUATOR: 'hexagon',
      PROCESSOR: 'node',
      MEMORY: 'database',
      DISPLAY: 'actor',
      COMMUNICATION: 'queue',
      POWER_SUPPLY: 'storage',
      OTHER: 'rectangle'
    };

    return shapeMap[type] || 'rectangle';
  }

  /**
   * Generate complete annexure draft using LLM
   */
  static async generateAnnexureDraft(
    session: any,
    jurisdiction: string = 'IN',
    filingType: string = 'utility',
    tenantId?: string,
    requestHeaders?: Record<string, string>
  ): Promise<AnnexureDraftResult> {
    try {
      // Build comprehensive prompt
      const prompt = this.buildAnnexurePrompt(session, jurisdiction, filingType);

      // Execute through LLM gateway
      const request = { headers: requestHeaders || {} };
      const result = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        prompt,
        parameters: { tenantId, jurisdiction, filingType },
        idempotencyKey: crypto.randomUUID()
      });

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'Draft generation failed'
        };
      }

      // Parse and structure the draft
      const draftResult = this.parseDraftResponse(result.response.output);

      if (!draftResult.success) {
        return {
          success: false,
          error: draftResult.error
        };
      }

      // Validate draft consistency
      const validation = this.validateDraftConsistency(draftResult.draft, session);

      return {
        success: true,
        draft: draftResult.draft,
        isValid: validation.valid,
        validationReport: validation.report,
        llmPrompt: prompt,
        llmResponse: result.response,
        tokensUsed: result.response.outputTokens
      };

    } catch (error) {
      console.error('Annexure draft generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Draft generation failed'
      };
    }
  }

  /**
   * Build comprehensive annexure generation prompt
   */
  private static buildAnnexurePrompt(session: any, jurisdiction: string, filingType: string): string {
    const idea = session.ideaRecord;
    const components: any[] = session.referenceMap?.components || [];
    const figures: any[] = session.figurePlans || [];

    let prompt = `Draft complete ${jurisdiction} patent specification.

INVENTION:
Title: ${idea.title}
Problem: ${idea.problem || 'Not specified'}
Objectives: ${idea.objectives || 'Not specified'}
Components: ${components.map(c => `${c.name} (${c.numeral})`).join(', ')}
Logic: ${idea.logic || 'Not specified'}
${figures.length > 0 ? `Figures: ${figures.map(f => `Fig.${f.figureNo}: ${f.title}`).join(', ')}` : ''}

REQUIRED SECTIONS:
1. TITLE (≤15 words)
2. FIELD OF INVENTION
3. BACKGROUND
4. SUMMARY
5. BRIEF DESCRIPTION OF DRAWINGS
6. DETAILED DESCRIPTION (include BEST METHOD subsection)
7. CLAIMS (independent + dependent)
8. ABSTRACT (≤150 words, start with title)
9. LIST OF REFERENCE NUMERALS

Use reference numerals consistently. Follow ${jurisdiction} format.`;

    return prompt;
  }

  /**
   * Parse LLM response into structured draft sections
   */
  private static parseDraftResponse(output: string): { success: boolean; draft?: any; error?: string } {
    try {
      // Split response into sections
      const sections = {
        title: '',
        fieldOfInvention: '',
        background: '',
        summary: '',
        briefDescriptionOfDrawings: '',
        detailedDescription: '',
        bestMethod: '',
        claims: '',
        abstract: '',
        listOfNumerals: ''
      };

      // Simple section extraction (in production, use more robust parsing)
      const sectionPatterns = {
        title: /TITLE:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        fieldOfInvention: /FIELD OF INVENTION:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        background: /BACKGROUND:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        summary: /SUMMARY:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        briefDescriptionOfDrawings: /BRIEF DESCRIPTION OF DRAWINGS:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        detailedDescription: /DETAILED DESCRIPTION:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        bestMethod: /BEST METHOD:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        claims: /CLAIMS:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        abstract: /ABSTRACT:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        listOfNumerals: /LIST OF.*NUMERALS:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$|$)/i
      };

      for (const [key, pattern] of Object.entries(sectionPatterns) as Array<[keyof typeof sectionPatterns, RegExp]>) {
        const match = output.match(pattern);
        if (match) {
          sections[key] = match[1].trim();
        }
      }

      // Validate critical sections
      if (!sections.title || !sections.claims || !sections.abstract) {
        return {
          success: false,
          error: 'Draft missing required sections (title, claims, abstract)'
        };
      }

      // Validate abstract word count
      const abstractWords = sections.abstract.split(/\s+/).length;
      if (abstractWords > 150) {
        sections.abstract = sections.abstract.split(/\s+/).slice(0, 150).join(' ') + '...';
      }

      // Build full text
      const fullText = Object.entries(sections as Record<string, string>)
        .filter(([key, value]) => value && key !== 'title')
        .map(([key, value]) => `${key.toUpperCase().replace(/([A-Z])/g, ' $1').trim()}:\n\n${value}`)
        .join('\n\n');

      return {
        success: true,
        draft: {
          ...sections,
          fullText
        }
      };

    } catch (error) {
      return {
        success: false,
        error: 'Failed to parse draft response'
      };
    }
  }

  /**
   * Validate draft consistency with components and figures
   */
  private static validateDraftConsistency(draft: any, session: any): { valid: boolean; report: any } {
    const report = {
      numeralConsistency: true,
      figureReferences: true,
      missingNumerals: [],
      unusedNumerals: [],
      invalidReferences: []
    };

    try {
      // Extract all numerals from draft text
      const numeralRegex = /\((\d{2,3})\)/g;
      const usedNumerals = new Set<number>();
      let match;

      const fullText = draft.fullText || '';
      while ((match = numeralRegex.exec(fullText)) !== null) {
        usedNumerals.add(parseInt(match[1]));
      }

      // Check against reference map
      const referenceNumerals = new Set<number>();
      if (session.referenceMap?.components) {
        for (const component of session.referenceMap.components) {
          referenceNumerals.add(component.numeral);
        }
      }

      // Find missing and unused numerals
      referenceNumerals.forEach((refNum: number) => {
        if (!usedNumerals.has(refNum)) {
          (report.missingNumerals as Array<number>).push(refNum);
        }
      });

      usedNumerals.forEach((usedNum: number) => {
        if (!referenceNumerals.has(usedNum)) {
          (report.unusedNumerals as Array<number>).push(usedNum);
        }
      });

      // Check figure references
      const figureRegex = /Fig\.?\s*(\d+)/gi;
      const referencedFigures = new Set<number>();
      while ((match = figureRegex.exec(fullText)) !== null) {
        referencedFigures.add(parseInt(match[1]));
      }

      const availableFigures = new Set<number>((session.figurePlans?.map((f: any) => f.figureNo) || []));
      referencedFigures.forEach((refFig: number) => {
        if (!availableFigures.has(refFig)) {
          (report.invalidReferences as Array<string | number>).push(`Figure ${refFig}`);
        }
      });

      report.numeralConsistency = report.missingNumerals.length === 0 && report.unusedNumerals.length === 0;
      report.figureReferences = report.invalidReferences.length === 0;

      return {
        valid: report.numeralConsistency && report.figureReferences,
        report
      };

    } catch (error) {
      return {
        valid: false,
        report: {
          error: 'Validation failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
}