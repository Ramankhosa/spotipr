export const PATENT_DIAGRAM_COMPLEXITY = Object.freeze({
  connectorLabelWords: 4,
  // Planning targets are what the planner is asked to aim for so a figure stays
  // readable on A4 WITHOUT zooming. Deliberately below the warning thresholds:
  // targets shape the plan, thresholds flag what still came out dense.
  planningTargets: Object.freeze({
    components: 10,
    steps: 8,
    interactions: 10,
    constituents: 8,
  }),
  siblingDimensionVariance: 0.2,
  absoluteMinimumTextSizePt: 8,
  component: Object.freeze({
    warningComponents: 16,
    warningConnectors: 25,
    warningCrossLayerLinks: 4,
    splitComponents: 20,
    splitConnectors: 30,
    maximumDetailedBands: 4,
  }),
  sequence: Object.freeze({
    warningParticipants: 6,
    warningInteractions: 12,
    splitParticipants: 7,
    splitInteractions: 15,
    maximumAlternatives: 1,
  }),
  process: Object.freeze({
    warningNodes: 10,
    splitNodes: 14,
    maximumBranchDepth: 2,
  }),
  constituent: Object.freeze({
    warningConstituents: 12,
    splitConstituents: 16,
  }),
})
