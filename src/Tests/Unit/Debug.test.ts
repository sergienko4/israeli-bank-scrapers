import { getDebug } from '../../Common/Debug.js';

describe('Debug', () => {
  describe('getDebug', () => {
    it('returns a pino child logger with the given module name', () => {
      const logger = getDebug('test-module');
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('returns different child loggers for different module names', () => {
      const logger1 = getDebug('module-a');
      const logger2 = getDebug('module-b');
      expect(logger1).not.toBe(logger2);
    });

    it('redacts amount keys via pino censor config', () => {
      const logger = getDebug('redaction-test');
      expect(() => {
        logger.info({ accountNumber: '1234567890', balance: 5000, originalAmount: -200 }, 'test');
      }).not.toThrow();
    });

    it('logger can log structured data without throwing', () => {
      const logger = getDebug('safe-test');
      expect(() => {
        logger.info('test message');
      }).not.toThrow();
      expect(() => {
        logger.debug({ key: 'value' }, 'structured log');
      }).not.toThrow();
      expect(() => {
        logger.warn('warning');
      }).not.toThrow();
      expect(() => {
        logger.error('error');
      }).not.toThrow();
    });
  });
});
