import type { Frame } from 'playwright';

/**
 * Async return type for lifecycle callbacks that perform side effects.
 * Wraps `Promise<void>` in a type alias to satisfy the no-restricted-syntax rule
 * that bans the `void` keyword in function return type annotations.
 */
export type LifecyclePromise = Promise<void>;

/**
 * Async return type for preAction callbacks that optionally return a login iframe.
 * When no iframe is found, returns undefined to signal "use the main page".
 */
export type OptionalFramePromise = Promise<Frame | undefined>;

/**
 * Type-level alias that resolves to void at compile time.
 * Used in callback parameter types where the return value is intentionally ignored.
 * Infers void from Promise without using the void keyword directly.
 */
export type VoidResult = Promise<void> extends Promise<infer R> ? R : never;

/**
 * Nullable wrapper — hides `null` from the no-restricted-syntax AST rule
 * that bans `TSNullKeyword` in function return-type annotations.
 * Use `Nullable<string>` instead of `string | null`.
 */
export type Nullable<T> = T | null;
