// ============================================================================
// PatentNest "Cobalt & Oxford" palette — SINGLE SOURCE OF TRUTH for rebranding.
//
// The product's color system lives in exactly THREE places. To change the
// brand colors later, edit these — nothing else:
//
//   1. THIS FILE — every SVG figure, animated drawing, and inline style on
//      the marketing surfaces imports its colors from here.
//
//   2. tailwind.config.js — the named ramps `lamp` (brand/AI cobalt), `brass`
//      (quiet ceremony grays), `paper` (cool neutrals), `wax` (error red).
//      NOTE: `ai-blue` is a LEGACY ALIAS whose values mirror `lamp`
//      (~500 old call sites) — keep the two ramps identical when rebranding.
//
//   3. src/app/globals.css — the semantic HSL tokens (--background, --primary,
//      --secondary, …) that drive the authenticated app's chrome and ui/
//      primitives. Keep --primary in step with lamp-600.
//
// Known local copies (intentionally not centralized): ThemeLab.tsx and
// hero-variants' lab pages carry fixed comparison palettes; verdict/status
// colors (success green, warning amber, error red) are SEMANTIC and should
// not follow the brand.
// ============================================================================

/** Ink — primary line work and text in figures (= oxford ink, paper-950). */
export const INK = '#101828'
/** Soft — muted strokes, captions, leader lines (= paper-500). */
export const SOFT = '#98a2b3'
/** Brass — former gold ceremony, now quiet gray labels (= brass-600). */
export const BRASS = '#667085'
/** Lamp — the brand/AI cobalt (= lamp-600, = --primary). */
export const LAMP = '#1d4ed8'
/** Ledger blue — secondary blue lane; sits between lamp-500 and lamp-700. */
export const BLUE = '#1e40af'
/** Violet — drawings/figures stage family in journey art. */
export const VIOLET = '#5b4a8a'
/** Wax — error red: spec-writing stage, wax-600. */
export const WAX = '#b91c1c'
/** Page white — card/plate fill inside figures (= paper-50). */
export const PAPER = '#ffffff'
/** Desk — the page background, cool inset gray (= paper-100, = --muted). */
export const DESK = '#f7f8fa'
