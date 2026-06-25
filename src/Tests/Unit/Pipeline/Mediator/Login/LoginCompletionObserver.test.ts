/**
 * Unit coverage for {@link observeLoginCompletion} — the ADVISORY
 * login-completion observer wired into LOGIN.final. Proves it composes the
 * four LOGIN-LOCAL signals (spinner / error / advanced / form) into one
 * snapshot, PII-safe-logs it, and is error-isolated (any throw → neutral
 * snapshot), driving real collaborators through typed fakes (no module
 * mocking). The config-driven poll defaults to single-shot (one capture),
 * so the advisory snapshot stays byte-identical to a lone capture.
 */

import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { observeLoginCompletion } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginCompletionObserver.js';
import {
  type IPipelineContext,
  LOGIN_FIELDS,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { createMockPage, makeLocatorMock } from '../../../../MockPage.js';

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
}

/** The captured `logger.debug` spy plus the assembled context. */
interface IFakeCtx {
  readonly ctx: IPipelineContext;
  readonly debug: jest.Mock;
}

/**
 * Build a fake element mediator exposing only the three probes the observer
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
 * Assemble a minimal LOGIN.final pipeline context plus a debug spy.
 * @param args - Tunable presence + probe behaviour.
 * @returns The fake context and its captured `logger.debug` spy.
 */
function makeCtx(args: IFakeCtxArgs = {}): IFakeCtx {
  const debug = jest.fn();
  const frame = args.frame ?? makeFrame(false);
  const ctx = {
    logger: { debug },
    diagnostics: { loginUrl: args.loginUrl ?? '' },
    config: {},
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

describe('observeLoginCompletion', () => {
  it('login state absent → neutral snapshot, no advisory log', async () => {
    const { ctx, debug } = makeCtx({ loginHas: false });
    const snap = await observeLoginCompletion(ctx);
    expect(snap).toEqual({
      spinnerVisible: false,
      hasError: false,
      advanced: false,
      formPresent: false,
    });
    expect(debug).not.toHaveBeenCalled();
  });

  it('mediator absent → neutral snapshot is still logged as login.completion', async () => {
    const { ctx, debug } = makeCtx({ mediatorHas: false });
    const snap = await observeLoginCompletion(ctx);
    expect(snap).toEqual({
      spinnerVisible: false,
      hasError: false,
      advanced: false,
      formPresent: false,
    });
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion',
      spinnerVisible: false,
      hasError: false,
      advanced: false,
      formPresent: false,
    });
  });

  it('clean page → all signals false, logged as login.completion', async () => {
    const { ctx, debug } = makeCtx({ loginUrl: '' });
    const snap = await observeLoginCompletion(ctx);
    expect(snap).toEqual({
      spinnerVisible: false,
      hasError: false,
      advanced: false,
      formPresent: false,
    });
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('spinning + error + url moved + form present → all signals true', async () => {
    const { ctx } = makeCtx({
      frame: makeFrame(true),
      hasErrors: true,
      loginUrl: 'https://bank.test/login',
      currentUrl: 'https://bank.test/dashboard',
      formPresent: true,
    });
    const snap = await observeLoginCompletion(ctx);
    expect(snap).toEqual({
      spinnerVisible: true,
      hasError: true,
      advanced: true,
      formPresent: true,
    });
  });

  it('a probe throwing → neutral snapshot, logged as login.completion.error', async () => {
    const { ctx, debug } = makeCtx({ loginUrl: 'https://bank.test/login', shouldThrowOnUrl: true });
    const snap = await observeLoginCompletion(ctx);
    expect(snap).toEqual({
      spinnerVisible: false,
      hasError: false,
      advanced: false,
      formPresent: false,
    });
    expect(debug).toHaveBeenCalledWith({
      phase: 'login',
      message: 'login.completion.error',
      error: 'ScraperError',
    });
  });
});
