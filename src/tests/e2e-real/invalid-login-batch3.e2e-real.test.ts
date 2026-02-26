import { createScraper, CompanyTypes } from '../../index';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertFailedLogin } from './helpers';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe('E2E: Yahav (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.yahav,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: 'INVALID_USER',
      nationalID: '000000000',
      password: 'invalid123',
    });
    assertFailedLogin(result);
  });
});

describe('E2E: Beyahad Bishvilha (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beyahadBishvilha,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Behatsdaa (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.behatsdaa,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: Pagi (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.pagi,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});

describe('E2E: One Zero (invalid login)', () => {
  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.oneZero,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      email: 'invalid@example.com',
      password: 'invalid123',
      otpLongTermToken: 'invalid-token',
    });
    assertFailedLogin(result);
  });
});
