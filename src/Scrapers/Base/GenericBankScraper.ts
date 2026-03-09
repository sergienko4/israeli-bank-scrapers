import { type Frame, type Page } from 'playwright';

import { clickButton, fillInput } from '../../Common/ElementsInteractions.js';
import {
  candidateToCss,
  type IFieldContext,
  resolveFieldContext,
} from '../../Common/SelectorResolver.js';
import { runSerial } from '../../Common/Waiting.js';
import {
  BaseScraperWithBrowser,
  type ILoginOptions,
  LOGIN_RESULTS,
  type PossibleLoginResults,
} from './BaseScraperWithBrowser.js';
import { type ScraperCredentials, type ScraperOptions } from './Interface.js';
import type { Nullable, OptionalFramePromise } from './Interfaces/CallbackTypes.js';
import { type IFieldConfig, type ILoginConfig, type SelectorCandidate } from './LoginConfig.js';

/**
 * Normalize submit button candidates to an array.
 * @param submit - A single candidate or array of candidates.
 * @returns An array of selector candidates.
 */
function submitCandidates(submit: SelectorCandidate | SelectorCandidate[]): SelectorCandidate[] {
  return Array.isArray(submit) ? submit : [submit];
}

/**
 * Wrap selector candidates into a field config for the submit button.
 * @param candidates - The submit button selector candidates.
 * @returns A field config keyed as __submit__.
 */
function toSubmitField(candidates: SelectorCandidate[]): IFieldConfig {
  return { credentialKey: '__submit__', selectors: candidates };
}

/**
 * Convert login config possible results into the ILoginOptions format.
 * @param possibleResults - The login config possible results.
 * @returns Mapped possible results keyed by LOGIN_RESULTS.
 */
function mapPossibleResults(
  possibleResults: ILoginConfig['possibleResults'],
): PossibleLoginResults {
  return {
    [LOGIN_RESULTS.Success]: possibleResults.success,
    ...(possibleResults.invalidPassword
      ? { [LOGIN_RESULTS.InvalidPassword]: possibleResults.invalidPassword }
      : {}),
    ...(possibleResults.changePassword
      ? { [LOGIN_RESULTS.ChangePassword]: possibleResults.changePassword }
      : {}),
    ...(possibleResults.accountBlocked
      ? { [LOGIN_RESULTS.AccountBlocked]: possibleResults.accountBlocked }
      : {}),
    ...(possibleResults.unknownError
      ? { [LOGIN_RESULTS.UnknownError]: possibleResults.unknownError }
      : {}),
  };
}

/** Options for building the submit button click function. */
interface ISubmitButtonOpts {
  submitCandidates: SelectorCandidate[];
  submitField: IFieldConfig;
  loginContext: () => Nullable<Page | Frame>;
  page: () => Page;
}

/**
 * Build a function that clicks the submit button via resolver or fallback CSS.
 * @param submitButtonOpts - The submit button options with candidates and context.
 * @returns An async function that clicks the submit button.
 */
function buildSubmitButtonFunction(submitButtonOpts: ISubmitButtonOpts): () => Promise<boolean> {
  const { submitCandidates: candidates, submitField, loginContext, page } = submitButtonOpts;
  return async (): Promise<boolean> => {
    const activeContext = loginContext() ?? page();
    const currentUrl = page().url();
    const result = await resolveFieldContext(activeContext, submitField, currentUrl);
    if (result.isResolved) {
      await clickButton(result.context, result.selector);
    } else {
      const fallbackCss = candidateToCss(candidates[0]);
      await clickButton(activeContext, fallbackCss);
    }
    return true;
  };
}

/**
 * Build the field list with CSS selectors and credential values.
 * @param config - The login configuration.
 * @param credentials - The user's bank credentials.
 * @returns An array of field descriptors for fillInputs.
 */
function buildFieldList(
  config: ILoginConfig,
  credentials: ScraperCredentials,
): { selector: string; value: string; credentialKey: string }[] {
  return config.fields.map(fieldConfig => ({
    selector: fieldConfig.selectors.length > 0 ? candidateToCss(fieldConfig.selectors[0]) : '',
    value: (credentials as Record<string, string>)[fieldConfig.credentialKey] ?? '',
    credentialKey: fieldConfig.credentialKey,
  }));
}

/** Lifecycle callback keys from ILoginOptions. */
type ILifecycleCallbacks = Pick<ILoginOptions, 'checkReadiness' | 'preAction' | 'postAction'>;

/**
 * Build lifecycle callbacks from login config for the login chain.
 * @param config - The login configuration.
 * @param page - The Playwright page instance.
 * @returns The checkReadiness, preAction, and postAction callbacks.
 */
function buildLoginCallbacks(config: ILoginConfig, page: Page): ILifecycleCallbacks {
  const callbacks: ILifecycleCallbacks = {};
  if (config.checkReadiness) {
    /**
     * Wait for page readiness before login.
     * @returns True when ready.
     */
    callbacks.checkReadiness = async (): Promise<boolean> => {
      await config.checkReadiness?.(page);
      return true;
    };
  }
  if (config.preAction) {
    /**
     * Execute pre-login action, optionally returning an iframe.
     * @returns The login frame or undefined.
     */
    callbacks.preAction = (): OptionalFramePromise =>
      config.preAction?.(page) ?? Promise.resolve(undefined);
  }
  if (config.postAction) {
    /**
     * Execute post-login action after form submission.
     * @returns True when done.
     */
    callbacks.postAction = async (): Promise<boolean> => {
      await config.postAction?.(page);
      return true;
    };
  }
  return callbacks;
}

/**
 * Fill an input field using the provided CSS selector (used as fallback when resolver fails).
 * @param pageOrFrame - The page or frame context.
 * @param selector - The CSS selector for the input.
 * @param value - The value to fill.
 * @returns True after filling.
 */
async function fillWithFallback(
  pageOrFrame: Page | Frame,
  selector: string,
  value: string,
): Promise<boolean> {
  await fillInput(pageOrFrame, selector, value);
  return true;
}

/**
 * A scraper base class driven by a `ILoginConfig` declaration.
 * Handles login via selector resolution (ID, display-name, global dictionary).
 * Extend this class and implement `fetchData()` for each bank.
 */
export default class GenericBankScraper<
  TCredentials extends ScraperCredentials,
> extends BaseScraperWithBrowser<TCredentials> {
  private _fieldConfigs: IFieldConfig[] = [];

  /**
   * Create a new GenericBankScraper with options and login configuration.
   * @param options - Scraper configuration options.
   * @param loginConfig - Declarative login configuration for the bank.
   */
  constructor(
    options: ScraperOptions,
    protected readonly loginConfig: ILoginConfig,
  ) {
    super(options);
  }

  /**
   * Build login options from the declarative login configuration.
   * @param credentials - The user's bank credentials.
   * @returns The resolved login options for the login chain.
   */
  public getLoginOptions(credentials: TCredentials): ILoginOptions {
    this._fieldConfigs = this.loginConfig.fields;
    const submitSelectorCandidates = submitCandidates(this.loginConfig.submit);
    const submitField = toSubmitField(submitSelectorCandidates);
    const config = this.loginConfig;
    const page = this.page;
    return {
      loginUrl: config.loginUrl,
      fields: buildFieldList(config, credentials),
      submitButtonSelector: this.buildSubmitSelector(submitSelectorCandidates, submitField),
      ...buildLoginCallbacks(config, page),
      possibleResults: mapPossibleResults(config.possibleResults),
      waitUntil: config.waitUntil,
    };
  }

  /**
   * Fill login fields using selector resolution with fallback to CSS selectors.
   * @param pageOrFrame - The page or frame containing the inputs.
   * @param fields - The field descriptors with selectors and values.
   * @returns True when all fields are filled.
   */
  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<boolean> {
    const fieldConfigs = this._fieldConfigs;
    const actions = fields.map((field, index): (() => Promise<boolean>) => {
      const fieldConfig = fieldConfigs[index];
      return async (): Promise<boolean> => {
        await this.fillFieldWithFallback(pageOrFrame, fieldConfig, {
          selector: field.selector,
          value: field.value,
        });
        return true;
      };
    });
    await runSerial(actions);
    return true;
  }

  /**
   * Build the submit button click function with resolver and fallback.
   * @param submitSelectorCandidates - The submit button selector candidates.
   * @param submitField - The submit field configuration.
   * @returns An async function that clicks the submit button.
   */
  private buildSubmitSelector(
    submitSelectorCandidates: SelectorCandidate[],
    submitField: IFieldConfig,
  ): () => Promise<boolean> {
    const page = this.page;
    return buildSubmitButtonFunction({
      submitCandidates: submitSelectorCandidates,
      submitField,
      /**
       * Get the active login frame or null.
       * @returns The active login context.
       */
      loginContext: () => this.activeLoginContext,
      /**
       * Get the current Playwright page.
       * @returns The page instance.
       */
      page: () => page,
    });
  }

  /**
   * Resolve the field selector and fill the input value.
   * @param pageOrFrame - The page or frame to search in.
   * @param fieldConfig - The field configuration with selectors.
   * @param value - The value to fill.
   * @returns The resolved field context.
   */
  private async resolveAndFill(
    pageOrFrame: Page | Frame,
    fieldConfig: IFieldConfig,
    value: string,
  ): Promise<IFieldContext> {
    const currentUrl = this.page.url();
    const result = await resolveFieldContext(
      this.activeLoginContext ?? pageOrFrame,
      fieldConfig,
      currentUrl,
    );
    if (result.isResolved) {
      this.activeLoginContext = result.context;
      await fillInput(result.context, result.selector, value);
    }
    return result;
  }

  /**
   * Fill a field with resolver, falling back to CSS selector if unresolved.
   * @param pageOrFrame - The page or frame containing the input.
   * @param fieldConfig - The field configuration with selectors.
   * @param field - The field selector and value.
   * @param field.selector - The CSS selector for the input.
   * @param field.value - The value to fill.
   * @returns True after the field is filled.
   */
  private async fillFieldWithFallback(
    pageOrFrame: Page | Frame,
    fieldConfig: IFieldConfig,
    field: { selector: string; value: string },
  ): Promise<boolean> {
    const result = await this.resolveAndFill(pageOrFrame, fieldConfig, field.value);
    if (!result.isResolved && field.selector) {
      const fallbackContext = this.activeLoginContext ?? pageOrFrame;
      await fillWithFallback(fallbackContext, field.selector, field.value);
    }
    return true;
  }
}
