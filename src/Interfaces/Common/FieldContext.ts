import type { Frame, Page } from 'playwright';

/**
 * The resolved location of a login field — always returned, never throws.
 * Check `isResolved` before using `selector` / `context`.
 * - `resolvedVia`: 'bankConfig' (bank's own selector) | 'wellKnown' (global fallback) | 'notResolved'
 * - `round`: 'iframe' (found in child frame) | 'mainPage' (found in main context) | 'notResolved'
 */
export interface FieldContext {
  isResolved: boolean;
  selector: string;
  context: Page | Frame;
  resolvedVia: 'bankConfig' | 'wellKnown' | 'notResolved';
  round: 'iframe' | 'mainPage' | 'notResolved';
  /** Diagnostic message — populated when isResolved is false */
  message?: string;
}
