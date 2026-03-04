import { type Frame, type Page } from 'playwright';

import type { WaitForRedirectOptions } from '../Interfaces/Common/WaitForRedirectOptions';
import type { WaitForUrlOptions } from '../Interfaces/Common/WaitForUrlOptions';
import type { WaitUntilState } from '../Interfaces/Common/WaitUntilState';
import { getDebug } from './Debug';
import { waitUntil } from './Waiting';

export type { WaitForRedirectOptions } from '../Interfaces/Common/WaitForRedirectOptions';
export type { WaitForUrlOptions } from '../Interfaces/Common/WaitForUrlOptions';
export type { WaitUntilState } from '../Interfaces/Common/WaitUntilState';

const LOG = getDebug('navigation');

interface WaitForOptions {
  waitUntil?: WaitUntilState;
  timeout?: number;
}

export async function waitForNavigation(
  pageOrFrame: Page | Frame,
  options?: WaitForOptions,
): Promise<void> {
  await pageOrFrame.waitForURL('**', options);
}

export async function waitForNavigationAndDomLoad(page: Page): Promise<void> {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
}

export function getCurrentUrl(
  pageOrFrame: Page | Frame,
  isClientSide = false,
): Promise<string> | string {
  if (isClientSide) {
    return pageOrFrame.evaluate(() => window.location.href);
  }

  return pageOrFrame.url();
}

async function safeGetUrl(pageOrFrame: Page | Frame, isClientSide: boolean): Promise<string> {
  try {
    return await getCurrentUrl(pageOrFrame, isClientSide);
  } catch {
    return '?';
  }
}

async function pollForRedirect(
  pageOrFrame: Page | Frame,
  initial: string,
  opts: { isClientSide: boolean; ignoreList: string[]; timeout: number },
): Promise<void> {
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, opts.isClientSide);
      return current !== initial && !opts.ignoreList.includes(current);
    },
    `waiting for redirect from ${initial}`,
    { timeout: opts.timeout, interval: 1000 },
  );
}

export async function waitForRedirect(
  pageOrFrame: Page | Frame,
  opts: WaitForRedirectOptions = {},
): Promise<void> {
  const { timeout = 20000, isClientSide = false, ignoreList = [] } = opts;
  const initial = await getCurrentUrl(pageOrFrame, isClientSide);
  LOG.info('waitForRedirect from %s', initial);
  try {
    await pollForRedirect(pageOrFrame, initial, { isClientSide, ignoreList, timeout });
  } catch (e) {
    LOG.info(
      'waitForRedirect TIMEOUT (%dms) — still at %s',
      timeout,
      await safeGetUrl(pageOrFrame, isClientSide),
    );
    throw e;
  }
  LOG.info('waitForRedirect → %s', await safeGetUrl(pageOrFrame, isClientSide));
}

async function pollForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: { timeout: number; isClientSide: boolean },
): Promise<void> {
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, opts.isClientSide);
      return url instanceof RegExp ? url.test(current) : url === current;
    },
    `waiting for url to be ${url}`,
    { timeout: opts.timeout, interval: 1000 },
  );
}

export async function waitForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: WaitForUrlOptions = {},
): Promise<void> {
  const { timeout = 20000, isClientSide = false } = opts;
  try {
    await pollForUrl(pageOrFrame, url, { timeout, isClientSide });
  } catch (e) {
    const stuck = await safeGetUrl(pageOrFrame, isClientSide);
    LOG.info('waitForUrl TIMEOUT (%dms) pattern=%s at %s', timeout, url, stuck);
    throw e;
  }
}
