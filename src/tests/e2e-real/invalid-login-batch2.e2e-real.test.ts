import { createScraper, CompanyTypes } from '../../index';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertFailedLogin } from './helpers';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Otsar Hahayal (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.otsarHahayal,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Union Bank (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.union,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Beinleumi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Mercantile (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.mercantile,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});

describe('E2E: Massad (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.massad,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
