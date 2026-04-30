import { jest } from '@jest/globals';

import { CompanyTypes, createScraper } from '../../index.js';
import { INVALID_CREDS_DISCOUNT, INVALID_CREDS_USERNAME_PASSWORD } from '../TestConstants.js';
import { assertFailedLogin, BROWSER_ARGS, defaultStartDate, SCRAPE_TIMEOUT } from './Helpers.js';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Otsar Hahayal (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.OtsarHahayal,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});

describe('E2E: Beinleumi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});

describe('E2E: Mercantile (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Mercantile,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_DISCOUNT);
    assertFailedLogin(result);
  });
});

describe('E2E: Massad (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Massad,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});
