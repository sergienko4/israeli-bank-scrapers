import { CompanyTypes, createScraper } from '../../index';
import { assertFailedLogin, BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Otsar Hahayal (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.OtsarHahayal,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Beinleumi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Mercantile (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Mercantile,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});

describe('E2E: Massad (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Massad,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
