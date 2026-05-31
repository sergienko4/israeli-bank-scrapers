import type { Frame, Page } from 'playwright-core';

import {
  clickButton,
  fillInput,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import {
  CONTINUE,
  type ILoginContext,
  type IParsedLoginPage,
  type IStepResult,
  stopWithResult,
} from '../../Common/LoginMiddleware.js';
import { waitForNavigation } from '../../Common/Navigation.js';
import { handleOtpCode, handleOtpConfirm } from '../../Common/OtpHandler.js';
import {
  extractCredentialKey,
  type IFieldContext,
  resolveFieldContext,
  resolveFieldWithCache,
} from '../../Common/SelectorResolver.js';
import { ScraperProgressTypes } from '../../Definitions.js';
import {
  buildLoginResult,
  getKeyByValue,
  type ILoginOptions,
  LOGIN_RESULTS,
} from './BaseScraperHelpers.js';
import type { IFieldConfig, SelectorCandidate } from './Config/LoginConfig.js';
import { LOGIN_STEP_WAIT_MS } from './Config/LoginFlowConfig.js';
import type { ScraperOptions } from './Interface.js';

/** Shared context passed from BaseScraperWithBrowser to each login step. */
export interface ILoginStepContext {
  page: Page;
  activeLoginContext: Page | Frame | null;
  currentParsedPage?: IParsedLoginPage;
  otpPhoneHint: string;
  otpTriggerSelectors?: SelectorCandidate[];
  diagState: { loginUrl: string; lastAction: string };
  emitProgress: (type: ScraperProgressTypes) => boolean;
  navigateTo: (url: string, waitUntil?: string) => Promise<boolean>;
  fillInputs: (
    ctx: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ) => Promise<boolean>;
  loginResultCtx: () => {
    page: Page;
    diagState: { lastAction: string; finalUrl?: string; pageTitle?: string };
    emitProgress: (type: ScraperProgressTypes) => boolean;
  };
  options: ScraperOptions;
}

/**
 * Navigate to the login URL and wait for readiness.
 * @param ctx - The shared login step context.
 * @param loginOptions - Login configuration with URL and readiness checks.
 * @returns A step result indicating whether to continue the chain.
 */
export async function stepNavigate(
  ctx: ILoginStepContext,
  loginOptions: ILoginOptions,
): Promise<IStepResult> {
  ctx.diagState.loginUrl = loginOptions.loginUrl;
  await ctx.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
  if (loginOptions.checkReadiness) {
    await loginOptions.checkReadiness();
  } else if (typeof loginOptions.submitButtonSelector === 'string') {
    await waitUntilElementFound(ctx.page, loginOptions.submitButtonSelector);
  }
  return CONTINUE;
}

/**
 * Parse the login page to discover child frames for selector resolution.
 * @param ctx - The shared login step context.
 * @param loginCtx - The login middleware context to populate.
 * @returns A step result indicating whether to continue the chain.
 */
export function stepParseLoginPage(
  ctx: ILoginStepContext,
  loginCtx: ILoginContext,
): Promise<IStepResult> {
  const childFrames = collectAccessibleFrames(ctx.page);
  loginCtx.parsedPage = {
    childFrames,
    loginFormContext: null,
    pageUrl: ctx.page.url(),
    bodyText: '',
  };
  ctx.currentParsedPage = loginCtx.parsedPage;
  return Promise.resolve(CONTINUE);
}

/**
 * Collect non-main frames from the page for iframe-based login forms.
 * @param page - The Playwright page to inspect.
 * @returns An array of child frames, or empty if frames are inaccessible.
 */
function collectAccessibleFrames(page: Page): Frame[] {
  try {
    const mainFrame = page.mainFrame();
    return page.frames().filter(f => f !== mainFrame);
  } catch {
    return [];
  }
}

/**
 * Fill login fields and click the submit button.
 * @param ctx - The shared login step context.
 * @param loginOptions - Login configuration with fields and submit selector.
 * @param loginCtx - The login middleware context for frame tracking.
 * @returns A step result indicating whether to continue the chain.
 */
export async function stepFillAndSubmit(
  ctx: ILoginStepContext,
  loginOptions: ILoginOptions,
  loginCtx: ILoginContext,
): Promise<IStepResult> {
  const loginFrameOrPage = await resolveLoginFrame(ctx, loginOptions);
  loginCtx.activeFrame = loginFrameOrPage;
  await ctx.fillInputs(loginFrameOrPage, loginOptions.fields);
  await submitForm(ctx, loginFrameOrPage, loginOptions);
  ctx.emitProgress(ScraperProgressTypes.LoggingIn);
  return CONTINUE;
}

/**
 * Resolve the login frame from preAction or fall back to the main page.
 * @param ctx - The shared login step context.
 * @param loginOptions - Login configuration with optional preAction.
 * @returns The page or frame to use for login form interaction.
 */
async function resolveLoginFrame(
  ctx: ILoginStepContext,
  loginOptions: ILoginOptions,
): Promise<Page | Frame> {
  if (!loginOptions.preAction) return ctx.page;
  const preResult = await loginOptions.preAction();
  return preResult ?? ctx.page;
}

/**
 * Click the submit button using either a CSS selector or a callback.
 * @param ctx - The shared login step context.
 * @param loginFrameOrPage - The page or frame containing the form.
 * @param loginOptions - Login configuration with submit selector.
 * @returns True after the submit action completes.
 */
async function submitForm(
  ctx: ILoginStepContext,
  loginFrameOrPage: Page | Frame,
  loginOptions: ILoginOptions,
): Promise<boolean> {
  const submitCtx = ctx.activeLoginContext ?? loginFrameOrPage;
  if (typeof loginOptions.submitButtonSelector === 'string') {
    await clickButton(submitCtx, loginOptions.submitButtonSelector);
  } else {
    await loginOptions.submitButtonSelector();
  }
  return true;
}

/**
 * Wait briefly after form submission for the page to settle.
 * @param ctx - The shared login step context with page reference.
 * @returns A step result indicating whether to continue the chain.
 */
export async function stepWaitAfterSubmit(ctx: ILoginStepContext): Promise<IStepResult> {
  await ctx.page.waitForTimeout(LOGIN_STEP_WAIT_MS);
  return CONTINUE;
}

/**
 * Check if the page already shows a recognized login result.
 * @param ctx - The shared login step context.
 * @param loginOptions - Login configuration with possible results map.
 * @returns A stop result if a login outcome was detected, or continue.
 */
export async function stepCheckEarlyResult(
  ctx: ILoginStepContext,
  loginOptions: ILoginOptions,
): Promise<IStepResult> {
  try {
    const pageUrl = ctx.page.url();
    const r = await getKeyByValue(loginOptions.possibleResults, pageUrl, ctx.page);
    if (r !== LOGIN_RESULTS.UnknownError) {
      const resultCtx = ctx.loginResultCtx();
      const loginResult = buildLoginResult(resultCtx, r);
      return stopWithResult(loginResult);
    }
  } catch {
    // page.url() may throw — continue chain
  }
  return CONTINUE;
}

/**
 * Handle OTP confirmation step (send SMS).
 * @param ctx - The shared login step context.
 * @returns A step result indicating whether to continue the chain.
 */
export async function stepOtpConfirm(ctx: ILoginStepContext): Promise<IStepResult> {
  ctx.otpPhoneHint = await handleOtpConfirm(
    ctx.page,
    ctx.currentParsedPage,
    ctx.otpTriggerSelectors,
  );
  return CONTINUE;
}

/**
 * Handle OTP code entry step.
 * @param ctx - The shared login step context.
 * @returns A stop result if OTP handling produced a result, or continue.
 */
export async function stepOtpCode(ctx: ILoginStepContext): Promise<IStepResult> {
  const otpResult = await handleOtpCode(ctx.page, ctx.options, ctx.otpPhoneHint);
  return otpResult.success ? CONTINUE : stopWithResult(otpResult);
}

/**
 * Execute post-login action or wait for navigation.
 * @param ctx - The shared login step context.
 * @param loginOptions - Login configuration with optional postAction.
 * @returns A step result indicating whether to continue the chain.
 */
export async function stepPostAction(
  ctx: ILoginStepContext,
  loginOptions: ILoginOptions,
): Promise<IStepResult> {
  if (loginOptions.postAction) {
    await loginOptions.postAction();
  } else {
    await waitForNavigation(ctx.page);
  }
  return CONTINUE;
}

/**
 * Resolve a field using the selector resolver with optional frame cache.
 * @param ctx - The shared login step context.
 * @param pageOrFrame - The page or frame to search in.
 * @param fc - The field configuration with selector candidates.
 * @returns The resolved field context with selector and frame information.
 */
export async function resolveField(
  ctx: ILoginStepContext,
  pageOrFrame: Page | Frame,
  fc: IFieldConfig,
): Promise<IFieldContext> {
  const url = ctx.page.url();
  if (!ctx.currentParsedPage) return resolveFieldContext(pageOrFrame, fc, url);
  return resolveFieldWithCache({
    pageOrFrame,
    field: fc,
    pageUrl: url,
    cachedFrames: ctx.currentParsedPage.childFrames,
  });
}

/**
 * Build a field config from a field descriptor for selector resolution.
 * @param field - The field descriptor with selector and credential key.
 * @param field.selector - The CSS selector for the input element.
 * @param field.credentialKey - The credential key for wellKnown lookup.
 * @returns A field config ready for the selector resolver.
 */
function buildFieldConfig(field: { selector: string; credentialKey?: string }): IFieldConfig {
  const key = field.credentialKey ?? extractCredentialKey(field.selector);
  return { credentialKey: key, selectors: [{ kind: 'css' as const, value: field.selector }] };
}

/**
 * Fill a single input field using selector resolution with fallback.
 * @param ctx - The shared login step context.
 * @param pageOrFrame - The page or frame containing the input.
 * @param field - The field descriptor with selector, value, and key.
 * @param field.selector - CSS selector for the input element.
 * @param field.value - The value to type into the input.
 * @param field.credentialKey - Optional credential key for wellKnown lookup.
 * @returns True after the field is filled.
 */
export async function fillOneInput(
  ctx: ILoginStepContext,
  pageOrFrame: Page | Frame,
  field: { selector: string; value: string; credentialKey?: string },
): Promise<boolean> {
  const fc = buildFieldConfig(field);
  const activeCtx = ctx.activeLoginContext ?? pageOrFrame;
  const result = await resolveField(ctx, activeCtx, fc);
  if (result.isResolved) {
    ctx.activeLoginContext = result.context;
    await fillInput(result.context, result.selector, field.value);
  } else {
    const fallbackCtx = ctx.activeLoginContext ?? pageOrFrame;
    await fillInput(fallbackCtx, field.selector, field.value);
  }
  return true;
}
