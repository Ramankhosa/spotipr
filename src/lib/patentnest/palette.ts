// ============================================================================
// PatentNest "Banker's Green" palette — SINGLE SOURCE OF TRUTH for rebranding.
//
// The product's color system lives in exactly THREE places. To change the
// brand colors later, edit these — nothing else:
//
//   1. THIS FILE — every SVG figure, animated drawing, and inline style on
//      the marketing surfaces imports its colors from here.
//
//   2. tailwind.config.js — the named ramps `lamp` (brand/AI green), `brass`
//      (document ceremony), `paper` (warm neutrals), `wax` (warm red /
//      errors). NOTE: `ai-blue` is a LEGACY ALIAS whose values mirror `lamp`
//      (~500 old call sites) — keep the two ramps identical when rebranding.
//
//   3. src/app/globals.css — the semantic HSL tokens (--background, --primary,
//      --secondary, …) that drive the authenticated app's chrome and ui/
//      primitives. Keep --primary in step with lamp-600.
//
// Known local copies (intentionally not centralized): ThemeLab.tsx and
// hero-variants' lab pages carry fixed comparison palettes; verdict/status
// colors (success green, warning amber, brick red) are SEMANTIC and should
// not follow the brand.
// ============================================================================

/** Ink — primary line work and text in figures (≈ ai-graphite-800). */
export const INK = '#1e293b'
/** Soft — muted strokes, captions, leader lines (≈ ai-graphite-400). */
export const SOFT = '#94a3b8'
/** Brass — document ceremony: seals, section labels, gates (= brass-600). */
export const BRASS = '#8a6a1f'
/** Lamp — the brand/AI green (= lamp-600, = --primary). */
export const LAMP = '#2e5d47'
/** Ledger blue — the "pinch of blue": semantic/search lane accents. */
export const BLUE = '#31567e'
/** Violet — drawings/figures stage family in journey art. */
export const VIOLET = '#5b4a8a'
/** Sealing wax — warm red: spec-writing stage, wax-600. */
export const WAX = '#a03b25'
/** Page white — card/plate fill inside figures (= paper-50). */
export const PAPER = '#fdfcfa'
/** Greige desk — the page background (= paper-200, = --background). */
export const DESK = '#f0eee6'
