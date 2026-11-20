/**
 * The local runner must preserve a password exactly; the real-E2E harness does
 * not trim it, and surrounding spaces can be part of a valid credential.
 */

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import readRequiredEnv from '../../E2eReal/Tools/HapoalimLocalCredentials.js';

describe('Hapoalim local credentials', () => {
  it('preserves a password with surrounding spaces', (): void => {
    const env = { HAPOALIM_PASSWORD: '  syn pass  ' };
    const value = readRequiredEnv('HAPOALIM_PASSWORD', false, env);
    expect(value).toBe('  syn pass  ');
  });

  it('trims a user code', (): void => {
    const env = { HAPOALIM_USER_CODE: '  123456  ' };
    const value = readRequiredEnv('HAPOALIM_USER_CODE', true, env);
    expect(value).toBe('123456');
  });

  it('rejects a missing value', (): void => {
    expect((): string => readRequiredEnv('HAPOALIM_PASSWORD', false, {})).toThrow(ScraperError);
  });

  it('rejects a user code that is only whitespace', (): void => {
    const env = { HAPOALIM_USER_CODE: '   ' };
    expect((): string => readRequiredEnv('HAPOALIM_USER_CODE', true, env)).toThrow(ScraperError);
  });
});
