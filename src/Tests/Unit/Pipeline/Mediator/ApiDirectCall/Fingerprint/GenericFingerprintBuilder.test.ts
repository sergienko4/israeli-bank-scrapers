/**
 * Unit tests for GenericFingerprintBuilder — hydrates the fingerprint
 * JsonValueTemplate against a minimal scope carrying only fresh-time
 * tokens. Zero bank knowledge.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { buildCollectionResult } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Fingerprint/GenericFingerprintBuilder.js';
import type {
  IApiDirectCallConfig,
  IFingerprintConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** Throwaway API-direct-call config used only to satisfy scope.config. */
const CONFIG_STUB = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: {},
} as unknown as IApiDirectCallConfig;

describe('GenericFingerprintBuilder.buildCollectionResult', () => {
  it('hydrates literal $ref: now into a Unix-second number', () => {
    const fp: IFingerprintConfig = {
      shape: {
        metadata: { timestamp: { $ref: 'now' } },
        content: { device_details: { $literal: { model: 'synthetic' } } },
      },
    };
    const result = buildCollectionResult(fp, CONFIG_STUB);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('buildCollectionResult should succeed');
    const value = result.value as { metadata: { timestamp: number }; content: unknown };
    expect(typeof value.metadata.timestamp).toBe('number');
    expect(value.metadata.timestamp).toBeGreaterThan(0);
  });

  it('hydrates $ref: nowMs into a millisecond value', () => {
    const fp: IFingerprintConfig = {
      shape: { content: { stamped: { $ref: 'nowMs' } } },
    };
    const result = buildCollectionResult(fp, CONFIG_STUB);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('buildCollectionResult should succeed');
    const value = result.value as { content: { stamped: number } };
    expect(value.content.stamped).toBeGreaterThan(10 ** 12);
  });

  it('returns literal blobs verbatim when no dynamic refs used', () => {
    const fp: IFingerprintConfig = {
      shape: {
        content: { app_permissions: { $literal: ['p.one', 'p.two'] } },
      },
    };
    const result = buildCollectionResult(fp, CONFIG_STUB);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('buildCollectionResult should succeed');
    const value = result.value as { content: { app_permissions: readonly string[] } };
    expect(value.content.app_permissions).toEqual(['p.one', 'p.two']);
  });
});
