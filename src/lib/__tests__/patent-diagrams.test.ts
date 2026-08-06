import { describe, expect, test } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { PATENT_DIAGRAM_STYLE, compilePatentDiagramStyle } from '@/lib/patent-diagrams/style'
import { buildPatentDiagram } from '@/lib/patent-diagrams/builders'
import { analyzeDiagramComplexity, validatePatentDiagram, validatePatentPlantUmlSource } from '@/lib/patent-diagrams/validation'
import { patentDiagramSchema, type PatentDiagramComponent } from '@/lib/patent-diagrams/types'
import { cleanPlantUmlForRendering, inspectRenderedSvg, validateRenderedPatentSvg } from '@/lib/plantuml-renderer'
import { extractRawPlantUmlFacts } from '@/lib/patent-diagrams/raw-source'
import { semanticChecksum } from '@/lib/patent-diagrams/pipeline'
import { buildFigureSetPlanningPrompt } from '@/lib/patent-diagrams/prompts'
import { validateDiagramExportReadiness } from '@/lib/patent-diagrams/export'

const components: PatentDiagramComponent[] = Array.from({ length: 24 }, (_, index) => ({
  id: `c${index + 1}`,
  name: `Technical Component ${index + 1}`,
  type: 'MODULE',
  description: `Performs disclosed technical function ${index + 1}`,
  referenceLabel: String((index + 1) * 100),
}))
const fixture = (name: string) => readFileSync(path.join(process.cwd(), 'src', 'lib', '__tests__', 'fixtures', 'patent-diagrams', name), 'utf8').trim()

describe('PatentDiagramStyle', () => {
  test('compiles the centralized monochrome filing tokens', () => {
    const source = compilePatentDiagramStyle()
    expect(PATENT_DIAGRAM_STYLE.maximumComponentsPerRow).toBe(4)
    expect(source).toContain('skinparam backgroundColor #FFFFFF')
    expect(source).toContain('skinparam monochrome true')
    expect(source).toContain('skinparam shadowing false')
    expect(source).toContain('skinparam roundcorner 0')
    expect(source).toContain('skinparam defaultFontName SansSerif')
    expect(source).toContain('skinparam defaultFontSize 13')
    expect(source).toContain('BorderThickness 1.8')
    expect(source).not.toContain('#F8F8F8')
    expect(source).not.toMatch(/gradient/i)
  })

  test('replaces user styling with the centralized filing style', () => {
    const cleaned = cleanPlantUmlForRendering('@startuml\nskinparam backgroundColor #FF0000\nrectangle "Controller\\n(100)" as C\n@enduml')
    expect(cleaned).toContain('skinparam backgroundColor #FFFFFF')
    expect(cleaned).not.toContain('#FF0000')
    expect(cleaned.match(/skinparam backgroundColor/g)).toHaveLength(1)
  })
})

describe('deterministic patent diagram builders', () => {
  test('matches the reviewed normalized component PlantUML golden', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'COMPONENT', key: 'golden', title: 'Golden System', purpose: 'Golden layout fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c1'], systemBoundaryLabel: 'Golden System',
      groups: [
        { id: 'input', label: 'Input Band', rows: [{ componentIds: ['c1', 'c2'] }] },
        { id: 'analysis', label: 'Analysis Band', rows: [{ componentIds: ['c3', 'c4'] }] },
      ],
      components: components.slice(0, 4).map(component => ({ componentId: component.id })),
      relationships: [
        { fromId: 'c1', toId: 'c3', label: 'technical flow', category: 'PRIMARY' },
        { fromId: 'c4', toId: 'c2', label: 'review feedback', category: 'REVIEW_FEEDBACK' },
      ],
    })
    const built = buildPatentDiagram(diagram, components)
    let normalized = built.plantumlCode.replace(/[\u2007\u200B]/g, '')
    components.slice(0, 4).forEach((component, index) => {
      const alias = Object.entries(built.labelMap).find(([, id]) => id === component.id)?.[0]
      if (alias) normalized = normalized.split(alias).join(`C${index + 1}`)
    })
    expect(normalized.trim()).toBe(fixture('component-layout.puml'))
  })

  test('builds ordered component bands, rows, anchors, references, and neutral secondary links', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1,
      kind: 'COMPONENT',
      key: 'system',
      title: 'Technical System',
      purpose: 'Show technical architecture',
      detailLevel: 'DETAIL',
      direction: 'TB',
      claimCriticalComponentIds: ['c1'],
      systemBoundaryLabel: 'Technical System',
      groups: [
        { id: 'input', label: 'Input Subsystem', rows: [{ componentIds: ['c1', 'c2', 'c3', 'c4'] }] },
        { id: 'analysis', label: 'Analysis Subsystem', rows: [{ componentIds: ['c5', 'c6'] }, { componentIds: ['c7', 'c8'] }] },
      ],
      components: Array.from({ length: 8 }, (_, index) => ({ componentId: `c${index + 1}` })),
      relationships: [
        { fromId: 'c1', toId: 'c5', label: 'technical features', category: 'PRIMARY' },
        { fromId: 'c8', toId: 'c2', label: 'review feedback', category: 'REVIEW_FEEDBACK' },
      ],
    })
    const built = buildPatentDiagram(diagram, components)
    const visiblePlantUml = built.plantumlCode.replace(/[\u2007\u200B]/g, '')
    const alias = (id: string) => Object.entries(built.labelMap).find(([, componentId]) => componentId === id)?.[0]
    expect(built.validation.filingReady).toBe(true)
    expect(built.plantumlCode).toContain('top to bottom direction')
    expect(built.plantumlCode).toContain('rectangle "Input Subsystem" as BAND1 <<SUBSYSTEM>>')
    expect(built.plantumlCode).toContain(`${alias('c1')} -right[hidden]-> ${alias('c2')}`)
    expect(built.plantumlCode).toContain(`${alias('c5')} -down[hidden]-> ${alias('c7')}`)
    expect(visiblePlantUml).toContain('Technical Component\\n1\\n(100)')
    // Block-diagram connectors render unlabelled: Graphviz drops edge labels at
    // edge midpoints with no collision avoidance, so they landed on top of the
    // component boxes.
    expect(built.plantumlCode).toMatch(new RegExp(`^${alias('c1')} -down-> ${alias('c5')}$`, 'm'))
    expect(built.plantumlCode).toMatch(new RegExp(`^${alias('c8')} -\\[norank,dashed\\]-> ${alias('c2')}$`, 'm'))
    expect(built.plantumlCode).not.toContain('technical features')
    expect(built.plantumlCode).not.toContain('review feedback')
    // Suppression is render-only — the written description still needs the text.
    expect(built.edges).toHaveLength(2)
    expect(built.edges.map((edge: any) => edge.label)).toEqual(['technical features', 'review feedback'])
  })

  test('builds sequence diagrams without actors or implementation decoration', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'SEQUENCE', key: 'sequence', title: 'Interaction Sequence', purpose: 'Show interaction',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      participants: [{ componentId: 'c1' }, { componentId: 'c2' }],
      interactions: [
        { order: 1, fromId: 'c1', toId: 'c2', label: 'structured request', category: 'PRIMARY' },
        { order: 2, fromId: 'c2', toId: 'c1', label: 'validated response', category: 'RESPONSE' },
      ],
    })
    const built = buildPatentDiagram(diagram, components)
    const alias = (id: string) => Object.entries(built.labelMap).find(([, componentId]) => componentId === id)?.[0]
    expect(built.plantumlCode).toContain(`participant "Technical Component\\n1\\n(100)" as ${alias('c1')}`)
    expect(built.plantumlCode).toContain(`${alias('c1')} -> ${alias('c2')} : structured request`)
    expect(built.plantumlCode).toContain(`${alias('c2')} --> ${alias('c1')} : validated response`)
    expect(built.plantumlCode).not.toMatch(/^\s*actor\b/m)
    // PlantUML rejects layout-direction directives inside sequence diagrams.
    expect(built.plantumlCode).not.toMatch(/^(top to bottom|left to right) direction$/m)
  })

  test('builds restrained process and constituent diagrams', () => {
    const process = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'PROCESS', key: 'process', title: 'Technical Method', purpose: 'Show method',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c1'],
      nodes: [
        { key: 'receive', kind: 'STEP', componentId: 'c1', label: 'Receive invention disclosure' },
        { key: 'complete', kind: 'DECISION', label: 'Disclosure complete' },
        { key: 'store', kind: 'STEP', label: 'Store disclosure record' },
      ],
      transitions: [
        { fromId: 'receive', toId: 'complete', label: 'disclosure data', category: 'PRIMARY' },
        { fromId: 'complete', toId: 'store', label: 'yes', category: 'PRIMARY' },
        { fromId: 'complete', toId: 'receive', label: 'no', category: 'OPTIONAL' },
      ],
    })
    const builtProcess = buildPatentDiagram(process, components)
    // The anchored step carries the performing component's numeral as its last
    // label line; no S-sign may be minted for plain numeric reference labels.
    expect(builtProcess.plantumlCode).toMatch(/rectangle "Receive invention\\ndisclosure\\n\(100\)" as M[A-Z0-9_]+/)
    // PlantUML rejects `diamond` in deployment syntax; decisions render as
    // stereotyped rectangles styled centrally by rectangle<<DECISION>>.
    expect(builtProcess.plantumlCode).toMatch(/rectangle "Disclosure complete" as M[A-Z0-9_]+ <<DECISION>>/)
    expect(builtProcess.plantumlCode).not.toMatch(/rectangle "[SD]\d+/)
    expect(builtProcess.plantumlCode).not.toMatch(/^\s*diamond\b/m)
    expect(builtProcess.plantumlCode).not.toMatch(/^\s*(start|stop)\s*$/m)
    // Flowchart edge conventions: step-to-step arrows carry no labels (they
    // collide under ortho routing), decision outcomes keep theirs, and every
    // transition stays ranked — `norank` is what sprawled flows horizontally.
    expect(builtProcess.plantumlCode).not.toContain('disclosure data')
    expect(builtProcess.plantumlCode).toMatch(/-down-> M[A-Z0-9_]+ : yes$/m)
    expect(builtProcess.plantumlCode).toMatch(/\.down\.> M[A-Z0-9_]+ : no$/m)
    expect(builtProcess.plantumlCode).not.toContain('norank')

    const constituent = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'CONSTITUENT', key: 'composition', title: 'Technical Composition', purpose: 'Show constituents',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], boundaryLabel: 'Technical Composition',
      constituents: [{ componentId: 'c1', technicalRole: 'active constituent' }, { componentId: 'c2', technicalRole: 'carrier constituent' }],
      relationships: [{ fromId: 'c1', toId: 'c2', label: 'combined with', category: 'ASSOCIATION' }],
    })
    const builtConstituent = buildPatentDiagram(constituent, components)
    expect(builtConstituent.plantumlCode).toContain('active constituent')
    const aliases = Object.entries(builtConstituent.labelMap)
    const c1Alias = aliases.find(([, id]) => id === 'c1')?.[0]
    const c2Alias = aliases.find(([, id]) => id === 'c2')?.[0]
    expect(builtConstituent.plantumlCode).toMatch(new RegExp(`^${c1Alias} -- ${c2Alias}$`, 'm'))
    expect(builtConstituent.plantumlCode).not.toContain('combined with')
    expect(builtConstituent.edges.map((edge: any) => edge.label)).toEqual(['combined with'])
  })
})

describe('repeated components across figure kinds', () => {
  // A live 4-figure run once failed outright on DUPLICATE_COMPONENT because the
  // check flattened every process step's component: one controller performing
  // three steps read as three duplicates, which is what a flowchart is.
  test('one component may perform several process steps', () => {
    const process = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'PROCESS', key: 'method', title: 'Control Method', purpose: 'Show the method',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'compare', kind: 'STEP', componentId: 'c1', label: 'Compare measured level' },
        { key: 'suppress', kind: 'STEP', componentId: 'c1', label: 'Suppress watering window' },
        { key: 'derive', kind: 'STEP', componentId: 'c1', relatedComponentIds: ['c2'], label: 'Derive watering window' },
      ],
      transitions: [
        { fromId: 'compare', toId: 'suppress', category: 'PRIMARY' },
        { fromId: 'suppress', toId: 'derive', category: 'PRIMARY' },
      ],
    })
    const built = buildPatentDiagram(process, components)
    if (built.diagram.kind !== 'PROCESS') throw new Error('expected process diagram')
    expect(built.diagram.nodes).toHaveLength(3)
    expect(built.validation.filingReady).toBe(true)
  })

  test('a component repeated in a component figure is deduped, not rejected', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'COMPONENT', key: 'arch', title: 'Architecture', purpose: 'Show the system',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], systemBoundaryLabel: 'System',
      groups: [{ id: 'g1', label: 'Subsystem', rows: [{ componentIds: ['c1', 'c2'] }] }],
      components: [{ componentId: 'c1' }, { componentId: 'c2' }, { componentId: 'c1' }],
      relationships: [],
    })
    const built = buildPatentDiagram(diagram, components)
    if (built.diagram.kind !== 'COMPONENT') throw new Error('expected component diagram')
    expect(built.diagram.components.map(node => node.componentId)).toEqual(['c1', 'c2'])
    expect(built.validation.filingReady).toBe(true)
    expect(built.validation.corrections.join(' ')).toMatch(/duplicate component/i)
  })

  test('a participant repeated in a sequence figure is deduped, not rejected', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'SEQUENCE', key: 'flow', title: 'Interactions', purpose: 'Show interactions',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      participants: [{ componentId: 'c1' }, { componentId: 'c1' }, { componentId: 'c2' }],
      interactions: [{ order: 1, fromId: 'c1', toId: 'c2', label: 'reports level', category: 'PRIMARY' }],
    })
    const built = buildPatentDiagram(diagram, components)
    if (built.diagram.kind !== 'SEQUENCE') throw new Error('expected sequence diagram')
    expect(built.diagram.participants.map(item => item.componentId)).toEqual(['c1', 'c2'])
    expect(built.validation.filingReady).toBe(true)
  })
})

describe('deterministic normalization before validation', () => {
  const componentDiagramWith = (overrides: Record<string, unknown>) => patentDiagramSchema.parse({
    schemaVersion: 1, kind: 'COMPONENT', key: 'norm', title: 'Normalized', purpose: 'Normalization fixture',
    detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], systemBoundaryLabel: 'System',
    groups: [{ id: 'g1', label: 'Band', rows: [{ componentIds: ['c1', 'c2'] }] }],
    components: [{ componentId: 'c1' }, { componentId: 'c2' }], relationships: [],
    ...overrides,
  })

  test('repairs over-long labels instead of failing the figure', () => {
    const diagram = componentDiagramWith({
      components: [
        { componentId: 'c1', displayLabel: 'One Two Three Four Five Six Seven Eight Nine' },
        { componentId: 'c2' },
      ],
      relationships: [{ fromId: 'c1', toId: 'c2', label: 'one two three four five six', category: 'PRIMARY' }],
    })
    // The builder truncates these at render time regardless, so rejecting the
    // figure would fail a diagram that draws correctly.
    expect(validatePatentDiagram(diagram, components).issues.map(i => i.code))
      .toEqual(expect.arrayContaining(['LONG_NODE_LABEL', 'LONG_CONNECTOR_LABEL']))

    const built = buildPatentDiagram(diagram, components)
    expect(built.validation.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(built.validation.filingReady).toBe(true)
    expect(built.validation.corrections.join(' ')).toMatch(/Shortened/)
  })

  test('re-flows over-wide rows and places ungrouped components', () => {
    const diagram = componentDiagramWith({
      groups: [{ id: 'g1', label: 'Band', rows: [{ componentIds: ['c1', 'c2', 'c3', 'c4'] }] }],
      components: Array.from({ length: 7 }, (_, index) => ({ componentId: `c${index + 1}` })),
    })
    const built = buildPatentDiagram(diagram, components)
    expect(built.validation.issues.filter(i => i.severity === 'error')).toEqual([])
    if (built.diagram.kind !== 'COMPONENT') throw new Error('expected component diagram')
    expect(built.diagram.groups.flatMap(g => g.rows).every(row => row.componentIds.length <= 4)).toBe(true)
    const placed = built.diagram.groups.flatMap(g => g.rows.flatMap(r => r.componentIds))
    expect(new Set(placed).size).toBe(7)
    expect(built.validation.corrections.join(' ')).toMatch(/ungrouped/i)
  })

  test('drops hallucinated components and their connectors rather than erroring', () => {
    const diagram = componentDiagramWith({
      groups: [{ id: 'g1', label: 'Band', rows: [{ componentIds: ['c1', 'c2', 'invented'] }] }],
      components: [{ componentId: 'c1' }, { componentId: 'c2' }, { componentId: 'invented' }],
      relationships: [
        { fromId: 'c1', toId: 'c2', label: 'flow', category: 'PRIMARY' },
        { fromId: 'c1', toId: 'invented', label: 'flow', category: 'PRIMARY' },
      ],
    })
    const built = buildPatentDiagram(diagram, components)
    expect(built.validation.issues.filter(i => i.severity === 'error')).toEqual([])
    if (built.diagram.kind !== 'COMPONENT') throw new Error('expected component diagram')
    expect(built.diagram.components.map(n => n.componentId)).not.toContain('invented')
    expect(built.diagram.relationships).toHaveLength(1)
    expect(built.plantumlCode).not.toContain('invented')
  })

  test('inserts a missing claim-critical component instead of blocking', () => {
    const diagram = componentDiagramWith({ claimCriticalComponentIds: ['c3'] })
    expect(validatePatentDiagram(diagram, components).issues.map(i => i.code))
      .toContain('MISSING_CLAIM_CRITICAL_COMPONENT')

    const built = buildPatentDiagram(diagram, components)
    expect(built.validation.issues.filter(i => i.severity === 'error')).toEqual([])
    if (built.diagram.kind !== 'COMPONENT') throw new Error('expected component diagram')
    expect(built.diagram.components.map(n => n.componentId)).toContain('c3')
    expect(built.validation.claimCriticalCoverage.missing).toEqual([])
  })

  test('discards model-supplied step identifiers instead of inventing numerals', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'PROCESS', key: 'proc', title: 'Process', purpose: 'Identifier fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'n1', kind: 'STEP', label: 'First step', identifier: 'S100' },
        { key: 'n2', kind: 'STEP', label: 'Second step', identifier: 'S140' },
        { key: 'n3', kind: 'DECISION', label: 'Check state', identifier: 'STEP-3' },
      ],
      transitions: [
        { fromId: 'n1', toId: 'n2', label: '', category: 'PRIMARY' },
        { fromId: 'n2', toId: 'ghost', label: '', category: 'PRIMARY' },
      ],
    })
    const built = buildPatentDiagram(diagram, components)
    expect(built.validation.issues.filter(i => i.severity === 'error')).toEqual([])
    if (built.diagram.kind !== 'PROCESS') throw new Error('expected process diagram')
    // None of these steps names a component, so no reference sign is derivable
    // and no numeral may be minted — S100/S140 were never disclosed anywhere.
    expect(built.diagram.nodes.map(n => n.identifier)).toEqual([undefined, undefined, undefined])
    // Anchored to the label so the hex node aliases (M0480A93D2E9B) can't match.
    expect(built.plantumlCode).not.toMatch(/rectangle "[SD]\d+/)
    expect(built.plantumlCode).not.toContain('STEP-3')
    expect(built.diagram.transitions).toHaveLength(1)
  })

  test('keeps a step identifier that is a real Component Planner reference sign', () => {
    const stepComponents = [
      ...components,
      { id: 'cs1', name: 'Sampling routine', type: 'PROCESS', referenceLabel: 'S210', description: 'Disclosed step' },
    ] as typeof components
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'PROCESS', key: 'proc2', title: 'Process', purpose: 'Derived identifier fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'n1', kind: 'STEP', label: 'Sample the fluid', componentId: 'cs1' },
        { key: 'n2', kind: 'STEP', label: 'Second step', componentId: 'cs1' },
      ],
      transitions: [{ fromId: 'n1', toId: 'n2', label: '', category: 'PRIMARY' }],
    })
    const built = buildPatentDiagram(diagram, stepComponents)
    if (built.diagram.kind !== 'PROCESS') throw new Error('expected process diagram')
    // The sign is taken from the registry, and never repeated across two steps.
    expect(built.diagram.nodes[0].identifier).toBe('S210')
    expect(built.diagram.nodes[1].identifier).toBeUndefined()
  })

  test('records stripped invented component references and flags the step as ungrounded', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'PROCESS', key: 'ghost-proc', title: 'Process', purpose: 'Hallucinated step fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'real', kind: 'STEP', componentId: 'c1', label: 'Perform disclosed operation' },
        { key: 'ghost', kind: 'STEP', componentId: 'invented-component', label: 'Deploy to cloud' },
      ],
      transitions: [{ fromId: 'real', toId: 'ghost', label: '', category: 'PRIMARY' }],
    })
    const built = buildPatentDiagram(diagram, components)
    // The invented reference must not vanish silently: normalization records the
    // removal and validation flags the now-unanchored step for the generation
    // path to block.
    expect(built.validation.corrections).toContain('Removed unknown component reference invented-component from step ghost')
    // Backward compatibility: a figure persisted before per-step citation
    // existed has no evidenceIds and must still build and render.
    expect(built.validation.issues.some(issue => issue.code === 'UNCITED_STEP')).toBe(false)
    const ungrounded = built.validation.issues.filter(issue => issue.code === 'UNGROUNDED_STEP')
    expect(ungrounded).toHaveLength(1)
    expect(ungrounded[0].severity).toBe('warning')
    expect(built.validation.issues.some(issue => issue.code === 'UNKNOWN_COMPONENT')).toBe(false)
  })

  test('an unanchored step is a review note, never a blocker', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'PROCESS', key: 'cite', title: 'Process', purpose: 'Grounding fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'anchored', kind: 'STEP', componentId: 'c1', label: 'Perform disclosed operation' },
        { key: 'loose', kind: 'STEP', label: 'Perform second operation' },
      ],
      transitions: [{ fromId: 'anchored', toId: 'loose', label: '', category: 'PRIMARY' }],
    })
    const built = buildPatentDiagram(diagram, components)
    const ungrounded = built.validation.issues.filter(issue => issue.code === 'UNGROUNDED_STEP')
    expect(ungrounded).toHaveLength(1)
    expect(ungrounded[0].severity).toBe('warning')
    expect(built.validation.filingReady).toBe(true)
  })

  test('anchored process boxes carry their component numerals', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'PROCESS', key: 'numbered', title: 'Method', purpose: 'Numbering fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'n1', kind: 'STEP', componentId: 'c1', label: 'Measure signal' },
        { key: 'n2', kind: 'DECISION', componentId: 'c3', label: 'Above threshold' },
      ],
      transitions: [{ fromId: 'n1', toId: 'n2', label: '', category: 'PRIMARY' }],
    })
    const built = buildPatentDiagram(diagram, components)
    // Same numbering convention as every other kind: the performing component's
    // reference numeral is the last label line — decisions included.
    expect(built.plantumlCode).toContain('Measure signal\\n(100)')
    expect(built.plantumlCode).toContain('Above threshold\\n(300)')
  })

  test('a step whose only linkage is one related component inherits its anchor and numeral', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'PROCESS', key: 'promoted', title: 'Method', purpose: 'Anchor promotion fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      nodes: [
        { key: 'n1', kind: 'STEP', relatedComponentIds: ['c2'], label: 'Filter samples' },
        { key: 'n2', kind: 'STEP', componentId: 'c1', label: 'Store result' },
      ],
      transitions: [{ fromId: 'n1', toId: 'n2', label: '', category: 'PRIMARY' }],
    })
    const built = buildPatentDiagram(diagram, components)
    if (built.diagram.kind !== 'PROCESS') throw new Error('expected process diagram')
    expect(built.diagram.nodes[0].componentId).toBe('c2')
    expect(built.plantumlCode).toContain('Filter samples\\n(200)')
    expect(built.validation.corrections).toContain('Anchored step n1 to its only related component c2')
    expect(built.validation.issues.some(issue => issue.code === 'UNGROUNDED_STEP')).toBe(false)
  })

  test('normalization is idempotent', () => {
    const diagram = componentDiagramWith({
      components: [{ componentId: 'c1', displayLabel: 'One Two Three Four Five Six Seven Eight' }, { componentId: 'c2' }],
    })
    const once = buildPatentDiagram(diagram, components)
    const twice = buildPatentDiagram(once.diagram, components)
    expect(twice.plantumlCode).toBe(once.plantumlCode)
    expect(twice.validation.corrections).toEqual([])
  })
})

describe('complexity and filing validation', () => {
  test('reports a dense figure as a review note and still draws it', () => {
    const groups = Array.from({ length: 6 }, (_, groupIndex) => ({
      id: `g${groupIndex + 1}`,
      label: `Subsystem ${groupIndex + 1}`,
      rows: [{ componentIds: Array.from({ length: 4 }, (_, itemIndex) => `c${groupIndex * 4 + itemIndex + 1}`) }],
    }))
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 3, kind: 'COMPONENT', key: 'complex', title: 'Complex System', purpose: 'Show system',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c1', 'c24'], systemBoundaryLabel: 'Complex System',
      groups,
      components: components.map(component => ({ componentId: component.id })),
      relationships: Array.from({ length: 23 }, (_, index) => ({
        fromId: `c${index + 1}`, toId: `c${index + 2}`, label: 'technical flow', category: 'PRIMARY',
      })),
    })
    const metrics = analyzeDiagramComplexity(diagram)
    expect(metrics.dense).toBe(true)
    expect(metrics.densityNotes.length).toBeGreaterThan(0)

    // Density never fails a figure: the attorney gets the drawing plus a note.
    const built = buildPatentDiagram(diagram, components)
    expect(built.validation.filingReady).toBe(true)
    expect(built.validation.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(built.validation.issues.map(issue => issue.code)).toContain('DENSE_FIGURE')
    if (built.diagram.kind !== 'COMPONENT') throw new Error('expected component diagram')
    expect(built.diagram.components).toHaveLength(24)
    expect(built.diagram.relationships).toHaveLength(23)
  })

  test('excludes stale translations and stale component-plan diagrams from export', () => {
    const semantic = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'COMPONENT', key: 'export', title: 'Export Figure', purpose: 'Show export structure',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], systemBoundaryLabel: 'System',
      groups: [{ id: 'g1', label: 'Subsystem', rows: [{ componentIds: ['c1', 'c2'] }] }],
      components: [{ componentId: 'c1' }, { componentId: 'c2' }], relationships: [],
    })
    const referenceComponents = components.slice(0, 2)
    const referenceMapChecksum = semanticChecksum(referenceComponents)
    const managedChecksum = semanticChecksum({ referenceMapChecksum, semantic })
    const session = {
      referenceMap: { components: referenceComponents },
      figurePlans: [{ figureNo: 1, semanticModel: semantic, semanticChecksum: managedChecksum, validationReport: { filingReady: true } }],
      diagramSources: [
        { figureNo: 1, language: 'en', checksum: 'english', sourceMode: 'MANAGED', renderStatus: 'SUCCESS', imagePath: 'figure.png', renderArtifacts: { svg: { path: 'figure.svg' }, png: { path: 'figure.png' } } },
        { figureNo: 1, language: 'fr', checksum: 'french', translatedFromChecksum: 'old', sourceMode: 'MANAGED', renderStatus: 'SUCCESS', imagePath: 'figure_fr.png', renderArtifacts: { svg: { path: 'figure_fr.svg' }, png: { path: 'figure_fr.png' } } },
      ],
    }
    const readiness = validateDiagramExportReadiness(session, 'fr')
    expect(readiness.ready).toBe(true)
    expect(readiness.selectedSources.get(1)?.language).toBe('en')
    session.figurePlans[0].semanticChecksum = 'stale'
    expect(validateDiagramExportReadiness(session, 'en').errors.map(error => error.code)).toContain('STALE_REFERENCE_MAP')
  })

  test('semantic checksums are stable across JSON key order (JSONB round-trips)', () => {
    const inMemoryOrder = { schemaVersion: 1, key: 'figure', title: 'Figure', groups: [{ id: 'g1', label: 'Band', rows: [{ componentIds: ['c1'] }] }] }
    const jsonbOrder = { key: 'figure', title: 'Figure', groups: [{ rows: [{ componentIds: ['c1'] }], label: 'Band', id: 'g1' }], schemaVersion: 1 }
    expect(semanticChecksum(inMemoryOrder)).toBe(semanticChecksum(jsonbOrder))
    expect(semanticChecksum(inMemoryOrder)).not.toBe(semanticChecksum({ ...inMemoryOrder, title: 'Changed' }))
  })

  test('legacy imported diagrams without SVG masters remain exportable', () => {
    const session = {
      referenceMap: { components: components.slice(0, 2) },
      figurePlans: [
        { figureNo: 1, semanticModel: null, semanticChecksum: null, referenceMapChecksum: null, validationReport: null },
      ],
      diagramSources: [
        // Migrated legacy row: PlantUML present, artifacts never rendered by the new pipeline.
        { figureNo: 1, language: 'en', checksum: 'legacy', sourceMode: 'IMPORTED_RAW', renderStatus: null, renderArtifacts: null, imagePath: '/uploads/patents/p1/figures/figure_1.png', imageFilename: 'figure_1.png' },
      ],
    }
    const readiness = validateDiagramExportReadiness(session, 'en')
    expect(readiness.errors).toEqual([])
    expect(readiness.ready).toBe(true)
  })

  test('does not flag # inside quoted labels as a colour directive', () => {
    const issues = validatePatentPlantUmlSource('@startuml\nrectangle "Model #A12\\n(100)" as C1\nrectangle "Series #Type-B\\n(200)" as C2\nC1 -down-> C2\n@enduml')
    expect(issues.map(issue => issue.code)).not.toContain('COLOR_DIRECTIVE')
    const colored = validatePatentPlantUmlSource('@startuml\nrectangle "Unit\\n(100)" as C1 #FF0000\n@enduml')
    expect(colored.map(issue => issue.code)).toContain('COLOR_DIRECTIVE')
  })

  test('extracts rendered bounds and rejects colour leakage', () => {
    const svg = fixture('component-layout.svg')
    const inspection = inspectRenderedSvg(svg)
    expect(inspection.colors).toEqual(['#FFFFFF', '#000000'])
    expect(inspection.elementBounds.SYSTEM?.strokeWidth).toBe(1.8)
    expect(inspection.elementBounds.BAND1?.strokeWidth).toBe(1.3)
    expect(inspection.elementBounds.C1?.strokeWidth).toBe(1)
    expect(validateRenderedPatentSvg(svg).valid).toBe(true)
    expect(validateRenderedPatentSvg(svg.replace('#FFF', '#FF0000')).errors.join(' ')).toMatch(/non-filing colors/i)
  })

  test('extracts raw facts while excluding hidden layout links', () => {
    const source = '@startuml\nrectangle "Sensor\\n(100)" as SENSOR\nrectangle "Controller\\n(200)" as CTRL\nSENSOR -right[hidden]-> CTRL\nSENSOR --> CTRL : sensed data\n@enduml'
    const extracted = extractRawPlantUmlFacts(source, components)
    expect(extracted.issues).toEqual([])
    expect(extracted.facts.nodes).toHaveLength(2)
    expect(extracted.facts.edges).toEqual([{ from: 'SENSOR', to: 'CTRL', label: 'sensed data', layoutOnly: false }])
    expect(extracted.facts.labelMap).toEqual({ SENSOR: 'c1', CTRL: 'c2' })
  })

  test('rejects non-filing source directives', () => {
    const issues = validatePatentPlantUmlSource('@startuml\nskinparam shadowing true\nrectangle A #FF0000\n@enduml')
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['COLOR_DIRECTIVE', 'SHADOW_DIRECTIVE']))
  })
})

describe('figure-set planning', () => {
  const planningInput = {
    inventionTitle: 'Irrigation controller',
    patentType: 'SYSTEM',
    inventionContext: {},
    claimsContext: {},
    components,
    figureCount: 4,
    exactFigureCount: true,
  }

  test('lets the planner size the set in auto mode instead of pinning four', () => {
    const prompt = buildFigureSetPlanningPrompt({ ...planningInput, exactFigureCount: false, figureCount: 7 })
    expect(prompt).toContain('at least 4 and at most 20 figures')
    expect(prompt).toContain('about 7 figure(s)')
    expect(prompt).toContain('one COMPONENT overview')
    expect(prompt).toContain('MORE, SMALLER figures')
  })

  test('states per-figure readability targets below the warning thresholds', () => {
    const prompt = buildFigureSetPlanningPrompt(planningInput)
    expect(prompt).toContain('target at most 10 components, 8 steps, 10 interactions, or 8 constituents')
  })

  test('asks for one figure of each of the four kinds in exact mode', () => {
    const prompt = buildFigureSetPlanningPrompt(planningInput)
    expect(prompt).toContain('plan exactly 4 figure(s)')
    expect(prompt).toContain('1. COMPONENT')
    expect(prompt).toContain('2. PROCESS')
    expect(prompt).toContain('3. SEQUENCE')
    expect(prompt).toContain('4. CONSTITUENT')
  })

  test('cycles the four kinds when more figures are requested', () => {
    const prompt = buildFigureSetPlanningPrompt({ ...planningInput, figureCount: 6 })
    expect(prompt).toContain('plan exactly 6 figure(s)')
    expect(prompt).toContain('5. COMPONENT')
    expect(prompt).toContain('6. PROCESS')
  })

  test('lists the claim-recited components the plan must cover', () => {
    const claimed: PatentDiagramComponent[] = [
      { ...components[0], claimSupport: { matchedClaims: [1, 4], claimRole: 'claim_1' } },
      components[1],
    ]
    const prompt = buildFigureSetPlanningPrompt({ ...planningInput, components: claimed })
    expect(prompt).toContain('must appear in the componentIds of at least one figure')
    expect(prompt).toContain('c1 (claims 1,4)')
  })

  test('says so when claim matching has not run instead of implying coverage', () => {
    const prompt = buildFigureSetPlanningPrompt(planningInput)
    expect(prompt).toContain('claim-to-component matching has not run')
  })

  test('shows the planner the disclosed method steps and the claim-matched components', () => {
    const claimed: PatentDiagramComponent[] = [
      { ...components[0], claimSupport: { matchedClaims: [1, 4], claimRole: 'claim_1' } },
      components[1],
    ]
    const prompt = buildFigureSetPlanningPrompt({
      ...planningInput,
      components: claimed,
      evidenceCatalog: [
        { id: 'SF-processSteps-1', value: 'Reading a moisture value from the probe' },
        { id: 'SF-other-1', value: 'Housing is weatherproof' },
      ],
    })
    expect(prompt).toContain('DISCLOSED METHOD STEPS')
    expect(prompt).toContain('SF-processSteps-1')
    expect(prompt).toContain('claims=1,4')
  })
})
