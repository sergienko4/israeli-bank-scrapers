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

function submitCandidates(submit: SelectorCandidate | SelectorCandidate[]): SelectorCandidate[] {
  return Array.isArray(submit) ? submit : [submit];
}

function toSubmitField(candidates: SelectorCandidate[]): FieldConfig {
  return { credentialKey: '__submit__', selectors: candidates };
}

function mapPossibleResults(r: LoginConfig['possibleResults']): PossibleLoginResults {
  return {
    [LOGIN_RESULTS.Success]: r.success,
    ...(r.invalidPassword ? { [LOGIN_RESULTS.InvalidPassword]: r.invalidPassword } : {}),
    ...(r.changePassword ? { [LOGIN_RESULTS.ChangePassword]: r.changePassword } : {}),
    ...(r.accountBlocked ? { [LOGIN_RESULTS.AccountBlocked]: r.accountBlocked } : {}),
    ...(r.unknownError ? { [LOGIN_RESULTS.UnknownError]: r.unknownError } : {}),
  };
}

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

function buildSubmitButtonFunction(opts: {
  submitCands: SelectorCandidate[];
  submitField: FieldConfig;
  ctx: () => Page | Frame | null;
  page: () => Page;
}): () => Promise<void> {
  const { submitCands, submitField, ctx, page } = opts;
  return async () => {
    const activeCtx = ctx() ?? page();
    const result = await resolveFieldContext(activeCtx, submitField, page().url());
    if (result.isResolved) {
      await clickButton(result.context, result.selector);
    } else {
      await clickButton(activeCtx, candidateToCss(submitCands[0]));
    }
  };
}

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

  constructor(
    options: ScraperOptions,
    protected readonly loginConfig: LoginConfig,
  ) {
    super(options);
  }

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

  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    await fields.reduce(async (prev, field, i) => {
      await prev;
      await this.fillFieldWithFallback(pageOrFrame, this._fieldConfigs[i], {
        selector: field.selector,
        value: field.value,
      });
    }, Promise.resolve());
  }

  private buildSubmitSelector(
    submitCands: SelectorCandidate[],
    submitField: FieldConfig,
  ): () => Promise<void> {
    const page = this.page;
    return buildSubmitButtonFunction({
      submitCands,
      submitField,
      ctx: () => this.activeLoginContext,
      page: () => page,
    });
  }

  private async resolveAndFill(
    pageOrFrame: Page | Frame,
    fieldConfig: FieldConfig,
    value: string,
  ): Promise<FieldContext> {
    const result = await resolveFieldContext(
      this.activeLoginContext ?? pageOrFrame,
      fieldConfig,
      this.page.url(),
    );
    if (result.isResolved) {
      this.activeLoginContext = result.context;
      await fillInput(result.context, result.selector, value);
    }
    return result;
  }

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
