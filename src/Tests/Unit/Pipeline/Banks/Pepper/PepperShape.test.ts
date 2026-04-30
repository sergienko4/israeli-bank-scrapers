/**
 * Coverage for Pepper shape's `userIdOf` helper — exercises both branches:
 * Israeli phone formats with the +972 country code AND digit strings that
 * already lack the prefix.
 */

import { userIdOf } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a minimal IActionContext carrying just credentials.phoneNumber.
 * @param phone - Phone string in any format.
 * @returns Action context with the phone wired into credentials.
 */
function makeCtxWithPhone(phone: string): IActionContext {
  return {
    credentials: { phoneNumber: phone },
  } as unknown as IActionContext;
}

describe('PepperShape.userIdOf', () => {
  it('strips the leading 972 country code from a +972 prefixed phone', () => {
    const ctx = makeCtxWithPhone('+972541234567');
    const result = userIdOf(ctx);
    expect(result).toBe('541234567');
  });

  it('strips 972 from a phone without the leading +', () => {
    const ctx = makeCtxWithPhone('972541234567');
    const result = userIdOf(ctx);
    expect(result).toBe('541234567');
  });

  it('returns digits unchanged when the phone does not start with 972', () => {
    const ctx = makeCtxWithPhone('0541234567');
    const result = userIdOf(ctx);
    expect(result).toBe('0541234567');
  });

  it('strips non-digit characters before checking the country code', () => {
    const ctx = makeCtxWithPhone('+972 (54) 123-4567');
    const result = userIdOf(ctx);
    expect(result).toBe('541234567');
  });

  it('returns empty string when the phone has no digits', () => {
    const ctx = makeCtxWithPhone('');
    const result = userIdOf(ctx);
    expect(result).toBe('');
  });
});
