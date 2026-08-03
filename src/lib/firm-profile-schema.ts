/**
 * Firm profile request validation (shared by the API route and its tests).
 *
 * Kept out of the route file because Next.js route modules may only export route
 * handlers and a fixed set of config fields — exporting a schema/helper from the route
 * fails the production build ("is not a valid Route export field").
 */

import { z } from 'zod'

export const MAX_LOGO_BYTES = 500 * 1024 // 500KB

// Treat blank strings from the form as "not provided" so optional validators don't fire.
const emptyToUndef = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

export function isValidLogoDataUri(value?: string): boolean {
  if (!value) return true
  const match = value.match(/^data:image\/(png|jpe?g);base64,(.+)$/i)
  if (!match) return false // SVG and other formats are rejected (PDFKit can't render them)
  try {
    const bytes = Buffer.from(match[2], 'base64')
    return bytes.length > 0 && bytes.length <= MAX_LOGO_BYTES
  } catch {
    return false
  }
}

export const firmProfileSchema = z.object({
  firmName: z.string().min(2, 'Firm name must be at least 2 characters').max(200, 'Firm name too long'),
  logoDataUri: z.preprocess(
    emptyToUndef,
    z.string().refine(isValidLogoDataUri, 'Logo must be a PNG or JPEG data URI under 500KB').optional()
  ),
  tagline: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  addressLine1: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  addressLine2: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  city: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  state: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  countryCode: z.preprocess(emptyToUndef, z.string().length(2, 'Country code must be 2 characters (ISO-2)').optional()),
  postalCode: z.preprocess(emptyToUndef, z.string().max(20).optional()),
  phone: z.preprocess(emptyToUndef, z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (+country code)').optional()),
  email: z.preprocess(emptyToUndef, z.string().email('Invalid email format').optional()),
  website: z.preprocess(emptyToUndef, z.string().url('Invalid website URL').optional()),
  accentColor: z.preprocess(emptyToUndef, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Accent color must be a #RRGGBB hex value').optional()),
  showPoweredBy: z.boolean().optional().default(true),
})
