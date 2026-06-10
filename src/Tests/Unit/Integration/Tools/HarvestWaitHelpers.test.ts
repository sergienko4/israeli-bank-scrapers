/**
 * Unit tests for {@link waitForCredentialInputIfNeeded} — harvester
 * SPA-hydration wait wired into the legacy pre-login recipe path.
 *
 * <p>Mocks the Playwright {@link Page} so the helper can be exercised
 * without booting Chromium. Three cases:
 * <ul>
 *   <li>Flag undefined → no wait (legacy banks unaffected).</li>
 *   <li>Flag false (synthetic) → no wait (defensive: only `true` triggers).</li>
 *   <li>Flag true → waits for `input[type="password"]` with the given timeout.</li>
 * </ul>
 */

import type { Page } from 'playwright-core';

import {
  CREDENTIAL_INPUT_SELECTOR,
  DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS,
  waitForCredentialInputIfNeeded,
} from '../../../Integration/Tools/HarvestWaitHelpers.js';

/** Selector + options pair captured by the mock {@link Page.waitForSelector}. */
interface IWaitForSelectorCall {
  readonly selector: string;
  readonly timeout: number | undefined;
}

/** Recording mock Page exposing just the methods the helper touches. */
interface IRecordingPage {
  readonly page: Page;
  readonly calls: readonly IWaitForSelectorCall[];
}

/**
 * Build the mock `waitForSelector` implementation that records calls.
 *
 * @param calls - Mutable array the mock writes captured calls into.
 * @returns Recording stub matching the Playwright signature.
 */
function makeWaitForSelectorStub(
  calls: IWaitForSelectorCall[],
): (selector: string, options?: { timeout?: number }) => Promise<unknown> {
  return (selector, options): Promise<unknown> => {
    calls.push({ selector, timeout: options?.timeout });
    return Promise.resolve({});
  };
}

/**
 * Build a Page mock whose `waitForSelector` records every call into a
 * shared array. Returns the array so the test can assert against it.
 *
 * @returns Recording page + immutable view of recorded calls.
 */
function buildRecordingPage(): IRecordingPage {
  const calls: IWaitForSelectorCall[] = [];
  const page = {
    waitForSelector: makeWaitForSelectorStub(calls),
  } as unknown as Page;
  return { page, calls };
}

describe('waitForCredentialInputIfNeeded', () => {
  it('skips wait when flag is undefined (legacy banks unchanged)', async () => {
    const { page, calls } = buildRecordingPage();
    const didWait = await waitForCredentialInputIfNeeded(page, undefined);
    expect(didWait).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('skips wait when flag is not strictly true (defensive)', async () => {
    const { page, calls } = buildRecordingPage();
    const didWait = await waitForCredentialInputIfNeeded(page, false);
    expect(didWait).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('waits for input[type="password"] when flag is true', async () => {
    const { page, calls } = buildRecordingPage();
    const didWait = await waitForCredentialInputIfNeeded(page, true);
    expect(didWait).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.selector).toBe(CREDENTIAL_INPUT_SELECTOR);
    expect(calls[0]?.timeout).toBe(DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS);
  });

  it('honours caller-provided timeoutMs override', async () => {
    const { page, calls } = buildRecordingPage();
    const customTimeoutMs = 7500;
    const didWait = await waitForCredentialInputIfNeeded(page, true, customTimeoutMs);
    expect(didWait).toBe(true);
    expect(calls[0]?.timeout).toBe(customTimeoutMs);
  });
});
