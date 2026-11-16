/**
 * Coverage for Pepper's x-user-id header.
 *
 * Pepper uses `phoneNumberFormat: 'international-flat'` so the login
 * BODY templates receive `972XXXXXXXXX`. The x-user-id HEADER is a
 * separate concern (header vs body) and the server expects the local
 * form, so the header producer strips the `972` prefix when present.
 */

import PEPPER_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
import type { IScrapeCallInfo } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a minimal IActionContext carrying just credentials.phoneNumber.
 * @param phone - Phone string in Pepper's wire format (`972XXXXXXXXX`)
 *   or the local fallback (`XXXXXXXXX`).
 * @returns Action context with the phone wired into credentials.
 */
function makeCtxWithPhone(phone: string): IActionContext {
  return {
    credentials: { phoneNumber: phone },
  } as unknown as IActionContext;
}

/** No account scope is needed for the customer-call headers. */
const CUSTOMER_CALL: IScrapeCallInfo = {};

/**
 * Read x-user-id from the shape's real customer header producer.
 * @param ctx - Action context carrying credentials.
 * @returns The header value.
 */
function userIdOf(ctx: IActionContext): string {
  const headers = PEPPER_SHAPE.customer.extraHeaders;
  if (typeof headers !== 'function') throw new TypeError('customer headers are not dynamic');
  return headers(ctx, CUSTOMER_CALL)['x-user-id'];
}

describe('PepperShape x-user-id header', () => {
  it('strips the 972 country-code prefix from the international-flat form', () => {
    const ctx = makeCtxWithPhone('972000000001');
    const result = userIdOf(ctx);
    expect(result).toBe('000000001');
  });

  it('propagates a phone that already lacks the 972 prefix', () => {
    const ctx = makeCtxWithPhone('000000001');
    const result = userIdOf(ctx);
    expect(result).toBe('000000001');
  });

  it('returns empty string when credentials.phoneNumber is empty', () => {
    const ctx = makeCtxWithPhone('');
    const result = userIdOf(ctx);
    expect(result).toBe('');
  });

  /**
   * Deliberate non-repair. The Israeli local form `05…` can never reach
   * here on the production path: Pepper declares `international-flat`, and
   * the API-direct ACTION now refuses a phone it cannot normalise to it.
   *
   * Rewriting the value here anyway would hide a broken upstream invariant
   * inside a header builder — the same silent-repair pattern this change
   * set removes. The credential boundary is the only place allowed to
   * reject, so this helper passes an unexpected shape through untouched
   * and lets the failure stay visible.
   */
  it('does not repair a local trunk form — the credential boundary owns rejection', () => {
    const ctx = makeCtxWithPhone('0500000001');
    const result = userIdOf(ctx);
    expect(result).toBe('0500000001');
  });
});
