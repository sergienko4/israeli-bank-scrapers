/**
 * OTP pre-hook guards. The retriever receives the `hintFrom`
 * carry slot (or `''`). A pre-hook's `requires` refs resolve, against the
 * step's jar view, before the retriever is asked; a miss fails and no code is
 * asked for. The code must match `valuePattern` and, when carry states an OTP
 * length, have exactly that many digits, else the step fails InvalidOtp before
 * its request; a stated length outside 4..10 fails before any code is asked
 * for. A retriever throw is reported by error name only.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import { createHeadlessApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/SmsOtpFlow.js';
import { DEFAULT_OTP_TIMEOUT_MS } from '../../../../../../Scrapers/Pipeline/Mediator/Timing/OtpTimingConfig.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ICookieSession } from '../../../../../../Scrapers/Pipeline/Types/Domain/CookieSession.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { none, type Option, some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const STEP_URL = 'https://bank.example/authenticate/verify';
const CARRIED_URL = 'https://portal.example/landing?t=syn-ticket';
const SECRETS = ['syn-otp-48213', 'syn-phone-0501234567', 'syn-cookie-q9z'];

/** A step's pre-hook config. */
type Hook = NonNullable<IStepConfig['preHook']>;

/** The bind step: reads a token and, when sent, the phone hint and flow. */
const BIND_STEP: IStepConfig = {
  name: 'bind',
  urlTag: WARM_STEP_TAG,
  body: { shape: {} },
  extractsToCarry: { token: '/token' },
  optionalExtractsToCarry: { phone: { pointer: '/phone' }, flow: { pointer: '/flow' } },
};

const HOOK: Hook = {
  awaitCredsField: 'otpCodeRetriever',
  intoCarryField: 'otp',
  hintFrom: 'carry.phone',
  requires: ['carry.flow'],
  valuePattern: String.raw`^\d{5}$`,
};

const NO_HINT_HOOK: Hook = { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otp' };

const COOKIE_HOOK: Hook = { ...HOOK, requires: ['cookie.csrfcookie'] };

const FULL_BIND = { token: 'bind-token', phone: '050***1234', flow: 'auth' };

/** What one guarded run gets. */
interface IGuardRunArgs {
  readonly hook: Hook;
  readonly bind: JsonValue;
  readonly code?: string;
  readonly thrown?: Error;
  readonly retriever?: (hint: string) => Promise<string>;
  readonly otpTimeoutMs?: number;
  readonly jar?: ICookieSession;
  readonly setCookies?: IStepConfig['setCookies'];
  readonly config?: IApiDirectCallConfig;
}

/** What one guarded run did. */
interface IGuardRun {
  readonly result: Procedure<unknown>;
  readonly captures: IApiPostCapture[];
  readonly hints: string[];
}

/**
 * The two-step config whose OTP step carries the given pre-hook.
 * @param hook - The pre-hook.
 * @param setCookies - Client cookies the OTP step will send, if any.
 * @returns Config.
 */
function configWith(hook: Hook, setCookies?: IStepConfig['setCookies']): IApiDirectCallConfig {
  const otpStep: IStepConfig = {
    name: 'login',
    urlTag: WARM_STEP_TAG,
    body: { shape: { otp: { $ref: 'carry.otp' } } },
    extractsToCarry: { token: '/token' },
    preHook: hook,
    setCookies,
  };
  return { flow: 'sms-otp', envelope: {}, steps: [BIND_STEP, otpStep] };
}

/**
 * The two-step config whose OTP step is a GET sent to the URL bind carried.
 * @param hook - The pre-hook.
 * @returns Config.
 */
function carriedConfigWith(hook: Hook): IApiDirectCallConfig {
  const extractsToCarry = { token: '/token', handoff: '/handoff' };
  const bindStep: IStepConfig = {
    ...BIND_STEP,
    extractsToCarry,
    extractRules: { handoff: { url: [{ origin: 'https://portal.example', paths: ['/landing'] }] } },
  };
  const otpStep: IStepConfig = {
    name: 'login',
    urlTag: WARM_STEP_TAG,
    method: 'GET',
    urlFromCarry: 'handoff',
    extractsToCarry: { token: '/token' },
    preHook: hook,
  };
  return { flow: 'sms-otp', envelope: {}, steps: [bindStep, otpStep] };
}

/**
 * A fake domain jar holding the given cookies; records the URLs it is asked.
 * @param cookies - Cookie name to raw value.
 * @param urls - Receives every URL a cookie is read for.
 * @returns Cookie session.
 */
function fakeJar(cookies: Readonly<Record<string, string>>, urls: string[]): ICookieSession {
  return {
    /**
     * Read a cookie for a URL.
     * @param url - Request URL.
     * @param name - Cookie name.
     * @returns The raw value, if held.
     */
    cookieFor(url: string, name: string): Option<string> {
      urls.push(url);
      return Object.hasOwn(cookies, name) ? some(cookies[name]) : none();
    },
    /**
     * No Cookie header.
     * @returns None.
     */
    headerFor: (): Option<string> => none(),
    /**
     * Ignore a client cookie.
     * @returns Jar size.
     */
    set: (): number => 0,
    /**
     * Nothing to export.
     * @returns No cookies.
     */
    exportAll: (): readonly [] => [],
    /**
     * Ignore an import.
     * @returns Jar size.
     */
    importAll: (): number => 0,
    /**
     * Nothing to clear.
     * @returns Jar size.
     */
    clear: (): number => 0,
  };
}

/**
 * A real domain jar seeded with a malformed cookie at the given path.
 * @param path - Cookie path, which determines request precedence.
 * @returns The run's cookie-session port.
 */
function realJarWithRawCookie(path: string): ICookieSession {
  const bus = createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: 'https://bank.example/',
    graphqlUrl: 'https://bank.example/graphql',
    sessionCookies: true,
    cookieDomains: ['bank.example'],
  });
  const jar = bus.cookies;
  if (jar === undefined) throw new TypeError('domain jar fixture unavailable');
  jar.importAll([
    {
      name: 'csrfcookie',
      value: 'syn-%ZZ',
      domain: 'bank.example',
      path,
      hostOnly: true,
      secure: true,
      expiresEpochS: 0,
    },
  ]);
  return jar;
}

/**
 * Run the two-step flow with a retriever that records its hint.
 * @param args - Hook, bind answer, code or throw, optional jar.
 * @returns The flow result, the requests sent and the hints received.
 */
async function runGuarded(args: IGuardRunArgs): Promise<IGuardRun> {
  const captures: IApiPostCapture[] = [];
  const responses = [succeed(args.bind), succeed({ token: 'otp-token' })];
  const stub = makeStubMediator({ responses, captures });
  const bus = args.jar === undefined ? stub : { ...stub, cookies: args.jar };
  const hints: string[] = [];
  /**
   * Record the hint, then throw or deliver the code.
   * @param hint - Hint from the flow.
   * @returns The delivered code.
   */
  const otpCodeRetriever = (hint: string): Promise<string> => {
    hints.push(hint);
    if (args.retriever !== undefined) return args.retriever(hint);
    if (args.thrown !== undefined) return Promise.reject(args.thrown);
    return Promise.resolve(args.code ?? '12345');
  };
  const config = args.config ?? configWith(args.hook, args.setCookies);
  const creds = { otpCodeRetriever, otpTimeoutMs: args.otpTimeoutMs };
  const result = await runSmsOtpFlow({ config, bus, creds, companyId: HINT });
  return { result, captures, hints };
}

/**
 * Simulates an OTP source that never delivers a code.
 * @returns A pending retriever promise.
 */
function pendingOtpCode(): Promise<string> {
  return new Promise<string>(() => undefined);
}

/** An OTP hook whose exact length comes from carry. */
const LENGTH_HOOK: Hook = {
  awaitCredsField: 'otpCodeRetriever',
  intoCarryField: 'otp',
  valuePattern: '^[0-9]{4,10}$',
  valueLengthRef: 'carry.otpLength',
};

/** The bind answer's `otpLength`, or none. */
type Stated = Readonly<Record<string, JsonValue>>;

/**
 * Run the flow with an OTP hook whose length the bind answer states.
 * @param stated - `{ otpLength }` for the bind answer, or `{}` to leave it out.
 * @param code - The code the retriever delivers.
 * @param hook - Length-aware hook, optionally without a pattern.
 * @returns The guarded run.
 */
async function runLength(
  stated: Stated,
  code: string,
  hook: Hook = LENGTH_HOOK,
): Promise<IGuardRun> {
  const base = configWith(hook);
  const isStated = Object.hasOwn(stated, 'otpLength');
  const lengthExtracts = { token: '/token', otpLength: '/otpLength' };
  const extractsToCarry = isStated ? lengthExtracts : BIND_STEP.extractsToCarry;
  const bindStep: IStepConfig = { ...BIND_STEP, extractsToCarry };
  const config: IApiDirectCallConfig = { ...base, steps: [bindStep, base.steps[1]] };
  const bind = { ...FULL_BIND, ...stated };
  return runGuarded({ hook, bind, code, config });
}

describe('SmsOtpFlow — pre-hook guards', () => {
  beforeAll((): void => {
    registerWkUrl(WARM_STEP_TAG, HINT, STEP_URL);
  });

  it('passes the hintFrom slot to the retriever', async () => {
    const run = await runGuarded({ hook: HOOK, bind: FULL_BIND });
    expect(run.result).toMatchObject({ success: true });
    expect(run.hints).toEqual(['050***1234']);
    expect(run.captures).toHaveLength(2);
  });

  it.each<[string, Hook, JsonValue]>([
    ['the hint slot is absent', HOOK, { token: 'bind-token', flow: 'auth' }],
    ['the hint slot is not text', HOOK, { ...FULL_BIND, phone: 7 }],
    ['the hook has no hintFrom', NO_HINT_HOOK, FULL_BIND],
  ])('passes an empty hint when %s', async (_label, hook, bind) => {
    const run = await runGuarded({ hook, bind });
    expect(run.result).toMatchObject({ success: true });
    expect(run.hints).toEqual(['']);
  });

  it('fails a carry requires miss before asking for a code', async () => {
    const run = await runGuarded({ hook: HOOK, bind: { token: 'bind-token', phone: 'p' } });
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'ref carry.flow missing from scope.carry',
    });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
  });

  it('reads a required cookie through the step jar view', async () => {
    const urls: string[] = [];
    const jar = fakeJar({ csrfcookie: SECRETS[2] }, urls);
    const run = await runGuarded({ hook: COOKIE_HOOK, bind: FULL_BIND, jar });
    expect(run.result).toMatchObject({ success: true });
    expect(run.hints).toHaveLength(1);
    expect(urls[0]).toBe(STEP_URL);
  });

  it('resolves a required cookie the same step will set before requesting an OTP', async () => {
    const jar = fakeJar({}, []);
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: 'carry.flow' },
    });
    expect(run.result).toMatchObject({ success: true });
    expect(run.hints).toHaveLength(1);
    expect(run.captures).toHaveLength(2);
  });

  it('previews a present optional cookie before requesting an OTP', async () => {
    const jar = fakeJar({}, []);
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: { ref: 'carry.flow', optional: true } },
    });
    expect(run.result).toMatchObject({ success: true });
    expect(run.hints).toHaveLength(1);
    expect(run.captures).toHaveLength(2);
  });

  it.each([
    ['absent', 'carry.missing', FULL_BIND],
    ['empty', 'carry.flow', { ...FULL_BIND, flow: '' }],
  ] as const)(
    'previews the stored cookie when the optional source is %s',
    async (_label, ref, bind) => {
      const jar = fakeJar({ csrfcookie: SECRETS[2] }, []);
      const run = await runGuarded({
        hook: COOKIE_HOOK,
        bind,
        jar,
        setCookies: { csrfcookie: { ref, optional: true } },
      });
      expect(run.result).toMatchObject({ success: true });
      expect(run.hints).toHaveLength(1);
    },
  );

  it.each([
    ['absent', 'carry.missing', FULL_BIND],
    ['empty', 'carry.flow', { ...FULL_BIND, flow: '' }],
    ['invalid', 'carry.flow', { ...FULL_BIND, flow: 'not valid' }],
  ] as const)(
    'does not request an OTP when a required optional cookie is %s',
    async (_label, ref, bind) => {
      const run = await runGuarded({
        hook: COOKIE_HOOK,
        bind,
        jar: fakeJar({}, []),
        setCookies: { csrfcookie: { ref, optional: true } },
      });
      expect(run.result).toMatchObject({ success: false });
      expect(run.hints).toEqual([]);
      expect(run.captures).toHaveLength(1);
    },
  );

  it('does not request an OTP for a malformed optional cookie source', async () => {
    const jar = realJarWithRawCookie('/');
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: { ref: 'cookie.csrfcookie', optional: true } },
    });
    expect(run.result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie bad' });
    expect(run.hints).toEqual([]);
  });

  it('honors stored path precedence when previewing an optional write', async () => {
    const jar = realJarWithRawCookie('/authenticate');
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: { ref: 'carry.flow', optional: true } },
    });
    expect(run.result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie bad' });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
    const stored = jar.exportAll();
    expect(stored).toHaveLength(1);
  });

  it('does not set a same-step cookie before all required refs validate', async () => {
    const set = jest.fn<ReturnType<ICookieSession['set']>, Parameters<ICookieSession['set']>>(
      () => 0,
    );
    const jar = { ...fakeJar({}, []), set };
    const hook = { ...COOKIE_HOOK, requires: ['cookie.csrfcookie', 'carry.absent'] as const };
    const run = await runGuarded({
      hook,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: 'carry.flow' },
    });
    expect(run.result).toMatchObject({
      success: false,
      errorMessage: 'ref carry.absent missing from scope.carry',
    });
    expect(run.hints).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps the cookie resolver miss when a same-step cookie cannot resolve', async () => {
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar: fakeJar({}, []),
      setCookies: { csrfcookie: 'carry.missing' },
    });
    expect(run.result).toMatchObject({
      success: false,
      errorMessage: 'ref cookie.csrfcookie miss',
    });
    expect(run.hints).toEqual([]);
  });

  it('rejects a deeper invalid cookie before an OTP despite a pending root cookie', async () => {
    const jar = realJarWithRawCookie('/authenticate');
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: 'carry.flow' },
    });
    expect(run.result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie bad' });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
    const stored = jar.exportAll();
    expect(stored).toHaveLength(1);
  });

  it('preserves a malformed cookie source failure instead of reporting a miss', async () => {
    const jar = realJarWithRawCookie('/');
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: 'cookie.csrfcookie' },
    });
    expect(run.result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie bad' });
    expect(run.hints).toEqual([]);
    const stored = jar.exportAll();
    expect(stored).toHaveLength(1);
  });

  it('accepts a pending root cookie that replaces the stored root cookie', async () => {
    const jar = realJarWithRawCookie('/');
    const run = await runGuarded({
      hook: COOKIE_HOOK,
      bind: FULL_BIND,
      jar,
      setCookies: { csrfcookie: 'carry.flow' },
    });
    expect(run.result).toMatchObject({ success: true });
    expect(run.hints).toHaveLength(1);
    expect(run.captures).toHaveLength(2);
    const cookie = jar.cookieFor(STEP_URL, 'csrfcookie');
    expect(cookie).toEqual({ has: true, value: 'auth' });
  });

  it('binds the jar view to a carried step URL', async () => {
    const urls: string[] = [];
    const jar = fakeJar({ csrfcookie: SECRETS[2] }, urls);
    const config = carriedConfigWith(COOKIE_HOOK);
    const bind = { ...FULL_BIND, handoff: CARRIED_URL };
    const run = await runGuarded({ hook: COOKIE_HOOK, bind, jar, config });
    expect(run.result).toMatchObject({ success: true });
    expect(urls[0]).toBe(CARRIED_URL);
  });

  it.each<[string, boolean, boolean]>([
    ['no jar, no required refs', false, false],
    ['no jar, required ref', false, true],
    ['jar, no required refs', true, false],
    ['jar, required ref', true, true],
  ])('refuses a relative carried URL before OTP with %s', async (_label, hasJar, hasRequires) => {
    const hook: Hook = { ...NO_HINT_HOOK, requires: hasRequires ? ['carry.flow'] : [] };
    const jar = hasJar ? fakeJar({}, []) : undefined;
    const config = carriedConfigWith(hook);
    const bind = { ...FULL_BIND, handoff: '//portal.example/landing' };
    const run = await runGuarded({ hook, bind, jar, config });
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'login carried url invalid',
    });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
  });

  it.each<[string, ICookieSession | undefined]>([
    ['the jar lacks the cookie', fakeJar({}, [])],
    ['the run has no jar', undefined],
  ])('fails a cookie requires miss when %s', async (_label, jar) => {
    const run = await runGuarded({ hook: COOKIE_HOOK, bind: FULL_BIND, jar });
    expect(run.result).toMatchObject({
      success: false,
      errorMessage: 'ref cookie.csrfcookie miss',
    });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
  });

  it.each(['1234', '123456', '12a45'])(
    'fails code %s outside valuePattern as InvalidOtp before the request',
    async code => {
      const run = await runGuarded({ hook: HOOK, bind: FULL_BIND, code });
      expect(run.result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.InvalidOtp,
        errorMessage: 'login preHook value invalid',
      });
      expect(run.captures).toHaveLength(1);
    },
  );

  it.each<[string, JsonValue]>([
    ['false', false],
    ['zero', 0],
    ['an object', { unexpected: 'state' }],
  ])('refuses an optional fallback over %s before asking for OTP', async (_label, flow) => {
    const config = configWith(HOOK);
    const bindStep: IStepConfig = {
      ...BIND_STEP,
      optionalExtractsToCarry: { flow: { pointer: '/flow', fallback: 'logonotp' } },
      extractRules: { flow: { type: 'string', oneOf: ['logonotp'] } },
    };
    const run = await runGuarded({
      hook: HOOK,
      bind: { token: 'bind-token', flow },
      config: { ...config, steps: [bindStep, config.steps[1]] },
    });
    expect(run.result).toMatchObject({ success: false, errorMessage: 'bind extract flow invalid' });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
  });

  it('reports a retriever throw by its error name only', async () => {
    const thrown = new TypeError(`retriever failed: ${SECRETS.join(' ')}`);
    const run = await runGuarded({ hook: HOOK, bind: FULL_BIND, thrown });
    const message = run.result.success ? '' : run.result.errorMessage;
    expect(message).toBe('preHook: creds.otpCodeRetriever() threw TypeError');
    for (const secret of SECRETS) expect(message).not.toContain(secret);
    expect(run.captures).toHaveLength(1);
  });

  it('reports a retriever throw named by a secret as Error', async () => {
    const thrown = new TypeError('retriever failed');
    thrown.name = SECRETS[0];
    const run = await runGuarded({ hook: HOOK, bind: FULL_BIND, thrown });
    const message = run.result.success ? '' : run.result.errorMessage;
    expect(message).toBe('preHook: creds.otpCodeRetriever() threw Error');
  });

  it.each<[string, Stated, string]>([
    ['a numeric length', { otpLength: 6 }, '123456'],
    ['a decimal-text length', { otpLength: '6' }, '123456'],
    ['an absent length (valuePattern only)', {}, '12345'],
  ])('accepts a code of the length carry states: %s', async (_label, stated, code) => {
    const run = await runLength(stated, code);
    expect(run.result).toMatchObject({ success: true });
    expect(run.captures).toHaveLength(2);
  });

  it.each(['12345', '1234567'])(
    'fails code %s of another length as InvalidOtp before the request',
    async code => {
      const run = await runLength({ otpLength: 6 }, code);
      expect(run.result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.InvalidOtp,
        errorMessage: 'login preHook value invalid',
      });
      expect(run.captures).toHaveLength(1);
    },
  );

  it('rejects same-length nondigits without a valuePattern', async () => {
    const hook: Hook = { ...NO_HINT_HOOK, valueLengthRef: 'carry.otpLength' };
    const run = await runLength({ otpLength: 6 }, '12ab56', hook);
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage: 'login preHook value invalid',
    });
    expect(run.hints).toHaveLength(1);
    expect(run.captures).toHaveLength(1);
  });

  it.each<[string, JsonValue]>([
    ['below 4', 3],
    ['above 10', 11],
    ['not an integer', 6.5],
    ['not decimal text', 'six'],
    ['null', null],
  ])('refuses a length ref %s before asking for a code', async (_label, otpLength) => {
    const run = await runLength({ otpLength }, '123456');
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'login preHook length invalid',
    });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
  });

  it('rejects a nonpositive OTP budget before asking for a code', async () => {
    const run = await runGuarded({ hook: HOOK, bind: FULL_BIND, otpTimeoutMs: 0 });
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'preHook: otpTimeoutMs invalid',
    });
    expect(run.hints).toEqual([]);
    expect(run.captures).toHaveLength(1);
  });

  it.each<[string, number | undefined, number]>([
    ['configured', 10, 10],
    ['default', undefined, DEFAULT_OTP_TIMEOUT_MS],
  ])('times out a pending retriever with the %s OTP budget', async (_label, otpTimeoutMs, ms) => {
    jest.useFakeTimers();
    try {
      const request = runGuarded({
        hook: HOOK,
        bind: FULL_BIND,
        otpTimeoutMs,
        retriever: pendingOtpCode,
      });
      await jest.advanceTimersByTimeAsync(ms);
      const run = await Promise.race([request, Promise.resolve('still waiting')]);
      expect(run).toMatchObject({
        result: { success: false, errorType: ScraperErrorTypes.Timeout },
        captures: [expect.anything()],
        hints: ['050***1234'],
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
