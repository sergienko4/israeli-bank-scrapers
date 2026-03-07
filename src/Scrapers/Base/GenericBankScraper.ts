import { type Frame, type Page } from 'playwright';

import { clickButton, fillInput } from '../../Common/ElementsInteractions';
import {
  candidateToCss,
  type IFieldContext,
  resolveFieldContext,
} from '../../Common/SelectorResolver';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import {
  BaseScraperWithBrowser,
  type ILoginOptions,
  LOGIN_RESULTS,
  type PossibleLoginResults,
} from './BaseScraperWithBrowser';
import { type ScraperCredentials, type ScraperOptions } from './Interface';
import { type IFieldConfig, type ILoginConfig, type SelectorCandidate } from './LoginConfig';

/**
 * Normalizes the submit config to always be an array of SelectorCandidates.
 *
 * @param submit - a single candidate or array of candidates from ILoginConfig
 * @returns an array of SelectorCandidates
 */
function submitCandidates(submit: SelectorCandidate | SelectorCandidate[]): SelectorCandidate[] {
  return Array.isArray(submit) ? submit : [submit];
}

/**
 * Wraps submit-button candidates in a IFieldConfig with the reserved '__submit__' key.
 *
 * @param candidates - selector candidates for the submit button
 * @returns a IFieldConfig keyed as '__submit__' for SelectorResolver
 */
function toSubmitField(candidates: SelectorCandidate[]): IFieldConfig {
  return { credentialKey: '__submit__', selectors: candidates };
}

/**
 * Converts the ILoginConfig result map to the PossibleLoginResults format expected by BaseScraper.
 *
 * @param r - the possibleResults section from ILoginConfig
 * @returns a PossibleLoginResults map keyed by LOGIN_RESULTS values
 */
function mapPossibleResults(r: ILoginConfig['possibleResults']): PossibleLoginResults {
  return {
    [LOGIN_RESULTS.Success]: r.success,
    ...(r.invalidPassword ? { [LOGIN_RESULTS.InvalidPassword]: r.invalidPassword } : {}),
    ...(r.changePassword ? { [LOGIN_RESULTS.ChangePassword]: r.changePassword } : {}),
    ...(r.accountBlocked ? { [LOGIN_RESULTS.AccountBlocked]: r.accountBlocked } : {}),
    ...(r.unknownError ? { [LOGIN_RESULTS.UnknownError]: r.unknownError } : {}),
  };
}

/**
 * Wraps a ILoginConfig checkReadiness or postAction hook in a page-bound closure.
 * The hook's return value is discarded; always resolves with IDoneResult.
 *
 * @param hook - the page-scoped hook function from ILoginConfig
 * @param page - the current Playwright page
 * @returns a closure returning IDoneResult
 */
function wrapDoneHook(
  hook: (page: Page) => Promise<IDoneResult>,
  page: Page,
): () => Promise<IDoneResult> {
  return () => hook(page).then(() => ({ done: true as const }));
}

/** Type for a preAction hook that may or may not return a Frame. */
type MaybeFrameHook = (page: Page) => Promise<Frame>;

/**
 * Wraps a ILoginConfig preAction hook in a page-bound closure.
 * The hook's result is lifted into FoundResult — truthy Frame means isFound: true.
 *
 * @param hook - the preAction function returning a Frame (possibly falsy at runtime)
 * @param page - the current Playwright page
 * @returns a closure returning FoundResult<Frame>
 */
function wrapPreAction(hook: MaybeFrameHook, page: Page): () => Promise<FoundResult<Frame>> {
  return () => hook(page).then(frame => ({ isFound: true, value: frame }));
}

/**
 * Wraps ILoginConfig lifecycle hooks in page-bound closures for ILoginOptions.
 *
 * @param config - the login configuration providing optional hook functions
 * @param page - the current Playwright page to pass to the hooks
 * @returns an object with optional checkReadiness, preAction, postAction closures
 */
function buildLoginCallbacks(
  config: ILoginConfig,
  page: Page,
): Pick<ILoginOptions, 'checkReadiness' | 'preAction' | 'postAction'> {
  const { checkReadiness, preAction, postAction } = config;
  type DoneHook = (p: Page) => Promise<IDoneResult>;
  return {
    checkReadiness: checkReadiness
      ? wrapDoneHook(checkReadiness as unknown as DoneHook, page)
      : undefined,
    preAction: preAction ? wrapPreAction(preAction as unknown as MaybeFrameHook, page) : undefined,
    postAction: postAction ? wrapDoneHook(postAction as unknown as DoneHook, page) : undefined,
  };
}

interface ISubmitButtonOpts {
  submitCands: SelectorCandidate[];
  submitField: IFieldConfig;
  getActiveCtx: () => Page | Frame;
}

/**
 * Builds an async submit-button click function using SelectorResolver with a CSS fallback.
 *
 * @param opts - options containing submit candidates, field config, and active context getter
 * @param opts.submitCands - selector candidates for the submit button
 * @param opts.submitField - IFieldConfig wrapping the submit candidates
 * @param opts.getActiveCtx - getter returning the currently active login context (page or frame)
 * @returns an async function that clicks the submit button and returns IDoneResult
 */
function buildSubmitButtonFunction(opts: ISubmitButtonOpts): () => Promise<IDoneResult> {
  const { submitCands, submitField, getActiveCtx } = opts;
  return async () => {
    const activeCtx = getActiveCtx();
    const currentPageUrl = activeCtx.url();
    const result = await resolveFieldContext(activeCtx, submitField, currentPageUrl);
    if (result.isResolved) {
      await clickButton(result.context, result.selector);
    } else {
      const firstCandidateCss = candidateToCss(submitCands[0]);
      await clickButton(activeCtx, firstCandidateCss);
    }
    return { done: true as const };
  };
}

/**
 * Maps ILoginConfig field definitions to a flat list of selector/value/credentialKey triples.
 *
 * @param config - the login configuration with field definitions
 * @param credentials - bank credentials to pull values from
 * @returns an array of field descriptors ready for fillInputs()
 */
function buildFieldList(
  config: ILoginConfig,
  credentials: ScraperCredentials,
): { selector: string; value: string; credentialKey: string }[] {
  return config.fields.map(f => ({
    // Empty selectors means wellKnown handles detection — use empty string as fallback anchor
    selector: f.selectors.length > 0 ? candidateToCss(f.selectors[0]) : '',
    value: (credentials as Record<string, string>)[f.credentialKey] ?? '',
    credentialKey: f.credentialKey,
  }));
}

/**
 * A scraper base class driven by a `ILoginConfig` declaration.
 * Handles login via selector resolution (ID → display-name → global dictionary).
 * Extend this class and implement `fetchData()` for each bank.
 */
export abstract class GenericBankScraper<
  TCredentials extends ScraperCredentials,
> extends BaseScraperWithBrowser<TCredentials> {
  private _fieldConfigs: IFieldConfig[] = [];

  /**
   * Creates a GenericBankScraper with the given options and login configuration.
   *
   * @param options - scraper options including companyId, timeout, and browser settings
   * @param loginConfig - the declarative login configuration for this bank
   */
  constructor(
    options: ScraperOptions,
    protected readonly loginConfig: ILoginConfig,
  ) {
    super(options);
  }

  /**
   * Builds ILoginOptions from the loginConfig and the provided credentials.
   *
   * @param credentials - bank login credentials
   * @returns fully resolved ILoginOptions for BaseScraperWithBrowser.login()
   */
  public getLoginOptions(credentials: TCredentials): ILoginOptions {
    this._fieldConfigs = this.loginConfig.fields;
    const submitCands = submitCandidates(this.loginConfig.submit);
    const submitField = toSubmitField(submitCands);
    return {
      loginUrl: this.loginConfig.loginUrl,
      fields: buildFieldList(this.loginConfig, credentials),
      submitButtonSelector: this.buildSubmitSelector(submitCands, submitField),
      ...buildLoginCallbacks(this.loginConfig, this.page),
      possibleResults: mapPossibleResults(this.loginConfig.possibleResults),
      waitUntil: this.loginConfig.waitUntil,
    };
  }

  /**
   * Fills all login form fields using SelectorResolver, with CSS fallback per field.
   *
   * @param pageOrFrame - the page or iframe containing the login form
   * @param fields - field descriptors with selector, value, and optional credentialKey
   * @returns a promise that resolves when all fields are filled
   */
  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<IDoneResult> {
    const initialPromise = Promise.resolve({ done: true } as IDoneResult);
    await fields.reduce(async (prev, field, i) => {
      await prev;
      return this.fillFieldWithFallback(pageOrFrame, this._fieldConfigs[i], {
        selector: field.selector,
        value: field.value,
      });
    }, initialPromise);
    return { done: true };
  }

  /**
   * Builds a submit-button click function bound to the current page and active context.
   *
   * @param submitCands - selector candidates for the submit button
   * @param submitField - IFieldConfig wrapping the submit candidates for SelectorResolver
   * @returns an async function that clicks the submit button
   */
  private buildSubmitSelector(
    submitCands: SelectorCandidate[],
    submitField: IFieldConfig,
  ): () => Promise<IDoneResult> {
    const page = this.page;
    return buildSubmitButtonFunction({
      submitCands,
      submitField,
      /**
       * Returns the active login context, falling back to the main page.
       *
       * @returns the active page or frame
       */
      getActiveCtx: () => this.activeLoginContext ?? page,
    });
  }

  /**
   * Resolves the input context via SelectorResolver and fills the field if found.
   *
   * @param pageOrFrame - the page or iframe to search for the input
   * @param fieldConfig - field config with candidates for SelectorResolver
   * @param value - the text to type into the input
   * @returns the IFieldContext with resolution result and active context
   */
  private async resolveAndFill(
    pageOrFrame: Page | Frame,
    fieldConfig: IFieldConfig,
    value: string,
  ): Promise<IFieldContext> {
    const currentPageUrl = this.page.url();
    const result = await resolveFieldContext(
      this.activeLoginContext ?? pageOrFrame,
      fieldConfig,
      currentPageUrl,
    );
    if (result.isResolved) {
      this.activeLoginContext = result.context;
      await fillInput(result.context, result.selector, value);
    }
    return result;
  }

  /**
   * Fills a field using SelectorResolver, falling back to CSS selector if unresolved.
   *
   * @param pageOrFrame - the page or iframe containing the input
   * @param fieldConfig - field config with selector candidates for SelectorResolver
   * @param field - fallback descriptor
   * @param field.selector - CSS selector fallback for the input element
   * @param field.value - the text to type into the input
   * @returns a promise that resolves when the field is filled
   */
  private async fillFieldWithFallback(
    pageOrFrame: Page | Frame,
    fieldConfig: IFieldConfig,
    field: { selector: string; value: string },
  ): Promise<IDoneResult> {
    const result = await this.resolveAndFill(pageOrFrame, fieldConfig, field.value);
    if (!result.isResolved && field.selector) {
      const ctx = this.activeLoginContext ?? pageOrFrame;
      await fillInput(ctx, field.selector, field.value);
    }
    return { done: true };
  }
}

export default GenericBankScraper;
