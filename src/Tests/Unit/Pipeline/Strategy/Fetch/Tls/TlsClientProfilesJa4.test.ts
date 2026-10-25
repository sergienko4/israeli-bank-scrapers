/**
 * JA4 oracle for the node:https transport's ClientHello profiles.
 *
 * Builds the transport agent exactly as the mediator does, captures the
 * ClientHello it emits on loopback and fingerprints it. The pinned JA4 must
 * appear on every runtime the profile claims to support and on no other, so
 * the profile options, the pinned fingerprint and the OpenSSL floor cannot
 * drift apart. Unsupported runtimes still run the test: they prove the floor
 * is not set too high.
 */

import { buildMtlsAgent } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import {
  getTlsClientProfile,
  isTlsProfileSupported,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js';
import { testCertBundle } from '../Mtls/MtlsTestServer.js';
import { captureJa4 } from './Ja4Fingerprint.js';

/** Runtime OpenSSL the oracle is evaluated on. */
const RUNTIME_OPENSSL = process.versions.openssl;

describe('TLS ClientHello profiles — JA4 oracle', () => {
  it('emits the pinned android-11-okhttp JA4 exactly when the runtime supports it', async () => {
    const bundle = testCertBundle();
    const agent = buildMtlsAgent(bundle, 'android-11-okhttp');
    const ja4 = await captureJa4(agent);
    agent.destroy();
    const { expectedJa4 } = getTlsClientProfile('android-11-okhttp');
    const isSupported = isTlsProfileSupported('android-11-okhttp', RUNTIME_OPENSSL);
    const isPinMatched = ja4 === expectedJa4;
    expect({ ja4, isPinMatched }).toEqual({ ja4, isPinMatched: isSupported });
  });

  it('keeps the stock Node handshake when no profile is configured', async () => {
    const agent = buildMtlsAgent(false);
    const ja4 = await captureJa4(agent);
    agent.destroy();
    const { expectedJa4 } = getTlsClientProfile('android-11-okhttp');
    expect(ja4).toMatch(/^t1[23]d\d{4}\w{2}_[\da-f]{12}_[\da-f]{12}$/);
    expect(ja4).not.toBe(expectedJa4);
  });
});
