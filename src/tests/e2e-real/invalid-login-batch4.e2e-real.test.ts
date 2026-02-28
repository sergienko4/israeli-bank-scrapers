import { createScraper, CompanyTypes } from '../../index';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertFailedLogin } from './helpers';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Amex (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.amex,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
      defaultTimeout: 60000,
    });
    const result = await scraper.scrape({ id: '000000000', card6Digits: '000000', password: 'InvalidPass1' });
    assertFailedLogin(result);
  });
});

describe('E2E: VisaCal (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.visaCal,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Discount (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.discount,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});
