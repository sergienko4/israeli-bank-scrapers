/**
 * Unit tests for Strategy/Fetch/Tls/TlsClientProfiles — the OpenSSL floor
 * check and the unsupported-runtime warning. The handshake each profile
 * actually emits is pinned by TlsClientProfilesJa4.test.ts.
 */

import { jest } from '@jest/globals';

/** Single logger instance shared by the module under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * The profile registry derives its logger from `import.meta.url`.
   * @returns The shared mock logger, so its calls are visible here.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's full surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const PROFILES =
  await import('../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js');

describe('isTlsProfileSupported — android-11-okhttp needs OpenSSL 3.5+', () => {
  it.each([
    ['3.5.0', true],
    ['3.5.9+quic', true],
    ['4.0.0', true],
    ['3.4.1', false],
    ['3.0.15+quic', false],
    ['1.1.1w', false],
    ['', false],
    ['BoringSSL', false],
  ])('OpenSSL %p → supported %p', (openssl, expected) => {
    const isSupported = PROFILES.isTlsProfileSupported('android-11-okhttp', openssl);
    expect(isSupported).toBe(expected);
  });

  it.each(['3.0.15', '1.1.1w', '', 'BoringSSL'])(
    'node-default is supported on OpenSSL %p',
    openssl => {
      const isSupported = PROFILES.isTlsProfileSupported('node-default', openssl);
      expect(isSupported).toBe(true);
    },
  );
});

describe('warnIfTlsProfileUnsupported', () => {
  beforeEach(() => {
    LOG.warn.mockClear();
  });

  it('warns once with the profile, runtime and floor when the runtime is too old', () => {
    const didWarn = PROFILES.warnIfTlsProfileUnsupported('android-11-okhttp', '3.0.15');
    expect(didWarn).toBe(true);
    expect(LOG.warn).toHaveBeenCalledTimes(1);
    const [payload] = LOG.warn.mock.calls[0] as unknown[];
    expect(payload).toMatchObject({
      tlsProfile: 'android-11-okhttp',
      openssl: '3.0.15',
      minimum: '3.5',
    });
  });

  it('stays silent when the runtime can emit the profile', () => {
    const didWarn = PROFILES.warnIfTlsProfileUnsupported('android-11-okhttp', '3.5.9');
    expect(didWarn).toBe(false);
    expect(LOG.warn).not.toHaveBeenCalled();
  });
});
