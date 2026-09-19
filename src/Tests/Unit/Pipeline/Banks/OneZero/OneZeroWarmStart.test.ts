/**
 * Regression tests for issue #576 — OneZero warm start.
 *
 * OneZero's login chain mints several artifacts. The warm-start config decides
 * WHICH one we hand back to the caller as `persistentOtpToken`, and therefore
 * how long an SMS-free re-login keeps working. Persisting a mid-chain artifact
 * caps warm start at that artifact's lifetime, and because the warm path only
 * ever consumes it, the stored value is re-persisted unchanged and never
 * rotates.
 *
 * These tests pin the durable artifact and the resume point. They are
 * behavioural where it matters: the second block asserts which request a warm
 * login actually puts on the wire, so a config change that quietly reintroduces
 * the defect fails here rather than an hour into a user's cron job.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test
 * architectural rule (Pipeline tests don't statically import from
 * Registry/Config — same pattern as `PayBoxConfig.test.ts`).
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IConfigTokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { createTokenStrategyFromConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { ITokenContext } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeJwtExpiringIn } from '../../../../Helpers/Jwt.js';
import type { IApiPostCapture } from '../../Mediator/ApiDirectCall/Flow/StubMediator.js';
import { makeStubMediator } from '../../Mediator/ApiDirectCall/Flow/StubMediator.js';

const CALL_PATH = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZero.js';

/**
 * Importing this module seeds the well-known URL registry as a load-time side
 * effect, which the flow needs before it can resolve a step's `urlTag`.
 */
const REGISTRY_PATH = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js';

/** Module shape returned by the dynamic call-config import. */
interface ICallModule {
  readonly ONEZERO_API_DIRECT_CALL: IApiDirectCallConfig;
}

/** Token context — the flow reads only the resolved bank identity. */
const CTX: ITokenContext = { companyId: CompanyTypes.OneZero };

/**
 * Load the OneZero call-config module via the permitted dynamic-import hatch.
 * @returns Promise resolving to the OneZero config literal.
 */
async function loadCall(): Promise<IApiDirectCallConfig> {
  const mod = (await import(CALL_PATH)) as ICallModule;
  return mod.ONEZERO_API_DIRECT_CALL;
}

/**
 * Seed the well-known URL registry so step `urlTag`s resolve.
 * @returns true once the registry module has been loaded.
 */
async function seedWellKnownUrls(): Promise<true> {
  await import(REGISTRY_PATH);
  return true;
}

describe('ONEZERO_API_DIRECT_CALL — warm-start contract (issue #576)', () => {
  it('persists the idToken, not the short-lived mid-chain otpToken', async () => {
    const config = await loadCall();
    expect(config.warmStart?.carryField).toBe('idToken');
  });

  it('still mints a fresh access token on the warm path', async () => {
    const config = await loadCall();
    const resumed = config.steps.slice(config.warmStart?.fromStepIndex ?? 0);
    const produced = resumed.flatMap(step => Object.keys(step.extractsToCarry));
    expect(produced).toContain('token');
  });

  it('keeps the resume point inside the step list', async () => {
    const config = await loadCall();
    const index = config.warmStart?.fromStepIndex ?? -1;
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(config.steps.length);
  });

  it('persists an artifact produced by the step before the resume point', async () => {
    const config = await loadCall();
    const carryField = config.warmStart?.carryField ?? '';
    const resumeIndex = config.warmStart?.fromStepIndex ?? 0;
    const producer = config.steps[resumeIndex - 1];
    const producedFields = Object.keys(producer.extractsToCarry);
    expect(producedFields).toContain(carryField);
  });

  it('declares a jwtClaims freshness gate like every other warm-start bank', async () => {
    const config = await loadCall();
    expect(config.jwtClaims).toEqual({ freshnessField: 'exp', skewSeconds: 60 });
  });
});

/** Password used by the synthetic credentials below. */
const SYNTHETIC_PASSWORD = 'synthetic-pass';

/** Durable artifact the cold chain mints at `getIdToken`. */
const FRESH_TOKEN_SECONDS = 3600;
const STALE_TOKEN_SECONDS = 10;
const COLD_ID_TOKEN = 'cold-chain-id-token';

/** Scripted `/sessions/token` response — the only call a warm login makes. */
const WARM_RESPONSES: readonly Procedure<unknown>[] = [
  succeed({ resultData: { accessToken: 'fresh-access-token' } }),
];

/** Scripted responses for the full five-step cold SMS chain. */
const COLD_RESPONSES: readonly Procedure<unknown>[] = [
  succeed({ resultData: { deviceToken: 'device-token' } }),
  succeed({ resultData: { otpContext: 'otp-context' } }),
  succeed({ resultData: { otpToken: 'short-lived-otp-token' } }),
  succeed({ resultData: { idToken: COLD_ID_TOKEN } }),
  succeed({ resultData: { accessToken: 'fresh-access-token' } }),
];

/** The request sequence a full cold SMS login puts on the wire. */
const COLD_URL_SEQUENCE: readonly string[] = [
  'identity.deviceToken',
  'identity.otpPrepare',
  'identity.otpVerify',
  'identity.getIdToken',
  'identity.sessionToken',
];

/** Observations returned by {@link prime}. */
interface IPrimeObservation {
  readonly urls: readonly string[];
  readonly captures: readonly IApiPostCapture[];
  readonly persisted: string;
  readonly isSuccess: boolean;
}

/**
 * Resolve a fixed synthetic SMS code, standing in for the user's inbox.
 * @returns The synthetic OTP code.
 */
async function otpCodeRetriever(): Promise<string> {
  await Promise.resolve();
  return '123456';
}

/**
 * Build synthetic credentials, optionally carrying a stored warm-start token.
 * @param stored - Stored token, or '' to force the cold path.
 * @returns Credentials bag accepted by the strategy.
 */
function buildCreds(stored: string): Record<string, unknown> {
  const creds: Record<string, unknown> = {
    email: 'synthetic@example.test',
    password: SYNTHETIC_PASSWORD,
    phoneNumber: '+972000000000',
    otpCodeRetriever,
  };
  if (stored.length > 0) creds.otpLongTermToken = stored;
  return creds;
}

/** Raised when the OneZero config cannot produce a token strategy. */
class StrategyBuildError extends Error {}

/**
 * Build the token strategy from the real OneZero config.
 * @returns The strategy under test.
 */
async function buildOneZeroStrategy(): Promise<IConfigTokenStrategy> {
  await seedWellKnownUrls();
  const config = await loadCall();
  const built = createTokenStrategyFromConfig({ config });
  if (!isOk(built)) throw new StrategyBuildError(built.errorMessage);
  return built.value;
}

/**
 * Run a prime against the real OneZero config with scripted responses.
 * @param stored - Value supplied as `creds.otpLongTermToken` ('' for cold).
 * @param responses - Scripted apiPost responses, in call order.
 * @returns Captured requests, the persisted token and the prime outcome.
 */
async function prime(
  stored: string,
  responses: readonly Procedure<unknown>[],
): Promise<IPrimeObservation> {
  const strategy = await buildOneZeroStrategy();
  const captures: IApiPostCapture[] = [];
  const bus = makeStubMediator({ responses, captures });
  const creds = buildCreds(stored);
  const proc = await strategy.primeInitial(bus, CTX, creds);
  const urls = captures.map(capture => String(capture.url));
  const persisted = strategy.getLatestLongTermToken();
  return { urls, captures, persisted, isSuccess: isOk(proc) };
}

describe('OneZero cold login — what it persists (issue #576)', () => {
  it('runs the full SMS chain and persists the durable idToken', async () => {
    const { urls, persisted, isSuccess } = await prime('', COLD_RESPONSES);
    expect(isSuccess).toBe(true);
    expect(urls).toEqual(COLD_URL_SEQUENCE);
    expect(persisted).toBe(COLD_ID_TOKEN);
  });
});

describe('OneZero warm login — what actually goes on the wire (issue #576)', () => {
  it('renews the session from the stored token without replaying the OTP chain', async () => {
    const stored = makeJwtExpiringIn(FRESH_TOKEN_SECONDS);
    const { urls, isSuccess } = await prime(stored, WARM_RESPONSES);
    expect(isSuccess).toBe(true);
    expect(urls).toEqual(['identity.sessionToken']);
  });

  it('sends the stored token as idToken alongside the mandatory password', async () => {
    const stored = makeJwtExpiringIn(FRESH_TOKEN_SECONDS);
    const { captures } = await prime(stored, WARM_RESPONSES);
    expect(captures[0].body).toEqual({ idToken: stored, pass: SYNTHETIC_PASSWORD });
  });

  it('never replays the stored token into getIdToken, which would cap it at one hour', async () => {
    const stored = makeJwtExpiringIn(FRESH_TOKEN_SECONDS);
    const { urls } = await prime(stored, WARM_RESPONSES);
    expect(urls).not.toContain('identity.getIdToken');
  });

  it('falls back to the cold SMS chain when the stored token is already stale', async () => {
    const stored = makeJwtExpiringIn(-STALE_TOKEN_SECONDS);
    const { urls, isSuccess } = await prime(stored, COLD_RESPONSES);
    expect(isSuccess).toBe(true);
    expect(urls).toEqual(COLD_URL_SEQUENCE);
  });

  it('falls back to the cold SMS chain for a legacy opaque token, so upgrades self-heal', async () => {
    const { urls, persisted, isSuccess } = await prime('legacy-opaque-otp-token', COLD_RESPONSES);
    expect(isSuccess).toBe(true);
    expect(urls).toEqual(COLD_URL_SEQUENCE);
    expect(persisted).toBe(COLD_ID_TOKEN);
  });
});
