/**
 * Phase H.T3c.6 — fixture-driven IPipelineContext builder for the
 * cross-bank OTP-FILL per-phase factory.
 *
 * <p>POST contract (per `OtpFillPhaseActions.ts:309-325`): succeeds
 * when neither an OTP error banner nor the OTP form itself is still
 * visible after submit. The mock mediator's default `resolveVisible`
 * returns NOT_FOUND for every candidate set — matching the
 * captured-shape last-good runs where OTP was accepted (form gone,
 * no error). Test rows that exercise the failure-mode path override
 * `resolveVisible` per fixture.
 *
 * <p>FINAL contract (per `OtpFillPhaseActions.ts:334-347`): always
 * succeeds — cookie count + URL are logged but never gate. The
 * helper wires `getCookies` to return a fixture-supplied cookie
 * snapshot count so the debug trace surfaces a realistic number.
 */

import type { Page } from 'playwright-core';

import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { Option } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Result of {@link buildOtpFillPhaseContext} — POST+FINAL replay-ready. */
export interface IOtpFillPhaseTestSubject {
  readonly context: IPipelineContext;
}

/** Bundled arguments for {@link buildOtpFillPhaseContext}. */
export interface IOtpFillPhaseContextArgs {
  readonly cookieCount: number;
  readonly dashboardUrl: string;
}

/**
 * Build an OTP-FILL-stage test subject from a fixture. The mock
 * mediator's `resolveVisible` defaults (NOT_FOUND) line up with the
 * "OTP accepted, form gone, no error" captured-shape — so the POST
 * naturally succeeds. `getCookies` returns a fixture-driven snapshot
 * so FINAL's cookie-count diagnostic is realistic.
 *
 * @param args - Bundled arguments (cookieCount, dashboardUrl).
 * @returns Context ready for OTP-FILL.POST + FINAL replay.
 */
export function buildOtpFillPhaseContext(args: IOtpFillPhaseContextArgs): IOtpFillPhaseTestSubject {
  const cookies = buildCookieSnapshot(args.cookieCount);
  const browser = buildOtpFillBrowser(args.dashboardUrl);
  const mediator = buildOtpFillMediator(args.dashboardUrl, cookies);
  const context = makeMockContext({ browser, mediator });
  return { context };
}

/**
 * Build the browser-state option for OTP-FILL replay. Wraps a
 * mock page that reports the bank's post-OTP dashboard URL.
 *
 * @param dashboardUrl - URL the mock page reports.
 * @returns Some-wrapped browser state.
 */
function buildOtpFillBrowser(dashboardUrl: string): Option<IBrowserState> {
  const page: Page = makeMockFullPage(dashboardUrl);
  const browserState = makeMockBrowserState(page);
  return some(browserState);
}

/**
 * Build the mediator option for OTP-FILL replay. Stubs
 * {@link getCookies} + {@link getCurrentUrl} so FINAL's cookie-
 * count + URL diagnostics surface fixture-driven values.
 *
 * @param dashboardUrl - URL the mediator reports as current.
 * @param cookies - Redacted cookie snapshot returned by getCookies.
 * @returns Some-wrapped element mediator.
 */
function buildOtpFillMediator(
  dashboardUrl: string,
  cookies: readonly ICookieSnapshot[],
): Option<IElementMediator> {
  const fixtureMediator = makeMockMediator({
    /**
     * Return the fixture's redacted cookie set so FINAL's
     * cookie-count diagnostic surfaces a realistic value.
     * @returns Fixture cookies.
     */
    getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve(cookies),
    /**
     * Return the dashboard URL so FINAL's URL debug-trace
     * reflects the bank's post-OTP landing page.
     * @returns Dashboard URL.
     */
    getCurrentUrl: (): string => dashboardUrl,
  });
  return some(fixtureMediator);
}

/**
 * Build a synthetic cookie array of the requested length. Each
 * entry is fully PII-redacted (`session-i`, `.example`, `FAKE_VALUE`)
 * — names are non-PII shape markers, not real bank cookie names.
 *
 * @param count - Number of cookies to synthesize.
 * @returns Cookie array of the requested length.
 */
function buildCookieSnapshot(count: number): readonly ICookieSnapshot[] {
  return Array.from({ length: count }, (_unused, index): ICookieSnapshot => {
    return {
      name: `session-${String(index)}`,
      domain: '.example',
      value: 'FAKE_VALUE',
    };
  });
}
