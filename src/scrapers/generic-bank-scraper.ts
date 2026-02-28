import { type Frame, type Page } from 'playwright';
import { clickButton, fillInput } from '../helpers/elements-interactions';
import { candidateToCss, resolveFieldContext } from '../helpers/selector-resolver';
import { type ScraperCredentials } from './interface';
import { type FieldConfig, type LoginConfig, type SelectorCandidate } from './login-config';
import {
  BaseScraperWithBrowser,
  LoginResults,
  type LoginOptions,
  type PossibleLoginResults,
} from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';

function submitCandidates(submit: SelectorCandidate | SelectorCandidate[]): SelectorCandidate[] {
  return Array.isArray(submit) ? submit : [submit];
}

function toSubmitField(candidates: SelectorCandidate[]): FieldConfig {
  return { credentialKey: '__submit__', selectors: candidates as [SelectorCandidate, ...SelectorCandidate[]] };
}

function mapPossibleResults(r: LoginConfig['possibleResults']): PossibleLoginResults {
  return {
    [LoginResults.Success]: r.success,
    ...(r.invalidPassword ? { [LoginResults.InvalidPassword]: r.invalidPassword } : {}),
    ...(r.changePassword ? { [LoginResults.ChangePassword]: r.changePassword } : {}),
    ...(r.accountBlocked ? { [LoginResults.AccountBlocked]: r.accountBlocked } : {}),
    ...(r.unknownError ? { [LoginResults.UnknownError]: r.unknownError } : {}),
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

function buildFieldList(config: LoginConfig, credentials: ScraperCredentials): { selector: string; value: string; credentialKey: string }[] {
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
      submitButtonSelector: buildSubmitButtonFunction({ submitCands, submitField, ctx: () => this.activeLoginContext, page: () => page }),
      checkReadiness: config.checkReadiness ? () => config.checkReadiness!(page) : undefined,
      preAction: config.preAction ? () => config.preAction!(page) : undefined,
      postAction: config.postAction ? () => config.postAction!(page) : undefined,
      possibleResults: mapPossibleResults(config.possibleResults),
      waitUntil: config.waitUntil,
    };
  }

  private async fillWithFallback(ctx: Page | Frame, selector: string, value: string): Promise<void> {
    await fillInput(ctx, selector, value);
  }

  private async fillFieldWithFallback(pageOrFrame: Page | Frame, fieldConfig: FieldConfig, field: { selector: string; value: string }): Promise<void> {
    try {
      const { selector, context } = await resolveFieldContext(this.activeLoginContext ?? pageOrFrame, fieldConfig, this.page.url());
      this.activeLoginContext = context;
      await fillInput(context, selector, field.value);
    } catch {
      await this.fillWithFallback(this.activeLoginContext ?? pageOrFrame, field.selector, field.value);
    }
  }

  async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    for (let i = 0; i < fields.length; i++) {
      const fieldConfig = this.fieldConfigs[i];
      const value = fields[i].value;
      if (fieldConfig) {
        await this.fillFieldWithFallback(pageOrFrame, fieldConfig, { selector: fields[i].selector, value });
      } else {
        await fillInput(this.activeLoginContext ?? pageOrFrame, fields[i].selector, value);
      }
    }
  }
}
