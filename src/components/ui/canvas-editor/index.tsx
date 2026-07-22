'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import Konva from 'konva'
import {
  AlertTriangle,
  Circle,
  CornerDownRight,
  Eraser,
  Hand,
  Loader2,
  LucideIcon,
  Maximize,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pen,
  Redo2,
  Square,
  SquareDashed,
  Tag,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { cn } from '@/lib/utils'
import EditorCanvas from './EditorCanvas'
import TextEditOverlay from './TextEditOverlay'
import { useHistory } from './useHistory'
import { whitenToPaperWhite } from './whiten'
import {
  ANNOTATIONS_VERSION,
  AnnotationPayload,
  BoxShape,
  CalloutShape,
  CanvasImageEditorProps,
  SegmentShape,
  ShapeDesc,
  TextShape,
  Tool,
  ViewState,
  elbowPoints
} from './types'

const MAX_SCALE = 8
const COLORS = ['#000000', '#dc2626', '#ffffff']
// Hairlines vanish once a figure is scaled down into the filed document, so
// strokes are floored rather than allowed down to 1px.
const MIN_STROKE_WIDTH = 2

const TOOLS: { tool: Tool; icon: LucideIcon; label: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select / move' },
  { tool: 'pan', icon: Hand, label: 'Pan (or hold Space)' },
  { tool: 'pen', icon: Pen, label: 'Pen' },
  { tool: 'eraser', icon: Eraser, label: 'Eraser (paints white)' },
  { tool: 'eraseRect', icon: SquareDashed, label: 'Erase area (white block)' },
  { tool: 'line', icon: Minus, label: 'Line' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  { tool: 'elbowArrow', icon: CornerDownRight, label: 'Bent arrow (90°)' },
  { tool: 'rect', icon: Square, label: 'Rectangle' },
  { tool: 'ellipse', icon: Circle, label: 'Ellipse' },
  { tool: 'text', icon: Type, label: 'Text label' },
  { tool: 'callout', icon: Tag, label: 'Reference numeral with leader line' }
]

interface EditingText {
  shapeId?: string
  x: number
  y: number
  initialText: string
  fontSize: number
  color: string
  /** Present when the text belongs to a callout, i.e. has a leader line. */
  anchor?: { x: number; y: number }
}

export default function CanvasImageEditor({
  imageSrc,
  onSave,
  onClose,
  title,
  initialShapes,
  referenceComponents,
  baseImageFilename
}: CanvasImageEditorProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Start past any rehydrated ids so newly drawn shapes can't collide with them.
  const nextIdRef = useRef(
    (initialShapes || []).reduce((max, s) => {
      const n = Number(/^shape_(\d+)$/.exec(s.id)?.[1])
      return Number.isFinite(n) ? Math.max(max, n + 1) : max
    }, 1)
  )
  const draftOriginRef = useRef({ x: 0, y: 0 })
  const initializedForRef = useRef<string | null>(null)
  const pendingTextRef = useRef<{ x: number; y: number; anchor?: { x: number; y: number } } | null>(null)

  const [imageEl, setImageEl] = useState<HTMLImageElement | HTMLCanvasElement | null>(null)
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadNonce, setLoadNonce] = useState(0)
  const [paperWhite, setPaperWhite] = useState(true)
  const [whitenAvailable, setWhitenAvailable] = useState(false)
  const rawImageRef = useRef<HTMLImageElement | null>(null)
  const whitenedRef = useRef<HTMLCanvasElement | null>(null)
  const paperWhiteRef = useRef(true)
  paperWhiteRef.current = paperWhite
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)
  const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 })
  const [fitScale, setFitScale] = useState(1)

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#000000')
  const [strokeWidthSetting, setStrokeWidth] = useState(3)
  const strokeWidth = Math.max(strokeWidthSetting, MIN_STROKE_WIDTH)
  const [eraserWidth, setEraserWidth] = useState(24)
  const [fontSize, setFontSize] = useState(18)

  // Seeded with any previously saved layer so past edits stay revisable.
  const { state: shapes, set: setShapes, undo, redo, canUndo, canRedo } = useHistory<ShapeDesc[]>(
    initialShapes && initialShapes.length ? initialShapes : []
  )
  const [draftShape, setDraftShape] = useState<ShapeDesc | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<EditingText | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const newId = () => `shape_${nextIdRef.current++}`

  const imageSize = useMemo(() => {
    if (!imageEl) return null
    return imageEl instanceof HTMLCanvasElement
      ? { width: imageEl.width, height: imageEl.height }
      : { width: imageEl.naturalWidth, height: imageEl.naturalHeight }
  }, [imageEl])
  const minScale = fitScale * 0.1

  // --- Image loading -------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setImageStatus('loading')
    setImageEl(null)
    initializedForRef.current = null
    rawImageRef.current = null
    whitenedRef.current = null
    setWhitenAvailable(false)
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      rawImageRef.current = img
      // Figures arrive with off-white backgrounds (AI sketches, scans, legacy
      // renders) while the eraser paints pure white; normalizing to paper
      // white makes erasing invisible and the saved figure uniformly #FFFFFF.
      const whitened = whitenToPaperWhite(img)
      whitenedRef.current = whitened ? whitened.element : null
      setWhitenAvailable(!!whitened)
      setImageEl(whitened && paperWhiteRef.current ? whitened.element : img)
      setImageStatus('ready')
    }
    img.onerror = () => {
      if (!cancelled) setImageStatus('error')
    }
    img.src = imageSrc
    return () => {
      cancelled = true
    }
  }, [imageSrc, loadNonce])

  const togglePaperWhite = () => {
    const next = !paperWhite
    setPaperWhite(next)
    const el = next && whitenedRef.current ? whitenedRef.current : rawImageRef.current
    if (el) setImageEl(el)
  }

  // --- Container sizing ----------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      // Ignore degenerate measurements taken before layout settles. Latching onto
      // one would fix the zoom at a nonsense scale, and the initialise-once guard
      // below would never let it recover — every click would then map hundreds of
      // thousands of pixels off-canvas.
      if (rect.width < 2 || rect.height < 2) return
      setContainerSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // --- Initial fit-to-screen ----------------------------------------------
  const computeFit = useCallback(() => {
    if (!imageSize || !containerSize) return null
    const scale = Math.min(
      (containerSize.width * 0.96) / imageSize.width,
      (containerSize.height * 0.96) / imageSize.height,
      1
    )
    return {
      scale,
      x: (containerSize.width - imageSize.width * scale) / 2,
      y: (containerSize.height - imageSize.height * scale) / 2
    }
  }, [imageSize, containerSize])

  useEffect(() => {
    if (!imageSize || !containerSize) return
    if (initializedForRef.current === imageSrc) return
    const fit = computeFit()
    if (!fit) return
    initializedForRef.current = imageSrc
    setFitScale(fit.scale)
    setView(fit)
  }, [imageSize, containerSize, imageSrc, computeFit])

  // --- Zoom helpers --------------------------------------------------------
  const clampScale = useCallback(
    (s: number) => Math.min(MAX_SCALE, Math.max(minScale || 0.02, s)),
    [minScale]
  )

  const zoomTo = useCallback(
    (newScale: number) => {
      if (!containerSize) return
      const center = { x: containerSize.width / 2, y: containerSize.height / 2 }
      setView(v => {
        const scale = clampScale(newScale)
        const anchor = { x: (center.x - v.x) / v.scale, y: (center.y - v.y) / v.scale }
        return { scale, x: center.x - anchor.x * scale, y: center.y - anchor.y * scale }
      })
    },
    [containerSize, clampScale]
  )

  const fitView = useCallback(() => {
    const fit = computeFit()
    if (fit) {
      setFitScale(fit.scale)
      setView(fit)
    }
  }, [computeFit])

  // --- Drawing -------------------------------------------------------------
  const handlePointerDown = (pos: { x: number; y: number }) => {
    if (editingText || saving) return
    switch (tool) {
      case 'pen':
      case 'eraser':
        setDraftShape({
          id: newId(),
          tool,
          points: [pos.x, pos.y, pos.x, pos.y],
          stroke: tool === 'eraser' ? '#ffffff' : color,
          strokeWidth: tool === 'eraser' ? eraserWidth : strokeWidth
        })
        break
      case 'line':
      case 'arrow':
      case 'elbowArrow':
        draftOriginRef.current = pos
        setDraftShape({
          id: newId(),
          tool,
          points: [pos.x, pos.y, pos.x, pos.y],
          stroke: color,
          strokeWidth
        })
        break
      case 'rect':
      case 'ellipse':
      case 'eraseRect':
        draftOriginRef.current = pos
        setDraftShape({
          id: newId(),
          tool,
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          stroke: tool === 'eraseRect' ? '#ffffff' : color,
          strokeWidth
        })
        break
      case 'text':
        // Placed on mouse-up, not here: the browser moves focus as part of the
        // click's default action, which would blur (and discard) the new input.
        pendingTextRef.current = pos
        break
      case 'callout':
        // Drag starts on the part being labelled; the numeral lands where released.
        draftOriginRef.current = pos
        setDraftShape({
          id: newId(),
          tool: 'callout',
          anchorX: pos.x,
          anchorY: pos.y,
          x: pos.x,
          y: pos.y,
          text: '',
          fontSize,
          fill: color,
          strokeWidth
        })
        break
      default:
        break
    }
  }

  const handlePointerMove = (pos: { x: number; y: number }) => {
    setDraftShape(prev => {
      if (!prev) return prev
      if (prev.tool === 'pen' || prev.tool === 'eraser') {
        return { ...prev, points: [...prev.points, pos.x, pos.y] }
      }
      if (prev.tool === 'line' || prev.tool === 'arrow') {
        return { ...prev, points: [prev.points[0], prev.points[1], pos.x, pos.y] }
      }
      if (prev.tool === 'elbowArrow') {
        const origin = draftOriginRef.current
        return { ...prev, points: elbowPoints(origin.x, origin.y, pos.x, pos.y) }
      }
      if (prev.tool === 'callout') {
        // The anchor stays put; the label follows the cursor.
        return { ...prev, x: pos.x, y: pos.y }
      }
      const origin = draftOriginRef.current
      return {
        ...prev,
        x: Math.min(origin.x, pos.x),
        y: Math.min(origin.y, pos.y),
        width: Math.abs(pos.x - origin.x),
        height: Math.abs(pos.y - origin.y)
      }
    })
  }

  const draftRef = useRef<ShapeDesc | null>(null)
  draftRef.current = draftShape
  const shapesRef = useRef<ShapeDesc[]>(shapes)
  shapesRef.current = shapes
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const colorRef = useRef(color)
  colorRef.current = color

  const handlePointerUp = useCallback(() => {
    // Text is placed here so the click's focus change happens before the input mounts.
    const pendingText = pendingTextRef.current
    if (pendingText) {
      pendingTextRef.current = null
      setEditingText({
        x: pendingText.x,
        y: pendingText.y,
        initialText: '',
        fontSize: fontSizeRef.current,
        color: colorRef.current
      })
      return
    }

    const current = draftRef.current
    if (!current) return
    draftRef.current = null
    setDraftShape(null)

    // A finished callout drag opens the numeral input at the label position.
    if (current.tool === 'callout') {
      setEditingText({
        x: current.x,
        y: current.y,
        initialText: '',
        fontSize: fontSizeRef.current,
        color: colorRef.current,
        anchor: { x: current.anchorX, y: current.anchorY }
      })
      return
    }
    // Discard accidental clicks: shapes smaller than ~3 screen px.
    const minDim = 3 / (stageRef.current?.scaleX() || 1)
    let valid = true
    if (current.tool === 'line' || current.tool === 'arrow' || current.tool === 'elbowArrow') {
      const pts = (current as SegmentShape).points
      const [x1, y1] = pts
      const x2 = pts[pts.length - 2]
      const y2 = pts[pts.length - 1]
      valid = Math.hypot(x2 - x1, y2 - y1) >= minDim
    } else if (current.tool === 'rect' || current.tool === 'ellipse' || current.tool === 'eraseRect') {
      const box = current as BoxShape
      valid = box.width >= minDim && box.height >= minDim
    }
    if (valid) setShapes([...shapesRef.current, current])
  }, [setShapes])

  // End strokes released outside the canvas.
  useEffect(() => {
    const onWindowUp = () => handlePointerUp()
    window.addEventListener('mouseup', onWindowUp)
    window.addEventListener('touchend', onWindowUp)
    return () => {
      window.removeEventListener('mouseup', onWindowUp)
      window.removeEventListener('touchend', onWindowUp)
    }
  }, [handlePointerUp])

  // --- Shape updates -------------------------------------------------------
  const handleShapeChange = (id: string, patch: Partial<ShapeDesc>) => {
    setShapes(shapes.map(s => (s.id === id ? ({ ...s, ...patch } as ShapeDesc) : s)))
  }

  const deleteSelected = () => {
    if (!selectedId) return
    setShapes(shapes.filter(s => s.id !== selectedId))
    setSelectedId(null)
  }

  // --- Text ----------------------------------------------------------------
  const startEditText = (id: string) => {
    const found = shapes.find(s => s.id === id)
    if (!found || (found.tool !== 'text' && found.tool !== 'callout')) return
    const shape = found as TextShape | CalloutShape
    setSelectedId(null)
    setEditingText({
      shapeId: id,
      x: shape.x,
      y: shape.y,
      initialText: shape.text,
      fontSize: shape.fontSize,
      color: shape.fill,
      // Retained so the leader line survives a re-edit of the numeral.
      ...(shape.tool === 'callout' ? { anchor: { x: shape.anchorX, y: shape.anchorY } } : {})
    })
  }

  const commitText = (text: string) => {
    const editing = editingText
    setEditingText(null)
    if (!editing) return
    const trimmed = text.replace(/\s+$/, '')
    if (editing.shapeId) {
      if (!trimmed) {
        setShapes(shapes.filter(s => s.id !== editing.shapeId))
      } else {
        setShapes(shapes.map(s => (s.id === editing.shapeId ? { ...s, text: trimmed } : s)))
      }
    } else if (trimmed) {
      const shape: ShapeDesc = editing.anchor
        ? {
            id: newId(),
            tool: 'callout',
            x: editing.x,
            y: editing.y,
            anchorX: editing.anchor.x,
            anchorY: editing.anchor.y,
            text: trimmed,
            fontSize: editing.fontSize,
            fill: editing.color,
            strokeWidth
          }
        : {
            id: newId(),
            tool: 'text',
            x: editing.x,
            y: editing.y,
            text: trimmed,
            fontSize: editing.fontSize,
            fill: editing.color,
            rotation: 0
          }
      setShapes([...shapes, shape])
    }
  }

  // --- Keyboard shortcuts --------------------------------------------------
  const handleClose = useCallback(() => {
    if (saving) return
    if (shapes.length > 0 && !confirm('Discard your edits?')) return
    onClose()
  }, [saving, shapes.length, onClose])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      if (typing) return
      if (e.key === ' ') {
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) return
        e.preventDefault()
        setSpaceDown(true)
        return
      }
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        setSelectedId(null)
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        setSelectedId(null)
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'Escape') {
        handleClose()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  // --- Save (export at native resolution) ----------------------------------
  const handleSave = async () => {
    const stage = stageRef.current
    if (!stage || !imageEl || !imageSize || saving) return
    // Clear selection/overlays synchronously so they don't appear in the export.
    flushSync(() => {
      setSelectedId(null)
      setEditingText(null)
      setDraftShape(null)
    })
    trRef.current?.nodes([])
    const prev = {
      scaleX: stage.scaleX(),
      scaleY: stage.scaleY(),
      x: stage.x(),
      y: stage.y(),
      width: stage.width(),
      height: stage.height()
    }
    let dataUrl: string
    try {
      stage.scale({ x: 1, y: 1 })
      stage.position({ x: 0, y: 0 })
      stage.size({ width: imageSize.width, height: imageSize.height })
      stage.draw()
      dataUrl = stage.toDataURL({
        x: 0,
        y: 0,
        width: imageSize.width,
        height: imageSize.height,
        pixelRatio: 1,
        mimeType: 'image/png'
      })
    } finally {
      stage.scale({ x: prev.scaleX, y: prev.scaleY })
      stage.position({ x: prev.x, y: prev.y })
      stage.size({ width: prev.width, height: prev.height })
      stage.batchDraw()
    }
    const base64 = dataUrl.split(',')[1]
    const safeName = (title || 'image').replace(/[^a-zA-Z0-9]/g, '_')

    // The API rejects anything over 10MB; catch it here with a message the user can act on.
    const approxMb = (base64.length * 0.75) / (1024 * 1024)
    if (approxMb > 9.8) {
      setSaveError(
        `Edited image is too large to save (${approxMb.toFixed(1)}MB, limit 10MB). Try editing a smaller figure.`
      )
      return
    }

    // Shapes travel with the flattened PNG so the layer stays re-editable.
    const annotations: AnnotationPayload = {
      version: ANNOTATIONS_VERSION,
      shapes,
      baseImageFilename: baseImageFilename ?? null,
      savedAt: new Date().toISOString()
    }

    try {
      setSaving(true)
      setSaveError(null)
      await Promise.resolve(
        onSave(base64, { name: `${safeName}_edited.png`, type: 'image/png' }, annotations)
      )
    } catch (err) {
      console.error('[CanvasImageEditor] save failed', err)
      setSaveError(err instanceof Error ? err.message : 'Failed to save the edited image')
    } finally {
      setSaving(false)
    }
  }

  // --- Derived UI state ----------------------------------------------------
  const effectiveTool: Tool = spaceDown && !editingText ? 'pan' : tool
  const cursor =
    effectiveTool === 'pan'
      ? 'grab'
      : effectiveTool === 'select'
        ? 'default'
        : effectiveTool === 'text'
          ? 'text'
          : 'crosshair'

  const showColor = ['pen', 'line', 'arrow', 'elbowArrow', 'rect', 'ellipse', 'text', 'callout'].includes(tool)
  const showStrokeWidth = ['pen', 'line', 'arrow', 'elbowArrow', 'rect', 'ellipse', 'callout'].includes(tool)

  const selectTool = (t: Tool) => {
    setTool(t)
    if (t !== 'select') setSelectedId(null)
    setDraftShape(null)
  }

  // Rendered through a portal: an ancestor of this stage carries a framer-motion
  // transform, which would otherwise become the containing block for `fixed` and
  // leave the overlay offset and running off-screen.
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full h-full max-w-[1700px] max-h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-paper-200 shrink-0">
          <h3 className="text-sm font-semibold text-ai-graphite-900 truncate min-w-0">
            {title ? `Edit — ${title}` : 'Edit image'}
          </h3>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!canUndo || saving} onClick={() => { setSelectedId(null); undo() }} />
            <IconButton icon={Redo2} label="Redo (Ctrl+Y)" disabled={!canRedo || saving} onClick={() => { setSelectedId(null); redo() }} />
            <div className="w-px h-6 bg-paper-200 mx-1" />
            <IconButton icon={ZoomOut} label="Zoom out" onClick={() => zoomTo(view.scale / 1.25)} />
            <span className="text-xs text-ai-graphite-500 w-12 text-center tabular-nums">
              {Math.round(view.scale * 100)}%
            </span>
            <IconButton icon={ZoomIn} label="Zoom in" onClick={() => zoomTo(view.scale * 1.25)} />
            <IconButton icon={Maximize} label="Fit to screen" onClick={fitView} />
            <button
              type="button"
              onClick={() => zoomTo(1)}
              className="px-2 h-8 rounded-md text-xs text-ai-graphite-600 hover:bg-paper-100"
              title="Actual size (100%)"
            >
              1:1
            </button>
            {whitenAvailable && (
              <button
                type="button"
                onClick={togglePaperWhite}
                className={cn(
                  'px-2 h-8 rounded-md text-xs whitespace-nowrap transition-colors',
                  paperWhite
                    ? 'bg-ai-blue-500 text-white'
                    : 'text-ai-graphite-600 hover:bg-paper-100'
                )}
                title="Normalize the figure background to pure paper white so the eraser blends in"
              >
                Paper white
              </button>
            )}
            <div className="w-px h-6 bg-paper-200 mx-1" />
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-3 h-8 rounded-md text-sm text-ai-graphite-600 hover:bg-paper-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || imageStatus !== 'ready'}
              className="px-4 h-8 rounded-md text-sm font-medium bg-ai-blue-500 text-white hover:bg-ai-blue-600 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="ml-1 w-8 h-8 rounded-md flex items-center justify-center text-ai-graphite-500 hover:bg-paper-100"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {saveError && (
          <div className="shrink-0 flex items-start gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{saveError}</span>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              className="shrink-0 text-red-500 hover:text-red-700"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Tool rail */}
          <div className="w-14 border-r border-paper-200 flex flex-col items-center gap-1 py-3 shrink-0 overflow-y-auto">
            {TOOLS.map(({ tool: t, icon: Icon, label }) => (
              <button
                key={t}
                type="button"
                title={label}
                onClick={() => selectTool(t)}
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                  tool === t
                    ? 'bg-ai-blue-500 text-white'
                    : 'text-ai-graphite-600 hover:bg-paper-100'
                )}
              >
                <Icon className="w-5 h-5" />
              </button>
            ))}
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {/* Context strip */}
            <div className="h-12 border-b border-paper-200 flex items-center gap-5 px-4 shrink-0 text-sm text-ai-graphite-600 overflow-x-auto">
              {showColor && (
                <div className="flex items-center gap-2">
                  <span className="text-xs">Color</span>
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        'w-6 h-6 rounded-full border border-paper-300 transition-shadow',
                        color === c && 'ring-2 ring-ai-blue-500 ring-offset-1'
                      )}
                      style={{ backgroundColor: c }}
                      title={c === '#ffffff' ? 'White' : c === '#000000' ? 'Black' : 'Red'}
                    />
                  ))}
                </div>
              )}
              {showStrokeWidth && (
                <div className="flex items-center gap-2">
                  <span className="text-xs">Width</span>
                  <input
                    type="range"
                    min={MIN_STROKE_WIDTH}
                    max={30}
                    value={strokeWidth}
                    onChange={e => setStrokeWidth(Math.max(Number(e.target.value), MIN_STROKE_WIDTH))}
                    className="w-32 accent-ai-blue-500"
                  />
                  <span className="text-xs w-6 tabular-nums">{strokeWidth}</span>
                </div>
              )}
              {tool === 'eraser' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs">Eraser size</span>
                  <input
                    type="range"
                    min={4}
                    max={80}
                    value={eraserWidth}
                    onChange={e => setEraserWidth(Number(e.target.value))}
                    className="w-32 accent-ai-blue-500"
                  />
                  <span className="text-xs w-6 tabular-nums">{eraserWidth}</span>
                </div>
              )}
              {(tool === 'text' || tool === 'callout') && (
                <div className="flex items-center gap-2">
                  <span className="text-xs">Text size</span>
                  <input
                    type="range"
                    min={10}
                    max={72}
                    value={fontSize}
                    onChange={e => setFontSize(Number(e.target.value))}
                    className="w-32 accent-ai-blue-500"
                  />
                  <span className="text-xs w-6 tabular-nums">{fontSize}</span>
                </div>
              )}
              {tool === 'select' && (
                <span className="text-xs">
                  Click a shape to select it. Drag to move, use the handles to resize, press Delete to remove. Double-click text to edit it.
                </span>
              )}
              {tool === 'eraseRect' && (
                <span className="text-xs">Drag over the area you want to white-out.</span>
              )}
              {tool === 'elbowArrow' && (
                <span className="text-xs whitespace-nowrap">
                  Drag from start to end — the arrow bends at a right angle along the longer direction.
                </span>
              )}
              {tool === 'pan' && <span className="text-xs">Drag to pan. Mouse wheel zooms.</span>}
              {tool === 'text' && (
                <span className="text-xs">Click on the image to place a label.</span>
              )}
              {tool === 'callout' && (
                <span className="text-xs whitespace-nowrap">
                  Drag from the part outwards, then type or pick a reference numeral.
                </span>
              )}
            </div>

            {/* Canvas */}
            {/* min-h-0/min-w-0 stop the Konva stage (an absolutely-positioned child,
                sized from this box) from propping the box open in a resize loop. */}
            <div
              ref={containerRef}
              className="flex-1 relative overflow-hidden bg-paper-200 min-h-0 min-w-0"
              style={{ cursor }}
            >
              {imageStatus === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-ai-graphite-500">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                    <p className="text-sm">Loading image…</p>
                  </div>
                </div>
              )}
              {imageStatus === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-ai-graphite-600">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
                    <p className="text-sm mb-3">Could not load the image.</p>
                    <button
                      type="button"
                      onClick={() => setLoadNonce(n => n + 1)}
                      className="px-3 py-1.5 rounded-md text-sm border border-paper-300 hover:bg-paper-100"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
              {imageStatus === 'ready' && imageEl && imageSize && containerSize && (
                <div className="absolute inset-0">
                <EditorCanvas
                  stageRef={stageRef}
                  trRef={trRef}
                  width={containerSize.width}
                  height={containerSize.height}
                  imageEl={imageEl}
                  imageWidth={imageSize.width}
                  imageHeight={imageSize.height}
                  view={view}
                  minScale={minScale || 0.02}
                  maxScale={MAX_SCALE}
                  onViewChange={setView}
                  tool={effectiveTool}
                  shapes={shapes}
                  draftShape={draftShape}
                  selectedId={selectedId}
                  editingTextId={editingText?.shapeId || null}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onSelect={setSelectedId}
                  onShapeChange={handleShapeChange}
                  onEditText={startEditText}
                />
                </div>
              )}
              {editingText && (
                <TextEditOverlay
                  left={view.x + editingText.x * view.scale}
                  top={view.y + editingText.y * view.scale}
                  fontSizePx={Math.max(10, editingText.fontSize * view.scale)}
                  color={editingText.color}
                  initialText={editingText.initialText}
                  suggestions={referenceComponents}
                  onCommit={commitText}
                  onCancel={() => setEditingText(null)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 rounded-md flex items-center justify-center text-ai-graphite-600 hover:bg-paper-100 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
