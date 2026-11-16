/**
 * Randomised delay used by E2E harnesses. This is test-side only; production
 * no longer exports a human-delay primitive.
 */

const DEFAULT_MIN_MS = 300;
const DEFAULT_MAX_MS = 1200;

/**
 * Wait a random duration between `minMs` (inclusive) and `maxMs` (exclusive).
 * @param minMs - Lower bound in milliseconds.
 * @param maxMs - Upper bound in milliseconds.
 * @returns Resolves once the delay elapses.
 */
export default function humanDelay(minMs = DEFAULT_MIN_MS, maxMs = DEFAULT_MAX_MS): Promise<void> {
  const delay = minMs >= maxMs ? minMs : minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise<void>(resolve => {
    globalThis.setTimeout(resolve, delay);
  });
}
