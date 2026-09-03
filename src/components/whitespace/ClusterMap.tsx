'use client'

/**
 * A 2D map of the field's areas, drawn from the layout coordinates the cluster
 * stage persists in metrics.layout (PCA over centroid means — see
 * layoutCentroids in binary-kmeans.ts, which is documented as "a selector,
 * never evidence"). This component keeps that contract: bubbles are a way to
 * pick an area, the caption says the axes mean nothing, and no empty region is
 * ever presented as an opening.
 *
 * Hand-rolled inline SVG by house rule — the whitespace visuals are all
 * categorical, unanimated, and single-accent (cobalt marks selection only).
 */

export interface ClusterMapItem {
  id: string
  label: string
  fieldEstimate: number
  layout: { x: number; y: number }
}

const VIEW_W = 100
const VIEW_H = 60
const PAD = 8
const MIN_R = 2.5
const MAX_R = 9

export function ClusterMap({
  clusters,
  selectedId,
  onSelect,
}: {
  clusters: ClusterMapItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const xs = clusters.map(c => c.layout.x)
  const ys = clusters.map(c => c.layout.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)

  // A degenerate axis (every centroid at the same coordinate) centers rather
  // than dividing by zero.
  const px = (x: number) => (spanX > 0 ? PAD + ((x - minX) / spanX) * (VIEW_W - 2 * PAD) : VIEW_W / 2)
  const py = (y: number) => (spanY > 0 ? PAD + ((y - minY) / spanY) * (VIEW_H - 2 * PAD) : VIEW_H / 2)

  // Bubble AREA tracks the estimate, so radius goes by square root.
  const maxEstimate = Math.max(1, ...clusters.map(c => c.fieldEstimate))
  const radius = (estimate: number) =>
    MIN_R + (MAX_R - MIN_R) * Math.sqrt(Math.max(0, estimate) / maxEstimate)

  return (
    <div className="mb-5">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="max-h-64 w-full" role="group" aria-label="Map of the field's areas">
        {clusters.map(cluster => {
          const cx = px(cluster.layout.x)
          const cy = py(cluster.layout.y)
          const r = radius(cluster.fieldEstimate)
          const selected = cluster.id === selectedId
          const shortLabel = cluster.label.length > 16 ? `${cluster.label.slice(0, 15)}…` : cluster.label
          return (
            <g
              key={cluster.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer outline-none focus-visible:opacity-80"
              onClick={() => onSelect(cluster.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(cluster.id)
                }
              }}
              aria-label={`${cluster.label}, about ${cluster.fieldEstimate.toLocaleString()} families, estimated`}
            >
              <title>{`${cluster.label} — ~${cluster.fieldEstimate.toLocaleString()} families (estimate)`}</title>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                className={
                  selected
                    ? 'fill-primary/[0.12] stroke-primary'
                    : 'fill-foreground/[0.06] stroke-border hover:stroke-foreground/40'
                }
                strokeWidth={selected ? 0.8 : 0.4}
              />
              <text
                x={cx}
                y={Math.min(VIEW_H - 1.5, cy + r + 3)}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={2.6}
              >
                {shortLabel}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        A map of the areas by how similar their patents read. The axes have no units — position is
        layout only, a way to pick an area, never evidence. Bubble size is the estimated family
        count. An empty region of this map means nothing.
      </p>
    </div>
  )
}
