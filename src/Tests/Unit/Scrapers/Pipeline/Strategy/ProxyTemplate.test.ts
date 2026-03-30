/**
 * Unit tests for ProxyTemplate — Dynamic Proxy Replay.
 * Rule #9: Tests first, then code.
 */

import {
  buildProxyUrl,
  injectDateParams,
} from '../../../../../Scrapers/Pipeline/Strategy/ProxyTemplate.js';

/** Whether a URL contains expected content. */
type UrlCheck = boolean;

describe('buildProxyUrl', () => {
  it('constructs .ashx URL with reqName and params', () => {
    const url = buildProxyUrl('https://he.americanexpress.co.il', 'DashboardMonth', {
      actionCode: '0',
      format: 'Json',
    });
    const hasAshx: UrlCheck = url.includes('ProxyRequestHandler.ashx');
    expect(hasAshx).toBe(true);
    const hasReqName: UrlCheck = url.includes('reqName=DashboardMonth');
    expect(hasReqName).toBe(true);
    const hasFormat: UrlCheck = url.includes('format=Json');
    expect(hasFormat).toBe(true);
  });

  it('returns empty string when apiBase is null', () => {
    const url = buildProxyUrl(null, 'DashboardMonth', {});
    expect(url).toBe('');
  });
});

describe('injectDateParams', () => {
  it('injects billingDate from target date', () => {
    const template = { actionCode: '0', billingDate: '2025-01-01', format: 'Json' };
    const target = new Date(2026, 2, 15);
    const result = injectDateParams(template, target);
    expect(result.billingDate).toBe('2026-03-01');
    expect(result.actionCode).toBe('0');
    expect(result.format).toBe('Json');
  });

  it('injects month and year separately', () => {
    const template = { month: '01', year: '2025', requiredDate: 'N' };
    const target = new Date(2026, 2, 15);
    const result = injectDateParams(template, target);
    expect(result.month).toBe('03');
    expect(result.year).toBe('2026');
    expect(result.requiredDate).toBe('N');
  });

  it('handles year rollover — January lookback to December', () => {
    const template = { month: '06', year: '2025' };
    const target = new Date(2025, 11, 15);
    const result = injectDateParams(template, target);
    expect(result.month).toBe('12');
    expect(result.year).toBe('2025');
  });

  it('preserves keys that are not date-related', () => {
    const template = { cardIndex: '3', format: 'Json', billingDate: '2025-01-01' };
    const target = new Date(2026, 0, 10);
    const result = injectDateParams(template, target);
    expect(result.cardIndex).toBe('3');
    expect(result.format).toBe('Json');
    expect(result.billingDate).toBe('2026-01-01');
  });
});
