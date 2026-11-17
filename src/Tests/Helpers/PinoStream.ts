/**
 * Test-side view of the stream behind a Pino logger.
 *
 * <p>Pino stores its destination under a module-local symbol. Reading it by
 * description keeps the probe working across `jest.resetModules()` boundaries,
 * where each module registry creates its own symbol instance.
 */

import pino, { type Logger } from 'pino';

/** Stream surface a logger-backed spec inspects or drives. */
interface IPinoStream {
  readonly fd?: number;
  readonly closed?: boolean;
  readonly destroyed?: boolean;
  readonly flush?: (cb: (err?: Error) => boolean) => boolean | object;
  readonly unref?: () => boolean | object;
  readonly on?: (event: 'error', listener: (err: Error) => boolean) => object;
  readonly once?: (event: 'close', listener: () => boolean) => object;
  readonly worker?: { readonly terminate: () => Promise<number> };
  readonly emit?: (event: 'error', err: Error) => boolean;
}

/**
 * Find Pino's stream symbol on a logger.
 * @param logger - Pino logger instance.
 * @returns The stream symbol, or false when Pino has none.
 */
function streamSymbolOf(logger: object): symbol | false {
  const symbols = Object.getOwnPropertySymbols(logger);
  return symbols.find((symbol): boolean => symbol.description === 'pino.stream') ?? false;
}

/**
 * Whether Pino attached a destination stream to `logger`.
 * @param logger - Pino logger instance.
 * @returns True when the stream symbol exists.
 */
function hasPinoStream(logger: object): boolean {
  return streamSymbolOf(logger) !== false;
}

/**
 * Read the stream Pino attached to `logger`.
 * @param logger - Pino logger instance.
 * @returns Its destination stream, or an empty probe when Pino has none.
 */
function readPinoStream(logger: object): IPinoStream {
  const streamSym = streamSymbolOf(logger);
  if (streamSym === false) return {};
  return Reflect.get(logger, streamSym) as IPinoStream;
}

/**
 * Build a superseded logger whose Pino stream is `stream`.
 * @param stream - Stream the retirement path must discover and drain.
 * @returns Minimal logger exposing `flush()` plus the stream symbol.
 */
function loggerWithStream(stream: object): Logger {
  const logger = {
    /**
     * Acknowledge the caller's flush request; retirement drains the stream itself.
     * @returns Always true.
     */
    flush: (): true => true,
  } as unknown as Logger;
  Object.defineProperty(logger, pino.symbols.streamSym, { value: stream });
  return logger;
}

export type { IPinoStream };
export { hasPinoStream, loggerWithStream, readPinoStream };
