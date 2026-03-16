import type { Frame, Page } from 'playwright-core';

import { waitUntilIframeFound } from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import type { ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../../Registry/WellKnownSelectors.js';
import {
  CONNECT_IFRAME_OPTS,
  hasChangePasswordForm,
  hasInvalidPasswordError,
  isConnectFrame,
} from '../VisaCalHelpers.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/**
 * Wait for the VisaCal login button to appear on the page.
 * @param page - The Playwright page instance.
 * @returns True when the login button is found.
 */
async function visaCalCheckReadiness(page: Page): LifecyclePromise {
  const candidates = WELL_KNOWN_DASHBOARD_SELECTORS.loginLink.filter(c => c.kind === 'textContent');
  const waiters = candidates.map(c =>
    page.getByText(c.value).first().waitFor({ state: 'visible', timeout: 15000 }),
  );
  try {
    await Promise.any(waiters);
  } catch (error: unknown) {
    if (error instanceof AggregateError) {
      throw new ScraperError('No VisaCal login link found among candidates', { cause: error });
    }
    throw error;
  }
}

/**
 * Open the VisaCal login popup and navigate to the login form inside the iframe.
 * @param page - The Playwright page instance.
 * @returns The iframe Frame containing the login form.
 */
async function visaCalOpenLoginPopup(page: Page): Promise<Frame> {
  const loginCandidates = WELL_KNOWN_DASHBOARD_SELECTORS.loginLink.filter(
    c => c.kind === 'textContent',
  );
  const loginTexts = loginCandidates.map(c => c.value);
  await clickFirstLoginText(page, loginTexts);
  const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_OPTS);
  await clickFirstLoginText(frame, loginTexts);
  return frame;
}

/**
 * Click the first visible login text from a list of candidates.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param texts - The candidate texts to search for.
 * @returns True when a match is clicked.
 */
async function clickFirstLoginText(ctx: Page | Frame, texts: string[]): Promise<boolean> {
  const locators = texts.map(t => {
    const loc = ctx.getByText(t);
    return loc.first();
  });
  const waitForVisible = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: 30000 });
    return i;
  });
  const idx = await Promise.any(waitForVisible);
  await locators[idx].click();
  return true;
}

/**
 * Wait for VisaCal post-login navigation to complete.
 * @param page - The Playwright page instance.
 * @returns True when post-login navigation completes.
 */
async function visaCalPostAction(page: Page): LifecyclePromise {
  const isAlreadyLoggedIn = page.url().includes('cal-online.co.il/#');
  if (!isAlreadyLoggedIn) {
    await waitForNavigation(page);
  }
}

/** Declarative login configuration for VisaCal. */
export const VISACAL_LOGIN_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'css', value: 'button[type="submit"]' }],
  checkReadiness: visaCalCheckReadiness,
  preAction: visaCalOpenLoginPopup,
  postAction: visaCalPostAction,
  possibleResults: {
    success: [/dashboard/i, /cal-online\.co\.il\/#/],
    invalidPassword: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        opts?.page ? hasInvalidPasswordError(opts.page) : false,
    ],
    changePassword: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        opts?.page ? hasChangePasswordForm(opts.page) : false,
    ],
  },
};

export default VISACAL_LOGIN_CONFIG;
