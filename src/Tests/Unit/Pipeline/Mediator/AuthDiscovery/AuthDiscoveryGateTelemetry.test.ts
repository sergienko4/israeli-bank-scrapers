/**
 * T-TEL: AUTH-DISCOVERY gate-decision telemetry unit tests.
 *
 * Verifies that {@link logGateDecision} emits the structured event,
 * that both URL arguments are PII-scrubbed before logging (no raw
 * digits reach the logger), that empty-string URLs are handled
 * safely, and that the function returns true.
 *
 * These tests cover the observability-only C2 addition.  The gate
 * logic itself lives in {@link AuthDiscoveryFinal.ts} and is covered
 * by the existing integration tests.
 */

import { jest } from '@jest/globals';

import {
  type IGateDecisionLog,
  logGateDecision,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryGateTelemetry.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** URL containing digit sequences that {@link redactUrlFull} must scrub. */
const DIGIT_URL = 'https://portal.bank.co.il/12345/auth-page';

/** Sentinel for empty-URL edge cases. */
const EMPTY_URL = '';

/**
 * Build a baseline {@link IGateDecisionLog} for T-TEL tests.
 *
 * @param ctx - Pipeline context (provides the logger).
 * @param url - Override for both currentUrl and preAuthUrl (default: empty).
 * @returns Args object ready to pass to {@link logGateDecision}.
 */
function makeFakeArgs(ctx: IPipelineContext, url = EMPTY_URL): IGateDecisionLog {
  return { input: ctx, reason: 'open', currentUrl: url, preAuthUrl: url };
}

/**
 * Build the asymmetric matcher for T-TEL-1.
 *
 * @returns Matcher that asserts the gate-decision event payload.
 */
function makeGateEventMatcher(): object {
  return expect.objectContaining({
    event: 'auth-discovery.gate.decision',
    reason: 'open',
  }) as object;
}

/**
 * Build the asymmetric matcher for T-TEL-2: no raw digit sequences in URLs.
 *
 * @returns Matcher asserting both URL fields have digits scrubbed.
 */
function makeNoRawDigitsMatcher(): object {
  const noDigits = expect.not.stringContaining('12345') as object;
  return expect.objectContaining({ currentUrl: noDigits, preAuthUrl: noDigits }) as object;
}

/**
 * Build the asymmetric matcher for T-TEL-3: both URL fields are empty strings.
 *
 * @returns Matcher asserting both URL fields logged as empty string.
 */
function makeEmptyUrlsMatcher(): object {
  return expect.objectContaining({ currentUrl: EMPTY_URL, preAuthUrl: EMPTY_URL }) as object;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('logGateDecision (T-TEL)', () => {
  it('T-TEL-1: emits auth-discovery.gate.decision event with reason', () => {
    const ctx = makeMockContext();
    const spy = jest.spyOn(ctx.logger, 'debug').mockImplementation(() => undefined);
    const args = makeFakeArgs(ctx);
    logGateDecision(args);
    expect(spy).toHaveBeenCalledTimes(1);
    const matcher = makeGateEventMatcher();
    expect(spy).toHaveBeenCalledWith(matcher);
  });

  it('T-TEL-2: redacts digit sequences from both URLs before logging', () => {
    const ctx = makeMockContext();
    const spy = jest.spyOn(ctx.logger, 'debug').mockImplementation(() => undefined);
    const args = makeFakeArgs(ctx, DIGIT_URL);
    logGateDecision(args);
    expect(spy).toHaveBeenCalledTimes(1);
    const matcher = makeNoRawDigitsMatcher();
    expect(spy).toHaveBeenCalledWith(matcher);
  });

  it('T-TEL-3: handles empty-string URLs safely (redactUrlFull returns empty)', () => {
    const ctx = makeMockContext();
    const spy = jest.spyOn(ctx.logger, 'debug').mockImplementation(() => undefined);
    const args = makeFakeArgs(ctx);
    logGateDecision(args);
    expect(spy).toHaveBeenCalledTimes(1);
    const matcher = makeEmptyUrlsMatcher();
    expect(spy).toHaveBeenCalledWith(matcher);
  });

  it('T-TEL-4: returns true', () => {
    const ctx = makeMockContext();
    jest.spyOn(ctx.logger, 'debug').mockImplementation(() => undefined);
    const args = makeFakeArgs(ctx);
    const isTrue = logGateDecision(args);
    expect(isTrue).toBe(true);
  });
});
