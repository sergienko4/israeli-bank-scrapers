import { jest } from '@jest/globals';

import { CompanyTypes, createScraper } from '../../index.js';
import { assertFailedLogin, BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Hapoalim (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ userCode: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Leumi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Leumi,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Mizrahi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Mizrahi,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Max (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Max,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Isracard (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: '000000000',
      card6Digits: '000000',
      password: 'invalid123',
    });
    assertFailedLogin(result);
  });
});
