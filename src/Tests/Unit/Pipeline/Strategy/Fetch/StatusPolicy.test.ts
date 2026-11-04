/**
 * UT-ST — a bank's status policy decides a 2xx before the body is read (N4):
 * `empty` answers `{}`, `fail` refuses with the log-safe URL and the status,
 * and a document step reads its own 204 instead of taking `empty`.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IAnswer } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/StatusPolicy.js';
import type {
  ResponseKind,
  StatusPolicy,
} from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const LOGIN_URL = 'https://api.bank.example/v1/login?sid=secret';
const POLICY: StatusPolicy = { 204: 'empty', 207: 'fail' };
const LOG = { warn: jest.fn<undefined, [Readonly<Record<string, unknown>>]>() };

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', () => ({
  /**
   * Captures cleanup diagnostics without exposing response or error text.
   * @returns The warning recorder.
   */
  getDebug: (): typeof LOG => LOG,
}));

const STATUS = await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/StatusPolicy.js');

/**
 * An answered POST with the given status.
 * @param status - HTTP status.
 * @param responseKind - How the step reads its answer.
 * @param statusPolicy - The bank's status policy.
 * @returns The answer to judge.
 */
function answerWith(
  status: number,
  responseKind: ResponseKind = 'json',
  statusPolicy: StatusPolicy = POLICY,
): IAnswer {
  const body = status === 204 ? null : '{"ok":true}';
  const response = new Response(body, { status });
  return { response, verb: 'POST', url: LOGIN_URL, reading: { statusPolicy, responseKind } };
}

/**
 * Judge an answer under its policy.
 * @param answer - The answer.
 * @returns The decided outcome, if the policy names the status.
 */
function judge(answer: IAnswer): Promise<Option<Procedure<unknown>>> {
  return STATUS.applyStatusPolicy<unknown>(answer);
}

describe('applyStatusPolicy', () => {
  beforeEach(() => {
    LOG.warn.mockClear();
  });

  it('UT-ST-01 answers {} for an empty status', async () => {
    const answer = answerWith(204);
    const decided = await judge(answer);
    expect(decided).toEqual({ has: true, value: { success: true, value: {} } });
  });

  it('UT-ST-02 refuses a fail status with the log-safe URL', async () => {
    const answer = answerWith(207);
    const decided = await judge(answer);
    const expected = {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'POST https://api.bank.example/v1/login HTTP 207',
    };
    expect(decided).toMatchObject({ has: true, value: expected });
  });

  it('UT-ST-03 leaves a status the policy does not name to the reader', async () => {
    const answer = answerWith(200);
    const decided = await judge(answer);
    expect(decided.has).toBe(false);
    const body = await answer.response.text();
    expect(body).toBe('{"ok":true}');
  });

  it('UT-ST-04 leaves a 204 on a document step to the document reader', async () => {
    const answer = answerWith(204, 'document');
    const decided = await judge(answer);
    expect(decided.has).toBe(false);
  });

  it('UT-ST-05 still refuses a fail status on a document step', async () => {
    const answer = answerWith(207, 'document');
    const decided = await judge(answer);
    expect(decided).toMatchObject({ has: true, value: { success: false } });
  });

  it('UT-ST-06 decides nothing for a bank without a policy', async () => {
    const answer = answerWith(204, 'json', {});
    const decided = await judge(answer);
    expect(decided.has).toBe(false);
  });

  it.each([
    { status: 200, kind: 'json', action: 'empty', success: true },
    { status: 207, kind: 'json', action: 'fail', success: false },
    { status: 207, kind: 'document', action: 'fail', success: false },
  ] as const)(
    'cancels the unused $status $kind body for $action',
    async ({ status, kind, action, success }) => {
      const cancel = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
      const body = new ReadableStream<Uint8Array>({ cancel });
      const response = new Response(body, { status });
      const answer = { ...answerWith(status, kind, { [status]: action }), response };
      const decided = await judge(answer);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(decided).toMatchObject({ has: true, value: { success } });
    },
  );

  it('keeps a document body available when its empty policy is ignored', async () => {
    const answer = answerWith(200, 'document', { 200: 'empty' });
    const decided = await judge(answer);
    const body = await answer.response.text();
    expect(decided.has).toBe(false);
    expect(body).toBe('{"ok":true}');
  });

  it.each([
    [200, 'empty', true],
    [207, 'fail', false],
  ] as const)(
    'preserves HTTP %i when cancellation rejects and logs safely',
    async (status, action, success) => {
      const cancel = jest.fn<Promise<void>, []>().mockRejectedValue(new Error('synthetic-private'));
      const body = new ReadableStream<Uint8Array>({ cancel });
      const response = new Response(body, { status });
      const answer = { ...answerWith(status, 'json', { [status]: action }), response };
      const decided = await judge(answer);
      expect(decided).toMatchObject({ has: true, value: { success } });
      expect(LOG.warn).toHaveBeenCalledWith({
        verb: 'POST',
        url: 'https://api.bank.example/v1/login',
        message: 'Response body cancellation failed',
      });
    },
  );
});
