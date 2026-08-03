import { describe, expect, it } from 'vitest';
import { firmProfileSchema, isValidLogoDataUri } from './route';

describe('firmProfileSchema', () => {
  it('accepts a minimal profile and defaults showPoweredBy to true', () => {
    const parsed = firmProfileSchema.safeParse({ firmName: 'Meridian IP' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.showPoweredBy).toBe(true);
  });

  it('rejects a firm name shorter than 2 characters', () => {
    expect(firmProfileSchema.safeParse({ firmName: 'A' }).success).toBe(false);
  });

  it('treats blank optional fields as absent', () => {
    const parsed = firmProfileSchema.safeParse({
      firmName: 'Meridian IP',
      phone: '',
      email: '',
      website: '',
      accentColor: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBeUndefined();
      expect(parsed.data.accentColor).toBeUndefined();
    }
  });

  it('rejects a non-hex accent color and accepts #RRGGBB', () => {
    expect(firmProfileSchema.safeParse({ firmName: 'Acme IP', accentColor: 'blue' }).success).toBe(false);
    expect(firmProfileSchema.safeParse({ firmName: 'Acme IP', accentColor: '#1D4ED8' }).success).toBe(true);
  });

  it('requires E.164 phone format', () => {
    expect(firmProfileSchema.safeParse({ firmName: 'Acme IP', phone: '9812345678' }).success).toBe(false);
    expect(firmProfileSchema.safeParse({ firmName: 'Acme IP', phone: '+919812345678' }).success).toBe(true);
  });

  it('rejects an SVG logo and accepts a small PNG data URI', () => {
    expect(firmProfileSchema.safeParse({ firmName: 'Acme IP', logoDataUri: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }).success).toBe(false);
    expect(firmProfileSchema.safeParse({ firmName: 'Acme IP', logoDataUri: 'data:image/png;base64,AAAABBBB' }).success).toBe(true);
  });
});

describe('isValidLogoDataUri', () => {
  it('rejects a logo larger than 500KB', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(700_000)}`; // ~525KB decoded
    expect(isValidLogoDataUri(oversized)).toBe(false);
  });

  it('allows an undefined logo (optional)', () => {
    expect(isValidLogoDataUri(undefined)).toBe(true);
  });
});
