/**
 * Unit tests for Types/MockTiming — MOCK_MODE timeout cap logic.
 */

import {
  capTimeout,
  isMockTimingActive,
  MOCK_TIMEOUT_MS,
} from '../../../../Scrapers/Pipeline/Types/MockTiming.js';

describe('MockTiming', () => {
  const originalMockMode = process.env.MOCK_MODE;

  afterEach(() => {
    if (originalMockMode === undefined) delete process.env.MOCK_MODE;
    else process.env.MOCK_MODE = originalMockMode;
  });

  describe('isMockTimingActive', () => {
    it('returns false when MOCK_MODE is unset', () => {
      delete process.env.MOCK_MODE;
      const isActive = isMockTimingActive();
      expect(isActive).toBe(false);
    });

    it('returns true when MOCK_MODE=1', () => {
      process.env.MOCK_MODE = '1';
      const isActive = isMockTimingActive();
      expect(isActive).toBe(true);
    });

    it('returns true when MOCK_MODE=true', () => {
      process.env.MOCK_MODE = 'true';
      const isActive = isMockTimingActive();
      expect(isActive).toBe(true);
    });

    it('returns false for arbitrary MOCK_MODE values', () => {
      process.env.MOCK_MODE = 'yes';
      const isActive = isMockTimingActive();
      expect(isActive).toBe(false);
    });
  });

  describe('capTimeout', () => {
    it('returns original value when MOCK_MODE is unset', () => {
      delete process.env.MOCK_MODE;
      const out = capTimeout(30000);
      expect(out).toBe(30000);
    });

    it('caps large requested timeout to MOCK_TIMEOUT_MS when active', () => {
      process.env.MOCK_MODE = '1';
      const out = capTimeout(30000);
      expect(out).toBe(MOCK_TIMEOUT_MS);
    });

    it('returns original when below cap and active', () => {
      process.env.MOCK_MODE = '1';
      const out = capTimeout(1000);
      expect(out).toBe(1000);
    });

    it('MOCK_TIMEOUT_MS constant is > 0', () => {
      expect(MOCK_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });
});
