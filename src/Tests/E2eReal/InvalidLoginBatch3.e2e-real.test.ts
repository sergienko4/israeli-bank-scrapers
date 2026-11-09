import { jest } from '@jest/globals';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  INVALID_CREDS_ONEZERO,
  INVALID_CREDS_USERNAME_PASSWORD,
  INVALID_CREDS_YAHAV,
} from '../TestConstants.js';
import { assertFailedLogin, defaultStartDate, SCRAPE_TIMEOUT } from './Helpers.js';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Yahav (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Yahav,
      startDate: defaultStartDate(),
    });
    const result = await scraper.scrape(INVALID_CREDS_YAHAV);
    assertFailedLogin(result);
  });
});

describe('E2E: Pagi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Pagi,
      startDate: defaultStartDate(),
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});

describe('E2E: One Zero (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.OneZero,
      startDate: defaultStartDate(),
    });
    const result = await scraper.scrape(INVALID_CREDS_ONEZERO);
    assertFailedLogin(result);
  });
});
