/**
 * LOGIN.PRE readiness gates — checkReadiness, preAction, neterror probe,
 * combined preamble result.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginPreOrchestrator.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Base/Interfaces/Config/LoginConfig.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { probeFirefoxNeterror } from '../../Elements/PagePrelude.js';
import type { DiscoverFormPreamble } from './PreOrchestratorTypes.js';

export type { DiscoverFormPreamble } from './PreOrchestratorTypes.js';

/**
 * Build a fail procedure for the checkReadiness catch arm.
 * @param error - Caught error from the readiness callback.
 * @returns Failure procedure tagged Generic.
 */
function failCheckReadiness(error: unknown): IProcedureFailure {
  const msg = toErrorMessage(error as Error);
  return fail(ScraperErrorTypes.Generic, `LOGIN PRE: checkReadiness — ${msg}`);
}

/**
 * Await the verified checkReadiness callback — resolves to `false`
 * (no failure) when the callback returns.
 * @param checkReadiness - Verified-present callback.
 * @param page - Browser page.
 * @returns Always `false` on success.
 */
async function performCheckReadiness(
  checkReadiness: NonNullable<ILoginConfig['checkReadiness']>,
  page: Page,
): Promise<false> {
  await checkReadiness(page);
  return false;
}

/**
 * Run checkReadiness if configured — returns failure Procedure or false.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Failure Procedure on error, false on success/skip.
 */
async function runCheckReadiness(
  config: ILoginConfig,
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  if (!config.checkReadiness) return false;
  return performCheckReadiness(config.checkReadiness, page).catch(failCheckReadiness);
}

/**
 * Invoke the optional preAction callback and select the active frame.
 * @param preAction - Verified-present preAction callback.
 * @param page - Browser page.
 * @returns Active frame (Page or Frame).
 */
async function performPreAction(
  preAction: NonNullable<ILoginConfig['preAction']>,
  page: Page,
): Promise<Page | Frame> {
  const frame = await preAction(page);
  return frame ?? page;
}

/**
 * Run preAction if configured — returns the active frame.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Active frame, or failure Procedure.
 */
async function runPreAction(config: ILoginConfig, page: Page): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(page as Page | Frame);
  try {
    const activeFrame = await performPreAction(config.preAction, page);
    return succeed(activeFrame);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: preAction — ${msg}`);
  }
}

/**
 * Probe the page for a Firefox-style network-error chrome.
 * @param page - Browser page.
 * @returns Failure procedure when detected, `false` otherwise.
 */
export async function probeNeterrorAndFail(
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  const probe = await probeFirefoxNeterror(page);
  if (!probe.isNeterror) return false;
  const pageUrl = page.url();
  const maskedUrl = maskVisibleText(pageUrl);
  const msg = `LOGIN PRE: browser error page — title="${probe.title}" url=${maskedUrl}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Run LOGIN.PRE's optional readiness + preAction callbacks.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Tagged outcome.
 */
export async function runDiscoverFormPreamble(
  config: ILoginConfig,
  page: Page,
): Promise<DiscoverFormPreamble> {
  const readyCheck = await runCheckReadiness(config, page);
  if (readyCheck !== false) return { tag: 'fail', proc: readyCheck };
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return { tag: 'fail', proc: frameResult };
  return { tag: 'frame', activeFrame: frameResult.value };
}
