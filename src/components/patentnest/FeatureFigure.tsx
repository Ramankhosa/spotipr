'use client'

// Renders a feature's animated patent figure from its declarative spec in
// features.ts. Used twice per feature: compact on the homepage embodiment card,
// full-size on the feature detail page — same drawing, one source of truth.

import type { FigSpec } from '@/lib/patentnest/features'
import {
  SparkStructureFig,
  PipelineFig,
  MatrixFig,
  FanOutFig,
  ScanReadFig,
  StyleSwitchFig,
  RefineLoopFig,
  ExportFig,
} from './figures'

export default function FeatureFigure({ spec, compact = false }: { spec: FigSpec; compact?: boolean }) {
  switch (spec.kind) {
    case 'spark':
      return <SparkStructureFig compact={compact} />
    case 'pipeline':
      return <PipelineFig stages={spec.stages} loopback={spec.loopback} compact={compact} />
    case 'matrix':
      return <MatrixFig compact={compact} />
    case 'fanout':
      return (
        <FanOutFig
          branches={spec.branches}
          sourceLabel={spec.sourceLabel}
          stacked={spec.stacked}
          compact={compact}
        />
      )
    case 'scan':
      return <ScanReadFig compact={compact} />
    case 'style':
      return <StyleSwitchFig compact={compact} />
    case 'refine':
      return <RefineLoopFig checks={spec.checks} compact={compact} />
    case 'export':
      return <ExportFig formats={spec.formats} compact={compact} />
  }
}
