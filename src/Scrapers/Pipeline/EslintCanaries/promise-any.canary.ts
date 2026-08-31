/**
 * ESLint canary — promise-any.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 CONCURRENCY: Promise.any() swallows e
 */

// Canary: Promise.any() ban — must use Promise.allSettled()
async function raceUnsafe(): Promise<number> {
  const result = await Promise.any([Promise.resolve(1)]);
  return result;
}

export { raceUnsafe };
