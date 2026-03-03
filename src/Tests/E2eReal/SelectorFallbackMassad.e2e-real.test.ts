/** Selector-fallback: Massad (FIBI MATAF portal) — Round 2 (wrong CSS id → fallback CSS id). */
import { CompanyTypes } from '../../Definitions';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { type LoginConfig } from '../../Scrapers/Base/LoginConfig';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers';

const ERR = selectorErrorFor('username', 'password');

const baseCfg: LoginConfig = {
  loginUrl:
    'https://online.bankmassad.co.il/MatafLoginService/MatafLoginServlet?bankId=MASADPRTAL&site=Private&KODSAFA=HE',
  fields: [
    {
      credentialKey: 'username',
      selectors: [
        { kind: 'css', value: '#WRONG_username' },
        { kind: 'css', value: '#username' },
      ],
    },
    {
      credentialKey: 'password',
      selectors: [
        { kind: 'css', value: '#WRONG_password' },
        { kind: 'css', value: '#password' },
      ],
    },
  ],
  submit: [
    { kind: 'css', value: '#WRONG_continueBtn' },
    { kind: 'css', value: '#continueBtn' },
  ],
  preAction: async page => {
    await page.waitForTimeout(1000);
    return undefined;
  },
  postAction: async page => {
    await Promise.race([
      page.waitForSelector('#card-header', { timeout: 15000 }),
      page.waitForSelector('#validationMsg', { timeout: 15000 }),
    ]).catch(() => {});
  },
  possibleResults: {
    success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/],
    invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
  },
};

describe('E2E: Selector fallback — Massad (FIBI MATAF portal)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 2 — wrong CSS id → fallback CSS id → form reached', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Massad,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      baseCfg,
    ).scrape({ username: 'INVALID_USER', password: 'FallbackTestMSD' } as {
      username: string;
      password: string;
    });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });
});
