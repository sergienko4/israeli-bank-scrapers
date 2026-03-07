/**
 * Replaces T | null from getFromSessionStorage and similar storage lookups.
 * Discriminate with hasValue to safely access the parsed value without null checks.
 *
 * @example
 * const stored = await getFromSessionStorage(page, key);
 * if (stored.hasValue) { process(stored.value); }
 */
export type StorageResult<T> = { hasValue: true; value: T } | { hasValue: false };
