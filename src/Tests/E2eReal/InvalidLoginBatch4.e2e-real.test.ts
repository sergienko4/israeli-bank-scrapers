import { CompanyTypes, createScraper } from '../../index';
import { assertFailedLogin, BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Amex (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      defaultTimeout: 60000,
    });
    const result = await scraper.scrape({
      id: '000000000',
      card6Digits: '000000',
      password: 'InvalidPass1',
    });
    assertFailedLogin(result);
  });
});

describe('E2E: VisaCal (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.VisaCal,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Discount (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});
