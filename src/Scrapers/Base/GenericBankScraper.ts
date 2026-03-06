import { type Frame, type Page } from 'playwright';

import { clickButton, fillInput } from '../../Common/ElementsInteractions';
import {
  candidateToCss,
  type FieldContext,
  resolveFieldContext,
} from '../../Common/SelectorResolver';
import {
  BaseScraperWithBrowser,
  LOGIN_RESULTS,
  type LoginOptions,
  type PossibleLoginResults,
} from './BaseScraperWithBrowser';
import { type ScraperCredentials, type ScraperOptions } from './Interface';
import { type FieldConfig, type LoginConfig, type SelectorCandidate } from './LoginConfig';

/**
 * Normalizes the submit config to always be an array of SelectorCandidates.
 *
 * @param submit - a single candidate or array of candidates from LoginConfig
 * @returns an array of SelectorCandidates
 */
function submitCandidates(submit: SelectorCandidate | SelectorCandidate[]): SelectorCandidate[] {
  return Array.isArray(submit) ? submit : [submit];
}

/**
 * Wraps submit-button candidates in a FieldConfig with the reserved '__submit__' key.
 *
 * @param candidates - selector candidates for the submit button
 * @returns a FieldConfig keyed as '__submit__' for SelectorResolver
 */
function toSubmitField(candidates: SelectorCandidate[]): FieldConfig {
  return { credentialKey: '__submit__', selectors: candidates };
}

/**
 * Converts the LoginConfig result map to the PossibleLoginResults format expected by BaseScraper.
 *
 * @param r - the possibleResults section from LoginConfig
 * @returns a PossibleLoginResults map keyed by LOGIN_RESULTS values
 */
function mapPossibleResults(r: LoginConfig['possibleResults']): PossibleLoginResults {
  return {
    [LOGIN_RESULTS.Success]: r.success,
    ...(r.invalidPassword ? { [LOGIN_RESULTS.InvalidPassword]: r.invalidPassword } : {}),
    ...(r.changePassword ? { [LOGIN_RESULTS.ChangePassword]: r.changePassword } : {}),
    ...(r.accountBlocked ? { [LOGIN_RESULTS.AccountBlocked]: r.accountBlocked } : {}),
    ...(r.unknownError ? { [LOGIN_RESULTS.UnknownError]: r.unknownError } : {}),
  };
}

/**
 * Wraps LoginConfig lifecycle hooks in page-bound closures for LoginOptions.
 *
 * @param config - the login configuration providing optional hook functions
 * @param page - the current Playwright page to pass to the hooks
 * @returns an object with optional checkReadiness, preAction, postAction closures
 */
function buildLoginCallbacks(
  config: LoginConfig,
  page: Page,
): Pick<LoginOptions, 'checkReadiness' | 'preAction' | 'postAction'> {
  const { checkReadiness, preAction, postAction } = config;
  return {
    checkReadiness: checkReadiness ? (): Promise<void> => checkReadiness(page) : undefined,
    preAction: preAction ? (): Promise<Frame | undefined> => preAction(page) : undefined,
    postAction: postAction ? (): Promise<void> => postAction(page) : undefined,
  };
}

/**
 * Builds an async submit-button click function using SelectorResolver with a CSS fallback.
 *
 * @param opts - options containing submit candidates, field config, active context, and page accessors
 * @param opts.submitCands - selector candidates for the submit button
 * @param opts.submitField - FieldConfig wrapping the submit candidates
 * @param opts.ctx - getter returning the currently active login context (page or frame)
 * @param opts.page - getter returning the main Playwright page
 * @returns an async function that clicks the submit button
 */
function buildSubmitButtonFunction(opts: {
  submitCands: SelectorCandidate[];
  submitField: FieldConfig;
  ctx: () => Page | Frame | null;
  page: () => Page;
}): () => Promise<void> {
  const { submitCands, submitField, ctx, page } = opts;
  return async () => {
    const activeCtx = ctx() ?? page();
    const currentPageUrl = page().url();
    const result = await resolveFieldContext(activeCtx, submitField, currentPageUrl);
    if (result.isResolved) {
      await clickButton(result.context, result.selector);
    } else {
      const firstCandidateCss = candidateToCss(submitCands[0]);
      await clickButton(activeCtx, firstCandidateCss);
    }
  };
}

/**
 * Maps LoginConfig field definitions to a flat list of selector/value/credentialKey triples.
 *
 * @param config - the login configuration with field definitions
 * @param credentials - bank credentials to pull values from
 * @returns an array of field descriptors ready for fillInputs()
 */
function buildFieldList(
  config: LoginConfig,
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
 * A scraper base class driven by a `LoginConfig` declaration.
 * Handles login via selector resolution (ID → display-name → global dictionary).
 * Extend this class and implement `fetchData()` for each bank.
 */
export abstract class GenericBankScraper<
  TCredentials extends ScraperCredentials,
> extends BaseScraperWithBrowser<TCredentials> {
  private _fieldConfigs: FieldConfig[] = [];

  /**
   * Creates a GenericBankScraper with the given options and login configuration.
   *
   * @param options - scraper options including companyId, timeout, and browser settings
   * @param loginConfig - the declarative login configuration for this bank
   */
  constructor(
    options: ScraperOptions,
    protected readonly loginConfig: LoginConfig,
  ) {
    super(options);
  }

  /**
   * Builds LoginOptions from the loginConfig and the provided credentials.
   *
   * @param credentials - bank login credentials
   * @returns fully resolved LoginOptions for BaseScraperWithBrowser.login()
   */
  public getLoginOptions(credentials: TCredentials): LoginOptions {
    this._fieldConfigs = this.loginConfig.fields;
    const submitCands = submitCandidates(this.loginConfig.submit);
    const submitField = toSubmitField(submitCands);
    const config = this.loginConfig;
    const page = this.page;
    return {
      loginUrl: config.loginUrl,
      fields: buildFieldList(config, credentials),
      submitButtonSelector: this.buildSubmitSelector(submitCands, submitField),
      ...buildLoginCallbacks(config, page),
      possibleResults: mapPossibleResults(config.possibleResults),
      waitUntil: config.waitUntil,
    };
  }

  /**
   * Fills all login form fields using SelectorResolver, with CSS fallback per field.
   *
   * @param pageOrFrame - the page or iframe containing the login form
   * @param fields - field descriptors with selector, value, and optional credentialKey
   */
  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    const initialPromise = Promise.resolve();
    await fields.reduce(async (prev, field, i) => {
      await prev;
      await this.fillFieldWithFallback(pageOrFrame, this._fieldConfigs[i], {
        selector: field.selector,
        value: field.value,
      });
    }, initialPromise);
  }

  /**
   * Builds a submit-button click function bound to the current page and active context.
   *
   * @param submitCands - selector candidates for the submit button
   * @param submitField - FieldConfig wrapping the submit candidates for SelectorResolver
   * @returns an async function that clicks the submit button
   */
  private buildSubmitSelector(
    submitCands: SelectorCandidate[],
    submitField: FieldConfig,
  ): () => Promise<void> {
    const page = this.page;
    return buildSubmitButtonFunction({
      submitCands,
      submitField,
      /**
       * Returns the currently active login context (page or frame).
       *
       * @returns the active page or frame, or null if not set
       */
      ctx: () => this.activeLoginContext,
      /**
       * Returns the main Playwright page.
       *
       * @returns the main Playwright page instance
       */
      page: () => page,
    });
  }

  /**
   * Resolves the input context via SelectorResolver and fills the field if found.
   *
   * @param pageOrFrame - the page or iframe to search for the input
   * @param fieldConfig - field config with candidates for SelectorResolver
   * @param value - the text to type into the input
   * @returns the FieldContext with resolution result and active context
   */
  private async resolveAndFill(
    pageOrFrame: Page | Frame,
    fieldConfig: FieldConfig,
    value: string,
  ): Promise<FieldContext> {
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
   */
  private async fillFieldWithFallback(
    pageOrFrame: Page | Frame,
    fieldConfig: FieldConfig,
    field: { selector: string; value: string },
  ): Promise<void> {
    const result = await this.resolveAndFill(pageOrFrame, fieldConfig, field.value);
    if (!result.isResolved && field.selector) {
      const ctx = this.activeLoginContext ?? pageOrFrame;
      await fillInput(ctx, field.selector, field.value);
    }
  }
}

export default GenericBankScraper;
