import { type Frame, type Page } from 'playwright';
import { clickButton, fillInput } from '../helpers/elements-interactions';
import { candidateToCss, resolveFieldContext } from '../helpers/selector-resolver';
import { type ScraperCredentials, type ScraperScrapingResult } from './interface';
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

/**
 * A scraper base class driven by a `LoginConfig` declaration.
 * Handles login via selector resolution (ID → display-name → global dictionary).
 * Extend this class and implement `fetchData()` for each bank.
 *
 * For tests or one-off use where transaction fetching is not needed,
 * use `ConcreteGenericScraper` which provides a stub `fetchData()`.
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
      fields: config.fields.map(f => ({
        selector: candidateToCss(f.selectors[0]),
        value: (credentials as any)[f.credentialKey] ?? '',
        credentialKey: f.credentialKey, // carry key so base fillInputs uses full FieldConfig
      })),
      submitButtonSelector: async () => {
        // activeLoginContext (from base class) is set after fillInputs if an iframe was detected.
        const ctx = this.activeLoginContext ?? page;
        const { selector, context } = await resolveFieldContext(ctx, submitField, page.url());
        await clickButton(context, selector);
      },
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
        // Use full FieldConfig (explicit display-name candidates from LoginConfig) for Rounds 1-4.
        const { selector, context } = await resolveFieldContext(
          this.activeLoginContext ?? pageOrFrame,
          fieldConfig,
          this.page.url(),
        );
        this.activeLoginContext = context;
        await fillInput(context, selector, value);
      } else {
        await fillInput(this.activeLoginContext ?? pageOrFrame, fields[i].selector, value);
      }
    }
  }
}

/**
 * Concrete subclass of GenericBankScraper for testing or one-off use.
 * `fetchData()` returns an empty success — only the login mechanism is exercised.
 * Use this to verify selector resolution without implementing transaction fetching.
 */
export class ConcreteGenericScraper<TCredentials extends ScraperCredentials> extends GenericBankScraper<TCredentials> {
  // eslint-disable-next-line @typescript-eslint/require-await
  async fetchData(): Promise<ScraperScrapingResult> {
    return { success: true, accounts: [] };
  }
}
