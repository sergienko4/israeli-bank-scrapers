/**
 * PayBox post-login request-body contract.
 *
 * <p>PayBox carries no `Authorization` header after login, so the
 * DATA calls identify themselves through a class-y `auth: { … }` body
 * envelope. `T-PB-BODY-2` asserts every data step carries a populated
 * one, so a step added later that forgets it fails here rather than in
 * a live E2E run.
 *
 * <p><b>The balance call (`/sync`) is the exception</b> and
 * `T-PB-BODY-3` pins it: it must ship `{}`. PayBox answers it 400
 * either way, but a rejected body carrying the live `access_token`
 * makes PayBox invalidate the session — forensic run 31015484475 shows
 * `/getUserHistory` returning `401 UNAUTHORIZED` 355 ms later. A
 * regression that "fixed" `/sync` by adding the envelope cost a full
 * release cycle.
 *
 * <p>The gap this file closes is that the phase-level integration test
 * stubs `apiPost` as `(urlTag) => route(urlTag)` and therefore never
 * inspects the body it was handed. Asserting the shape of the REQUEST —
 * not just the handling of the RESPONSE — is what pins both halves of
 * the contract.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';
import { FIXT_GETKEY_TSIV, FIXT_GETKEY_TSKEY, FIXT_PHONE } from './PayBoxBusFactory.js';

const FIXT_UID = 'pb-uid-fixture-1';
const FIXT_DEVICE = 'fixt-device-pb-0001';
const FIXT_TOKEN = 'fixt-jwt-pb-0001';

/** Session-context the ApiDirectCall phase deposits before scrape runs. */
const PAYBOX_SESSION: Readonly<Record<string, unknown>> = Object.freeze({
  uId: FIXT_UID,
  deviceId16Hex: FIXT_DEVICE,
  token: FIXT_TOKEN,
});

/**
 * The balance URL tag, read from the production shape rather than
 * restated here — a test that hardcodes it would keep passing if the
 * shape moved the balance call to another endpoint. PayBox declares it
 * as a literal; a function form would mean the tag is per-account and
 * this whole file's premise no longer holds, so fail loudly.
 */
const RAW_BALANCE_TAG: unknown = PAYBOX_SHAPE.balance.urlTag;
if (typeof RAW_BALANCE_TAG !== 'string') {
  throw new TypeError('PAYBOX_SHAPE.balance.urlTag must be a literal tag');
}
const BALANCE_URL_TAG: string = RAW_BALANCE_TAG;

/** Envelope fields that carry caller identity — must never be blank. */
const IDENTITY_FIELDS = ['uId', 'uuid', 'access_token'] as const;

/** Envelope fields sourced from PAYBOX_AUTH_ENVELOPE_DEFAULTS. */
const CLIENT_FIELDS = ['appVer', 'type', 'os'] as const;

/** One recorded apiPost dispatch. */
interface ICapturedCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/**
 * Canned response bodies keyed by URL tag — shaped to satisfy the real
 * PayBox extractors so the phase completes its full walk. A map (OCP)
 * rather than a URL `if` chain: a new step is one entry, not a new branch.
 *
 * The `getUserHistory` row's `ts` equals the first-page sentinel, which
 * stalls the cursor and so terminates pagination after one fetch.
 */
const CANNED_BODIES: ReadonlyMap<string, unknown> = new Map([
  ['data.getKey', { content: { tsKey: FIXT_GETKEY_TSKEY, tsIv: FIXT_GETKEY_TSIV } }],
  ['data.sync', { content: { userFunds: { balance: 100 } } }],
  ['data.getUserHistory', { content: { nc: [{ ts: 'null' }] } }],
]);

/**
 * Resolve the canned response for a dispatched URL tag.
 * @param url - WK URL tag apiPost was called with.
 * @returns Procedure the stub resolves with.
 */
function respondTo(url: string): Procedure<unknown> {
  const body = CANNED_BODIES.get(url);
  if (body === undefined) return fail(ScraperErrorTypes.Generic, `unexpected url=${url}`);
  return succeed(body);
}

/**
 * Build a mediator that records the body of every apiPost dispatch.
 * @param sink - Array each dispatched call is appended to.
 * @returns Mock mediator.
 */
function makeRecordingBus(sink: ICapturedCall[]): IApiMediator {
  const apiPost = jest.fn(async (url: string, body: unknown): Promise<Procedure<unknown>> => {
    await Promise.resolve();
    sink.push({ url, body: (body ?? {}) as Record<string, unknown> });
    return respondTo(url);
  });
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn((): boolean => true),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => PAYBOX_SESSION),
  } as unknown as IApiMediator;
}

/**
 * Read the `auth` envelope off a captured body.
 * @param call - Recorded dispatch.
 * @returns Envelope record (empty when absent or not an object).
 */
function authOf(call: ICapturedCall): Record<string, unknown> {
  const auth = call.body.auth;
  if (auth === null || typeof auth !== 'object') return {};
  return auth as Record<string, unknown>;
}

/**
 * Every recorded dispatch that is not the balance call — the post-login
 * data steps, derived from what the shape actually dispatched rather
 * than from a hardcoded tag list that could drift from production.
 * @param calls - All recorded dispatches.
 * @returns Data-step dispatches.
 */
function dataCalls(calls: readonly ICapturedCall[]): readonly ICapturedCall[] {
  return calls.filter(c => c.url !== BALANCE_URL_TAG);
}

describe('PayBox post-login body contract', () => {
  let calls: ICapturedCall[] = [];

  beforeAll(async () => {
    calls = [];
    const bus = makeRecordingBus(calls);
    const overrides: Partial<IPipelineContext> = { apiMediator: some(bus) };
    const base = makeMockContext(overrides);
    const credentials = { phoneNumber: FIXT_PHONE } as unknown as typeof base.credentials;
    const ctx = { ...base, credentials } as unknown as IActionContext;
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const result = await phase(ctx);
    assertOk(result);
  });

  it('T-PB-BODY-1 dispatches at least one data step and skips the balance step', () => {
    const urls = calls.map(c => c.url);
    expect(urls).not.toContain(BALANCE_URL_TAG);
    expect(dataCalls(calls).length).toBeGreaterThan(0);
  });

  // The regression net. `/sync` shipped a body with no identity for ten
  // weeks; this fails the moment a data step does so again.
  it('T-PB-BODY-2 every data step carries a populated auth envelope', () => {
    const steps = dataCalls(calls);
    // Without this the loop below passes vacuously if the shape ever
    // stops dispatching a data step — the exact failure it must catch.
    expect(steps.length).toBeGreaterThan(0);
    for (const call of steps) {
      const auth = authOf(call);
      for (const field of IDENTITY_FIELDS) {
        expect(typeof auth[field]).toBe('string');
        expect(auth[field]).not.toBe('');
      }
      for (const field of CLIENT_FIELDS) expect(auth[field]).not.toBe('');
    }
  });

  // The counter-regression net, and the more expensive one to get wrong.
  // `/sync` is answered with HTTP 400 whatever the body holds, and the
  // rejection poisons the session: `/getUserHistory` then returns
  // `401 UNAUTHORIZED` instead of rows — observed across two runs that
  // scraped 0 txns where the preceding green run scraped a full page.
  // Withholding the auth envelope was NOT enough; the bare 400 suffices.
  // The call is therefore never made, which this pins.
  it('T-PB-BODY-3 the balance step is never dispatched', () => {
    const syncCalls = calls.filter(c => c.url === BALANCE_URL_TAG);
    expect(syncCalls).toHaveLength(0);
  });

  it('T-PB-BODY-4 identity fields are sourced from the live session-context', () => {
    const [dataCall] = dataCalls(calls);
    const auth = authOf(dataCall);
    expect(auth.uId).toBe(FIXT_UID);
    expect(auth.uuid).toBe(FIXT_DEVICE);
    expect(auth.access_token).toBe(FIXT_TOKEN);
  });
});

/**
 * The bootstrap deposits the request-signing key into session-context.
 * If the mediator refuses to store it the scrape MUST abort: every later
 * read would otherwise go out unsigned and come back as an opaque bank
 * rejection, hiding the real cause behind a transport-looking error.
 */
describe('PayBox bootstrap merge is fail-closed', () => {
  it('T-PB-BODY-5 aborts the scrape when session-context refuses the patch', async () => {
    const calls: ICapturedCall[] = [];
    const bus = makeRecordingBus(calls);
    const refusing = { ...bus, setSessionContext: jest.fn((): boolean => false) };
    const overrides: Partial<IPipelineContext> = { apiMediator: some(refusing) };
    const base = makeMockContext(overrides);
    const credentials = { phoneNumber: FIXT_PHONE } as unknown as typeof base.credentials;
    const ctx = { ...base, credentials } as unknown as IActionContext;
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
  });
});
