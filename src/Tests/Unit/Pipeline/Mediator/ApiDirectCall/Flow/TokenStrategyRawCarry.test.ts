/**
 * Raw carry warm start through the token strategy: a new `v1.` token is
 * opened and its raw value seeded; a legacy raw token is still accepted; a
 * token minted for another bank is refused and the cold flow runs instead.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  createTokenStrategyFromConfig,
  type IConfigTokenStrategy,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/TokenStrategyFromConfig.js';
import {
  decodeRawCarry,
  encodeRawCarry,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmRawCarry.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { makeJwtExpiringIn, makeJwtExpiringInWithClaims } from '../../../../../Helpers/Jwt.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const WARM_STEP_TAG: WKUrlGroup = 'auth.assert';
const HINT = CompanyTypes.VisaCal;
const PROVIDER = 'visacal';
const USER = 'syn-user';
const PASSWORD = 'syn-password';
const RAW = 'syn-raw-hash';
const MINTED = 'syn-minted-hash';
const FOREIGN = 'syn-foreign-hash';
const CTX = { companyId: HINT } as unknown as IPipelineContext;

beforeAll((): void => {
  registerWkUrl(WARM_STEP_TAG, HINT, 'https://example.test/api/raw-carry');
});

/**
 * A carry warm start bound to the test provider and user.
 * @returns API-direct-call config.
 */
function rawConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: { queryTag: 'customer' },
    warmStart: {
      credsField: 'otpLongTermToken',
      carryField: 'token',
      fromStepIndex: 1,
      validation: 'bank-call',
      provider: PROVIDER,
      accountFields: ['username'],
    },
    steps: [
      {
        name: 'login',
        urlTag: WARM_STEP_TAG,
        body: { shape: {} },
        extractsToCarry: { token: '/hash' },
      },
    ],
  };
}

/**
 * A raw carry warm start validated by the inner JWT's expiry.
 * @returns API-direct-call config.
 */
function rawJwtConfig(): IApiDirectCallConfig {
  return {
    ...rawConfig(),
    warmStart: {
      credsField: 'otpLongTermToken',
      carryField: 'token',
      fromStepIndex: 1,
      provider: PROVIDER,
      accountFields: ['username'],
    },
    jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
  };
}

/**
 * Build the strategy under test.
 * @param config - Config literal, defaulting to the bank-call config.
 * @returns The config-driven token strategy.
 */
function makeStrategy(config: IApiDirectCallConfig = rawConfig()): IConfigTokenStrategy {
  const built = createTokenStrategyFromConfig({ config });
  assertOk(built);
  return built.value;
}

/**
 * Credentials carrying a stored token.
 * @param stored - Stored token.
 * @returns Credential bag.
 */
function credsWith(stored: string): Record<string, string> {
  return { username: USER, password: PASSWORD, otpLongTermToken: stored };
}

describe('raw carry warm start through the strategy', () => {
  it('seeds the raw value from a matching v1 envelope', async () => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const encoded = encodeRawCarry({ provider: PROVIDER, accounts: [USER], tagKey: PASSWORD }, RAW);
    assertOk(encoded);
    const strategy = makeStrategy();
    const creds = credsWith(encoded.value);
    const proc = await strategy.primeInitial(bus, CTX, creds);
    assertOk(proc);
    expect(proc.value).toBe(RAW);
    expect(captures).toHaveLength(0);
  });

  it('accepts a legacy raw token unchanged', async () => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const strategy = makeStrategy();
    const creds = credsWith('legacy-hash');
    const proc = await strategy.primeInitial(bus, CTX, creds);
    assertOk(proc);
    expect(proc.value).toBe('legacy-hash');
    expect(captures).toHaveLength(0);
  });

  it('refuses another bank’s token and runs the cold flow', async () => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ hash: MINTED })];
    const bus = makeStubMediator({ responses, captures });
    const foreign = encodeRawCarry({ provider: 'isracard', accounts: [USER] }, FOREIGN);
    assertOk(foreign);
    const strategy = makeStrategy();
    const creds = credsWith(foreign.value);
    const proc = await strategy.primeInitial(bus, CTX, creds);
    assertOk(proc);
    expect(proc.value).toBe(MINTED);
    expect(captures).toHaveLength(1);
  });

  it('reuses a published token when its inner JWT is fresh', async () => {
    const token = makeJwtExpiringInWithClaims(3600, { sub: 'syn-warm' });
    const coldCaptures: IApiPostCapture[] = [];
    const coldBus = makeStubMediator({
      responses: [succeed({ hash: token })],
      captures: coldCaptures,
    });
    const config = rawJwtConfig();
    const strategy = makeStrategy(config);
    const cold = await strategy.primeInitial(coldBus, CTX, { username: USER, password: PASSWORD });
    assertOk(cold);
    const published = strategy.getLatestLongTermToken();
    const warmCaptures: IApiPostCapture[] = [];
    const warmBus = makeStubMediator({
      responses: [succeed({ hash: 'cold-fallback' })],
      captures: warmCaptures,
    });
    const creds = credsWith(published);
    const warmConfig = rawJwtConfig();
    const warmStrategy = makeStrategy(warmConfig);
    const warm = await warmStrategy.primeInitial(warmBus, CTX, creds);
    assertOk(warm);
    expect(warm.value).toBe(token);
    expect(warmCaptures).toHaveLength(0);
  });

  it('runs the cold flow when the inner JWT is stale', async () => {
    const stale = makeJwtExpiringIn(-10);
    const encoded = encodeRawCarry(
      { provider: PROVIDER, accounts: [USER], tagKey: PASSWORD },
      stale,
    );
    assertOk(encoded);
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [succeed({ hash: MINTED })], captures });
    const creds = credsWith(encoded.value);
    const config = rawJwtConfig();
    const strategy = makeStrategy(config);
    const proc = await strategy.primeInitial(bus, CTX, creds);
    assertOk(proc);
    expect(proc.value).toBe(MINTED);
    expect(captures).toHaveLength(1);
  });

  it('runs the cold flow when a legacy raw JWT is stale', async () => {
    const stale = makeJwtExpiringIn(-10);
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [succeed({ hash: MINTED })], captures });
    const creds = credsWith(stale);
    const config = rawJwtConfig();
    const strategy = makeStrategy(config);
    const proc = await strategy.primeInitial(bus, CTX, creds);
    assertOk(proc);
    expect(proc.value).toBe(MINTED);
    expect(captures).toHaveLength(1);
  });

  it('refuses an unwrapped value with a control character', async () => {
    const encoded = encodeRawCarry(
      { provider: PROVIDER, accounts: [USER], tagKey: PASSWORD },
      'safe\r\nX-Injected: 1',
    );
    assertOk(encoded);
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [succeed({ hash: MINTED })], captures });
    const creds = credsWith(encoded.value);
    const proc = await makeStrategy().primeInitial(bus, CTX, creds);
    assertOk(proc);
    expect(proc.value).toBe(MINTED);
    expect(captures).toHaveLength(1);
  });

  it('publishes a legacy raw value when the envelope would not fit', async () => {
    const raw = makeJwtExpiringInWithClaims(3600, { pad: 'x'.repeat(9_300) });
    const encoded = encodeRawCarry({ provider: PROVIDER, accounts: [USER], tagKey: PASSWORD }, raw);
    assertOk(encoded);
    expect(raw.length).toBeLessThan(16384);
    expect(encoded.value.length).toBeGreaterThan(16384);
    const strategy = makeStrategy();
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [succeed({ hash: raw })], captures });
    const fresh = await strategy.primeFresh(bus, CTX, { username: USER, password: PASSWORD });
    assertOk(fresh);
    const published = strategy.getLatestLongTermToken();
    expect(published).toBe(raw);
  });

  it('clears a previous bound token when the replacement does not fit', async () => {
    const stored = encodeRawCarry({ provider: PROVIDER, accounts: [USER], tagKey: PASSWORD }, RAW);
    assertOk(stored);
    const strategy = makeStrategy();
    const warmBus = makeStubMediator({ responses: [], captures: [] });
    const warmCreds = credsWith(stored.value);
    const warm = await strategy.primeInitial(warmBus, CTX, warmCreds);
    assertOk(warm);
    const previous = strategy.getLatestLongTermToken();
    expect(previous).not.toBe('');
    const huge = makeJwtExpiringInWithClaims(3600, { pad: 'x'.repeat(20_000) });
    const hugeResponse = succeed({ hash: huge });
    const captures: IApiPostCapture[] = [];
    const freshBus = makeStubMediator({ responses: [hugeResponse], captures });
    const fresh = await strategy.primeFresh(freshBus, CTX, { username: USER, password: PASSWORD });
    assertOk(fresh);
    const published = strategy.getLatestLongTermToken();
    expect(published).toBe('');
  });

  it('publishes a v1 envelope for the token a cold flow mints', async () => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ hash: MINTED })];
    const bus = makeStubMediator({ responses, captures });
    const strategy = makeStrategy();
    const proc = await strategy.primeInitial(bus, CTX, { username: USER, password: PASSWORD });
    assertOk(proc);
    const exported = strategy.getLatestLongTermToken();
    const decoded = decodeRawCarry(exported, {
      provider: PROVIDER,
      accounts: [USER],
      tagKey: PASSWORD,
      maxChars: 16384,
    });
    assertOk(decoded);
    expect(decoded.value).toBe(MINTED);
  });
});
