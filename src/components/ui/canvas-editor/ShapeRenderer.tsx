'use client'

import Konva from 'konva'
import { Arrow, Circle, Ellipse, Group, Line, Rect, Text } from 'react-konva'
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

  if (shape.tool === 'callout') {
    const callout = shape
    // The leader starts at the edge of the label nearest the anchor so the line
    // never strikes through the numeral.
    const halfW = (callout.text.length * callout.fontSize * 0.3) / 2
    const halfH = callout.fontSize / 2
    const cx = callout.x + halfW
    const cy = callout.y + halfH
    const dx = callout.anchorX - cx
    const dy = callout.anchorY - cy
    const dist = Math.hypot(dx, dy) || 1
    const pad = 4
    const startX = cx + (dx / dist) * Math.min(halfW + pad, dist)
    const startY = cy + (dy / dist) * Math.min(halfH + pad, dist)

    return (
      <Group
        {...common}
        visible={!hidden}
        onDblClick={() => onEditText?.(callout.id)}
        onDblTap={() => onEditText?.(callout.id)}
        onDragEnd={(e: KonvaEventObject<DragEvent>) => {
          // Children hold absolute coordinates, so fold the group's offset back
          // into the shape and reset the group to the origin.
          const node = e.target
          const dxMove = node.x()
          const dyMove = node.y()
          node.position({ x: 0, y: 0 })
          onChange?.(callout.id, {
            x: callout.x + dxMove,
            y: callout.y + dyMove,
            anchorX: callout.anchorX + dxMove,
            anchorY: callout.anchorY + dyMove
          })
        }}
      >
        <Line
          points={[startX, startY, callout.anchorX, callout.anchorY]}
          stroke={callout.fill}
          strokeWidth={callout.strokeWidth}
          lineCap="round"
          hitStrokeWidth={Math.max(callout.strokeWidth, 14)}
        />
        <Circle
          x={callout.anchorX}
          y={callout.anchorY}
          radius={Math.max(callout.strokeWidth * 1.2, 2.5)}
          fill={callout.fill}
        />
        <Text
          x={callout.x}
          y={callout.y}
          text={callout.text}
          fontSize={callout.fontSize}
          fontFamily={TEXT_FONT_FAMILY}
          fill={callout.fill}
        />
      </Group>
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
