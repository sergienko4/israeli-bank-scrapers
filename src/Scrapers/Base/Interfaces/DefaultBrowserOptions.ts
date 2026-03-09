import type { Browser } from 'playwright';

import type { LifecyclePromise } from './CallbackTypes.js';

export interface IDefaultBrowserOptions {
  /**
   * shows the browser while scraping, good for debugging (default false)
   */
  shouldShowBrowser?: boolean;

  /**
   * provide a path to local chromium to be used by playwright
   */
  executablePath?: string;

  /**
   * additional arguments to pass to the browser instance. The list of flags can be found in
   *
   * https://developer.mozilla.org/en-US/docs/Mozilla/Command_Line_Options
   * https://peter.sh/experiments/chromium-command-line-switches/
   */
  args?: string[];

  /**
   * Maximum navigation time in milliseconds, pass 0 to disable timeout.
   * @default 30000
   */
  timeout?: number;

  /**
   * Adjust the browser instance before it is being used.
   * @param browser - The Playwright Browser instance to configure.
   */
  prepareBrowser?: (browser: Browser) => LifecyclePromise;
}
