/**
 * Mission M4.F2.b — LOGIN.POST OTP discriminator.
 *
 * <p>Pins {@link validateActionScopeIntact}'s ambiguous-branch
 * behaviour: when URL is unchanged AND the password element is still
 * resolvable AND an OTP-trigger or OTP-input element is visible, the
 * validator returns `false` (fall through to OTP-TRIGGER) instead of
 * firing a false-positive `INVALID_PASSWORD`.
 *
 * <p>Test Case IDs:
 *   - LOGIN-POST-OTP-001: OTP form visible → fall through (no fail)
 *   - LOGIN-POST-OTP-002: OTP trigger visible → fall through (no fail)
 *   - LOGIN-POST-OTP-003: neither visible → INVALID_PASSWORD (regression guard)
 *   - LOGIN-POST-OTP-004: URL changed → fall through immediately (no probe)
 *   - LOGIN-POST-OTP-005: password absent → fall through immediately (no probe)
 */

import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { validateActionScopeIntact } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  ILoginFieldDiscovery,
  IPipelineContext,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { LOGIN_FIELDS } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Discriminator for the stub's `resolveVisible`: WK_OTP_INPUT's first
 * candidate uses `placeholder` kind; WK_OTP_TRIGGER's first candidate
 * uses `clickableText` kind. Real probe order is fixed in
 * `otpScreenVisible` so the stub can route by candidate kind without
 * coupling to call order.
 */
const OTP_INPUT_KIND = 'placeholder';

/** First-candidate kind that identifies the OTP-trigger probe. */
const OTP_TRIGGER_KIND = 'clickableText';

/**
 * Stub IRaceResult: a found / not-found pair so the stub mediator
 * can report "OTP visible" via a successful race.
 *
 * @param wasFound - Whether the candidate was resolved.
 * @returns Race-result-like shape with the {found} flag set.
 */
function raceResult(wasFound: boolean): IRaceResult {
  return { found: wasFound } as unknown as IRaceResult;
}

/** Configuration for the stub mediator's per-call answers. */
interface IMediatorConfig {
  readonly currentUrl: string;
  readonly passwordCount: number;
  readonly otpTriggerFound: boolean;
  readonly otpFormFound: boolean;
}

/**
 * Build a minimal IElementMediator stub that answers the four
 * mediator calls `validateActionScopeIntact` (and its OTP probe)
 * make: `getCurrentUrl`, `countBySelector`, and two `resolveVisible`
 * calls — one for OTP trigger, one for OTP input.
 *
 * @param config - Scripted answers for this scenario.
 * @returns IElementMediator stub.
 */
function makeMediator(config: IMediatorConfig): IElementMediator {
  return {
    /**
     * Returns the scripted current URL.
     * @returns Scripted URL string.
     */
    getCurrentUrl: (): string => config.currentUrl,
    /**
     * Returns the scripted password-selector count.
     * @returns Scripted count.
     */
    countBySelector: async (): Promise<number> => {
      await Promise.resolve();
      return config.passwordCount;
    },
    /**
     * Routes between OTP-trigger and OTP-input probe answers based on
     * the first candidate's `kind` field — `placeholder` for input
     * candidates, `clickableText` for trigger candidates. Mirrors the
     * registry shape from WK_OTP_INPUT / WK_OTP_TRIGGER.
     * @param candidates - Candidates passed by the probe.
     * @returns Race result with the {found} flag set.
     */
    resolveVisible: async (
      candidates: readonly { readonly kind: string }[],
    ): Promise<IRaceResult> => {
      await Promise.resolve();
      const kind = candidates[0]?.kind ?? '';
      if (kind === OTP_TRIGGER_KIND) return raceResult(config.otpTriggerFound);
      if (kind === OTP_INPUT_KIND) return raceResult(config.otpFormFound);
      return raceResult(false);
    },
  } as unknown as IElementMediator;
}

/**
 * Build a minimal IPipelineContext stub with the fields
 * {@link validateActionScopeIntact} reads.
 *
 * @param loginUrl - The login URL stored in diagnostics.
 * @param passwordSelector - Selector string used by the validator.
 * @returns Pipeline-context-shaped stub.
 */
function makeContext(loginUrl: string, passwordSelector: string): IPipelineContext {
  const passwordTarget: IResolvedTarget = {
    selector: passwordSelector,
    contextId: 'frame-0',
    kind: 'css',
    candidateValue: 'password',
  };
  const discovery: ILoginFieldDiscovery = {
    targets: new Map([[LOGIN_FIELDS.PASSWORD, passwordTarget]]),
    formAnchor: none(),
    activeFrameId: 'frame-0',
    submitTarget: none(),
  };
  return {
    diagnostics: { loginUrl },
    loginFieldDiscovery: some(discovery),
    logger: {
      /**
       * No-op debug sink — discards diagnostics produced by the
       * validator so the test asserts only on the return value.
       * Returns a non-undefined value to satisfy the architecture
       * `no-return-void` rule; the validator never reads it.
       * @returns Constant false sentinel.
       */
      debug: (): false => false,
      /**
       * No-op trace sink — same intent as the debug sink.
       * @returns Constant false sentinel.
       */
      trace: (): false => false,
    },
  } as unknown as IPipelineContext;
}

describe('LOGIN.POST validateActionScopeIntact — M4.F2.b OTP discriminator', () => {
  const loginUrl = 'https://login.bank.fake.example/ng-portals/auth/he/';
  const passwordSelector = '#password';

  it('LOGIN-POST-OTP-001: OTP form visible → fall through (no fail)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      otpTriggerFound: false,
      otpFormFound: true,
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-002: OTP trigger visible → fall through (no fail)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      otpTriggerFound: true,
      otpFormFound: false,
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-003: neither OTP element visible → INVALID_PASSWORD', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      otpTriggerFound: false,
      otpFormFound: false,
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.success).toBe(false);
    }
  });

  it('LOGIN-POST-OTP-004: URL changed → fall through immediately (no probe)', async () => {
    const mediator = makeMediator({
      currentUrl: 'https://login.bank.fake.example/dashboard/',
      passwordCount: 1,
      otpTriggerFound: false,
      otpFormFound: false,
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-005: password element absent → fall through (no probe)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 0,
      otpTriggerFound: false,
      otpFormFound: false,
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });
});
