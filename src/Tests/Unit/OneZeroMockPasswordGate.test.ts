/**
 * OneZero mock — the password gate on the token-minting routes.
 *
 * <p>The real identity server rejects `/sessions/token` and `/getIdToken`
 * unless the account password rides along with the token. A mock that
 * answered 200 without it would teach the wrong contract: a warm request
 * that regressed to omit `pass` would look perfectly healthy in the mocked
 * E2E and only fail against the bank.
 *
 * <p>The gate existed but nothing exercised it — deleting it left every
 * suite green. These tests pin it directly.
 */

import {
  installOneZeroFetchMock,
  ONEZERO_MOCK_CREDS,
  SYN_ID_TOKEN,
} from '../E2eMocked/OneZero/OneZeroFetchMock.js';

/** Any URL the mock classifies as an identity call. */
const SESSION_URL = 'https://identity.example.test/sessions/token';

/** Status the identity server uses to refuse a credential. */
const REFUSED = 401;

/** Error code the identity server returns when the password is missing. */
const REFUSAL_CODE = 'ErrorInvalidCredentials';

/** Handle for the currently installed mock. */
let mock: ReturnType<typeof installOneZeroFetchMock> | undefined;

/** What the mock replied to a `/sessions/token` POST. */
interface ISessionReply {
  /** HTTP status the mock returned. */
  readonly status: number;
  /** Error code carried in the body, absent on success. */
  readonly errorCode: string | undefined;
}

/**
 * POST a body to the mock's `/sessions/token` route.
 * @param body - Request payload sent as JSON.
 * @returns The parsed status and errorCode the mock replied with.
 */
async function postSession(body: Record<string, string>): Promise<ISessionReply> {
  const init = { method: 'POST', body: JSON.stringify(body) };
  const response = await fetch(SESSION_URL, init);
  const bodyText = await response.text();
  const payload = JSON.parse(bodyText) as { errorCode?: string };
  return { status: response.status, errorCode: payload.errorCode };
}

beforeEach((): boolean => {
  mock = installOneZeroFetchMock();
  return true;
});

afterEach((): boolean => {
  mock?.dispose();
  mock = undefined;
  return true;
});

describe('OneZero mock — /sessions/token requires the account password', () => {
  it('mints an access token when the password rides along with the idToken', async () => {
    const result = await postSession({
      idToken: SYN_ID_TOKEN,
      pass: ONEZERO_MOCK_CREDS.password,
    });
    expect(result.status).toBe(200);
  });

  it('refuses a request that carries a valid idToken but no password', async () => {
    const result = await postSession({ idToken: SYN_ID_TOKEN });
    expect(result.status).toBe(REFUSED);
  });

  it('names the refusal a credential failure, not a token failure', async () => {
    const result = await postSession({ idToken: SYN_ID_TOKEN });
    expect(result.errorCode).toBe(REFUSAL_CODE);
  });

  it('refuses a request whose password is merely wrong', async () => {
    const result = await postSession({ idToken: SYN_ID_TOKEN, pass: 'not-the-password' });
    expect(result.status).toBe(REFUSED);
  });
});
