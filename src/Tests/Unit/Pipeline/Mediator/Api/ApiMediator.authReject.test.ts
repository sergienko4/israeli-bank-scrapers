/**
 * `isAuthRejectedFailure` (UT-AR): a failure reads as the bank refusing
 * the credentials or session in either marker form it can carry — the
 * transport's ` 401: ` and the ` HTTP 401` a login step is sanitised to — and
 * never when the edge blocked the call or the status only starts with 401.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { isAuthRejectedFailure } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.authReject.js';
import { fail } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** A transport failure prefix: verb, safe URL. */
const CALL = 'POST https://bank.example/api/token';

describe('isAuthRejectedFailure', () => {
  it.each<[string, string]>([
    ['the transport 401 form', `${CALL} 401: denied`],
    ['the transport 403 form', `${CALL} 403: denied`],
    ['a sanitised 401 step', 'token HTTP 401'],
    ['a sanitised 403 step', 'token HTTP 403'],
    ['a status-policy 401', `${CALL} HTTP 401`],
  ])('accepts %s', (_label, message): void => {
    const failure = fail(ScraperErrorTypes.Generic, message);
    const isRejected = isAuthRejectedFailure(failure);
    expect(isRejected).toBe(true);
  });

  it.each<[string, string]>([
    ['a sanitised 400 step', 'token HTTP 400'],
    ['a sanitised 5xx step', 'token HTTP 500'],
    ['a status that only starts with 401', 'token HTTP 4010'],
    ['a transport 5xx', `${CALL} 500: oops`],
    ['a step that got no response', `token ${ScraperErrorTypes.Generic}`],
  ])('refuses %s', (_label, message): void => {
    const failure = fail(ScraperErrorTypes.Generic, message);
    const isRejected = isAuthRejectedFailure(failure);
    expect(isRejected).toBe(false);
  });

  it('refuses a timeout', (): void => {
    const failure = fail(ScraperErrorTypes.Timeout, `token ${ScraperErrorTypes.Timeout}`);
    const isRejected = isAuthRejectedFailure(failure);
    expect(isRejected).toBe(false);
  });

  it('refuses an edge block even when it carries a 403 marker', (): void => {
    const failure = fail(ScraperErrorTypes.WafBlocked, `${CALL} 403: edge block`);
    const isRejected = isAuthRejectedFailure(failure);
    expect(isRejected).toBe(false);
  });
});
