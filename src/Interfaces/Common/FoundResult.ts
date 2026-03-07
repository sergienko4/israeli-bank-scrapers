/**
 * Replaces T | null and T | undefined in "found or not found" search functions.
 * Discriminate with isFound to safely access the value without null checks.
 *
 * @example
 * const result = await findFrame(page);
 * if (result.isFound) { await result.value.click(); }
 */
export type FoundResult<T> = { isFound: true; value: T } | { isFound: false };
