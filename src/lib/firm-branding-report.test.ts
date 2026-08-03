import { describe, expect, it } from 'vitest';
import { buildNoveltyAttorneyReportModel, formatFirmAddressLines, type FirmBranding } from './novelty-attorney-report';

const baseRun = {
  id: 'firm-brand-search',
  title: 'Autonomous inspection controller',
  jurisdiction: 'IN',
  inventionDescription: 'An autonomous controller uses anomaly inference feedback.',
  config: { searchSource: { mode: 'LOCAL_CORPUS', filters: {} } },
  stage0Results: { searchQuery: 'autonomous controller', inventionFeatures: ['autonomous control loop'] },
  stage1Results: {},
  stage35Results: {},
  stage4Results: { confidence: 'Low' },
};

describe('novelty report firm branding', () => {
  it('describes the LOCAL_CORPUS mode as the global 55M+ corpus, not the raw identifier', () => {
    const model = buildNoveltyAttorneyReportModel(baseRun);
    expect(model.methodology.corpus).toContain('55M+');
    expect(model.methodology.corpus).not.toContain('LOCAL_CORPUS');
  });

  it('defaults preparedBy to PatentNest when no firm is supplied', () => {
    const model = buildNoveltyAttorneyReportModel(baseRun);
    expect(model.preparedBy).toBe('PatentNest.ai Patent Intelligence');
    expect(model.firm).toBeUndefined();
    expect(model.showPoweredBy).toBe(true);
  });

  it('uses the firm name and accent when a firm profile is supplied', () => {
    const firm: FirmBranding = {
      firmName: 'Meridian IP Associates',
      accentColor: '#0F766E',
      showPoweredBy: false,
      city: 'Bengaluru',
      state: 'KA',
      countryCode: 'IN',
      addressLine1: '4th Floor, Prestige Tower',
    };
    const model = buildNoveltyAttorneyReportModel(baseRun, firm);
    expect(model.preparedBy).toBe('Meridian IP Associates');
    expect(model.firm?.firmName).toBe('Meridian IP Associates');
    expect(model.accentColor).toBe('#0F766E');
    expect(model.showPoweredBy).toBe(false);
  });
});

describe('formatFirmAddressLines', () => {
  it('composes address, city/state/postal, and country into ordered lines', () => {
    const lines = formatFirmAddressLines({
      firmName: 'X',
      addressLine1: 'Suite 100',
      addressLine2: 'Innovation Park',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      countryCode: 'IN',
    });
    expect(lines).toEqual(['Suite 100', 'Innovation Park', 'Pune, MH, 411001', 'IN']);
  });

  it('omits empty segments', () => {
    const lines = formatFirmAddressLines({ firmName: 'X', city: 'Delhi' });
    expect(lines).toEqual(['Delhi']);
  });
});
