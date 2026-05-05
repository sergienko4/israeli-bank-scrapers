/**
 * Unit tests for the small private helpers in LoginPhaseActions —
 * `extractFormAnchorSelector` (B.2 trustworthy-anchor filter).
 * Covers each accept/reject branch of the selector-shape gate so that
 * positional and bare-tag selectors stay rejected after future edits.
 */

import type { IFormAnchor } from '../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import { extractFormAnchorSelector } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { none, type Option, some } from '../../../../Scrapers/Pipeline/Types/Option.js';

/**
 * Build a `Some<IFormAnchor>` whose only meaningful slot is the selector.
 * The context field is irrelevant to extractFormAnchorSelector and is left
 * unset for test brevity.
 * @param selector - Selector string to wrap.
 * @returns Option<IFormAnchor> in the `some` state.
 */
function someAnchor(selector: string): Option<IFormAnchor> {
  const anchor = { selector, context: undefined } as unknown as IFormAnchor;
  return some(anchor);
}

describe('extractFormAnchorSelector', () => {
  it('returns "" when the option is none (no anchor discovered)', () => {
    const noneAnchor: Option<IFormAnchor> = none();
    const result = extractFormAnchorSelector(noneAnchor);
    expect(result).toBe('');
  });

  it('returns "" when selector is the empty string', () => {
    const anchor = someAnchor('');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('');
  });

  it('accepts an id-based selector (#login)', () => {
    const anchor = someAnchor('#login');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('#login');
  });

  it('rejects a bare "#" with no id body (length 1)', () => {
    const anchor = someAnchor('#');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('');
  });

  it('accepts a name-attribute selector (form[name="login"])', () => {
    const anchor = someAnchor('form[name="login"]');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('form[name="login"]');
  });

  it('accepts a class-based selector matching tag.class (form.user-login-form)', () => {
    const anchor = someAnchor('form.user-login-form');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('form.user-login-form');
  });

  it('rejects positional :nth-of-type fallbacks (Discount-style trap)', () => {
    const anchor = someAnchor('div:nth-of-type(0)');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('');
  });

  it('rejects a bare-tag selector (no id, no name, no class)', () => {
    const anchor = someAnchor('form');
    const result = extractFormAnchorSelector(anchor);
    expect(result).toBe('');
  });
});
