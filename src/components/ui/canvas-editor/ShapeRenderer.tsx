'use client'

import Konva from 'konva'
import { Arrow, Ellipse, Line, Rect, Text } from 'react-konva'
import { KonvaEventObject } from 'konva/lib/Node'
import { SELECTION_COLOR, ShapeDesc, TEXT_FONT_FAMILY } from './types'

interface ShapeRendererProps {
  shape: ShapeDesc
  isDraft?: boolean
  isSelected?: boolean
  draggable?: boolean
  hidden?: boolean
  onSelect?: (id: string) => void
  onChange?: (id: string, patch: Partial<ShapeDesc>) => void
  onEditText?: (id: string) => void
}

export default function ShapeRenderer({
  shape,
  isDraft = false,
  isSelected = false,
  draggable = false,
  hidden = false,
  onSelect,
  onChange,
  onEditText
}: ShapeRendererProps) {
  const select = onSelect ? () => onSelect(shape.id) : undefined

  const selectionGlow = isSelected
    ? { shadowColor: SELECTION_COLOR, shadowBlur: 8, shadowOpacity: 0.9, shadowForStrokeEnabled: true }
    : {}

  const common = {
    id: shape.id,
    draggable,
    listening: !isDraft,
    onMouseDown: select,
    onTap: select,
    ...selectionGlow
  }

  if (shape.tool === 'pen' || shape.tool === 'eraser') {
    return (
      <Line
        {...common}
        x={shape.x || 0}
        y={shape.y || 0}
        points={shape.points}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(shape.strokeWidth, 16)}
        onDragEnd={(e: KonvaEventObject<DragEvent>) =>
          onChange?.(shape.id, { x: e.target.x(), y: e.target.y() })
        }
      />
    )
  }

  if (shape.tool === 'line' || shape.tool === 'arrow' || shape.tool === 'elbowArrow') {
    const isElbow = shape.tool === 'elbowArrow'
    const segmentProps = {
      ...common,
      x: shape.x || 0,
      y: shape.y || 0,
      points: shape.points,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
      hitStrokeWidth: Math.max(shape.strokeWidth, 16),
      onDragEnd: (e: KonvaEventObject<DragEvent>) =>
        onChange?.(shape.id, { x: e.target.x(), y: e.target.y() })
    }
    if (shape.tool === 'arrow' || isElbow) {
      const pointerSize = Math.min(Math.max(shape.strokeWidth * 4, 8), 30)
      return (
        <Arrow
          {...segmentProps}
          fill={shape.stroke}
          pointerLength={pointerSize}
          pointerWidth={pointerSize}
        />
      )
    }
    return <Line {...segmentProps} />
  }

  if (shape.tool === 'eraseRect') {
    return (
      <Rect
        {...common}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        fill="#ffffff"
        stroke={isDraft || isSelected ? SELECTION_COLOR : undefined}
        strokeWidth={isDraft || isSelected ? 1.5 : 0}
        dash={[6, 4]}
        strokeScaleEnabled={false}
        onDragEnd={(e: KonvaEventObject<DragEvent>) =>
          onChange?.(shape.id, { x: e.target.x(), y: e.target.y() })
        }
        onTransformEnd={(e: KonvaEventObject<Event>) => {
          const node = e.target as Konva.Rect
          const sx = node.scaleX()
          const sy = node.scaleY()
          node.scale({ x: 1, y: 1 })
          onChange?.(shape.id, {
            x: node.x(),
            y: node.y(),
            width: Math.max(2, node.width() * sx),
            height: Math.max(2, node.height() * sy)
          })
        }}
      />
    )
  }

  if (shape.tool === 'rect') {
    return (
      <Rect
        {...common}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        fillEnabled={false}
        hitStrokeWidth={Math.max(shape.strokeWidth, 16)}
        onDragEnd={(e: KonvaEventObject<DragEvent>) =>
          onChange?.(shape.id, { x: e.target.x(), y: e.target.y() })
        }
        onTransformEnd={(e: KonvaEventObject<Event>) => {
          const node = e.target as Konva.Rect
          const sx = node.scaleX()
          const sy = node.scaleY()
          node.scale({ x: 1, y: 1 })
          onChange?.(shape.id, {
            x: node.x(),
            y: node.y(),
            width: Math.max(2, node.width() * sx),
            height: Math.max(2, node.height() * sy)
          })
        }}
      />
    )
  }

  if (shape.tool === 'ellipse') {
    return (
      <Ellipse
        {...common}
        x={shape.x + shape.width / 2}
        y={shape.y + shape.height / 2}
        radiusX={Math.max(shape.width / 2, 1)}
        radiusY={Math.max(shape.height / 2, 1)}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        fillEnabled={false}
        hitStrokeWidth={Math.max(shape.strokeWidth, 16)}
        onDragEnd={(e: KonvaEventObject<DragEvent>) =>
          onChange?.(shape.id, {
            x: e.target.x() - shape.width / 2,
            y: e.target.y() - shape.height / 2
          })
        }
        onTransformEnd={(e: KonvaEventObject<Event>) => {
          const node = e.target as Konva.Ellipse
          const sx = node.scaleX()
          const sy = node.scaleY()
          node.scale({ x: 1, y: 1 })
          const width = Math.max(2, node.radiusX() * 2 * sx)
          const height = Math.max(2, node.radiusY() * 2 * sy)
          onChange?.(shape.id, {
            x: node.x() - width / 2,
            y: node.y() - height / 2,
            width,
            height
          })
        }}
      />
    )
  }

  if (shape.tool === 'text') {
    const textShape = shape
    return (
      <Text
        {...common}
        visible={!hidden}
        x={textShape.x}
        y={textShape.y}
        text={textShape.text}
        fontSize={textShape.fontSize}
        fontFamily={TEXT_FONT_FAMILY}
        fill={textShape.fill}
        rotation={textShape.rotation}
        onDblClick={() => onEditText?.(textShape.id)}
        onDblTap={() => onEditText?.(textShape.id)}
        onDragEnd={(e: KonvaEventObject<DragEvent>) =>
          onChange?.(textShape.id, { x: e.target.x(), y: e.target.y() })
        }
        onTransformEnd={(e: KonvaEventObject<Event>) => {
          const node = e.target as Konva.Text
          const sy = node.scaleY()
          node.scale({ x: 1, y: 1 })
          onChange?.(textShape.id, {
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            fontSize: Math.max(8, Math.round(textShape.fontSize * sy))
          })
        }}
      />
    )
  }

  return null
}
