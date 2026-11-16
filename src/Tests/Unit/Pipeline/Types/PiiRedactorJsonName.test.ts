/**
 * A `name` object whose leaves are bare `first` / `last` keys carries no
 * category on the leaf alone. The walker must classify by the parent path so
 * these names are redacted, and arrays of such records must still collapse to
 * the size sentinel.
 */

import { redactJsonBody } from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

describe('PiiRedactor — nested name objects in JSON bodies', () => {
  it('redacts first/last leaves inside a name object', () => {
    const out = redactJsonBody('{"name":{"first":"Alice","last":"Smith"}}');
    expect(out).not.toContain('Alice');
    expect(out).not.toContain('Smith');
  });

  it('collapses arrays of name-object records', () => {
    const body = JSON.stringify({ people: [{ name: { first: 'Alice', last: 'Smith' } }] });
    const out = redactJsonBody(body);
    expect(out).toContain('[<1 redacted items>]');
    expect(out).not.toContain('Alice');
  });
});
