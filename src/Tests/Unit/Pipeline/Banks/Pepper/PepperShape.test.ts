/**
 * Coverage for Pepper shape's `userIdOf` helper.
 *
 * Pepper uses `phoneNumberFormat: 'international-flat'` so the login
 * BODY templates receive `972XXXXXXXXX`. The x-user-id HEADER is a
 * separate concern (header vs body) and the server expects the local
 * form, so `userIdOf` strips the `972` prefix when present.
 */

import { userIdOf } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
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

describe('PepperShape.userIdOf', () => {
  it('strips the 972 country-code prefix from the international-flat form', () => {
    const ctx = makeCtxWithPhone('972000000001');
    const result = userIdOf(ctx);
    expect(result).toBe('000000001');
  });

  it('propagates a phone that already lacks the 972 prefix', () => {
    const ctx = makeCtxWithPhone('500000001');
    const result = userIdOf(ctx);
    expect(result).toBe('500000001');
  });

  it('returns empty string when credentials.phoneNumber is empty', () => {
    const ctx = makeCtxWithPhone('');
    const result = userIdOf(ctx);
    expect(result).toBe('');
  });

  /**
   * The leading `0` is the Israeli trunk prefix, never part of the
   * subscriber number, so `0500000001` and `972500000001` name the same
   * subscriber and must produce the same header. Before the ACTION stage
   * learned to refuse an unnormalisable phone, the local form reached here
   * intact and went out as `x-user-id: 0500000001` — a value the bank has
   * never issued.
   */
  it('never emits the trunk prefix, whichever form it is handed', () => {
    const ctx = makeCtxWithPhone('0500000001');
    const result = userIdOf(ctx);
    expect(result).toBe('500000001');
  });
});
