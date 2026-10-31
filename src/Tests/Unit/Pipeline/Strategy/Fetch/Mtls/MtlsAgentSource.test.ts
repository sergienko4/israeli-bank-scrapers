/**
 * N26 — agent sources. A fixed source answers every URL with the one agent a
 * static transport shares; `presentedOf` names the certificate that agent
 * presents (the SHA-256 of its DER) so the mocked-transport seam can observe
 * it, and answers false for no certificate or one that does not parse.
 */

import { Agent } from 'node:https';

import {
  fixedAgentSource,
  presentedOf,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsAgentSource.js';
import { issueTestCert } from '../../../../../Helpers/TestCertificate.js';

const DEVICE = issueTestCert({ commonName: 'device' });

describe('MtlsAgentSource', () => {
  it('names a certificate by the SHA-256 of its DER', () => {
    const presented = presentedOf({ key: DEVICE.keyPem, cert: DEVICE.certPem });
    expect(presented).toEqual({ sha256: DEVICE.sha256 });
  });

  it.each<[string, Parameters<typeof presentedOf>[0]]>([
    ['no certificate', false],
    ['a certificate that does not parse', { key: DEVICE.keyPem, cert: 'not a certificate' }],
  ])('names nothing for %s', (_label, cert) => {
    const presented = presentedOf(cert);
    expect(presented).toBe(false);
  });

  it('answers every URL with the same agent and certificate', () => {
    const agent = new Agent({ keepAlive: false });
    const source = fixedAgentSource(agent, { sha256: DEVICE.sha256 });
    const first = source('https://a.example/x');
    const second = source('https://b.example/y');
    agent.destroy();
    expect(first).toEqual({ agent, presented: { sha256: DEVICE.sha256 } });
    expect(second).toBe(first);
  });
});
