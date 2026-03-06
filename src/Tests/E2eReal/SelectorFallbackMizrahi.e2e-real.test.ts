/** Selector-fallback: Mizrahi — Round 2 (wrong CSS id → fallback CSS id). */
import { waitUntilElementDisappear } from '../../Common/ElementsInteractions';
import { CompanyTypes } from '../../Definitions';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { type LoginConfig } from '../../Scrapers/Base/LoginConfig';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers';

const ERR = selectorErrorFor('username', 'password');

const BASE_CFG: LoginConfig = {
  loginUrl: 'https://www.mizrahi-tefahot.co.il/login/index.html#/auth-page-he',
  fields: [
    {
      credentialKey: 'username',
      selectors: [
        { kind: 'css', value: '#WRONG_userNumberDesktopHeb' },
        { kind: 'css', value: '#userNumberDesktopHeb' },
      ],
    },
    {
      credentialKey: 'password',
      selectors: [
        { kind: 'css', value: '#WRONG_passwordDesktopHeb' },
        { kind: 'css', value: '#passwordDesktopHeb' },
      ],
    },
  ],
  submit: [
    { kind: 'css', value: '#WRONG_btnPrimary' },
    { kind: 'css', value: 'button.btn.btn-primary' },
  ],
  checkReadiness:
    /**
     * Waits for the Mizrahi loading overlay to disappear before filling inputs.
     *
     * @param page - the Playwright page to wait on
     */
    async page => {
      await waitUntilElementDisappear(page, 'div.ngx-overlay.loading-foreground');
    },
  postAction:
    /**
     * Waits briefly after login submission to allow page navigation to complete.
     *
     * @param page - the Playwright page to wait on
     */
    async page => {
      await page.waitForTimeout(5000);
    },
  possibleResults: {
    success: [/https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/i],
    invalidPassword: [/a\[href\*="sc\.mizrahi/],
    changePassword: [/\/change-pass/],
  },
};

describe('E2E: Selector fallback — Mizrahi', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 2 — wrong CSS id → fallback CSS id → form reached', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Mizrahi,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      BASE_CFG,
    ).scrape({ username: 'INVALID_USER', password: 'FallbackTestMZR' } as {
      username: string;
      password: string;
    });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });
});
