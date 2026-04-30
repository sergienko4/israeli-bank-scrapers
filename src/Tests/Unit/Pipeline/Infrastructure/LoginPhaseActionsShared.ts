/**
 * Shared fixtures for LoginPhaseActions.test.ts + sibling branch/discovery files.
 */

import type { IBrowserState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
export class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Parameter.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * Narrow a ctx.browser field to ISome and return the state.
 * @param ctx - Parameter.
 * @param ctx.browser - Browser option.
 * @param ctx.browser.has - Present flag.
 * @returns Result.
 */
export function requireBrowser(ctx: { browser: { has: boolean } }): IBrowserState {
  if (!ctx.browser.has) throw new TestError('expected browser state');
  return (ctx.browser as { has: true; value: IBrowserState }).value;
}

/** Minimal ILoginConfig. */
export const TEST_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

/** ILoginConfig with one password field for richer discovery. */
export const CONFIG_WITH_FIELDS = {
  loginUrl: 'https://bank.example.com/login',
  fields: [
    {
      credentialKey: 'password',
      selectors: [{ kind: 'placeholder' as const, value: 'pwd' }],
    },
  ],
  submit: [{ kind: 'textContent' as const, value: 'Login' }],
  possibleResults: {},
};
