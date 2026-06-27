/**
 * LOGIN.POST auth-confirm advisory observation — coverage for
 * observeAuthConfirm exercised through the exported
 * {@link runPostFormScanAndCallback} seam.
 *
 * <p>Test Case IDs:
 *   - AUTH-CONFIRM-001 (ADVISORY): opted-in bank, accounts traffic absent
 *     → NO fail (advisory observation only). RED on the pre-demote gate
 *     (returned a Timeout fail); GREEN after the demote to advisory.
 *   - AUTH-CONFIRM-002 (SLOW-AUTH SUCCESS): opted-in bank, traffic present
 *     → no fail (returns false).
 *   - AUTH-CONFIRM-003 (NON-OPTED BYTE-IDENTICAL): no loginAuthConfirmMs,
 *     traffic absent → no fail (legacy advisory, 12-bank regression guard).
 *   - AUTH-CONFIRM-004 (ANTI-MASKING): form errors present → InvalidPassword
 *     regardless of loginAuthConfirmMs (PR #282 anti-masking preserved).
 *   - AUTH-CONFIRM-005 (ADVISORY OBSERVATION): opted-in bank still emits the
 *     login.authconfirm.pool histogram through the demoted gate, proving the
 *     advisory observation survives (RED if observeAuthConfirm is no-oped).
 *   - AUTH-CONFIRM-006 (NON-OPTED SKIP): no loginAuthConfirmMs → observeAuthConfirm
 *     returns early, so the login.authconfirm.pool histogram is NOT emitted
 *     (RED before the early return, GREEN after).
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IPostFormScanArgs } from '../../../../../Scrapers/Pipeline/Mediator/Login/PostValidate/PostValidateGates.js';
import { runPostFormScanAndCallback } from '../../../../../Scrapers/Pipeline/Mediator/Login/PostValidate/PostValidateGates.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Stub frame-scan result shape. */
interface IDiscoverResult {
  readonly hasErrors: boolean;
  readonly summary: string;
}

/** Scripted behaviour for the stub mediator. */
interface IStubScript {
  /** What discoverErrors resolves to. Defaults to no-error. */
  readonly discoverResult?: IDiscoverResult;
  /** What waitForTraffic resolves to. Defaults to false (no traffic). */
  readonly trafficHit?: IDiscoveredEndpoint | false;
}

/** Minimal discoverable endpoint for traffic-hit scenarios. */
const STUB_HIT: IDiscoveredEndpoint = {
  url: 'https://bank.co.il/api/accounts',
  method: 'GET',
  postData: '',
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  responseBody: {},
  timestamp: 0,
};

/**
 * Build a minimal IElementMediator stub sufficient for runPostFormScanAndCallback.
 * @param script - Scripted answers.
 * @returns Stub mediator.
 */
function makeMediator(script: IStubScript): IElementMediator {
  return {
    network: {
      /**
       * Return scripted traffic hit or false.
       * @returns Scripted endpoint or false.
       */
      waitForTraffic: (): Promise<IDiscoveredEndpoint | false> =>
        Promise.resolve(script.trafficHit ?? false),
      /**
       * Return captured endpoints (empty in gate tests).
       * @returns Empty endpoint pool.
       */
      getAllEndpoints: (): IDiscoveredEndpoint[] => [],
      /**
       * Return successful-response count (zero in gate tests).
       * @returns Zero.
       */
      countSuccessfulResponses: (): number => 0,
    },
    /**
     * Return a stable page URL.
     * @returns Static URL.
     */
    getCurrentUrl: (): string => 'https://bank.co.il',
    /**
     * Return scripted error-scan result.
     * @returns Scripted scan result.
     */
    discoverErrors: (): Promise<IDiscoverResult> =>
      Promise.resolve(script.discoverResult ?? { hasErrors: false, summary: '' }),
  } as unknown as IElementMediator;
}

/** Minimal no-op logger. */
const STUB_LOGGER = {
  /**
   * No-op trace sink — discards trace events in test isolation.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * No-op debug sink — discards debug events in test isolation.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op info sink — discards info events in test isolation.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * No-op warn sink — discards warn events in test isolation.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * No-op error sink — discards error events in test isolation.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/**
 * Build a logger that captures debug payloads into a sink, to assert the
 * advisory pool histogram still emits through the demoted gate seam.
 * @param sink - Array to receive each debug entry.
 * @returns Capturing logger (no-op except debug).
 */
function makeCapturingLogger(sink: unknown[]): ScraperLogger {
  return {
    ...STUB_LOGGER,
    /**
     * Capture a debug entry.
     * @param entry - Debug payload.
     * @returns True.
     */
    debug: (entry: unknown): boolean => {
      sink.push(entry);
      return true;
    },
  };
}

/**
 * Build IPostFormScanArgs for runPostFormScanAndCallback.
 * @param mediator - Stub mediator.
 * @param loginAuthConfirmMs - Optional auth-confirm budget from bank config.
 * @param logger - Logger to thread through the context; defaults to STUB_LOGGER.
 * @returns Minimal stub args.
 */
function makeArgs(
  mediator: IElementMediator,
  loginAuthConfirmMs?: number,
  logger: ScraperLogger = STUB_LOGGER,
): IPostFormScanArgs {
  return {
    mediator,
    config: {} as ILoginConfig,
    page: {} as Page,
    input: {
      config: {
        urls: { base: 'https://bank.co.il' },
        balanceKind: 'card-cycle',
        ...(loginAuthConfirmMs !== undefined && { loginAuthConfirmMs }),
      },
      logger,
    } as unknown as IPipelineContext,
  };
}

describe('LOGIN.POST auth-confirm advisory — AUTH-CONFIRM-001..004', () => {
  it('AUTH-CONFIRM-001 (ADVISORY): opted-in bank, no traffic → no fail', async () => {
    // Demoted gate: opted-in + absent traffic is ADVISORY ONLY. Login is
    // never failed here — authentication is proven later at auth-discovery.
    // RED on the pre-demote gate (returned a Timeout fail); GREEN after.
    const mediator = makeMediator({ trafficHit: false });
    const args = makeArgs(mediator, 45_000);
    const result = await runPostFormScanAndCallback(args);
    expect(result).toBe(false);
  });

  it('AUTH-CONFIRM-002 (SLOW-AUTH SUCCESS): opted-in bank, traffic present → no fail', async () => {
    const mediator = makeMediator({ trafficHit: STUB_HIT });
    const args = makeArgs(mediator, 45_000);
    const result = await runPostFormScanAndCallback(args);
    expect(result).toBe(false);
  });

  it('AUTH-CONFIRM-003 (NON-OPTED BYTE-IDENTICAL): no budget, traffic absent → no fail', async () => {
    // Legacy 12-bank no-regression guard: without loginAuthConfirmMs the
    // boolean is advisory only and a false return does NOT fail the gate.
    const mediator = makeMediator({ trafficHit: false });
    const args = makeArgs(mediator, undefined);
    const result = await runPostFormScanAndCallback(args);
    expect(result).toBe(false);
  });

  it('AUTH-CONFIRM-004 (ANTI-MASKING): form errors → InvalidPassword before auth gate', async () => {
    // PR #282 contract: a genuinely wrong password produces InvalidPassword,
    // never Timeout, even when the bank has loginAuthConfirmMs set.
    const mediator = makeMediator({
      discoverResult: { hasErrors: true, summary: 'wrong credentials' },
      trafficHit: false,
    });
    const args = makeArgs(mediator, 45_000);
    const result = await runPostFormScanAndCallback(args);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
      }
    }
  });

  it('AUTH-CONFIRM-005 (ADVISORY OBSERVATION): opted-in bank still emits pool histogram', async () => {
    // The demoted gate never fails, but observeAuthConfirm must still perform
    // the advisory observation so loginAuthConfirmMs keeps its diagnostics
    // value: the login.authconfirm.pool histogram reaches logger.debug. RED if
    // observeAuthConfirm is reduced to a no-op; GREEN while it observes.
    const debugCalls: unknown[] = [];
    const logger = makeCapturingLogger(debugCalls);
    const mediator = makeMediator({ trafficHit: false });
    const args = makeArgs(mediator, 45_000, logger);
    const result = await runPostFormScanAndCallback(args);
    expect(result).toBe(false);
    const poolEvent = debugCalls.find(
      (entry): boolean => (entry as { event?: string }).event === 'login.authconfirm.pool',
    );
    expect(poolEvent).toMatchObject({ event: 'login.authconfirm.pool', hasTraffic: false });
  });

  it('AUTH-CONFIRM-006 (NON-OPTED SKIP): no budget → pool histogram not emitted', async () => {
    // R3-02: without loginAuthConfirmMs observeAuthConfirm returns early, so a
    // non-opted bank never runs the post-login traffic wait and never emits the
    // login.authconfirm.pool histogram. RED before the early return (the wait
    // ran on the default budget and emitted the histogram); GREEN after.
    const debugCalls: unknown[] = [];
    const logger = makeCapturingLogger(debugCalls);
    const mediator = makeMediator({ trafficHit: false });
    const args = makeArgs(mediator, undefined, logger);
    const result = await runPostFormScanAndCallback(args);
    expect(result).toBe(false);
    const poolEvent = debugCalls.find(
      (entry): boolean => (entry as { event?: string }).event === 'login.authconfirm.pool',
    );
    expect(poolEvent).toBeUndefined();
  });
});
