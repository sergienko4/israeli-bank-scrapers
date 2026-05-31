/**
 * Unit tests for ResolutionTrace — trace logging pass-through for IRaceResult.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import traceResolution from '../../../../../Scrapers/Pipeline/Mediator/Elements/ResolutionTrace.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

/** Captured log entries for assertion. */
interface ITraceRecord {
  readonly resolution: string;
  readonly found: boolean;
  readonly winner: unknown;
  readonly context: string;
  readonly index: number;
  readonly snapshot: string;
}

/**
 * Build a recording logger that captures trace() calls.
 * @returns Logger with captured records.
 */
function makeRecordingLogger(): {
  logger: ScraperLogger;
  records: ITraceRecord[];
} {
  const records: ITraceRecord[] = [];
  const logger = {
    /**
     * Capture trace event.
     * @param entry - Trace record.
     * @returns True.
     */
    trace: (entry: ITraceRecord): boolean => {
      records.push(entry);
      return true;
    },
    /**
     * No-op debug.
     * @returns True.
     */
    debug: (): boolean => true,
    /**
     * No-op info.
     * @returns True.
     */
    info: (): boolean => true,
    /**
     * No-op warn.
     * @returns True.
     */
    warn: (): boolean => true,
    /**
     * No-op error.
     * @returns True.
     */
    error: (): boolean => true,
  } as unknown as ScraperLogger;
  return { logger, records };
}

/**
 * Build a mock Locator.
 * @returns Stub locator.
 */
function makeLocator(): Locator {
  return {} as unknown as Locator;
}

/**
 * Build a mock Page with scripted URL.
 * @param url - URL to report.
 * @returns Page with 'context' property (to identify as main page).
 */
function makePage(url: string): Page {
  return {
    /**
     * Return URL.
     * @returns Scripted URL.
     */
    url: (): string => url,
    context: {},
  } as unknown as Page;
}

/**
 * Build a mock Frame (no 'context' property).
 * @param url - URL to report.
 * @returns Frame mock.
 */
function makeFrame(url: string): Frame {
  return {
    /**
     * Return URL.
     * @returns Scripted URL.
     */
    url: (): string => url,
  } as unknown as Frame;
}

describe('traceResolution', () => {
  it('returns the same result (pass-through)', () => {
    const { logger } = makeRecordingLogger();
    const result = traceResolution(logger, 'HOME.PRE', NOT_FOUND_RESULT);
    expect(result).toBe(NOT_FOUND_RESULT);
  });

  it('describes main Page context', () => {
    const { logger, records } = makeRecordingLogger();
    const ctx = makePage('https://bank.example.com/login');
    const raceResult: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: { kind: 'textContent', value: 'Login' },
      context: ctx,
      index: 0,
      value: 'Login',
      identity: false,
    };
    traceResolution(logger, 'HOME.PRE entry', raceResult);
    expect(records[0]?.context).toContain('main');
  });

  it('describes iframe Frame context', () => {
    const { logger, records } = makeRecordingLogger();
    const ctx = makeFrame('https://iframe.example.com/x');
    const raceResult: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: { kind: 'css', value: '#x' },
      context: ctx,
      index: 1,
      value: 'hit',
      identity: false,
    };
    traceResolution(logger, 'OTP.PRE', raceResult);
    expect(records[0]?.context).toContain('iframe');
  });

  it('describes "none" for context=false', () => {
    const { logger, records } = makeRecordingLogger();
    traceResolution(logger, 'LBL', NOT_FOUND_RESULT);
    expect(records[0]?.context).toBe('none');
  });

  it('truncates long URLs in the context description', () => {
    const { logger, records } = makeRecordingLogger();
    const longUrl = 'https://bank.example.com/' + 'x'.repeat(200);
    const ctx = makePage(longUrl);
    const raceResult: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: { kind: 'textContent', value: 'A' },
      context: ctx,
      index: 0,
      value: '',
      identity: false,
    };
    traceResolution(logger, 'X', raceResult);
    expect(records[0]?.context).toContain('...');
  });

  it('builds winner metadata from candidate', () => {
    const { logger, records } = makeRecordingLogger();
    const ctx = makePage('https://short.example.com');
    const raceResult: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: { kind: 'textContent', value: 'Entrar' },
      context: ctx,
      index: 2,
      value: 'Entrar',
      identity: false,
    };
    traceResolution(logger, 'win', raceResult);
    const winner = records[0]?.winner as { kind: string } | false;
    expect(winner).not.toBe(false);
    if (winner && typeof winner === 'object') {
      expect(winner.kind).toBe('textContent');
    }
  });

  it('winner is false when no candidate present', () => {
    const { logger, records } = makeRecordingLogger();
    const result: IRaceResult = { ...NOT_FOUND_RESULT, candidate: false };
    traceResolution(logger, 'label', result);
    expect(records[0]?.winner).toBe(false);
  });
});
