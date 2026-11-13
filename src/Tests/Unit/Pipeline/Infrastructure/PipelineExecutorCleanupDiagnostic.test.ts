/**
 * The cleanup warning an execution emits when disposing its mediator fails.
 *
 * <p>Two levels. The emit is tested against a real pino logger writing to an
 * in-memory stream, so the assertions run on the parsed record the logger
 * actually produced. The executor is tested end to end for the properties that
 * matter to a caller: the scrape's own outcome is untouched and disposal runs
 * exactly once.
 */

import { PassThrough } from 'node:stream';

import { jest } from '@jest/globals';
import pino from 'pino';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import {
  buildCleanupWarning,
  reportCleanupFailure,
} from '../../../../Scrapers/Pipeline/Core/Executor/CleanupDiagnostic.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';
import {
  failingPhase,
  leakyDisposalError,
  mediatorPhase,
  passThroughPhase,
  rejectingDispose,
  resolvingDispose,
  run,
  SECRET,
} from './CleanupFixtures.js';

/** A real pino logger and the records it wrote. */
interface ICapture {
  readonly logger: pino.Logger;
  readonly records: () => Record<string, unknown>[];
}

/**
 * Parse every JSON line written so far.
 * @param chunks - The raw text written to the stream.
 * @returns The parsed records.
 */
function parseRecords(chunks: readonly string[]): Record<string, unknown>[] {
  const lines = chunks.join('').split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line) as Record<string, unknown>);
}

/**
 * A real pino logger writing to memory.
 * @returns The logger and a reader of the parsed records.
 */
function captureLogger(): ICapture {
  const stream = new PassThrough();
  const chunks: string[] = [];
  /**
   * Keep each chunk the logger writes.
   * @param chunk - A raw chunk.
   * @returns The new chunk count.
   */
  const keep = (chunk: Buffer): number => {
    const text = chunk.toString('utf8');
    return chunks.push(text);
  };
  stream.on('data', keep);
  const logger = pino({ level: 'info' }, stream);
  /**
   * Read the records written so far.
   * @returns The parsed records.
   */
  const records = (): Record<string, unknown>[] => parseRecords(chunks);
  return { logger, records };
}

describe('buildCleanupWarning / reportCleanupFailure', () => {
  it('[CLN-1] carries only the allowlisted fields, never the message or secret', () => {
    const capture = captureLogger();
    const ctx = makeMockContext({ logger: capture.logger });
    const error = leakyDisposalError();
    reportCleanupFailure(ctx, error);
    const [record] = capture.records();
    const written = JSON.stringify(record);
    expect(record).toMatchObject({
      level: 40,
      event: 'cleanup-failed',
      resource: 'api-mediator',
      errorName: 'ScraperError',
      causeCode: 'ECONNRESET',
    });
    expect(written).not.toContain(SECRET);
    expect(written).not.toContain('socket to');
  });

  it('[CLN-2] reports a non-Error thrown value without throwing itself', () => {
    const thrown = Symbol('boom');
    const fields = buildCleanupWarning(thrown);
    expect(fields).toMatchObject({ errorName: 'Error', causeCode: '' });
  });

  it('[CLN-2b] drops a cause code that has the shape of a secret, not of an error code', () => {
    const error = new ScraperError('disposal failed');
    Object.defineProperty(error, 'cause', { value: { code: 'TOKEN9F8E7D6C5B4A' } });
    const fields = buildCleanupWarning(error);
    expect(fields.causeCode).toBe('');
  });

  it('[CLN-3] a throwing log sink does not become a second failure', () => {
    const sink = jest.fn((): never => {
      throw new ScraperError('sink down');
    });
    const logger = { warn: sink } as unknown as pino.Logger;
    const ctx = makeMockContext({ logger });
    const error = leakyDisposalError();
    const isReported = reportCleanupFailure(ctx, error);
    expect(isReported).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineExecutor — disposal failure never changes the outcome', () => {
  it('[CLN-4] keeps a successful scrape successful when dispose rejects', async () => {
    const dispose = rejectingDispose();
    const result = await run([mediatorPhase(dispose), passThroughPhase()]);
    expect(result.success).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('[CLN-5] keeps the original failure when dispose also rejects', async () => {
    const dispose = rejectingDispose();
    const result = await run([mediatorPhase(dispose), failingPhase()]);
    expect(result).toMatchObject({ success: false, errorMessage: 'scrape failed' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('[CLN-6] disposes exactly once on success', async () => {
    const dispose = resolvingDispose();
    const result = await run([mediatorPhase(dispose), passThroughPhase()]);
    expect(result.success).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("[CLN-7] records today's limit: a mediator installed by the last phase is not disposed", async () => {
    const dispose = resolvingDispose();
    const result = await run([mediatorPhase(dispose)]);
    expect(result.success).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });
});
