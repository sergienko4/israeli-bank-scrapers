/**
 * UT-ST — a bank's status policy decides a 2xx before the body is read (N4):
 * `empty` answers `{}`, `fail` refuses with the log-safe URL and the status,
 * and a document step reads its own 204 instead of taking `empty`.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IAnswer } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/StatusPolicy.js';
import { applyStatusPolicy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/StatusPolicy.js';
import type {
  ResponseKind,
  StatusPolicy,
} from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const LOGIN_URL = 'https://api.bank.example/v1/login?sid=secret';
const POLICY: StatusPolicy = { 204: 'empty', 207: 'fail' };

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
function judge(answer: IAnswer): Option<Procedure<unknown>> {
  return applyStatusPolicy<unknown>(answer);
}

describe('applyStatusPolicy', () => {
  it('UT-ST-01 answers {} for an empty status', () => {
    const answer = answerWith(204);
    const decided = judge(answer);
    expect(decided).toEqual({ has: true, value: { success: true, value: {} } });
  });

  it('UT-ST-02 refuses a fail status with the log-safe URL', () => {
    const answer = answerWith(207);
    const decided = judge(answer);
    const expected = {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'POST https://api.bank.example/v1/login HTTP 207',
    };
    expect(decided).toMatchObject({ has: true, value: expected });
  });

  it('UT-ST-03 leaves a status the policy does not name to the reader', () => {
    const answer = answerWith(200);
    const decided = judge(answer);
    expect(decided.has).toBe(false);
  });

  it('UT-ST-04 leaves a 204 on a document step to the document reader', () => {
    const answer = answerWith(204, 'document');
    const decided = judge(answer);
    expect(decided.has).toBe(false);
  });

  it('UT-ST-05 still refuses a fail status on a document step', () => {
    const answer = answerWith(207, 'document');
    const decided = judge(answer);
    expect(decided).toMatchObject({ has: true, value: { success: false } });
  });

  it('UT-ST-06 decides nothing for a bank without a policy', () => {
    const answer = answerWith(204, 'json', {});
    const decided = judge(answer);
    expect(decided.has).toBe(false);
  });
});
