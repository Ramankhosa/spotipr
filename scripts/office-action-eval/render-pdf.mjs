import { createCanvas } from '@napi-rs/canvas'
import { readFileSync, writeFileSync } from 'fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const [src, outDir, pagesArg = '1'] = process.argv.slice(2)
const data = new Uint8Array(readFileSync(src))
const doc = await pdfjs.getDocument({ data, disableWorker: true, useSystemFonts: true }).promise

const canvasFactory = {
  create: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') } },
  reset: (cc, w, h) => { cc.canvas.width = w; cc.canvas.height = h },
  destroy: (cc) => { cc.canvas.width = 0; cc.canvas.height = 0 }
}

for (const pn of pagesArg.split(',').map(Number)) {
  const page = await doc.getPage(pn)
  const viewport = page.getViewport({ scale: 2.0 })
  const canvas = createCanvas(viewport.width, viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, viewport.width, viewport.height)
  await page.render({ canvasContext: ctx, viewport, canvasFactory }).promise
  const out = `${outDir}/page-${pn}.png`
  writeFileSync(out, canvas.toBuffer('image/png'))
  console.log('wrote', out, `${Math.round(viewport.width)}x${Math.round(viewport.height)}`)
}
