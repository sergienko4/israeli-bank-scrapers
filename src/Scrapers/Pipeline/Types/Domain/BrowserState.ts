import type { BrowserContext, Page } from 'playwright-core';

import type { Procedure } from '../Procedure.js';

/** Cleanup handler return type — side-effect only, no payload. */
type CleanupResult = Procedure<void>;

/** Browser lifecycle context — absent for API-only scrapers. */
interface IBrowserState {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly cleanups: readonly (() => Promise<CleanupResult>)[];
}

export type { CleanupResult, IBrowserState };
