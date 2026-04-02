/**
 * HOME phase — navigate from home page URL to the login page.
 *
 * PRE:    goto(urls.base) — "Homepage unreachable" on failure
 * ACTION: tryClosePopup → discover + click login link (WK.HOME.ENTRY)
 * POST:   store discovered loginUrl in diagnostics
 * FINAL:  default no-op (readiness signal added in follow-up)
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { tryClickLoginLinkWithHref } from '../../Mediator/Home/HomeActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** HOME phase — BasePhase with PRE/ACTION/POST implemented. */
class HomePhase extends BasePhase {
  public readonly name = 'home' as const;

  /**
   * PRE: navigate to homepage URL.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with browser + config.
   * @returns Updated context, or failure if goto fails.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for HOME PRE');
    const mediator = input.mediator.value;
    const homepageUrl = input.config.urls.base;
    process.stderr.write(`    [HOME.PRE] navigating to ${homepageUrl}\n`);
    const navResult = await mediator.navigateTo(homepageUrl, { waitUntil: 'domcontentloaded' });
    if (!navResult.success) return navResult;
    process.stderr.write(`    [HOME.PRE] landed on ${mediator.getCurrentUrl()}\n`);
    return succeed(input);
  }

  /**
   * ACTION: clear overlays then navigate to the login URL.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with browser + mediator.
   * @returns Same context (navigation is side-effect).
   */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME ACTION');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for HOME ACTION');
    const mediator = input.mediator.value;
    await tryClickLoginLinkWithHref(mediator);
    const afterUrl = mediator.getCurrentUrl();
    process.stderr.write(`    [HOME.ACTION] after login link click → ${afterUrl}\n`);
    return succeed(input);
  }

  /**
   * POST: store the login URL in diagnostics.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with browser.
   * @returns Updated context with diagnostics.loginUrl populated.
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) {
      const err = fail(ScraperErrorTypes.Generic, 'No mediator for HOME POST');
      return Promise.resolve(err);
    }
    const loginUrl = input.mediator.value.getCurrentUrl();
    const updatedDiag = { ...input.diagnostics, loginUrl };
    const result = succeed({ ...input, diagnostics: updatedDiag });
    return Promise.resolve(result);
  }

  /**
   * FINAL: validate loginUrl was captured by POST.
   * Catches "Silent Success" — POST ran but didn't store the URL.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with diagnostics.
   * @returns Succeed if loginUrl present, fail otherwise.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.diagnostics.loginUrl) {
      const err = fail(ScraperErrorTypes.Generic, 'HOME final: loginUrl not set');
      return Promise.resolve(err);
    }
    const result = succeed(input);
    return Promise.resolve(result);
  }
}

/**
 * Create the HOME phase instance.
 * @returns HomePhase with PRE/ACTION/POST/FINAL.
 */
function createHomePhase(): HomePhase {
  return new HomePhase();
}

export { createHomePhase, HomePhase };
