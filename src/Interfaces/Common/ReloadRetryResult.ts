/**
 * Result returned by waitUntilWithReload — no throw, caller decides what to do on failure.
 * Discriminate with `found` before accessing `value`:
 *   if (result.found) { use(result.value); }
 */
export type IReloadRetryResult<T> =
  | { found: true; value: NonNullable<T>; reloadsUsed: number; description: string }
  | { found: false; reloadsUsed: number; description: string };
