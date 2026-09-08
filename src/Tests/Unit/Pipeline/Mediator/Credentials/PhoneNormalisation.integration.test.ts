/**
 * Integration test for the phone-normalisation wire-up.
 *
 * Per test-guidlines.md ("integration test over unit test"), this
 * single test exercises the WHOLE pipeline path: real
 * `PIPELINE_BANK_CONFIG` entry → `runApiDirectCallAction` →
 * `withNormalisedCreds` invocation → credentials reach the token
 * strategy in the bank's wire format.
 *
 * Why not three per-format unit tests on `formatPhoneNumber`: the
 * primitive is an internal detail; the only behaviour the rest of
 * the system depends on is "after the API-direct ACTION runs, every
 * step that resolves `$ref: creds.phoneNumber` sees the wire form
 * the bank expects." That is what this test pins.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { runApiDirectCallAction } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeStubMediator } from '../ApiDirectCall/Flow/StubMediator.js';

/** Caller-supplied phone (digits-only international, per README contract). */
const RAW_PHONE = '972000000000';

/**
 * Local mirror of the registry's `PhoneNumberFormatTag` union — the
 * Pipeline-tests ESLint preset bans importing `Registry/Config/**`
 * (DI rule: depend on `ctx.config`, not the central registry), so we
 * restate the tag here. A drift between this union and the registry
 * surfaces in the OneZero/Pepper Docker E2E (which uses the real
 * config) — that is the integration pin.
 */
type PhoneNumberFormatTag =
  'international-plus' | 'international-dash' | 'international-flat' | 'local-only';

/** Local mirror of the registry's `IPipelineBankConfig` shape — see above. */
interface IPipelineBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: 'token' | 'session-cookie' | 'api-direct';
  readonly headless?: {
    readonly identityBase: string;
    readonly graphql: string;
    readonly paths: Readonly<Record<string, string>>;
    readonly phoneNumberFormat?: PhoneNumberFormatTag;
  };
}

/**
 * Per-bank expectation: the bank's declared phoneNumberFormat, the value
 * the caller supplies, and the wire form the body templates should observe.
 *
 * The matrix covers every production `phoneNumberFormat` declaration
 * (`PipelineBankConfig.ts` lines 146/168/208) twice — once from the
 * canonical digits-only form the README documents, and once from the
 * bank's own wire form, which is what `docs/banks/*.md` tells callers to
 * pass. The second pass pins idempotence: a caller who follows the bank
 * guide must not be rejected.
 */
interface IBankWireCase {
  readonly bank: CompanyTypes;
  readonly phoneNumberFormat: PhoneNumberFormatTag;
  readonly rawPhone: string;
  readonly expectedWirePhone: string;
}

const BANK_CASES: readonly IBankWireCase[] = [
  {
    bank: CompanyTypes.OneZero,
    phoneNumberFormat: 'international-plus',
    rawPhone: RAW_PHONE,
    expectedWirePhone: '+972000000000',
  },
  {
    bank: CompanyTypes.PayBox,
    phoneNumberFormat: 'international-dash',
    rawPhone: RAW_PHONE,
    expectedWirePhone: '972-000000000',
  },
  {
    bank: CompanyTypes.Pepper,
    phoneNumberFormat: 'international-flat',
    rawPhone: RAW_PHONE,
    expectedWirePhone: '972000000000',
  },
  {
    bank: CompanyTypes.OneZero,
    phoneNumberFormat: 'international-plus',
    rawPhone: '+972000000000',
    expectedWirePhone: '+972000000000',
  },
  {
    bank: CompanyTypes.PayBox,
    phoneNumberFormat: 'international-dash',
    rawPhone: '972-000000000',
    expectedWirePhone: '972-000000000',
  },
];

/**
 * Build a minimal IApiDirectCallConfig with a primer step that
 * lets the ACTION succeed and reach `bus.withTokenStrategy` so we
 * can capture the credentials that flow through.
 * @returns IApiDirectCallConfig literal.
 */
function makeProbeConfig(): IApiDirectCallConfig {
  return { flow: 'sms-otp', envelope: {}, steps: [] };
}

/**
 * Capture slot — populated by the stub mediator's `withTokenStrategy`
 * hook with the creds parameter so the test can assert on the
 * post-normalisation phoneNumber.
 */
interface ICredsCapture {
  capturedPhone: string;
}

/**
 * Build a stub mediator that captures the creds passed to
 * `withTokenStrategy` and a primeSession that immediately succeeds
 * so the action reaches the capture point.
 * @param capture - Mutable capture slot.
 * @returns Mediator stub with capturing `withTokenStrategy`.
 */
function makeCapturingBus(capture: ICredsCapture): IApiMediator {
  const base = makeStubMediator({ responses: [], captures: [], primeBearer: 'bearer' });
  return {
    ...base,
    /**
     * Capture the creds passed by `runApiDirectCallAction` after its
     * phone-normalisation step, then defer to the base stub.
     * @param strategy - Token strategy (unused).
     * @param ctx - Pipeline context (unused).
     * @param creds - Creds bag whose phoneNumber we capture.
     * @returns Ack — propagated to keep the call signature stable.
     */
    withTokenStrategy: (strategy, ctx, creds): true => {
      const phone = (creds as { phoneNumber?: unknown }).phoneNumber;
      capture.capturedPhone = typeof phone === 'string' ? phone : '';
      return base.withTokenStrategy(strategy, ctx, creds);
    },
  };
}

/**
 * Build a pipeline bank config literal mirroring the shape of a
 * `PIPELINE_BANK_CONFIG` entry — only the fields exercised by
 * `withNormalisedCreds` (headless.phoneNumberFormat) carry meaning.
 * Keeps the test self-contained per DI rule (no production-config import).
 * @param format - Wire-format tag declared by the bank.
 * @returns Pipeline bank config literal.
 */
function makeBankConfig(format: PhoneNumberFormatTag): IPipelineBankConfig {
  return {
    urls: { base: 'https://example.invalid' },
    balanceKind: 'account',
    authStrategyKind: 'api-direct',
    headless: {
      identityBase: 'https://identity.example.invalid/',
      graphql: 'https://graph.example.invalid/graphql',
      paths: {},
      phoneNumberFormat: format,
    },
  };
}

/** Args bundle for {@link makeBankCtx} — keeps params ≤3. */
interface IBankCtxArgs {
  readonly bank: CompanyTypes;
  readonly config: IPipelineBankConfig;
  readonly bus: IApiMediator;
  readonly rawPhone?: string;
}

/**
 * Build an action-ready pipeline context bound to a bank config
 * literal plus the capturing mediator.
 * @param args - Bank discriminator, config literal, mediator, raw phone.
 * @returns IPipelineContext.
 */
function makeBankCtx(args: IBankCtxArgs): IPipelineContext {
  const base = makeMockContext();
  const phoneNumber = args.rawPhone ?? RAW_PHONE;
  const credentials = { ...base.credentials, phoneNumber };
  return {
    ...base,
    companyId: args.bank,
    apiMediator: some(args.bus),
    config: args.config,
    credentials,
  };
}

/**
 * Run the ACTION stage with a phone the bank's format cannot represent.
 *
 * @param format - Bank wire format under test.
 * @param rawPhone - Phone that format must refuse.
 * @returns Failure message the stage produced, or `''` when it succeeded.
 */
async function failureMessageFor(format: PhoneNumberFormatTag, rawPhone: string): Promise<string> {
  const capture: ICredsCapture = { capturedPhone: '' };
  const bus = makeCapturingBus(capture);
  const bankConfig = makeBankConfig(format);
  const baseCtx = makeBankCtx({ bank: CompanyTypes.Pepper, config: bankConfig, bus });
  const credentials = { ...baseCtx.credentials, phoneNumber: rawPhone };
  const config = makeProbeConfig();
  const result = await runApiDirectCallAction(config, { ...baseCtx, credentials });
  return result.success ? '' : result.errorMessage;
}

describe('Phone normalisation — pipeline integration', () => {
  it.each(BANK_CASES)(
    'normalises creds.phoneNumber to the bank wire format ($bank: $rawPhone → $expectedWirePhone)',
    async ({ bank, phoneNumberFormat, rawPhone, expectedWirePhone }) => {
      const capture: ICredsCapture = { capturedPhone: '' };
      const bus = makeCapturingBus(capture);
      const bankConfig = makeBankConfig(phoneNumberFormat);
      const ctx = makeBankCtx({ bank, config: bankConfig, bus, rawPhone });
      const config = makeProbeConfig();
      const result = await runApiDirectCallAction(config, ctx);
      expect(result.success).toBe(true);
      expect(capture.capturedPhone).toBe(expectedWirePhone);
    },
  );

  it('passes through unchanged when the bank declares no phoneNumberFormat', async () => {
    const capture: ICredsCapture = { capturedPhone: '' };
    const bus = makeCapturingBus(capture);
    const bank = CompanyTypes.OneZero;
    const configNoFormat: IPipelineBankConfig = {
      urls: { base: 'https://example.invalid' },
      balanceKind: 'account',
      authStrategyKind: 'api-direct',
      headless: {
        identityBase: 'https://identity.example.invalid/',
        graphql: 'https://graph.example.invalid/graphql',
        paths: {},
      },
    };
    const ctx = makeBankCtx({ bank, config: configNoFormat, bus });
    const config = makeProbeConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(true);
    expect(capture.capturedPhone).toBe(RAW_PHONE);
  });

  it('passes through unchanged when credentials.phoneNumber is absent', async () => {
    const capture: ICredsCapture = { capturedPhone: '' };
    const bus = makeCapturingBus(capture);
    const bank = CompanyTypes.OneZero;
    const bankConfig = makeBankConfig('international-plus');
    const baseCtx = makeBankCtx({ bank, config: bankConfig, bus });
    const credsWithoutPhone = { ...baseCtx.credentials } as Record<string, unknown>;
    delete credsWithoutPhone.phoneNumber;
    const ctx: IPipelineContext = {
      ...baseCtx,
      credentials: credsWithoutPhone as IPipelineContext['credentials'],
    };
    const config = makeProbeConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(true);
    expect(capture.capturedPhone).toBe('');
  });

  it('rejects an unusable phone before any credential reaches the wire', async () => {
    const capture: ICredsCapture = { capturedPhone: '' };
    const bus = makeCapturingBus(capture);
    const bank = CompanyTypes.OneZero;
    const malformedPhone = '+972-000-000-000';
    const bankConfig = makeBankConfig('international-plus');
    const baseCtx = makeBankCtx({ bank, config: bankConfig, bus });
    const ctx: IPipelineContext = {
      ...baseCtx,
      credentials: { ...baseCtx.credentials, phoneNumber: malformedPhone },
    };
    const config = makeProbeConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(false);
    expect(capture.capturedPhone).toBe('');
  });

  it('names the failure so a caller can tell it from a generic fault', async () => {
    const capture: ICredsCapture = { capturedPhone: '' };
    const bus = makeCapturingBus(capture);
    const bank = CompanyTypes.OneZero;
    const bankConfig = makeBankConfig('international-plus');
    const baseCtx = makeBankCtx({ bank, config: bankConfig, bus });
    const ctx: IPipelineContext = {
      ...baseCtx,
      credentials: { ...baseCtx.credentials, phoneNumber: '+972-000-000-000' },
    };
    const config = makeProbeConfig();
    const result = await runApiDirectCallAction(config, ctx);
    const errorType = result.success ? '' : result.errorType;
    expect(errorType).toBe(ScraperErrorTypes.InvalidPhoneNumber);
  });

  /**
   * The natural Israeli form is the one a user is most likely to supply,
   * and it is the one that used to fail worst: `checkCountryCode` rejects
   * it, the old code logged a warning and kept it, and Pepper then shipped
   * it verbatim as `x-user-id`. The bank answered with an opaque auth
   * failure that named nothing. It must be refused here instead.
   */
  it('refuses the local Israeli form rather than shipping it as-is', async () => {
    const capture: ICredsCapture = { capturedPhone: '' };
    const bus = makeCapturingBus(capture);
    const bank = CompanyTypes.Pepper;
    const localForm = '0500000001';
    const bankConfig = makeBankConfig('international-flat');
    const baseCtx = makeBankCtx({ bank, config: bankConfig, bus });
    const ctx: IPipelineContext = {
      ...baseCtx,
      credentials: { ...baseCtx.credentials, phoneNumber: localForm },
    };
    const config = makeProbeConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(false);
    expect(capture.capturedPhone).toBe('');
  });

  /**
   * `formatPhoneNumber` already names the field it rejected, and PayBox
   * propagates that reason verbatim (`PayBoxBootstrap.deriveHmacKey`), so
   * the prefix has to stay where it is. The wrapper here should therefore
   * contribute only what it alone knows — the target wire format — rather
   * than restating the field and producing `…: phoneNumber: …`.
   */
  it('names the phoneNumber field once, not twice, in the failure message', async () => {
    const message = await failureMessageFor('international-flat', '0500000001');
    const mentions = message.split('phoneNumber').length - 1;
    expect(mentions).toBe(1);
    expect(message).toContain('international-flat');
    expect(message).toContain('country code 972');
  });
});
