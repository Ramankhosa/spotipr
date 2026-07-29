import { describe, expect, test } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { PATENT_DIAGRAM_STYLE, compilePatentDiagramStyle } from '@/lib/patent-diagrams/style'
import { buildPatentDiagram } from '@/lib/patent-diagrams/builders'
import { analyzeDiagramComplexity, validatePatentDiagram, validatePatentPlantUmlSource } from '@/lib/patent-diagrams/validation'
import { decomposePatentDiagram } from '@/lib/patent-diagrams/complexity'
import { patentDiagramSchema, type PatentDiagramComponent } from '@/lib/patent-diagrams/types'
import { cleanPlantUmlForRendering, inspectRenderedSvg, validateRenderedPatentSvg } from '@/lib/plantuml-renderer'
import { extractRawPlantUmlFacts } from '@/lib/patent-diagrams/raw-source'
import { evaluateFigureSetClaimCoverage, semanticChecksum } from '@/lib/patent-diagrams/pipeline'
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
    // These fixture components carry plain component reference signs (100, 200),
    // not step signs, so no step numeral is derivable — and none may be minted.
    expect(builtProcess.plantumlCode).toMatch(/rectangle "Receive invention\\ndisclosure" as M[A-Z0-9_]+/)
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

  test('citation checks stay warnings and only run when a catalog exists', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'PROCESS', key: 'cite', title: 'Process', purpose: 'Citation fixture',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], evidenceIds: ['SF-processSteps-1'],
      nodes: [
        { key: 'cited', kind: 'STEP', componentId: 'c1', label: 'Perform disclosed operation', evidenceIds: ['SF-processSteps-1'] },
        { key: 'uncited', kind: 'STEP', componentId: 'c2', label: 'Perform undisclosed operation' },
        { key: 'bogus', kind: 'STEP', componentId: 'c3', label: 'Perform third operation', evidenceIds: ['SF-made-up-7'] },
      ],
      transitions: [
        { fromId: 'cited', toId: 'uncited', label: '', category: 'PRIMARY' },
        { fromId: 'uncited', toId: 'bogus', label: '', category: 'PRIMARY' },
      ],
    })
    const catalog = new Set(['SF-processSteps-1'])
    const built = buildPatentDiagram(diagram, components, catalog)

    const codes = built.validation.issues.map(issue => `${issue.severity}:${issue.code}`)
    expect(codes).toContain('warning:UNCITED_STEP')
    // The invented ID is stripped by normalization, which leaves that step
    // uncited rather than silently accepted.
    expect(built.validation.corrections).toContain('Removed unrecognized disclosure evidence SF-made-up-7 from step bogus')
    expect(built.validation.issues.filter(issue => issue.code === 'UNCITED_STEP')).toHaveLength(2)
    // Warnings only: persisted figures must keep rendering, translating and exporting.
    expect(built.validation.filingReady).toBe(true)

    // With no catalog the gate is inert.
    const withoutCatalog = buildPatentDiagram(diagram, components)
    expect(withoutCatalog.validation.issues.some(issue => issue.code === 'UNCITED_STEP')).toBe(false)
  })

  test('treats disclosure evidence gaps as review notes, not blockers', () => {
    const diagram = componentDiagramWith({ evidenceIds: [] })
    const report = validatePatentDiagram(diagram, components, new Set(['SF-1']))
    expect(report.issues.find(i => i.code === 'MISSING_DISCLOSURE_EVIDENCE')?.severity).toBe('warning')
    expect(report.filingReady).toBe(true)
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
  test('decomposes the 24-component, six-band representative case', () => {
    const groups = Array.from({ length: 6 }, (_, groupIndex) => ({
      id: `g${groupIndex + 1}`,
      label: `Subsystem ${groupIndex + 1}`,
      rows: [{ componentIds: Array.from({ length: 4 }, (_, itemIndex) => `c${groupIndex * 4 + itemIndex + 1}`) }],
    }))
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'COMPONENT', key: 'complex', title: 'Complex System', purpose: 'Show system',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c1', 'c24'], systemBoundaryLabel: 'Complex System',
      groups,
      components: components.map(component => ({ componentId: component.id })),
      relationships: Array.from({ length: 23 }, (_, index) => ({ fromId: `c${index + 1}`, toId: `c${index + 2}`, label: 'technical flow', category: 'PRIMARY' })),
    })
    expect(analyzeDiagramComplexity(diagram).requiresSplit).toBe(true)
    const split = decomposePatentDiagram(diagram)
    expect(split.length).toBeGreaterThan(1)
    expect(split[0].detailLevel).toBe('OVERVIEW')
    expect(split.slice(1).every(item => item.kind === 'COMPONENT' && item.groups.length <= 4)).toBe(true)
    const covered = new Set(split.slice(1).flatMap(item => item.kind === 'COMPONENT' ? item.components.map(node => node.componentId) : []))
    expect(covered.size).toBe(24)
    const preservedRelationships = split.slice(1).flatMap(item => item.kind === 'COMPONENT' ? item.relationships : [])
    expect(preservedRelationships).toHaveLength(23)
    expect(new Set(preservedRelationships.map(link => `${link.fromId}:${link.toId}`)).size).toBe(23)
  })

  test('preserves sequence interactions, process transitions, and constituent relationships across splits', () => {
    const sequence = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'SEQUENCE', key: 'dense-sequence', title: 'Dense Sequence', purpose: 'Show transmissions',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [],
      participants: components.slice(0, 8).map(component => ({ componentId: component.id })),
      interactions: Array.from({ length: 16 }, (_, index) => ({
        order: index + 1, fromId: `c${index % 8 + 1}`, toId: `c${(index + 1) % 8 + 1}`,
        label: 'technical transmission', category: 'PRIMARY',
      })),
    })
    const sequenceSplit = decomposePatentDiagram(sequence)
    expect(sequenceSplit.flatMap(item => item.kind === 'SEQUENCE' ? item.interactions : [])).toHaveLength(16)
    expect(sequenceSplit.every(item => item.kind === 'SEQUENCE' && item.participants.length <= 7)).toBe(true)

    const process = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'PROCESS', key: 'dense-process', title: 'Dense Process', purpose: 'Show technical method',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c1', 'c15'],
      nodes: Array.from({ length: 15 }, (_, index) => ({ key: `step-${index + 1}`, kind: 'STEP', componentId: `c${index + 1}`, label: `Perform technical step ${index + 1}` })),
      transitions: Array.from({ length: 14 }, (_, index) => ({ fromId: `step-${index + 1}`, toId: `step-${index + 2}`, label: 'next technical step', category: 'PRIMARY' })),
    })
    const processSplit = decomposePatentDiagram(process)
    expect(processSplit.flatMap(item => item.kind === 'PROCESS' ? item.transitions : [])).toHaveLength(14)

    const constituent = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'CONSTITUENT', key: 'dense-constituent', title: 'Dense Composition', purpose: 'Show supported composition',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: [], boundaryLabel: 'Technical Composition',
      constituents: components.slice(0, 17).map(component => ({ componentId: component.id, technicalRole: 'supported role' })),
      relationships: Array.from({ length: 16 }, (_, index) => ({ fromId: `c${index + 1}`, toId: `c${index + 2}`, label: 'combined with', category: 'ASSOCIATION' })),
    })
    const constituentSplit = decomposePatentDiagram(constituent)
    expect(constituentSplit.flatMap(item => item.kind === 'CONSTITUENT' ? item.relationships : [])).toHaveLength(16)
  })

  test('requires structured disclosure evidence when an evidence catalog exists', () => {
    const diagram = patentDiagramSchema.parse({
      schemaVersion: 1, kind: 'COMPONENT', key: 'evidence', title: 'Evidence Figure', purpose: 'Show disclosed structure',
      detailLevel: 'DETAIL', direction: 'TB', claimCriticalComponentIds: ['c1'], evidenceIds: [], systemBoundaryLabel: 'System',
      groups: [{ id: 'g1', label: 'Subsystem', rows: [{ componentIds: ['c1', 'c2'] }] }],
      components: [{ componentId: 'c1' }, { componentId: 'c2' }], relationships: [],
    })
    expect(validatePatentDiagram(diagram, components, new Set(['SF-componentsAndSubcomponents-1'])).issues.map(issue => issue.code)).toContain('MISSING_DISCLOSURE_EVIDENCE')
    const unknown = validatePatentDiagram({ ...diagram, evidenceIds: ['invented-evidence'] }, components, new Set(['SF-componentsAndSubcomponents-1']))
    expect(unknown.issues.map(issue => issue.code)).toContain('UNKNOWN_DISCLOSURE_EVIDENCE')
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

describe('figure-set planning grounding', () => {
  const planningInput = {
    inventionTitle: 'Irrigation controller',
    patentType: 'SYSTEM',
    inventionContext: {},
    claimsContext: {},
    components,
  }

  test('shows the planner the disclosed method steps it must plan against', () => {
    const prompt = buildFigureSetPlanningPrompt({
      ...planningInput,
      evidenceCatalog: [
        { id: 'SF-processSteps-1', value: 'Reading a moisture value from the probe' },
        { id: 'SF-other-1', value: 'Housing is weatherproof' },
      ],
    })
    expect(prompt).toContain('DISCLOSED METHOD STEPS')
    expect(prompt).toContain('SF-processSteps-1')
    expect(prompt).toContain('evidenceIds')
  })

  test('forbids planning a PROCESS figure when no operation is disclosed', () => {
    const prompt = buildFigureSetPlanningPrompt({ ...planningInput, evidenceCatalog: [] })
    // Without disclosed steps a flowchart could only be invented downstream.
    expect(prompt).toContain('Do NOT plan a PROCESS figure')
    expect(prompt).toContain('DISCLOSED METHOD STEPS: none recorded')
  })

  test('tells the planner which components the claims name', () => {
    const claimed: PatentDiagramComponent[] = [
      { ...components[0], claimSupport: { matchedClaims: [1, 4], claimRole: 'claim_1' } },
      components[1],
    ]
    const prompt = buildFigureSetPlanningPrompt({ ...planningInput, components: claimed })
    expect(prompt).toContain('must appear in the componentIds of at least one figure: c1')
    expect(prompt).toContain('claims=1,4')
  })

  test('reports claim-named components that no planned figure depicts', () => {
    const claimed: PatentDiagramComponent[] = [
      { ...components[0], claimSupport: { matchedClaims: [1], claimRole: 'claim_1' } },
      { ...components[1], claimSupport: { matchedClaims: [2], claimRole: 'dependent_claim' } },
    ]
    const plan = {
      schemaVersion: 1 as const,
      figures: [{
        key: 'f1', kind: 'COMPONENT' as const, title: 'Overview', purpose: 'Overview',
        detailLevel: 'OVERVIEW' as const, direction: 'TB' as const,
        componentIds: ['c1'], claimCriticalComponentIds: ['c1'],
        orderedGroups: [], phaseHints: [], evidenceIds: [],
      }],
    }
    const coverage = evaluateFigureSetClaimCoverage(plan, claimed)
    expect(coverage.evaluated).toBe(true)
    expect(coverage.missing.map(item => item.id)).toEqual(['c2'])
    expect(coverage.missing[0].matchedClaims).toEqual([2])
  })

  test('reports coverage as unknown when claim matching has not run', () => {
    const plan = {
      schemaVersion: 1 as const,
      figures: [{
        key: 'f1', kind: 'COMPONENT' as const, title: 'Overview', purpose: 'Overview',
        detailLevel: 'OVERVIEW' as const, direction: 'TB' as const,
        componentIds: ['c1'], claimCriticalComponentIds: [],
        orderedGroups: [], phaseHints: [], evidenceIds: [],
      }],
    }
    // Claim matching is optional upstream, so absence must never look like a gap.
    const coverage = evaluateFigureSetClaimCoverage(plan, components)
    expect(coverage.evaluated).toBe(false)
    expect(coverage.missing).toEqual([])
  })
})
