'use client'

// Zoomable figure viewer for the full-view modals.
//
// Patent figures are tall (3:4 portrait) and dense with reference numerals, so
// "fit to the box" is the right default but is often too small to read. Zoom is
// therefore relative to the fitted size: 100% means fitted, 200% means twice
// that. The image is grown by setting an explicit width rather than by CSS
// transform, because only real layout size gives the scroll container genuine
// scroll extents — which is what lets the user pan around a magnified figure.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Minus, Plus, Maximize2 } from 'lucide-react'

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const STEP = 0.25

interface ZoomableImageProps {
  src: string
  alt: string
  /** Rendered at the top-right of the viewport, next to the zoom controls. */
  children?: React.ReactNode
}

export default function ZoomableImage({ src, alt, children }: ZoomableImageProps) {
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState<number | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // A different figure starts fresh.
  useEffect(() => {
    setZoom(1)
    setFitWidth(null)
  }, [src])

  // The fitted width is only measurable while actually fitting (zoom === 1).
  // offsetWidth, not getBoundingClientRect: the modal animates in from
  // scale(0.8), and a rect measured mid-animation is scaled, which would make
  // every subsequent zoom step proportionally wrong. offsetWidth is layout size
  // and ignores transforms.
  const measureFit = useCallback(() => {
    if (zoom !== 1 || !imageRef.current) return
    const width = imageRef.current.offsetWidth
    if (width > 0) setFitWidth(width)
  }, [zoom])

  useLayoutEffect(() => {
    measureFit()
  }, [measureFit])

  useEffect(() => {
    if (zoom !== 1) return
    window.addEventListener('resize', measureFit)
    return () => window.removeEventListener('resize', measureFit)
  }, [zoom, measureFit])

  const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
  const zoomBy = (delta: number) => {
    measureFit()
    setZoom(current => clamp(current + delta))
  }

  // Ctrl/Cmd + wheel zooms; a plain wheel keeps scrolling so panning still works.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? STEP : -STEP)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  })

  const isFitted = zoom === 1
  const zoomedWidth = fitWidth != null ? fitWidth * zoom : null

  // The scroll viewport is absolutely positioned rather than flex-sized. A
  // flex-sized box keeps `height: auto` as its computed value, so the image's
  // `max-height: 100%` never resolves and a tall figure overflows instead of
  // fitting; `inset-0` gives it the definite height that percentage needs.
  // Because that takes the image out of flow, the root carries an explicit
  // min-height — otherwise it has no intrinsic content and collapses to zero.
  return (
    <div className="relative flex-1 min-h-[50vh] overflow-hidden bg-paper-200">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-paper-300 bg-white/95 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => zoomBy(-STEP)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-ai-graphite-600 transition-colors hover:bg-paper-200 hover:text-ai-graphite-900 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ai-blue-500"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-ai-graphite-600" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(STEP)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-ai-graphite-600 transition-colors hover:bg-paper-200 hover:text-ai-graphite-900 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ai-blue-500"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          disabled={isFitted}
          aria-label="Fit figure to window"
          title="Fit to window"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-ai-graphite-600 transition-colors hover:bg-paper-200 hover:text-ai-graphite-900 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ai-blue-500"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        {children}
      </div>

      <div
        ref={scrollRef}
        className={`absolute inset-0 overflow-auto p-4 ${isFitted ? 'flex items-center justify-center' : ''}`}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          onLoad={measureFit}
          onDoubleClick={() => (isFitted ? zoomBy(1) : setZoom(1))}
          draggable={false}
          className={`shadow-lg ${isFitted ? 'max-h-full max-w-full object-contain' : 'max-w-none'}`}
          style={isFitted || zoomedWidth == null ? undefined : { width: `${zoomedWidth}px`, height: 'auto' }}
        />
      </div>
    </div>
  )
}
