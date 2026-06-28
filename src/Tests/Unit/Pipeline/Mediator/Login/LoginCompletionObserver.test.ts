/**
 * Unit coverage for {@link enforceLoginCompletion} — the NEUTRAL-by-default
 * login-completion enforcer wired into LOGIN.final. Proves it composes the
 * four LOGIN-LOCAL signals (spinner / error / advanced / form) through a
 * config-driven settle poll, PII-safe-logs the snapshot, and returns a
 * Procedure verdict: a bank that did NOT opt into a settle budget ALWAYS
 * succeeds (byte-identical to today, even with a stuck form on screen),
 * while an opted-in bank fails non-retryably when the budget is exhausted
 * with the form still present. Error-isolated: any probe throw → neutral
 * success. Drives real collaborators through typed fakes (no module mocking).
 */

import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { enforceLoginCompletion } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginCompletionObserver.js';
import { LOGIN_NOT_COMPLETED_CODE } from '../../../../../Scrapers/Pipeline/Types/Domain/LoginTypes.js';
import {
  type IPipelineContext,
  LOGIN_FIELDS,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { createMockPage, makeLocatorMock } from '../../../../MockPage.js';

/** A config-driven settle budget the bank may opt into. */
interface IPollBudget {
  readonly intervalMs: number;
  readonly maxAttempts: number;
}

/** Tunable inputs for one fake LOGIN.final pipeline context. */
interface IFakeCtxArgs {
  readonly loginHas?: boolean;
  readonly browserHas?: boolean;
  readonly mediatorHas?: boolean;
  readonly frame?: Page | Frame;
  readonly loginUrl?: string;
  readonly currentUrl?: string;
  readonly hasErrors?: boolean;
  readonly shouldThrowOnUrl?: boolean;
  readonly formPresent?: boolean;
  readonly pollBudget?: IPollBudget;
}

/** The captured `logger.debug` spy plus the assembled context. */
interface IFakeCtx {
  readonly ctx: IPipelineContext;
  readonly debug: jest.Mock;
}

/**
 * Build a fake element mediator exposing only the three probes the enforcer
 * touches: frame error discovery, the current URL, and the password-target
 * count (used by the form-present signal).
 * @param args - Error + URL + form-present behaviour for the fake.
 * @returns A mediator-shaped fake.
 */
function makeMediator(args: IFakeCtxArgs): object {
  return {
    discoverErrors: jest.fn<Promise<{ hasErrors: boolean }>, []>().mockResolvedValue({
      hasErrors: args.hasErrors ?? false,
    }),
    getCurrentUrl: jest.fn<string, []>().mockImplementation((): string => {
      if (args.shouldThrowOnUrl === true) throw new ScraperError('boom');
      return args.currentUrl ?? '';
    }),
    countBySelector: jest
      .fn<Promise<number>, [unknown]>()
      .mockResolvedValue(args.formPresent === true ? 1 : 0),
  };
}

/**
 * Build a fake active login frame whose WK_LOADING spinner probe resolves
 * to `spinner`. Controls the `locator` seam (the textContent walk-up path
 * the loading probe expands) via the shared {@link makeLocatorMock} factory.
 * @param spinner - Whether the loading indicator reads visible.
 * @returns A page-shaped fake with a deterministic spinner probe.
 */
function makeFrame(spinner: boolean): Page {
  const loc = makeLocatorMock();
  loc.isVisible = jest.fn<Promise<boolean>, []>().mockResolvedValue(spinner);
  return createMockPage({ locator: jest.fn().mockReturnValue(loc) });
}

/**
 * Build the bank-config slice for the fake context. Enforcement is opt-in via
 * {@link IFakeCtxArgs.pollBudget}; the base URL falls back through the supplied
 * current/login URLs so url-stuck detection stays deterministic.
 * @param args - Tunable presence + probe behaviour + optional poll budget.
 * @returns A minimal IPipelineBankConfig-shaped literal.
 */
function makeCtxConfig(args: IFakeCtxArgs): Record<string, unknown> {
  const base = args.currentUrl ?? args.loginUrl ?? '';
  const poll = args.pollBudget ? { loginCompletionPoll: args.pollBudget } : {};
  return { urls: { base }, balanceKind: 'account', authStrategyKind: 'token', ...poll };
}

/**
 * Assemble a minimal LOGIN.final pipeline context plus a debug spy. The
 * bank opts into enforcement only when {@link IFakeCtxArgs.pollBudget} is set.
 * @param args - Tunable presence + probe behaviour + optional poll budget.
 * @returns The fake context and its captured `logger.debug` spy.
 */
function makeCtx(args: IFakeCtxArgs = {}): IFakeCtx {
  const debug = jest.fn();
  const frame = args.frame ?? makeFrame(false);
  const ctx = {
    logger: { debug },
    diagnostics: { loginUrl: args.loginUrl ?? '' },
    config: makeCtxConfig(args),
    loginFieldDiscovery:
      args.formPresent === true
        ? { has: true, value: { targets: new Map([[LOGIN_FIELDS.PASSWORD, { selector: 'pwd' }]]) } }
        : { has: false },
    login: args.loginHas === false ? { has: false } : { has: true, value: { activeFrame: frame } },
    browser: args.browserHas === false ? { has: false } : { has: true, value: { page: frame } },
    mediator:
      args.mediatorHas === false ? { has: false } : { has: true, value: makeMediator(args) },
  } as unknown as IPipelineContext;
  return { ctx, debug };
}

describe('enforceLoginCompletion', () => {
  it('not opted + login state absent → succeed, no completion log', async () => {
    const { ctx, debug } = makeCtx({ loginHas: false });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(ctx);
    expect(debug).not.toHaveBeenCalled();
  });

  it('not opted + mediator absent → succeed, neutral snapshot logged', async () => {
    const { ctx, debug } = makeCtx({ mediatorHas: false });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion',
      settled: true,
      attempts: 1,
      waitedMs: 0,
      hasError: false,
      advanced: false,
      formPresent: false,
    });
  });

  it('not opted + clean page → succeed, logged once per attempt + final', async () => {
    const { ctx, debug } = makeCtx({ loginUrl: '' });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it('not opted + stuck form present → STILL succeed (neutrality)', async () => {
    const { ctx, debug } = makeCtx({ formPresent: true });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(ctx);
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion',
      settled: false,
      attempts: 1,
      waitedMs: 0,
      hasError: false,
      advanced: false,
      formPresent: true,
    });
  });

  it('opted in + stuck form present → fail with not-completed code', async () => {
    const { ctx } = makeCtx({ formPresent: true, pollBudget: { intervalMs: 0, maxAttempts: 3 } });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!isSuccess) expect(result.errorMessage).toContain(LOGIN_NOT_COMPLETED_CODE);
  });

  it('opted in + stuck form, 3 attempts: logs 3 attempt lines + final line', async () => {
    const { ctx, debug } = makeCtx({
      formPresent: true,
      pollBudget: { intervalMs: 0, maxAttempts: 3 },
    });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!isSuccess) expect(result.errorMessage).toContain(LOGIN_NOT_COMPLETED_CODE);
    expect(debug).toHaveBeenCalledTimes(4);
    for (let a = 1; a <= 3; a++) {
      expect(debug).toHaveBeenCalledWith({
        phase: 'login',
        message: 'login.completion.attempt',
        attempt: a,
        of: 3,
        formPresent: true,
        advanced: false,
        hasError: false,
      });
    }
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion',
      settled: false,
      attempts: 3,
      waitedMs: 0,
      formPresent: true,
      advanced: false,
      hasError: false,
    });
  });

  it('opted in + form gone → succeed (settles on attempt one)', async () => {
    const { ctx } = makeCtx({ pollBudget: { intervalMs: 0, maxAttempts: 3 } });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(ctx);
  });

  it('a probe throwing → neutral succeed, logged as completion.error', async () => {
    const { ctx, debug } = makeCtx({ loginUrl: 'https://bank.test/login', shouldThrowOnUrl: true });
    const result = await enforceLoginCompletion(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(ctx);
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion.error',
      error: 'ScraperError',
    });
  });
});
