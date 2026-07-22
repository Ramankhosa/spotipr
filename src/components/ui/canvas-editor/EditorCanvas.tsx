'use client'

import { RefObject, useEffect } from 'react'
import Konva from 'konva'
import { KonvaEventObject } from 'konva/lib/Node'
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva'
import ShapeRenderer from './ShapeRenderer'
import { SELECTION_COLOR, ShapeDesc, Tool, ViewState } from './types'

const TRANSFORMABLE_TOOLS = ['rect', 'ellipse', 'eraseRect', 'text']

interface EditorCanvasProps {
  stageRef: RefObject<Konva.Stage>
  trRef: RefObject<Konva.Transformer>
  width: number
  height: number
  imageEl: HTMLImageElement | HTMLCanvasElement
  imageWidth: number
  imageHeight: number
  view: ViewState
  minScale: number
  maxScale: number
  onViewChange: (view: ViewState) => void
  tool: Tool
  shapes: ShapeDesc[]
  draftShape: ShapeDesc | null
  selectedId: string | null
  editingTextId: string | null
  onPointerDown: (pos: { x: number; y: number }) => void
  onPointerMove: (pos: { x: number; y: number }) => void
  onPointerUp: () => void
  onSelect: (id: string | null) => void
  onShapeChange: (id: string, patch: Partial<ShapeDesc>) => void
  onEditText: (id: string) => void
}

const DRAWING_TOOLS: Tool[] = [
  'pen', 'eraser', 'eraseRect', 'line', 'arrow', 'elbowArrow', 'rect', 'ellipse', 'text', 'callout'
]

export default function EditorCanvas({
  stageRef,
  trRef,
  width,
  height,
  imageEl,
  imageWidth,
  imageHeight,
  view,
  minScale,
  maxScale,
  onViewChange,
  tool,
  shapes,
  draftShape,
  selectedId,
  editingTextId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelect,
  onShapeChange,
  onEditText
}: EditorCanvasProps) {
  const selectedShape = shapes.find(s => s.id === selectedId)

  // Attach/detach the transformer when the selection changes.
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    if (tool === 'select' && selectedShape && TRANSFORMABLE_TOOLS.includes(selectedShape.tool)) {
      const node = stage.findOne('#' + selectedShape.id)
      tr.nodes(node ? [node] : [])
    } else {
      tr.nodes([])
    }
    tr.getLayer()?.batchDraw()
  }, [selectedId, selectedShape, shapes, tool, trRef, stageRef])

  const getImagePos = () => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getRelativePointerPosition()
    return pos ? { x: pos.x, y: pos.y } : null
  }

  const handlePointerDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (tool === 'pan') return
    if (tool === 'select') {
      // Clicking empty space (the stage itself — background layer is non-listening)
      // clears the selection; clicks on shapes are handled by the shapes.
      if (e.target === stageRef.current) onSelect(null)
      return
    }
    if ('button' in e.evt && e.evt.button !== 0) return
    const pos = getImagePos()
    if (pos) onPointerDown(pos)
  }

  const handlePointerMove = () => {
    if (tool === 'pan' || tool === 'select') return
    const pos = getImagePos()
    if (pos) onPointerMove(pos)
  }

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const oldScale = view.scale
    const factor = 1.08
    const rawScale = e.evt.deltaY > 0 ? oldScale / factor : oldScale * factor
    const newScale = Math.min(maxScale, Math.max(minScale, rawScale))
    if (newScale === oldScale) return
    const anchor = {
      x: (pointer.x - view.x) / oldScale,
      y: (pointer.y - view.y) / oldScale
    }
    onViewChange({
      scale: newScale,
      x: pointer.x - anchor.x * newScale,
      y: pointer.y - anchor.y * newScale
    })
  }

  const handleStageDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current
    if (stage && e.target === stage) {
      onViewChange({ scale: view.scale, x: stage.x(), y: stage.y() })
    }
  }

  const isTextSelected = selectedShape?.tool === 'text'

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      scaleX={view.scale}
      scaleY={view.scale}
      x={view.x}
      y={view.y}
      draggable={tool === 'pan'}
      onWheel={handleWheel}
      onDragEnd={handleStageDragEnd}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={onPointerUp}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={onPointerUp}
    >
      <Layer listening={false}>
        <Rect x={0} y={0} width={imageWidth} height={imageHeight} fill="#ffffff" />
        <KonvaImage image={imageEl} x={0} y={0} width={imageWidth} height={imageHeight} />
      </Layer>
      <Layer>
        {shapes.map(shape => (
          <ShapeRenderer
            key={shape.id}
            shape={shape}
            isSelected={tool === 'select' && shape.id === selectedId}
            draggable={tool === 'select'}
            hidden={shape.id === editingTextId}
            onSelect={tool === 'select' ? id => onSelect(id) : undefined}
            onChange={onShapeChange}
            onEditText={onEditText}
          />
        ))}
        {draftShape && DRAWING_TOOLS.includes(tool) && (
          <ShapeRenderer shape={draftShape} isDraft />
        )}
        <Transformer
          ref={trRef}
          rotateEnabled={isTextSelected}
          keepRatio={isTextSelected}
          enabledAnchors={
            isTextSelected
              ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
              : undefined
          }
          flipEnabled={false}
          anchorSize={9}
          anchorStroke={SELECTION_COLOR}
          borderStroke={SELECTION_COLOR}
          ignoreStroke
          boundBoxFunc={(oldBox, newBox) =>
            Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox
          }
        />
      </Layer>
    </Stage>
  )
}
