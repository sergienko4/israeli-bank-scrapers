import { type Frame, type Page } from 'playwright';
import { clickButton, fillInput } from '../Helpers/ElementsInteractions';
import { candidateToCss, resolveFieldContext } from '../Helpers/SelectorResolver';
import { type ScraperCredentials } from './Interface';
import { type FieldConfig, type LoginConfig, type SelectorCandidate } from './LoginConfig';
import {
  BaseScraperWithBrowser,
  LOGIN_RESULTS,
  type LoginOptions,
  type PossibleLoginResults,
} from './BaseScraperWithBrowser';
import { type ScraperOptions } from './Interface';

function submitCandidates(submit: SelectorCandidate | SelectorCandidate[]): SelectorCandidate[] {
  return Array.isArray(submit) ? submit : [submit];
}

function toSubmitField(candidates: SelectorCandidate[]): FieldConfig {
  return {
    credentialKey: '__submit__',
    selectors: candidates as [SelectorCandidate, ...SelectorCandidate[]],
  };
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

interface SubmitButtonOpts {
  submitCands: SelectorCandidate[];
  submitField: FieldConfig;
  ctx: () => Page | Frame | null;
  page: () => Page;
}

function buildSubmitButtonFunction(opts: SubmitButtonOpts): () => Promise<void> {
  const { submitCands, submitField, ctx, page } = opts;
  return async () => {
    const activeCtx = ctx() ?? page();
    try {
      const { selector, context } = await resolveFieldContext(activeCtx, submitField, page().url());
      await clickButton(context, selector);
    } catch {
      await clickButton(activeCtx, candidateToCss(submitCands[0]));
    }
  };
}

function buildFieldList(
  config: LoginConfig,
  credentials: ScraperCredentials,
): { selector: string; value: string; credentialKey: string }[] {
  return config.fields.map(f => ({
    selector: candidateToCss(f.selectors[0]),
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
  private fieldConfigs: FieldConfig[] = [];

  constructor(
    options: ScraperOptions,
    protected readonly loginConfig: LoginConfig,
  ) {
    super(options);
  }

  getLoginOptions(credentials: TCredentials): LoginOptions {
    this.fieldConfigs = this.loginConfig.fields;
    const submitCands = submitCandidates(this.loginConfig.submit);
    const submitField = toSubmitField(submitCands);
    const config = this.loginConfig;
    const page = this.page;
    return {
      loginUrl: config.loginUrl,
      fields: buildFieldList(config, credentials),
      submitButtonSelector: this.buildSubmitSelector(submitCands, submitField),
      checkReadiness: config.checkReadiness ? () => config.checkReadiness!(page) : undefined,
      preAction: config.preAction ? () => config.preAction!(page) : undefined,
      postAction: config.postAction ? () => config.postAction!(page) : undefined,
      possibleResults: mapPossibleResults(config.possibleResults),
      waitUntil: config.waitUntil,
    };
  }

  async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    for (let i = 0; i < fields.length; i++) {
      const fieldConfig = this.fieldConfigs[i];
      const value = fields[i].value;
      if (fieldConfig) {
        await this.fillFieldWithFallback(pageOrFrame, fieldConfig, {
          selector: fields[i].selector,
          value,
        });
      } else {
        await fillInput(this.activeLoginContext ?? pageOrFrame, fields[i].selector, value);
      }
    }
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

  private async fillWithFallback(
    ctx: Page | Frame,
    selector: string,
    value: string,
  ): Promise<void> {
    await fillInput(ctx, selector, value);
  }

  private async resolveAndFill(
    pageOrFrame: Page | Frame,
    fieldConfig: FieldConfig,
    value: string,
  ): Promise<void> {
    const { selector, context } = await resolveFieldContext(
      this.activeLoginContext ?? pageOrFrame,
      fieldConfig,
      this.page.url(),
    );
    this.activeLoginContext = context;
    await fillInput(context, selector, value);
  }

  private async tryFallbackOrRethrow(
    pageOrFrame: Page | Frame,
    field: { selector: string; value: string },
    resolveError: unknown,
  ): Promise<void> {
    try {
      const ctx = this.activeLoginContext ?? pageOrFrame;
      await this.fillWithFallback(ctx, field.selector, field.value);
    } catch {
      throw resolveError;
    }
  }

  private async fillFieldWithFallback(
    pageOrFrame: Page | Frame,
    fieldConfig: FieldConfig,
    field: { selector: string; value: string },
  ): Promise<void> {
    try {
      await this.resolveAndFill(pageOrFrame, fieldConfig, field.value);
    } catch (e: unknown) {
      await this.tryFallbackOrRethrow(pageOrFrame, field, e);
    }
  }
}
