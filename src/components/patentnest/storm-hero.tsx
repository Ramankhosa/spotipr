'use client'

// The corpus storm — hero variant D.
//
// One sentence, told in one picture: thirty million prior-art documents
// stream as weather across a dark window; the brass relevance gate keeps
// only what matters; what survives turns lamp green (the AI choosing) and
// lands on a paper page as lines of ink type. When the page fills, the
// seal presses, GRANTED stamps, and a fresh sheet begins.
//
// Deliberately simple: plain 2D canvas, no dependencies, three semantic
// colors (steel corpus / brass gate / lamp verdict) + paper. Trails give
// the motion its softness; the page is redrawn crisp every frame.
// Honors prefers-reduced-motion (renders a single composed still) and
// pauses when offscreen or the tab is hidden.

import { useEffect, useRef } from 'react'
import { BRASS, INK, PAPER, SOFT, WAX } from '@/lib/patentnest/palette'

const NIGHT = '#0d1524'          // the dark window (ink family, deepened)
const TRAIL = 'rgba(13,21,36,0.30)'
const LAMP_LIT = '#5fa37f'       // lamp green lifted for dark ground
const BRASS_LIT = '#b3924a'      // brass lifted for dark ground

type Slot = { x: number; y: number; w: number }

type P = {
  x: number; y: number
  lane: number; wob: number; freq: number; ph: number; sp: number
  st: 0 | 1 | 2                  // 0 storm · 1 accepted flight · 2 rejected
  t: number
  sx: number; sy: number         // flight start / reject velocity
  tx: number; ty: number
  bright: number
}

export function CorpusStormFig() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let W = 0
    let H = 0
    let raf = 0
    let running = false
    let visible = true
    let T = 0
    let found = 0

    // ---- layout (recomputed on resize) ----
    let gateX = 0, gateY = 0, gateR = 0
    let docX = 0, docY = 0, docW = 0, docH = 0
    let slots: Slot[] = []
    let filled = 0
    let lastLand = -10
    let stampT = -1                // ≥0 while the granted moment plays

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = wrap.clientWidth
      H = wrap.clientHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      gateX = W * 0.52
      gateY = H * 0.53
      gateR = Math.min(H * 0.14, 60)

      docW = Math.min(W * 0.24, 220)
      docH = Math.min(H * 0.74, 400)
      docX = Math.min(W * 0.7, W - docW - 16)
      docY = (H - docH) / 2

      // Typeset slots: ragged rows of 2–4 segments, claim-style indents.
      slots = []
      const inX = docX + 18
      const inW = docW - 36
      const top = docY + 52
      const bottom = docY + docH - 46
      let row = 0
      for (let y = top; y <= bottom; y += 13, row++) {
        const indent = row % 5 === 3 ? 12 : 0
        const widths = row % 5 === 4
          ? [0.34, 0.22, 0.18]
          : [0.26, 0.2, 0.24, 0.16]
        let x = inX + indent
        for (const f of widths) {
          const w = f * (inW - indent)
          if (x + w > inX + inW) break
          slots.push({ x, y, w })
          x += w + 5
        }
      }
      filled = Math.min(filled, slots.length)

      ctx.fillStyle = NIGHT
      ctx.fillRect(0, 0, W, H)
    }

    // ---- particles ----
    const N = reduce ? 500 : Math.max(600, Math.min(1600, Math.round((wrap.clientWidth * wrap.clientHeight) / 650)))
    const ps: P[] = []
    const spawn = (p: P, anywhere = false) => {
      p.x = anywhere ? -40 + Math.random() * (wrap.clientWidth * 0.55) : -40 - Math.random() * 80
      p.lane = (Math.random() - 0.5) * wrap.clientHeight * 0.86
      p.wob = 5 + Math.random() * 12
      p.freq = 0.5 + Math.random() * 1.3
      p.ph = Math.random() * Math.PI * 2
      p.sp = 0.35 + Math.random() * 0.5
      p.st = 0
      p.t = 0
      p.bright = 0.35 + Math.random() * 0.6
      p.y = 0
    }
    for (let i = 0; i < N; i++) {
      const p = { x: 0, y: 0, lane: 0, wob: 0, freq: 0, ph: 0, sp: 0, st: 0, t: 0, sx: 0, sy: 0, tx: 0, ty: 0, bright: 1 } as P
      spawn(p, true)
      ps.push(p)
    }

    const step = (dt: number) => {
      T += dt
      for (const p of ps) {
        if (p.st === 0) {
          const d = Math.max(0, Math.min(1, (gateX - p.x) / (gateX + 40)))
          const shrink = 0.16 + 0.84 * d
          p.x += p.sp * (1 + (1 - d) * 1.7) * dt * 60
          p.y = gateY + p.lane * shrink + Math.sin(T * p.freq + p.ph) * p.wob * shrink
          if (p.x >= gateX) {
            const off = p.y - gateY
            if (Math.abs(off) < gateR * 0.8 && filled < slots.length && stampT < 0 && Math.random() < 0.5) {
              p.st = 1
              p.t = 0
              p.sx = p.x
              p.sy = p.y
              const s = slots[filled]
              p.tx = s.x + s.w
              p.ty = s.y
            } else {
              p.st = 2
              p.t = 0
              p.sx = 1.1 + Math.random() * 0.8
              p.sy = Math.sign(off || 1) * (1.1 + Math.random() * 1.2)
            }
          }
        } else if (p.st === 1) {
          p.t += dt * 1.4
          const k = Math.min(1, p.t)
          const e = k * k * (3 - 2 * k)
          p.x = p.sx + (p.tx - p.sx) * e
          p.y = p.sy + (p.ty - p.sy) * e - Math.sin(k * Math.PI) * 26
          if (k >= 1) {
            if (filled < slots.length) {
              filled++
              found++
              lastLand = T
              if (filled >= slots.length) stampT = 0
            }
            spawn(p)
          }
        } else {
          p.t += dt
          p.x += p.sx * dt * 60
          p.y += p.sy * dt * 60
          if (p.t > 1.1 || p.x > W + 30 || p.y < -30 || p.y > H + 30) spawn(p)
        }
      }
      if (stampT >= 0) {
        stampT += dt
        if (stampT > 3.2) {        // fresh sheet
          filled = 0
          stampT = -1
        }
      }
    }

    // ---- drawing ----
    const drawField = (px: number, py: number) => {
      ctx.save()
      ctx.translate(px * 6, py * 4)
      for (const p of ps) {
        if (p.st === 1) {
          const k = Math.min(1, p.t)
          ctx.fillStyle = LAMP_LIT
          ctx.globalAlpha = 0.55 + 0.45 * k
          ctx.beginPath()
          ctx.arc(p.x, p.y, 1.6 + 0.7 * k, 0, 6.284)
          ctx.fill()
        } else {
          const fade = p.st === 2 ? Math.max(0, 1 - p.t) : 1
          ctx.fillStyle = '#7c9cc4'
          ctx.globalAlpha = 0.5 * p.bright * fade
          ctx.beginPath()
          ctx.arc(p.x, p.y, 0.9 + p.bright, 0, 6.284)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }

    const drawGate = (px: number, py: number) => {
      ctx.save()
      ctx.translate(gateX + px * 2, gateY + py * 2)
      const pulse = 1 + 0.03 * Math.sin(T * 2)
      ctx.strokeStyle = BRASS_LIT
      ctx.globalAlpha = 0.22
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(0, 0, gateR * pulse, 0, 6.284)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.arc(0, 0, gateR * pulse, 0, 6.284)
      ctx.stroke()
      ctx.rotate(T * 0.25)
      ctx.lineWidth = 1.6
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4)
        ctx.beginPath()
        ctx.moveTo(gateR * pulse + 3, 0)
        ctx.lineTo(gateR * pulse + 9, 0)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawDoc = (px: number, py: number) => {
      ctx.save()
      ctx.translate(px * -3, py * -2)

      ctx.fillStyle = PAPER
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(docX, docY, docW, docH, 6)
      ctx.fill()
      ctx.stroke()

      // pre-printed header: title bar + rule
      ctx.fillStyle = INK
      ctx.fillRect(docX + 18, docY + 20, docW * 0.46, 3.5)
      ctx.fillStyle = SOFT
      ctx.fillRect(docX + 18, docY + 30, docW * 0.3, 2.5)
      ctx.strokeStyle = 'rgba(30,41,59,0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(docX + 18, docY + 42)
      ctx.lineTo(docX + docW - 18, docY + 42)
      ctx.stroke()

      // typeset lines — the newest flashes lamp before settling into ink
      for (let i = 0; i < filled; i++) {
        const s = slots[i]
        const isNew = i === filled - 1 && T - lastLand < 0.45
        ctx.fillStyle = isNew ? LAMP_LIT : INK
        ctx.globalAlpha = isNew ? 1 : 0.82
        ctx.fillRect(s.x, s.y, s.w, 2.4)
      }
      ctx.globalAlpha = 1

      // the granted moment
      if (stampT >= 0) {
        const k = Math.min(1, stampT * 2.4)
        const cx = docX + 34
        const cy = docY + docH - 26
        ctx.strokeStyle = BRASS
        ctx.lineWidth = 1.8
        ctx.globalAlpha = k
        ctx.beginPath()
        ctx.arc(cx, cy, 13, 0, 6.284)
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.arc(cx, cy, 8.5, 0, 6.284)
        ctx.stroke()
        ctx.setLineDash([])

        const sc = 1 + (1 - k) * 0.9
        ctx.translate(docX + docW - 62, docY + docH - 26)
        ctx.rotate(-0.09)
        ctx.scale(sc, sc)
        ctx.strokeStyle = WAX
        ctx.lineWidth = 1.6
        ctx.strokeRect(-44, -12, 92, 24)
        ctx.fillStyle = WAX
        ctx.font = '600 11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('GRANTED', 2, 1)
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }

    let px = 0, py = 0
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect()
      px = ((e.clientX - r.left) / r.width) * 2 - 1
      py = ((e.clientY - r.top) / r.height) * 2 - 1
    }
    const onLeave = () => { px = 0; py = 0 }

    const frame = () => {
      step(1 / 60)
      ctx.fillStyle = TRAIL
      ctx.fillRect(0, 0, W, H)
      drawField(px, py)
      drawGate(px, py)
      drawDoc(px, py)
      if (countRef.current) countRef.current.textContent = found.toLocaleString()
      if (running) raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (running || reduce || !visible || document.hidden) return
      running = true
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    layout()

    if (reduce) {
      // A single composed still: mid-storm, page two-thirds set.
      for (let k = 0; k < 500; k++) step(1 / 60)
      filled = Math.floor(slots.length * 0.66)
      found = 214
      ctx.fillStyle = NIGHT
      ctx.fillRect(0, 0, W, H)
      drawField(0, 0)
      drawGate(0, 0)
      drawDoc(0, 0)
      if (countRef.current) countRef.current.textContent = found.toLocaleString()
    } else {
      start()
    }

    const ro = new ResizeObserver(() => layout())
    ro.observe(wrap)
    const io = new IntersectionObserver(([en]) => {
      visible = !!en?.isIntersecting
      if (visible) start()
      else stop()
    }, { threshold: 0.05 })
    io.observe(wrap)
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerleave', onLeave)

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      className="relative h-[420px] w-full overflow-hidden rounded-xl sm:h-[480px]"
      style={{ background: NIGHT }}
      role="img"
      aria-label="Thirty million prior-art documents stream as points of light through a brass relevance gate; the few that matter turn green and land on a paper page as typeset lines — when the page fills, it is stamped granted and a fresh sheet begins"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <p className="pointer-events-none absolute left-4 top-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[#7c9cc4] sm:left-6">
        30M+ prior art
      </p>
      <p className="pointer-events-none absolute left-[52%] top-4 -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#b3924a]">
        the relevance gate
      </p>
      <p className="pointer-events-none absolute right-4 top-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[#c9c1ab] sm:right-6">
        your application
      </p>
      <p className="pointer-events-none absolute bottom-4 left-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[#5fa37f] sm:left-6">
        relevant found · <span ref={countRef}>0</span>
      </p>
      <p className="pointer-events-none absolute bottom-4 right-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[#5a6a84] sm:right-6">
        every dot · one document
      </p>
    </div>
  )
}
