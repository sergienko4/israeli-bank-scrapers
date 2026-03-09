/** Selector-fallback: Mizrahi — Round 2 (wrong CSS id → fallback CSS id). */

import { jest } from '@jest/globals';

import { waitUntilElementDisappear } from '../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/LoginConfig.js';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers.js';

const ERR = selectorErrorFor('username', 'password');

const BASE_CFG: ILoginConfig = {
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
  /**
   * Wait for the loading overlay to disappear.
   * @param page - page to check readiness
   * @returns true when ready
   */
  checkReadiness: async page => {
    await waitUntilElementDisappear(page, 'div.ngx-overlay.loading-foreground');
  },
  /**
   * Wait after form submission.
   * @param page - page for post-action
   * @returns true when done
   */
  postAction: async page => {
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
