import { type Frame, type Page } from 'playwright';
import { waitUntil } from './waiting';

export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

interface WaitForOptions {
  waitUntil?: WaitUntilState;
  timeout?: number;
}

export async function waitForNavigation(pageOrFrame: Page | Frame, options?: WaitForOptions): Promise<void> {
  await pageOrFrame.waitForNavigation(options);
}

export async function waitForNavigationAndDomLoad(page: Page): Promise<void> {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
}

export function getCurrentUrl(pageOrFrame: Page | Frame, clientSide = false): Promise<string> | string {
  if (clientSide) {
    return pageOrFrame.evaluate(() => window.location.href);
  }

  return pageOrFrame.url();
}

export interface WaitForRedirectOptions {
  timeout?: number;
  clientSide?: boolean;
  ignoreList?: string[];
}

export async function waitForRedirect(pageOrFrame: Page | Frame, opts: WaitForRedirectOptions = {}): Promise<void> {
  const { timeout = 20000, clientSide = false, ignoreList = [] } = opts;
  const initial = await getCurrentUrl(pageOrFrame, clientSide);

  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, clientSide);
      return current !== initial && !ignoreList.includes(current);
    },
    `waiting for redirect from ${initial}`,
    { timeout, interval: 1000 },
  );
}

export interface WaitForUrlOptions {
  timeout?: number;
  clientSide?: boolean;
}

export async function waitForUrl(pageOrFrame: Page | Frame, url: string | RegExp, opts: WaitForUrlOptions = {}): Promise<void> {
  const { timeout = 20000, clientSide = false } = opts;
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, clientSide);
      return url instanceof RegExp ? url.test(current) : url === current;
    },
    `waiting for url to be ${url}`,
    { timeout, interval: 1000 },
  );
}
