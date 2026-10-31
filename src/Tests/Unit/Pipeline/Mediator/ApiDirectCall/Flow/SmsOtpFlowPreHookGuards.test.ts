/**
 * N15/N21/D12 — OTP pre-hook guards. The retriever receives the `hintFrom`
 * carry slot (or `''`). A pre-hook's `requires` refs resolve, against the
 * step's jar view, before the retriever is asked; a miss fails and no code is
 * asked for. The code must match `valuePattern`, else the step fails InvalidOtp
 * before its request. A retriever throw is reported by error name only.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
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
  readonly jar?: ICookieSession;
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
 * @returns Config.
 */
function configWith(hook: Hook): IApiDirectCallConfig {
  const otpStep: IStepConfig = {
    name: 'login',
    urlTag: WARM_STEP_TAG,
    body: { shape: { otp: { $ref: 'carry.otp' } } },
    extractsToCarry: { token: '/token' },
    preHook: hook,
  };
  return { flow: 'sms-otp', envelope: {}, steps: [BIND_STEP, otpStep] };
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
    if (args.thrown !== undefined) return Promise.reject(args.thrown);
    return Promise.resolve(args.code ?? '12345');
  };
  const config = configWith(args.hook);
  const creds = { otpCodeRetriever };
  const result = await runSmsOtpFlow({ config, bus, creds, companyId: HINT });
  return { result, captures, hints };
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
});
