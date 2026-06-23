/**
 * LOGIN.POST auth-confirm enforcement — coverage for enforceAuthConfirm
 * exercised through the exported {@link runPostFormScanAndCallback} seam.
 *
 * <p>Test Case IDs:
 *   - AUTH-CONFIRM-001 (FIRING): opted-in bank, accounts traffic absent
 *     → TIMEOUT fail. This test MUST be RED on the pre-fix code (boolean
 *     discarded) and GREEN after the fix.
 *   - AUTH-CONFIRM-002 (SLOW-AUTH SUCCESS): opted-in bank, traffic present
 *     → no fail (returns false).
 *   - AUTH-CONFIRM-003 (NON-OPTED BYTE-IDENTICAL): no loginAuthConfirmMs,
 *     traffic absent → no fail (legacy advisory, 12-bank regression guard).
 *   - AUTH-CONFIRM-004 (ANTI-MASKING): form errors present → InvalidPassword
 *     regardless of loginAuthConfirmMs (PR #282 anti-masking preserved).
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
 * Build IPostFormScanArgs for runPostFormScanAndCallback.
 * @param mediator - Stub mediator.
 * @param loginAuthConfirmMs - Optional auth-confirm budget from bank config.
 * @returns Minimal stub args.
 */
function makeArgs(mediator: IElementMediator, loginAuthConfirmMs?: number): IPostFormScanArgs {
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
      logger: STUB_LOGGER,
    } as unknown as IPipelineContext,
  };
}

describe('LOGIN.POST auth-confirm gate — AUTH-CONFIRM-001..004', () => {
  it('AUTH-CONFIRM-001 (FIRING): opted-in bank, no traffic → TIMEOUT fail', async () => {
    // This case was RED on the pre-fix code (boolean discarded → no fail).
    // After the fix, the boolean is enforced → Timeout failure.
    const mediator = makeMediator({ trafficHit: false });
    const args = makeArgs(mediator, 45_000);
    const result = await runPostFormScanAndCallback(args);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
      }
    }
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
});
