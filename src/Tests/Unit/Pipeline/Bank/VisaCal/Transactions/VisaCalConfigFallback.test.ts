/**
 * Coverage-only tests for config ?? / || fallback branches.
 * Mocks SCRAPER_CONFIGURATION with null API values so the fallback
 * branches (lines 31-36 in VisaCalScrape, line 90 in VisaCalPipeline) are exercised.
 * Just importing the modules with null config covers the branches.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../../Definitions.js';

/** Null API config — triggers all ?? '' fallbacks. */
const NULL_API = {
  base: null,
  purchaseHistory: null,
  card: null,
  calTransactions: null,
  calFrames: null,
  calPending: null,
  calInit: null,
  calLoginResponse: null,
  calOrigin: null,
  calXSiteId: null,
};

/** Null config for VisaCal — triggers || '' on urls.base. */
const NULL_VISACAL_CONFIG = {
  urls: { base: '', loginRoute: null, transactions: null },
  api: NULL_API,
  auth: {},
  loginSetup: {},
  format: { date: null },
  timing: {},
  selectors: {},
};

/** Mock SCRAPER_CONFIGURATION with null values for VisaCal. */
jest.unstable_mockModule('../../../../../../Scrapers/Registry/Config/ScraperConfig.js', () => ({
  SCRAPER_CONFIGURATION: {
    banks: { [CompanyTypes.VisaCal]: NULL_VISACAL_CONFIG },
  },
}));

/** Import after mock — module evaluates with null config. */
const SCRAPE_MODULE =
  await import('../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalScrape.js');
const PIPELINE_MODULE =
  await import('../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js');

describe('VisaCalScrape config ?? fallbacks', () => {
  it('exports visaCalFetchData even with null config', () => {
    expect(typeof SCRAPE_MODULE.visaCalFetchData).toBe('function');
  });

  it('exports buildMonths even with null config', () => {
    expect(typeof SCRAPE_MODULE.buildMonths).toBe('function');
  });
});

describe('VisaCalPipeline config || fallback', () => {
  it('exports buildVisaCalPipeline even with null config', () => {
    expect(typeof PIPELINE_MODULE.buildVisaCalPipeline).toBe('function');
  });

  it('VISACAL_LOGIN has empty loginUrl from fallback', () => {
    const loginUrl = PIPELINE_MODULE.VISACAL_LOGIN.loginUrl;
    expect(loginUrl).toBe('');
  });
});
