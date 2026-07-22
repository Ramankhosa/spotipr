export type Tool =
  | 'select'
  | 'pen'
  | 'eraser'
  | 'eraseRect'
  | 'line'
  | 'arrow'
  | 'elbowArrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'callout'
  | 'pan'

export interface StrokeShape {
  id: string
  tool: 'pen' | 'eraser'
  points: number[]
  stroke: string
  strokeWidth: number
  x?: number
  y?: number
}

export interface SegmentShape {
  id: string
  tool: 'line' | 'arrow' | 'elbowArrow'
  // Straight segments hold 4 values; elbow arrows hold 6 (start, corner, end).
  points: number[]
  stroke: string
  strokeWidth: number
  x?: number
  y?: number
}

// Builds the right-angled path for a bent arrow. The longer drag axis is
// travelled first, which matches how connectors are drawn on block diagrams.
export function elbowPoints(x1: number, y1: number, x2: number, y2: number): number[] {
  return Math.abs(x2 - x1) >= Math.abs(y2 - y1)
    ? [x1, y1, x2, y1, x2, y2]
    : [x1, y1, x1, y2, x2, y2]
}

export interface BoxShape {
  id: string
  tool: 'rect' | 'ellipse' | 'eraseRect'
  x: number
  y: number
  width: number
  height: number
  stroke: string
  strokeWidth: number
}

export interface TextShape {
  id: string
  tool: 'text'
  x: number
  y: number
  text: string
  fontSize: number
  fill: string
  rotation: number
}

// A reference numeral with a leader line pointing at the part it labels.
// Label and anchor move together, which is how patent figures are annotated.
export interface CalloutShape {
  id: string
  tool: 'callout'
  x: number // label position
  y: number
  anchorX: number // tip of the leader line, on the part being labelled
  anchorY: number
  text: string
  fontSize: number
  fill: string
  strokeWidth: number
}

export type ShapeDesc = StrokeShape | SegmentShape | BoxShape | TextShape | CalloutShape

// One entry of the drafting session's reference map, used to suggest numerals.
export interface ReferenceComponent {
  numeral: string
  name: string
}

// Persisted editable layer. Kept alongside the flattened PNG so edits can be
// reopened and revised rather than being baked irreversibly into the image.
export const ANNOTATIONS_VERSION = 1

export interface AnnotationPayload {
  version: number
  shapes: ShapeDesc[]
  baseImageFilename?: string | null
  savedAt: string
}

export interface ViewState {
  scale: number
  x: number
  y: number
}

// Same contract as the previous ImageEditor component so FigurePlannerStage
// can swap implementations via the dynamic import alone.
export interface CanvasImageEditorProps {
  imageSrc: string
  onSave: (
    editedImageBase64: string,
    imageObject: any,
    annotations: AnnotationPayload
  ) => void | Promise<void>
  onClose: () => void
  title?: string
  /** Previously saved shapes, re-applied over imageSrc so edits stay revisable. */
  initialShapes?: ShapeDesc[]
  /** Reference numerals offered as suggestions; arbitrary text is still allowed. */
  referenceComponents?: ReferenceComponent[]
  /** Filename of the base image the shapes are drawn over, recorded with the payload. */
  baseImageFilename?: string | null
}

export const TEXT_FONT_FAMILY = 'Arial, Helvetica, sans-serif'
export const SELECTION_COLOR = '#3b82f6'
