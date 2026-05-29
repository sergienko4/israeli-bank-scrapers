import type { Frame, Page } from 'playwright-core';

import type { Option } from '../Option.js';

/** Login phase result context. */
interface ILoginState {
  readonly activeFrame: Page | Frame;
  readonly persistentOtpToken: Option<string>;
  /**
   * URL captured at LOGIN.PRE entry — the page where credentials are
   * about to be submitted. Threaded forward through OTP-TRIGGER /
   * OTP-FILL emits (each phase carries the latest value on its own
   * slim contract). AUTH-DISCOVERY.FINAL reads the LATEST slot's
   * value to compare against the post-auth current URL (Mission M4.F1
   * dashboard gate). Empty string ⇒ test / mock paths only.
   */
  readonly urlBeforeSubmit: string;
}

export type { ILoginState };
