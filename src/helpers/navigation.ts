import { type Frame, type Page } from 'playwright';
import { waitUntil } from './Waiting';

export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

interface WaitForOptions {
  waitUntil?: WaitUntilState;
  timeout?: number;
}

export async function waitForNavigation(
  pageOrFrame: Page | Frame,
  options?: WaitForOptions,
): Promise<void> {
  await pageOrFrame.waitForNavigation(options);
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

export interface WaitForRedirectOptions {
  timeout?: number;
  isClientSide?: boolean;
  ignoreList?: string[];
}

export async function waitForRedirect(
  pageOrFrame: Page | Frame,
  opts: WaitForRedirectOptions = {},
): Promise<void> {
  const { timeout = 20000, isClientSide = false, ignoreList = [] } = opts;
  const initial = await getCurrentUrl(pageOrFrame, isClientSide);

  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, isClientSide);
      return current !== initial && !ignoreList.includes(current);
    },
    `waiting for redirect from ${initial}`,
    { timeout, interval: 1000 },
  );
}

export interface WaitForUrlOptions {
  timeout?: number;
  isClientSide?: boolean;
}

export async function waitForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: WaitForUrlOptions = {},
): Promise<void> {
  const { timeout = 20000, isClientSide = false } = opts;
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, isClientSide);
      return url instanceof RegExp ? url.test(current) : url === current;
    },
    `waiting for url to be ${url}`,
    { timeout, interval: 1000 },
  );
}
