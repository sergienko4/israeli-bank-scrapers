import { jest } from '@jest/globals';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  INVALID_CREDS_DISCOUNT,
  INVALID_CREDS_ISRACARD_AMEX,
  INVALID_CREDS_USERNAME_PASSWORD,
} from '../TestConstants.js';
import { assertFailedLogin, BROWSER_ARGS, defaultStartDate, SCRAPE_TIMEOUT } from './Helpers.js';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Amex (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      defaultTimeout: 60000,
    });
    const result = await scraper.scrape(INVALID_CREDS_ISRACARD_AMEX);
    assertFailedLogin(result);
  });
});

describe('E2E: VisaCal (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.VisaCal,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});

describe('E2E: Discount (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_DISCOUNT);
    assertFailedLogin(result);
  });
});
