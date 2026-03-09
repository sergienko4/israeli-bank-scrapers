import { jest } from '@jest/globals';

import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch.js';
import { createMockPage } from '../MockPage.js';

/**
 * Flow-state validation for fetchGetWithinPage and fetchPostWithinPage.
 * Verifies the EXACT output shape for every status: success, parse failure,
 * shouldIgnoreErrors, and HTTP 204.
 */
describe('fetchGetWithinPage — flow states', () => {
  it('success: returns parsed TResult with expected keys', async () => {
    const payload = { balance: 1000, currency: 'ILS' };
    const serialized = JSON.stringify(payload);
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([serialized, 200]),
    });

    const result = await fetchGetWithinPage<{ balance: number; currency: string }>(
      page,
      'https://bank.co.il/api/balance',
    );

    expect(result).toEqual({ balance: 1000, currency: 'ILS' });
    expect(result).toHaveProperty('balance');
    expect(result).toHaveProperty('currency');
  });

  it('success: result is not null and not empty object', async () => {
    const serialized = JSON.stringify({ id: 42 });
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([serialized, 200]),
    });

    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/id');

    expect(result).not.toBeNull();
    expect(result).not.toEqual({});
    expect(result).toEqual({ id: 42 });
  });

  it('parse failure + shouldIgnoreErrors=true: returns exactly null', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['<html>bad</html>', 200]),
    });

    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/bad', true);

    expect(result).toBeNull();
    expect(result).not.toEqual({});
    expect(result).toStrictEqual(null);
  });

  it('parse failure + shouldIgnoreErrors=false: throws ScraperError', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['not-json', 200]),
    });

    const promise = fetchGetWithinPage(page, 'https://bank.co.il/api/bad', false);

    await expect(promise).rejects.toThrow('parse error');
    await expect(promise).rejects.toThrow(/fetchGetWithinPage/);
  });

  it('HTTP 204: returns empty object (not null)', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['', 204]),
    });

    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/empty');

    expect(result).toEqual({});
    expect(result).not.toBeNull();
  });

  it('empty string body (non-204): returns empty object', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['', 200]),
    });

    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/empty');

    expect(result).toEqual({});
  });
});

describe('fetchPostWithinPage — flow states', () => {
  it('success: returns parsed TResult with expected keys', async () => {
    const payload = { txnId: 'ABC123', status: 'completed' };
    const serialized = JSON.stringify(payload);
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([serialized, 200]),
    });

    const result = await fetchPostWithinPage<{ txnId: string; status: string }>(
      page,
      'https://bank.co.il/api/submit',
      { data: { amount: 100 } },
    );

    expect(result).toEqual({ txnId: 'ABC123', status: 'completed' });
    expect(result).toHaveProperty('txnId');
    expect(result).toHaveProperty('status');
  });

  it('success: result is not null and not empty object', async () => {
    const serialized = JSON.stringify({ ok: true });
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([serialized, 200]),
    });

    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/action', {
      data: { key: 'value' },
    });

    expect(result).not.toBeNull();
    expect(result).toEqual({ ok: true });
  });

  it('parse failure + shouldIgnoreErrors=true: returns exactly null', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['<html>blocked</html>', 200]),
    });

    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/bad', {
      data: {},
      shouldIgnoreErrors: true,
    });

    expect(result).toBeNull();
    expect(result).not.toEqual({});
    expect(result).toStrictEqual(null);
  });

  it('parse failure + shouldIgnoreErrors=false: throws ScraperError', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['not valid json!', 200]),
    });

    const promise = fetchPostWithinPage(page, 'https://bank.co.il/api/bad', {
      data: {},
      shouldIgnoreErrors: false,
    });

    await expect(promise).rejects.toThrow('parse');
    await expect(promise).rejects.toThrow(/fetchPostWithinPage/);
  });

  it('HTTP 204: returns empty object (not null)', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['', 204]),
    });

    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/empty', {
      data: {},
    });

    expect(result).toEqual({});
    expect(result).not.toBeNull();
  });

  it('empty string body (non-204): returns empty object', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['', 200]),
    });

    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/empty', {
      data: {},
    });

    expect(result).toEqual({});
  });

  it('parse error message includes URL and status', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['garbage', 500]),
    });

    const promise = fetchPostWithinPage(page, 'https://bank.co.il/api/broken', {
      data: {},
    });

    await expect(promise).rejects.toThrow(/bank\.co\.il/);
    await expect(promise).rejects.toThrow(/500/);
  });
});
