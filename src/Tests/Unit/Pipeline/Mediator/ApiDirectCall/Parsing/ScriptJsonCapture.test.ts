/**
 * Serialized root fields are read without running page scripts.
 */

import { captureScriptJson } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Parsing/ScriptJsonCapture.js';

const SESSION = '0123456789ABCDEF0123456789ABCDEF';
const OTHER = 'ABCDEF0123456789ABCDEF0123456789';
const POLICY = { field: 'SessionID', pattern: '^[a-fA-F0-9]{32}$', maxChars: 32 } as const;

/**
 * Serializes a JSON object as a JavaScript string literal.
 * @param value - Synthetic object.
 * @returns A quoted JavaScript literal.
 */
function serialized(value: object): string {
  const json = JSON.stringify(value);
  return JSON.stringify(json);
}

describe('serialized script JSON capture', () => {
  it('reads the observed root field from an active assignment without evaluating it', () => {
    const data = serialized({ SessionID: SESSION, UserName: 'synthetic-private-user' });
    const html = `<script>window.ClientBootstrap = ${data};</script>`;
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: true, value: SESSION });
  });

  it('deduplicates the same value across supported top-level statements', () => {
    const data = serialized({ SessionID: SESSION });
    const html = `<script>const state = ${data}; const parsed = JSON.parse(${data});</script>`;
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: true, value: SESSION });
  });

  it('ignores malformed JSON literals alongside a valid root candidate', () => {
    const invalid = JSON.stringify('{"other":');
    const valid = serialized({ SessionID: SESSION });
    const html = `<script>const other = ${invalid}; const state = ${valid};</script>`;
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: true, value: SESSION });
  });

  it('refuses distinct valid root values', () => {
    const first = serialized({ SessionID: SESSION });
    const second = serialized({ SessionID: OTHER });
    const html = `<script>var first = ${first}; var second = ${second};</script>`;
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: false });
    const output = JSON.stringify(result);
    expect(output).not.toContain(SESSION);
    expect(output).not.toContain(OTHER);
  });

  it.each(['SessionID', 'Sess\\u0069onID'])(
    'refuses a serialized object with duplicate root key %s',
    key => {
      const json = `{"SessionID":"${SESSION}","${key}":"${OTHER}"}`;
      const data = JSON.stringify(json);
      const html = `<script>window.ClientBootstrap = ${data};</script>`;
      const result = captureScriptJson({ ...POLICY, html });
      expect(result).toMatchObject({ success: false });
      const output = JSON.stringify(result);
      expect(output).not.toContain(SESSION);
      expect(output).not.toContain(OTHER);
    },
  );

  it('excludes inactive scripts, function bodies, external scripts and nested fields', () => {
    const root = serialized({ SessionID: SESSION });
    const nested = serialized({ nested: { SessionID: SESSION } });
    const html = [
      `<template><script>window.state=${root}</script></template>`,
      `<noscript><script>window.state=${root}</script></noscript>`,
      `<svg><script>window.state=${root}</script></svg>`,
      `<script type="application/json">${root}</script>`,
      `<script src="/other.js">window.state=${root}</script>`,
      `<script>function unused(){return ${root}}</script>`,
      `<script>window.state=${nested}</script>`,
    ].join('');
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: false });
  });

  it.each(['console.log', 'new Unrelated', 'JSON.parse'])(
    'refuses a session found only in an unrelated %s argument',
    call => {
      const data = serialized({ SessionID: SESSION });
      const html = `<script>${call}(${data});</script>`;
      const result = captureScriptJson({ ...POLICY, html });
      expect(result).toMatchObject({ success: false });
    },
  );

  it('refuses a session in the unrelated JSON.parse reviver argument', () => {
    const data = serialized({ SessionID: SESSION });
    const html = `<script>const state = JSON.parse('{}', ${data});</script>`;
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: false });
  });

  it('refuses missing, malformed and pattern-invalid values without exposing page content', () => {
    const bodies = [
      serialized({ SessionID: 'synthetic-private-value' }),
      serialized({ SessionID: 42 }),
      JSON.stringify('{"SessionID":'),
      '"synthetic-private-value"',
    ];
    for (const body of bodies) {
      const html = `<script>window.ClientBootstrap = ${body};</script>`;
      const result = captureScriptJson({ ...POLICY, html });
      expect(result).toMatchObject({ success: false });
      const output = JSON.stringify(result);
      expect(output).not.toContain('synthetic-private-value');
    }
  });

  it('refuses malformed executable script syntax without exposing its contents', () => {
    const html = '<script>window.ClientBootstrap = "synthetic-private-value</script>';
    const result = captureScriptJson({ ...POLICY, html });
    expect(result).toMatchObject({ success: false, errorMessage: 'script JSON invalid' });
    const output = JSON.stringify(result);
    expect(output).not.toContain('synthetic-private-value');
  });
});
