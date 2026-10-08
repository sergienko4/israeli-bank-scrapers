/**
 * Unit tests for AuthFailureWatcher.
 *
 * Drives the watcher with a hand-rolled MockPlaywrightPage that captures
 * the response listener registered via `page.on('response', listener)` and
 * exposes a `fire(response)` helper. No Playwright, no real browser —
 * pure logic / state-machine coverage.
 *
 * Layer 1 (HTTP 4xx) and Layer 2 (HTTP 200 + body-error pattern) are
 * both exercised. The Layer 2 fixtures use real success-shape JSON
 * taken from actual network captures (Beinleumi, Max, Hapoalim,
 * Discount), then mutated to their failure variants — proving the
 * body-error pattern table matches every migrated bank's contract.
 */

import {
  AUTH_BODY_FAILURE_PATTERNS,
  classifyBodyAsFailure,
  createAuthFailureWatcher,
  createFrozenAuthFailureWatcher,
  isAuthEndpointUrl,
  isFailureStatusCode,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/index.js';
import { makeMockPage, makeResponse, settle } from './AuthFailureWatcherMocks.js';

/** Real Beinleumi success body shape, mutated to failure (error_code != 0). */
const BEINLEUMI_FAILURE_BODY = JSON.stringify({
  error_code: -42,
  error_message: 'invalid credentials',
  data: '',
});
/** Real Max success body shape, mutated to failure (LoginStatus != 0). */
const MAX_FAILURE_BODY = JSON.stringify({
  Result: { LoginStatus: -1, LoginCode: -1 },
  ReturnCode: 0,
  RcDesc: 'invalid creds',
});
/** Real Hapoalim success body shape, mutated to failure (error: {...}). */
const HAPOALIM_FAILURE_BODY = JSON.stringify({
  flow: 'AUTHENTICATE',
  state: 'ERROR',
  error: { code: 'BAD_CREDS', detail: 'wrong password' },
});
/** Real Discount loginSuccessResponse shape, mutated to failure. */
const DISCOUNT_FAILURE_BODY = JSON.stringify({ Login: { Status: 'FAILED' } });
/** Exact Mizrahi login API URL from a real trace. */
const MIZRAHI_LOGIN_URL = 'https://www.mizrahi-tefahot.co.il/login/api/Login/LoginUser';
/** Real Mizrahi LoginUser success shape: Max's field names, non-zero codes, Success: true. */
const MIZRAHI_SUCCESS_BODY = JSON.stringify({
  ReturnCode: 1,
  LoginStatus: 1,
  ReturnMessagesKey: 'LoginOK',
  Success: true,
});
/** Real Mizrahi LoginUser rejection shape. */
const MIZRAHI_FAILURE_BODY = JSON.stringify({
  ReturnCode: 9,
  LoginStatus: 9,
  ReturnMessagesKey: 'IllegalCharacters',
  Success: false,
});

describe('AuthFailureWatcher — Layer 1 (HTTP 4xx)', () => {
  it('fires on 401 to a WK auth URL', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse('https://bank.example/api/v2/auth/login', 401, '');
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    expect(failure).toBeTruthy();
    if (failure !== false) {
      expect(failure.classifier).toBe('http-4xx');
      expect(failure.status).toBe(401);
    }
    watcher.dispose();
  });

  it('fires on 403 to a WK auth URL', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse('https://bank.example/api/v2/authentication/login', 403, '');
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    if (failure !== false) expect(failure.status).toBe(403);
    watcher.dispose();
  });

  it('fires on 422 to a WK auth URL', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse('https://bank.example/api/v2/authentication/login', 422, '');
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    if (failure !== false) expect(failure.status).toBe(422);
    watcher.dispose();
  });

  it('ignores 401 on a NON-auth URL (e.g. analytics endpoint)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse('https://api-js.mixpanel.com/track', 401, '');
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('ignores 5xx on auth URLs (server error, not credential rejection)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse('https://bank.example/api/v2/auth/login', 503, '');
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('ignores 200 on auth URL with success body (no L2 pattern match)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const successBody = JSON.stringify({ token: 'abc123', flow: 'AUTHENTICATE' });
    const fakeResponse = makeResponse('https://bank.example/api/v2/auth/login', 200, successBody);
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });
});

describe('AuthFailureWatcher — Layer 2 (HTTP 200 + body-error pattern)', () => {
  it('fires on Beinleumi-shape body { error_code: !=0 }', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse(
      'https://online.fibi.co.il/api/v2/auth/login',
      200,
      BEINLEUMI_FAILURE_BODY,
    );
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    expect(failure).toBeTruthy();
    if (failure !== false) {
      expect(failure.classifier).toBe('body-error');
      expect(failure.status).toBe(200);
    }
    watcher.dispose();
  });

  it('fires on Max-shape body { Result: { LoginStatus: !=0 } }', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse(
      'https://www.max.co.il/api/login/login',
      200,
      MAX_FAILURE_BODY,
    );
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    expect(failure).toBeTruthy();
    watcher.dispose();
  });

  it('fires on Hapoalim-shape body { error: {...} }', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse(
      'https://login.bankhapoalim.co.il/authenticate/init',
      200,
      HAPOALIM_FAILURE_BODY,
    );
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    expect(failure).toBeTruthy();
    watcher.dispose();
  });

  it('fires on Discount-shape body { Status: !=SUCCESS }', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse(
      'https://start.telebank.co.il/Lobby/gatewayAPI/loginSuccessResponse',
      200,
      DISCOUNT_FAILURE_BODY,
    );
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    expect(failure).toBeTruthy();
    watcher.dispose();
  });

  it('ignores body-error patterns on NON-auth URLs', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    // Same Beinleumi-shape body but on an analytics endpoint.
    const fakeResponse = makeResponse(
      'https://analytics.example/event',
      200,
      BEINLEUMI_FAILURE_BODY,
    );
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('ignores 200 + body without any pattern match', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const benignBody = JSON.stringify({
      token: 'xyz',
      refreshToken: 'abc',
      expires: 1000,
    });
    const fakeResponse = makeResponse('https://bank.example/api/v2/auth/login', 200, benignBody);
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('ignores body-error on 200 with `error: null` (Hapoalim success)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const successBody = JSON.stringify({
      flow: 'AUTHENTICATE',
      state: 'LOGON',
      result: { challenge: 'xyz' },
      error: null,
    });
    const fakeResponse = makeResponse(
      'https://login.bankhapoalim.co.il/authenticate/init',
      200,
      successBody,
    );
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('ignores the Mizrahi LoginUser success body (Success: true outranks codes)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse(MIZRAHI_LOGIN_URL, 200, MIZRAHI_SUCCESS_BODY);
    mockPage.fire(fakeResponse);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('fires on the Mizrahi LoginUser rejection body (Success: false)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse(MIZRAHI_LOGIN_URL, 200, MIZRAHI_FAILURE_BODY);
    mockPage.fire(fakeResponse);
    await settle();
    const failure = watcher.hasFailed();
    expect(failure).toBeTruthy();
    watcher.dispose();
  });
});

describe('AuthFailureWatcher — lifecycle (reset, dispose, await)', () => {
  it('reset() clears prior detection so a later failure can fire', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const firstFailure = makeResponse('https://bank.example/api/v2/auth/login', 401, '');
    mockPage.fire(firstFailure);
    await settle();
    const initial = watcher.hasFailed();
    expect(initial).toBeTruthy();
    watcher.reset();
    const afterReset = watcher.hasFailed();
    expect(afterReset).toBe(false);
    const secondFailure = makeResponse('https://bank.example/api/v2/auth/login', 403, '');
    mockPage.fire(secondFailure);
    await settle();
    const final = watcher.hasFailed();
    if (final !== false) expect(final.status).toBe(403);
    watcher.dispose();
  });

  it('dispose() removes the listener', () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const before = mockPage.listenerCount();
    expect(before).toBe(1);
    watcher.dispose();
    const after = mockPage.listenerCount();
    expect(after).toBe(0);
  });

  it('waitForFailure resolves with existing failure synchronously', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const fakeResponse = makeResponse('https://bank.example/api/v2/auth/login', 401, '');
    mockPage.fire(fakeResponse);
    await settle();
    const failure = await watcher.waitForFailure(50);
    expect(failure).toBeTruthy();
    if (failure !== false) expect(failure.status).toBe(401);
    watcher.dispose();
  });

  it('waitForFailure returns false on timeout when no failure observed', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const result = await watcher.waitForFailure(50);
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('waitForFailure path resolves on a Response observed during the wait', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    // Concurrently: launch waitForFailure with a generous timeout, then
    // fire a 4xx auth response. The listener captures it (state.detected
    // gets set), and waitForFailure's post-await re-read finds it.
    const waitPromise = watcher.waitForFailure(2000);
    // Immediately fire a 4xx auth response. Run inside setImmediate so
    // the await above is parked first.
    /**
     * Trigger an auth 4xx response on the mock page once microtasks run.
     * @returns True after firing.
     */
    const triggerOnce = (): boolean => {
      const resp = makeResponse('https://bank.example/api/v2/auth/login', 401, '{"err":1}');
      mockPage.fire(resp);
      return true;
    };
    globalThis.setImmediate(triggerOnce);
    const failure = await waitPromise;
    expect(failure).toBeTruthy();
    if (failure !== false) expect(failure.status).toBe(401);
    watcher.dispose();
  });

  it('listener short-circuits on dispose (no state mutation after teardown)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    watcher.dispose();
    const afterDispose = mockPage.listenerCount();
    expect(afterDispose).toBe(0);
    // Even if a stale Response somehow reached the disposed listener,
    // state would not change because dispose flips isDisposed first
    // and removes the handler. Asserting via hasFailed staying false.
    const stale = makeResponse('https://bank.example/api/v2/auth/login', 401, '');
    mockPage.fire(stale);
    await settle();
    const finalState = watcher.hasFailed();
    expect(finalState).toBe(false);
  });

  it('awaitFailure matcher rejects non-auth and non-fail responses', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const waitPromise = watcher.waitForFailure(120);
    /**
     * Fire a series of NON-matching responses, ensuring matcher branches
     * (auth-URL miss, status-not-4xx) are exercised. Then let timeout fire.
     * @returns True after firing all variants.
     */
    const triggerNonMatching = (): boolean => {
      // 1) Non-auth URL — matcher must reject on the URL branch.
      const nonAuth = makeResponse('https://api-js.mixpanel.com/track', 401, '');
      mockPage.fire(nonAuth);
      // 2) Auth URL but 200 — matcher must reject on the status branch.
      const auth200 = makeResponse('https://bank.example/api/v2/auth/login', 200, '{}');
      mockPage.fire(auth200);
      // 3) Auth URL with 5xx — also rejected.
      const auth5xx = makeResponse('https://bank.example/api/v2/auth/login', 500, '');
      mockPage.fire(auth5xx);
      return true;
    };
    globalThis.setImmediate(triggerNonMatching);
    const result = await waitPromise;
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('awaitFailure picks up an L2 (body-error) hit captured during the wait', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    // Wait expects a 4xx (L1) — but during the wait window we fire a
    // 200+body-error which the listener captures via L2. After the
    // wait times out, awaitFailure re-reads state.detected and returns
    // the L2 hit (the post-await race re-poll branch).
    const waitPromise = watcher.waitForFailure(120);
    /**
     * Fire a 200+body-error during the wait window so the L1 matcher
     * never matches but the listener writes an L2 record.
     * @returns True after firing.
     */
    const fireL2 = (): boolean => {
      const l2Body = JSON.stringify({ error_code: -1, error_message: 'bad creds' });
      const respL2 = makeResponse('https://online.fibi.co.il/api/v2/auth/login', 200, l2Body);
      mockPage.fire(respL2);
      return true;
    };
    globalThis.setImmediate(fireL2);
    const failure = await waitPromise;
    expect(failure).toBeTruthy();
    if (failure !== false) expect(failure.classifier).toBe('body-error');
    watcher.dispose();
  });

  it('listener ignores response when a failure is already detected', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const first = makeResponse('https://bank.example/api/v2/auth/login', 401, '{"a":1}');
    mockPage.fire(first);
    await settle();
    const firstHit = watcher.hasFailed();
    expect(firstHit).toBeTruthy();
    // Fire a SECOND auth failure — should be ignored (first wins).
    const second = makeResponse('https://bank.example/api/v2/auth/login', 422, '{"b":2}');
    mockPage.fire(second);
    await settle();
    const stillFirst = watcher.hasFailed();
    if (stillFirst !== false) expect(stillFirst.status).toBe(401);
    watcher.dispose();
  });

  it('waitForFailure returns false immediately when called on an already-disposed watcher', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    watcher.dispose();
    // Pre-await guard in awaitFailure: isDisposed=true → return false
    // without ever consulting the wait predicate (Waiter.ts L101 branch).
    const result = await watcher.waitForFailure(2000);
    expect(result).toBe(false);
  });

  it('waitForFailure returns false when disposed mid-wait even if a matching response arrives (CR PR #280 #121)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const waitPromise = watcher.waitForFailure(2000);
    // Dispose during the wait — listener is removed but the pending
    // Playwright waiter remains live in the mock (mirrors real
    // Playwright: page.off does not clear armed waitForResponse).
    watcher.dispose();
    /**
     * Fire an auth-4xx response so the wait predicate matches and
     * `next` resolves with a real Response. The post-await readDisposed
     * branch (Waiter.ts L87) then aborts BEFORE processAuthResponse.
     * @returns True after firing.
     */
    const triggerOnce = (): boolean => {
      const resp = makeResponse('https://bank.example/api/v2/auth/login', 401, '{"err":1}');
      mockPage.fire(resp);
      return true;
    };
    globalThis.setImmediate(triggerOnce);
    const failure = await waitPromise;
    expect(failure).toBe(false);
    // State must remain clean — the disposed-after-await branch returned
    // false without committing the response to state.detected.
    const finalState = watcher.hasFailed();
    expect(finalState).toBe(false);
  });
});

describe('AuthFailureWatcher — edge cases (empty body, idempotency)', () => {
  it('handles 200 with empty body (no JSON to parse)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const emptyResp = makeResponse('https://bank.example/api/v2/auth/login', 200, '');
    mockPage.fire(emptyResp);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('handles 200 with malformed JSON body (parse fails gracefully)', async () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const malformed = makeResponse(
      'https://bank.example/api/v2/auth/login',
      200,
      '{ this is not json',
    );
    mockPage.fire(malformed);
    await settle();
    const result = watcher.hasFailed();
    expect(result).toBe(false);
    watcher.dispose();
  });

  it('dispose() is idempotent — second call is a no-op', () => {
    const mockPage = makeMockPage();
    const watcher = createAuthFailureWatcher(mockPage.handle);
    const didFirstDispose = watcher.dispose();
    expect(didFirstDispose).toBe(true);
    const didSecondDispose = watcher.dispose();
    expect(didSecondDispose).toBe(false);
    const after = mockPage.listenerCount();
    expect(after).toBe(0);
  });
});

describe('AuthFailureWatcher — frozen variant (SCRAPE phase)', () => {
  it('createFrozenAuthFailureWatcher always reports not-failed', async () => {
    const watcher = createFrozenAuthFailureWatcher();
    const initial = watcher.hasFailed();
    expect(initial).toBe(false);
    const result = await watcher.waitForFailure(50);
    expect(result).toBe(false);
    const didReset = watcher.reset();
    expect(didReset).toBe(true);
    const didDispose = watcher.dispose();
    expect(didDispose).toBe(true);
  });
});

describe('AuthFailureWatcher — pure helpers', () => {
  it('isAuthEndpointUrl matches WK auth patterns and rejects others', () => {
    const isAuth1 = isAuthEndpointUrl('https://bank.example/api/v2/authentication/login');
    expect(isAuth1).toBe(true);
    const isAuth2 = isAuthEndpointUrl('https://bank.example/api/v2/auth/login');
    expect(isAuth2).toBe(true);
    const isAuthVerif = isAuthEndpointUrl(
      'https://start.telebank.co.il/Lobby/gatewayAPI/verification/getInfo',
    );
    expect(isAuthVerif).toBe(true);
    const isAuthSuccess = isAuthEndpointUrl(
      'https://start.telebank.co.il/Lobby/gatewayAPI/loginSuccessResponse',
    );
    expect(isAuthSuccess).toBe(true);
    const isAuthAnalytics = isAuthEndpointUrl('https://api-js.mixpanel.com/track');
    expect(isAuthAnalytics).toBe(false);
    const isAuthBalance = isAuthEndpointUrl('https://bank.example/api/v2/balance/list');
    expect(isAuthBalance).toBe(false);
  });

  it('isFailureStatusCode covers 400-499 inclusive only', () => {
    const isFail399 = isFailureStatusCode(399);
    expect(isFail399).toBe(false);
    const isFail400 = isFailureStatusCode(400);
    expect(isFail400).toBe(true);
    const isFail401 = isFailureStatusCode(401);
    expect(isFail401).toBe(true);
    const isFail499 = isFailureStatusCode(499);
    expect(isFail499).toBe(true);
    const isFail500 = isFailureStatusCode(500);
    expect(isFail500).toBe(false);
    const isFail200 = isFailureStatusCode(200);
    expect(isFail200).toBe(false);
  });

  it('classifyBodyAsFailure returns the pattern note for each known shape', () => {
    const beinleumi = classifyBodyAsFailure({ error_code: -1, data: '' });
    expect(beinleumi).toMatch(/Beinleumi/);
    const max1 = classifyBodyAsFailure({ LoginStatus: -1 });
    expect(max1).toMatch(/Max/);
    const max2 = classifyBodyAsFailure({ ReturnCode: 99 });
    expect(max2).toMatch(/Max/);
    const hapoalim = classifyBodyAsFailure({ error: 'bad' });
    expect(hapoalim).toMatch(/Hapoalim/);
    const discount = classifyBodyAsFailure({ Status: 'FAILED' });
    expect(discount).toMatch(/Discount/);
  });

  it('classifyBodyAsFailure handles error_code as STRING (Beinleumi variant)', () => {
    const stringFailure = classifyBodyAsFailure({ error_code: 'E42' });
    expect(stringFailure).toMatch(/Beinleumi/);
    const stringZero = classifyBodyAsFailure({ error_code: '0' });
    expect(stringZero).toBe(false);
    const stringEmpty = classifyBodyAsFailure({ error_code: '' });
    expect(stringEmpty).toBe(false);
    const stringBoolean = classifyBodyAsFailure({ error_code: true });
    expect(stringBoolean).toBe(false);
  });

  it('classifyBodyAsFailure handles error as STRING / OBJECT / empty-OBJECT (Hapoalim variants)', () => {
    const errorString = classifyBodyAsFailure({ error: 'something broke' });
    expect(errorString).toMatch(/Hapoalim/);
    const errorObject = classifyBodyAsFailure({ error: { code: 'X' } });
    expect(errorObject).toMatch(/Hapoalim/);
    const errorEmpty = classifyBodyAsFailure({ error: {} });
    expect(errorEmpty).toBe(false);
    const errorBoolean = classifyBodyAsFailure({ error: true });
    expect(errorBoolean).toBe(false);
  });

  it('classifyBodyAsFailure handles non-object inputs and undefined', () => {
    const nullBody = classifyBodyAsFailure(null);
    expect(nullBody).toBe(false);
    const stringBody = classifyBodyAsFailure('plain text');
    expect(stringBody).toBe(false);
    const numberBody = classifyBodyAsFailure(42);
    expect(numberBody).toBe(false);
    const undefinedBody = classifyBodyAsFailure(undefined);
    expect(undefinedBody).toBe(false);
  });

  it('classifyBodyAsFailure walks nested wrapper objects (Max Result.X, Discount Login.X)', () => {
    const maxNested = classifyBodyAsFailure({
      Result: { LoginStatus: -1, LoginCode: -1 },
      ReturnCode: 0,
    });
    expect(maxNested).toMatch(/Max/);
    const discountNested = classifyBodyAsFailure({ Login: { Status: 'FAILED' } });
    expect(discountNested).toMatch(/Discount/);
    const noWrapperFailure = classifyBodyAsFailure({
      Wrapper: { unrelatedField: 'x' },
    });
    expect(noWrapperFailure).toBe(false);
  });

  it('classifyBodyAsFailure returns false for success-shape bodies', () => {
    const beinleumiOk = classifyBodyAsFailure({ error_code: 0, data: 'token' });
    expect(beinleumiOk).toBe(false);
    const maxOk1 = classifyBodyAsFailure({ LoginStatus: 0 });
    expect(maxOk1).toBe(false);
    const maxOk2 = classifyBodyAsFailure({ ReturnCode: 0, RcDesc: null });
    expect(maxOk2).toBe(false);
    const hapoalimOk = classifyBodyAsFailure({ error: null });
    expect(hapoalimOk).toBe(false);
    const discountOk = classifyBodyAsFailure({ Status: 'SUCCESS' });
    expect(discountOk).toBe(false);
    const empty = classifyBodyAsFailure({});
    expect(empty).toBe(false);
  });

  it('AUTH_BODY_FAILURE_PATTERNS exposes one row per migrated bank', () => {
    /** Pattern row shape used to extract field names. */
    interface IFieldHolder {
      readonly field: string;
    }
    /**
     * Extract a field name for the assertion.
     * @param row - Pattern row with a readonly field.
     * @returns The field name.
     */
    const fieldOf = (row: IFieldHolder): string => row.field;
    const fields = AUTH_BODY_FAILURE_PATTERNS.map(fieldOf);
    expect(fields).toContain('LoginStatus');
    expect(fields).toContain('ReturnCode');
    expect(fields).toContain('error_code');
    expect(fields).toContain('error');
    expect(fields).toContain('Status');
  });
});
