import { describe, expect, it } from 'vitest'
import { AnthropicProvider } from '../anthropic-provider'
import { buildDiagramBatchPrompt } from '@/lib/patent-diagrams/prompts'
import type { FigureSetPlanItem, PatentDiagramComponent } from '@/lib/patent-diagrams/types'

/**
 * OpenAI and Gemini find a shared prompt prefix on their own; Anthropic does not.
 * Without an explicit cache_control breakpoint it bills every call's full prompt as
 * fresh input, so the breakpoint — and the prompt builder that reports where it goes —
 * is the whole mechanism on that provider.
 */

function anthropicCapturingProvider() {
  const provider = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' })
  const captured: any[] = []
  ;(provider as any).client = {
    messages: {
      create: async (body: any) => {
        captured.push(body)
        return { content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }
      },
    },
  }
  return { provider, captured }
}

const LONG_PREFIX = 'INVARIANT PREAMBLE. '.repeat(400) // ~8,000 characters, above every model floor

describe('Anthropic prompt cache breakpoint', () => {
  it('splits the prompt into a cached prefix block and an uncached tail', async () => {
    const { provider, captured } = anthropicCapturingProvider()
    const prompt = `${LONG_PREFIX}FIGURE-SPECIFIC TAIL`

    await provider.execute(
      { prompt, modelClass: 'claude-sonnet-5', parameters: { cacheablePrefixLength: LONG_PREFIX.length } } as any,
      { maxTokensOut: 4096 } as any,
    )

    expect(captured[0].messages[0].content).toEqual([
      { type: 'text', text: LONG_PREFIX, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'FIGURE-SPECIFIC TAIL' },
    ])
  })

  it('reassembles to exactly the prompt it was given', async () => {
    const { provider, captured } = anthropicCapturingProvider()
    const prompt = `${LONG_PREFIX}FIGURE-SPECIFIC TAIL`

    await provider.execute(
      { prompt, modelClass: 'claude-sonnet-5', parameters: { cacheablePrefixLength: LONG_PREFIX.length } } as any,
      { maxTokensOut: 4096 } as any,
    )

    expect(captured[0].messages[0].content.map((block: any) => block.text).join('')).toBe(prompt)
  })

  it('sends a plain string when no breakpoint is declared', async () => {
    const { provider, captured } = anthropicCapturingProvider()

    await provider.execute(
      { prompt: `${LONG_PREFIX}TAIL`, modelClass: 'claude-sonnet-5' } as any,
      { maxTokensOut: 4096 } as any,
    )

    expect(captured[0].messages[0].content).toBe(`${LONG_PREFIX}TAIL`)
  })

  // Anthropic will not create a cache entry below a per-model token floor, so marking
  // a short prefix splits the message for nothing.
  it('leaves a prefix below the model floor unmarked', async () => {
    const { provider, captured } = anthropicCapturingProvider()

    await provider.execute(
      { prompt: 'short preamble. TAIL', modelClass: 'claude-sonnet-5', parameters: { cacheablePrefixLength: 16 } } as any,
      { maxTokensOut: 4096 } as any,
    )

    expect(captured[0].messages[0].content).toBe('short preamble. TAIL')
  })

  // A stale offset must degrade to an uncached call, never truncate the prompt.
  it('ignores an offset that runs past the end of the prompt', async () => {
    const { provider, captured } = anthropicCapturingProvider()
    const prompt = `${LONG_PREFIX}TAIL`

    await provider.execute(
      { prompt, modelClass: 'claude-sonnet-5', parameters: { cacheablePrefixLength: prompt.length + 500 } } as any,
      { maxTokensOut: 4096 } as any,
    )

    expect(captured[0].messages[0].content).toBe(prompt)
  })

  it('applies the higher Haiku floor', async () => {
    const provider = new AnthropicProvider({ apiKey: 'x', baseURL: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5' })
    const captured: any[] = []
    ;(provider as any).client = {
      messages: {
        create: async (body: any) => {
          captured.push(body)
          return { content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }
        },
      },
    }
    // 8,000 characters clears the Sonnet floor but not Haiku's.
    await provider.execute(
      { prompt: `${LONG_PREFIX}TAIL`, modelClass: 'claude-haiku-4-5', parameters: { cacheablePrefixLength: LONG_PREFIX.length } } as any,
      { maxTokensOut: 4096 } as any,
    )

    expect(captured[0].messages[0].content).toBe(`${LONG_PREFIX}TAIL`)
  })
})

const COMPONENTS: PatentDiagramComponent[] = [
  { id: 'c1', name: 'Sensor Module', type: 'HARDWARE', description: 'Captures readings', referenceLabel: '100', parentId: null, claimSupport: null },
  { id: 'c2', name: 'Controller', type: 'HARDWARE', description: 'Processes readings', referenceLabel: '200', parentId: null, claimSupport: null },
]

function planItem(key: string, kind: FigureSetPlanItem['kind']): FigureSetPlanItem {
  return {
    key, kind, title: `Title ${key}`, purpose: `Purpose ${key}`,
    detailLevel: 'DETAIL', direction: 'TB',
    componentIds: ['c1', 'c2'], claimCriticalComponentIds: [],
    orderedGroups: [], phaseHints: [], evidenceIds: [],
  }
}

describe('diagram generation prompt cache boundary', () => {
  const shared = {
    inventionContext: { technicalProblem: 'Readings drift over time', processSteps: ['capture', 'correct'] },
    claimsContext: [{ number: 1, text: 'A system comprising a sensor module and a controller.' }],
    components: COMPONENTS,
    evidenceCatalog: [{ id: 'SF-processSteps-1', value: 'capturing a reading' }],
  }

  it('reports a boundary that reassembles to the whole prompt', () => {
    const { prompt, cacheablePrefixLength } = buildDiagramBatchPrompt({ ...shared, plans: [planItem('a', 'COMPONENT')] })

    expect(cacheablePrefixLength).toBeGreaterThan(0)
    expect(cacheablePrefixLength).toBeLessThan(prompt.length)
    expect(prompt.slice(0, cacheablePrefixLength) + prompt.slice(cacheablePrefixLength)).toBe(prompt)
  })

  it('puts the whole figure-specific tail below the boundary', () => {
    const { prompt, cacheablePrefixLength } = buildDiagramBatchPrompt({ ...shared, plans: [planItem('alpha', 'SEQUENCE')] })
    const prefix = prompt.slice(0, cacheablePrefixLength)

    expect(prefix).not.toContain('alpha')
    expect(prefix).not.toContain('FIGURES TO DETAIL')
    expect(prompt.slice(cacheablePrefixLength)).toContain('FIGURES TO DETAIL')
  })

  // The invariant the cache actually depends on: sibling calls in one run differ only
  // below the boundary. If an edit ever lifts plan-specific text above it, every
  // generation call becomes a cache miss and this fails.
  it('produces a byte-identical prefix across the batches of one run', () => {
    const first = buildDiagramBatchPrompt({ ...shared, plans: [planItem('a', 'COMPONENT'), planItem('b', 'PROCESS')] })
    const second = buildDiagramBatchPrompt({ ...shared, plans: [planItem('c', 'SEQUENCE'), planItem('d', 'CONSTITUENT')] })

    expect(first.cacheablePrefixLength).toBe(second.cacheablePrefixLength)
    expect(first.prompt.slice(0, first.cacheablePrefixLength))
      .toBe(second.prompt.slice(0, second.cacheablePrefixLength))
    expect(first.prompt).not.toBe(second.prompt)
  })

  // Regeneration passes the existing model in; that must stay below the boundary too,
  // so a regenerate still reads the cache the original run wrote.
  it('keeps existing semantic models below the boundary', () => {
    const withExisting = buildDiagramBatchPrompt({
      ...shared,
      plans: [planItem('a', 'COMPONENT')],
      existingDiagrams: [{ key: 'a', kind: 'COMPONENT', title: 'Prior', purpose: 'Prior purpose' } as any],
    })
    const without = buildDiagramBatchPrompt({ ...shared, plans: [planItem('a', 'COMPONENT')] })

    expect(withExisting.prompt.slice(0, withExisting.cacheablePrefixLength))
      .toBe(without.prompt.slice(0, without.cacheablePrefixLength))
  })
})
