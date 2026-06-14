/**
 * Unit tests for AnchorEscape — selector-injection guards
 * (CR PR #345 findings #175, #179). Pure-function tests cover
 * every branch of every helper.
 */

import {
  escapeCssAttr,
  escapeCssIdent,
  toXpathLiteral,
} from '../../../../../Scrapers/Pipeline/Mediator/Form/Anchor/AnchorEscape.js';

describe('AnchorEscape', () => {
  describe('escapeCssIdent', () => {
    /** Capture and restore globalThis.CSS across the two branches. */
    const original = (globalThis as { CSS?: unknown }).CSS;

    afterEach(() => {
      (globalThis as { CSS?: unknown }).CSS = original;
    });

    it('delegates to globalThis.CSS.escape when present', () => {
      (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
        /**
         * Stub CSS.escape that wraps the input in markers so the test
         * can assert delegation happened (rather than the fallback path).
         * @param s - Input identifier.
         * @returns Marker-wrapped string.
         */
        escape: (s: string): string => `<<${s}>>`,
      };
      const delegated = escapeCssIdent('abc');
      expect(delegated).toBe('<<abc>>');
    });

    it('falls back to a regex escape when CSS.escape is missing', () => {
      (globalThis as { CSS?: unknown }).CSS = undefined;
      const fallback = escapeCssIdent('a b');
      expect(fallback).toMatch(/^a\\20 b$/);
    });

    it('leaves identifier-safe chars untouched in fallback path', () => {
      (globalThis as { CSS?: unknown }).CSS = undefined;
      const safe = escapeCssIdent('abc_-9');
      expect(safe).toBe('abc_-9');
    });
  });

  describe('escapeCssAttr', () => {
    it('escapes embedded double-quote characters', () => {
      const escaped = escapeCssAttr('a"b');
      expect(escaped).toBe(String.raw`a\"b`);
    });

    it('escapes backslashes BEFORE quotes (no double-escape)', () => {
      const escaped = escapeCssAttr(String.raw`a\b`);
      expect(escaped).toBe(String.raw`a\\b`);
    });

    it('leaves plain ASCII untouched', () => {
      const untouched = escapeCssAttr('plain text 123');
      expect(untouched).toBe('plain text 123');
    });
  });

  describe('toXpathLiteral', () => {
    it('wraps in double-quotes when value contains no double-quote', () => {
      const xpath = toXpathLiteral('hello world');
      expect(xpath).toBe('"hello world"');
    });

    it('wraps in single-quotes when value contains a double-quote only', () => {
      const xpath = toXpathLiteral('he said "hi"');
      expect(xpath).toBe('\'he said "hi"\'');
    });

    it('uses concat() when value contains BOTH quote styles', () => {
      const mixed = 'a"b\'c"d';
      const xpath = toXpathLiteral(mixed);
      const isConcat = xpath.startsWith('concat(');
      expect(isConcat).toBe(true);
      expect(xpath).toContain('"a"');
      expect(xpath).toContain("'\"'");
    });
  });
});
