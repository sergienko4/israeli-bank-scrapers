/**
 * Auth-API + async DOM error detectors for LOGIN.POST validation.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginPostValidate.ts}.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import { fail, type Procedure } from '../../../Types/Procedure.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import { safeScanFrame } from '../LoginFrameScan.js';
import { hasStayedOnLoginUrl } from '../LoginUrlHelpers.js';

/** Lookup table mapping classifier → human-readable layer label. */
export const AUTH_FAILURE_LAYER_LABELS: Partial<Record<string, string>> = {
  'http-4xx': 'HTTP 4xx',
  'body-error': 'body-error',
};

/**
 * Probe the generic auth-failure watcher and convert any captured
 * failure into a Procedure.
 * @param mediator - Element mediator (exposes networkDiscovery).
 * @returns Failure procedure when the watcher fired, false otherwise.
 */
export function detectAuthApiFailure(
  mediator: IElementMediator,
): Procedure<IPipelineContext> | false {
  const captured = mediator.network.authFailureWatcher.hasFailed();
  if (!captured) return false;
  const layerLabel = AUTH_FAILURE_LAYER_LABELS[captured.classifier] ?? captured.classifier;
  const summary = `Auth API ${layerLabel} (${String(captured.status)}): ${captured.bodyPreview}`;
  return fail(ScraperErrorTypes.InvalidPassword, summary);
}

/**
 * Async-page scan helper for {@link detectAsyncLoginErrors}.
 * @param mediator - Element mediator.
 * @param page - Browser page.
 * @returns Failure procedure on detected error, otherwise `false`.
 */
export async function detectAsyncOnPage(
  mediator: IElementMediator,
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  const asyncErrors = await safeScanFrame(mediator, page);
  if (!asyncErrors.hasErrors) return false;
  return fail(ScraperErrorTypes.InvalidPassword, `Form: ${asyncErrors.summary}`);
}

/**
 * Re-scan the MAIN page for error banners that render asynchronously.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Failure procedure on detected async error, else false.
 */
export async function detectAsyncLoginErrors(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  if (!input.browser.has) return false;
  return detectAsyncOnPage(mediator, input.browser.value.page);
}
