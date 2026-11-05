/**
 * Yahav native BaNCS session rotation (spec §10.2, N31): the envelope gate,
 * the four rotated values, what an answer that leaves one out keeps, and the
 * completeness check every answer — the login included — must pass.
 */

import { YAHAV_RESPONSE_SESSION } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeSession.js';
import type { SessionContext } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  ApiBody,
  IResponseSessionArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { bancsAnswer, PRIMED, yahavCtx } from './YahavNativeFactory.js';

/** A security token a later answer issues (fake). */
const NEW_TOKEN = { Ver: 'SecurityToken_1.0.0', Token: [{ TokenId: 'fake-new-token' }] };

/** Rotation headers as the bank sends them. */
const NEW_HEADERS = {
  jesessionid: 'JSESSIONID=fake-new-session; Path=/',
  'xsrf-token': 'XSRF-TOKEN=fake-new-xsrf; Path=/',
};

/** The four values the previous answers left in the session. */
const PREVIOUS = {
  security: PRIMED.security,
  csrf: PRIMED.csrf,
  session: PRIMED.session,
  xsrf: PRIMED.xsrf,
};

/** One answer the patch reads. */
interface IAnswer {
  readonly body: ApiBody;
  readonly headers?: Readonly<Record<string, string>>;
  readonly status?: number;
}

/**
 * Run the rotation patch over one answer.
 * @param answer - Answer body, headers and status.
 * @param session - Session before the answer.
 * @returns Patch outcome.
 */
function rotate(answer: IAnswer, session: SessionContext = PRIMED): ReturnType<typeof patchOf> {
  const ctx = yahavCtx(session);
  const headers = answer.headers ?? {};
  const status = answer.status ?? 200;
  const args: IResponseSessionArgs = { body: answer.body, headers, status, ctx };
  return patchOf(args);
}

/**
 * The shape's rotation patch.
 * @param args - Response-session args.
 * @returns Patch outcome.
 */
function patchOf(args: IResponseSessionArgs): ReturnType<typeof YAHAV_RESPONSE_SESSION.patch> {
  return YAHAV_RESPONSE_SESSION.patch(args);
}

/**
 * An accepted answer that rotates every value.
 * @returns Answer body.
 */
function rotatingBody(): ApiBody {
  const answer = bancsAnswer([]);
  return { ...answer, SecToken: NEW_TOKEN, csrfTkn: 'fake-new-csrf' };
}

/** Answers the gate refuses, by what is wrong with them. */
const REFUSED: readonly (readonly [string, IAnswer])[] = [
  ['a non-200 status', { body: bancsAnswer([]), status: 202 }],
  ['another envelope version', { body: { ...bancsAnswer([]), Ver: 'Other_1.0.0' } }],
  ['a non-zero status code', { body: { ...bancsAnswer([]), Status: { Code: 7 } } }],
  ['no status', { body: { ...bancsAnswer([]), Status: undefined } }],
  ['no entity list', { body: { ...bancsAnswer([]), Payload: { DataEntity: {} } } }],
  ['no payload', { body: { ...bancsAnswer([]), Payload: undefined } }],
];

describe('Yahav native session rotation', () => {
  it('reads both rotation headers', () => {
    expect(YAHAV_RESPONSE_SESSION.headers).toEqual(['jesessionid', 'xsrf-token']);
  });

  it.each([0, '0'])('accepts status code %p and rotates all four values', code => {
    const body = { ...rotatingBody(), Status: { Code: code } };
    const patch = rotate({ body, headers: NEW_HEADERS });
    const rotated = { security: NEW_TOKEN, csrf: 'fake-new-csrf' };
    const ids = { session: 'fake-new-session', xsrf: 'fake-new-xsrf' };
    expect(patch).toEqual({ success: true, value: { ...rotated, ...ids } });
  });

  it('keeps every value an answer leaves out', () => {
    const body = { ...bancsAnswer([]), SecToken: { Token: [] } };
    const patch = rotate({ body });
    expect(patch).toEqual({ success: true, value: PREVIOUS });
  });

  it('keeps the previous CSRF token on an empty one', () => {
    const body = { ...bancsAnswer([]), csrfTkn: '' };
    const patch = rotate({ body });
    expect(patch).toEqual({ success: true, value: PREVIOUS });
  });

  it('accepts an empty answer that leaves the entity list out', () => {
    const body = { ...bancsAnswer([]), Payload: { EntityCounts: [] } };
    const patch = rotate({ body });
    expect(patch).toEqual({ success: true, value: PREVIOUS });
  });

  it.each(REFUSED)('fails bank status on %s', (_label, answer) => {
    const patch = rotate(answer);
    expect(patch).toMatchObject({ success: false, errorMessage: 'bank status' });
  });

  it('fails when the login leaves the session incomplete', () => {
    const body = { ...bancsAnswer([]), SecToken: NEW_TOKEN };
    const patch = rotate({ body, headers: NEW_HEADERS }, { mag: PRIMED.mag });
    expect(patch).toMatchObject({ success: false, errorMessage: 'session state missing' });
  });

  it('fails when a rotated id is empty after its prefix', () => {
    const headers = { jesessionid: 'JSESSIONID=; Path=/' };
    const patch = rotate({ body: bancsAnswer([]), headers });
    expect(patch).toMatchObject({ success: false, errorMessage: 'session state missing' });
  });

  it('fails on a CSRF token carrying a line break', () => {
    const body = { ...bancsAnswer([]), csrfTkn: 'fake\ncsrf' };
    const patch = rotate({ body });
    expect(patch).toMatchObject({ success: false, errorMessage: 'session state invalid' });
  });

  it('keeps the previous ids on empty session headers', () => {
    const headers = { jesessionid: '', 'xsrf-token': '' };
    const patch = rotate({ body: bancsAnswer([]), headers });
    expect(patch).toEqual({ success: true, value: PREVIOUS });
  });

  it('fails on a session header carrying a line break', () => {
    const headers = { 'xsrf-token': 'XSRF-TOKEN=fake\r\nxsrf' };
    const patch = rotate({ body: bancsAnswer([]), headers });
    expect(patch).toMatchObject({ success: false, errorMessage: 'session state invalid' });
  });
});
