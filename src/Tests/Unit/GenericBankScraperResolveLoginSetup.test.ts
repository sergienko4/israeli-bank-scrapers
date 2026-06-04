import { jest } from '@jest/globals';

import { type ILoginConfig, type ILoginSetup } from '../../Scrapers/Base/Config/LoginConfig.js';
import {
  type IScraperScrapingResult,
  type ScraperCredentials,
} from '../../Scrapers/Base/Interface.js';

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug to silence warn() calls during tests.
   * @returns Mocked module.
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns Mock logger.
       */
      (): Record<string, jest.Mock> => ({
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    /**
     * Passthrough mock for bank context.
     * @param _b - Bank name (unused).
     * @param fn - Function to execute.
     * @returns fn result.
     */
    runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
  }),
);

const { default: GENERIC_BANK_SCRAPER } = await import('../../Scrapers/Base/GenericBankScraper.js');
const { CompanyTypes: COMPANY_TYPES } = await import('../../Definitions.js');

const STUB_CONFIG: ILoginConfig = {
  loginUrl: 'https://stub.bank/login',
  fields: [],
  submit: { kind: 'css', value: '#submit' },
  possibleResults: { success: ['https://stub.bank/dashboard'] },
};

const CUSTOM_SETUP: ILoginSetup = {
  isApiOnly: true,
  hasOtpConfirm: true,
  hasOtpCode: false,
};

const DEFAULT_SETUP: ILoginSetup = {
  isApiOnly: false,
  hasOtpConfirm: false,
  hasOtpCode: false,
};

/**
 * Test subclass exposing the protected `resolveLoginSetup()` hook so
 * unit tests can assert both branches without driving the full login chain.
 */
class TestGenericScraper extends GENERIC_BANK_SCRAPER<ScraperCredentials> {
  /**
   * Expose the protected hook for direct assertion.
   * @returns The lookup result.
   */
  public exposeResolveLoginSetup(): ReturnType<TestGenericScraper['resolveLoginSetup']> {
    return this.resolveLoginSetup();
  }

  /**
   * Stub fetchData — never invoked in resolveLoginSetup tests.
   * @returns Empty success result.
   */
  public fetchData(): Promise<IScraperScrapingResult> {
    void this.loginConfig;
    return Promise.resolve({ success: true, accounts: [] });
  }
}

describe('GenericBankScraper.resolveLoginSetup', () => {
  it('returns loginConfig.loginSetup when explicitly provided', () => {
    const scraper = new TestGenericScraper(
      { companyId: COMPANY_TYPES.Discount, startDate: new Date('2024-01-01') },
      { ...STUB_CONFIG, loginSetup: CUSTOM_SETUP },
    );
    const lookup = scraper.exposeResolveLoginSetup();
    expect('loginSetup' in lookup).toBe(true);
    if ('loginSetup' in lookup) {
      expect(lookup.loginSetup).toEqual(CUSTOM_SETUP);
    }
  });

  it('falls back to SIMPLE_LOGIN default when loginConfig.loginSetup is undefined', () => {
    const scraper = new TestGenericScraper(
      { companyId: COMPANY_TYPES.Discount, startDate: new Date('2024-01-01') },
      STUB_CONFIG,
    );
    const lookup = scraper.exposeResolveLoginSetup();
    expect('loginSetup' in lookup).toBe(true);
    if ('loginSetup' in lookup) {
      expect(lookup.loginSetup).toEqual(DEFAULT_SETUP);
    }
  });

  it('never returns a failure (even for pipeline-only companyId)', () => {
    const scraper = new TestGenericScraper(
      { companyId: COMPANY_TYPES.Beinleumi, startDate: new Date('2024-01-01') },
      STUB_CONFIG,
    );
    const lookup = scraper.exposeResolveLoginSetup();
    expect('failure' in lookup).toBe(false);
  });
});
