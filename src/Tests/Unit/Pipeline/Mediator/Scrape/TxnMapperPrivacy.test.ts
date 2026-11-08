import { jest } from '@jest/globals';

const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  getDebug: jest.fn(() => LOG),
}));

const { autoMapTransaction: AUTO_MAP_TRANSACTION } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js');

describe('transaction rejection privacy', () => {
  it('does not log financial values from an invalid transaction', () => {
    const raw = { DateUTC: 'private-invalid-date', Amount: 9876.5 };
    const result = AUTO_MAP_TRANSACTION(raw, false);
    const logs = JSON.stringify(LOG.debug.mock.calls);
    expect(result).toBe(false);
    expect(logs).not.toContain('private-invalid-date');
    expect(logs).not.toContain('9876.5');
  });
});
