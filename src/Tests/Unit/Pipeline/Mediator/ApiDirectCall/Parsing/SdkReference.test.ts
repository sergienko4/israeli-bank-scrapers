/**
 * Active SDK references come from document syntax without executing scripts.
 */

import { captureSdkReference } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Parsing/SdkReference.js';
import type { IUrlRule } from '../../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

const ANSWER_URL = 'https://bank.example/gatekeeper/he/';
const RULES: readonly IUrlRule[] = [
  { origin: 'https://bank.example', paths: ['/gatekeeper/sdk.js', '/other/sdk.js'] },
];

describe('active SDK reference', () => {
  it('resolves an active src against the first document base', () => {
    const html = '<base href="../"><script src="sdk.js"></script>';
    const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
    expect(result).toMatchObject({
      success: true,
      value: 'https://bank.example/gatekeeper/sdk.js',
    });
  });

  it('recognizes the observed top-level queue and deduplicates identical references', () => {
    const script = '(self.__next_s=self.__next_s||[]).push(["../sdk.js",{}])';
    const html = `<script>${script}</script><script src="../sdk.js"></script>`;
    const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
    expect(result).toMatchObject({
      success: true,
      value: 'https://bank.example/gatekeeper/sdk.js',
    });
  });

  it('ignores a static inline-script queue entry next to the pinned SDK', () => {
    const inline = 'self.__next_s.push([0,{"id":"inline","children":"bootstrap"}])';
    const sdk = 'self.__next_s.push(["../sdk.js",{}])';
    const result = captureSdkReference({
      html: `<script>${inline};${sdk}</script>`,
      answerUrl: ANSWER_URL,
      rules: RULES,
    });
    expect(result).toMatchObject({
      success: true,
      value: 'https://bank.example/gatekeeper/sdk.js',
    });
  });

  it.each([
    'self.__next_s.push([0,{"src":"https://other.invalid/script.js"}])',
    'self.__next_s.push([0,{...unknown}])',
    'self.__next_s.push([0,{[unknown]: "value"}])',
    'self.__next_s.push([0,{"id":unknown}])',
    'self.__next_s.push([0,{}],["../sdk.js",{}])',
    'self.__next_s.push([0])',
  ])('refuses ambiguous inline-script properties next to an SDK: %s', invalid => {
    const html = `<script>self.__next_s.push(["../sdk.js",{}]);${invalid}</script>`;
    const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
    expect(result).toMatchObject({ success: false });
  });

  it('rejects inert, foreign or non-executable script references', () => {
    const html = [
      '<!-- <script src="../sdk.js"></script> -->',
      '<template><script src="../sdk.js"></script></template>',
      '<noscript><script src="../sdk.js"></script></noscript>',
      '<svg><script href="../sdk.js"></script></svg>',
      '<script type="application/json" src="../sdk.js"></script>',
      '<script nomodule src="../sdk.js"></script>',
      '<script language="javascript " src="../sdk.js"></script>',
      '<script type=" module " src="../sdk.js"></script>',
      '<script for="another" event="onclick" src="../sdk.js"></script>',
      '<script>function unused(){self.__next_s.push(["../sdk.js"])}</script>',
      '<script>self.__next_f.push(["../sdk.js"])</script>',
    ].join('');
    const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
    expect(result).toMatchObject({
      success: false,
    });
  });

  it('counts legacy executable JavaScript MIME types when deciding uniqueness', () => {
    const html = [
      '<script src="../sdk.js"></script>',
      '<script type="application/x-javascript" src="/other/sdk.js"></script>',
    ].join('');
    const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
    expect(result).toMatchObject({ success: false });
  });

  it.each([
    '["/other/sdk.js",{}]',
    '[dynamicSource,{}]',
    '[]',
    '...unknown',
    '[0,{"id":"inline"}]',
  ])('refuses an unchecked later queue argument: %s', later => {
    const script = `self.__next_s.push(["../sdk.js",{}],${later})`;
    const result = captureSdkReference({
      html: `<script>${script}</script>`,
      answerUrl: ANSWER_URL,
      rules: RULES,
    });
    expect(result).toMatchObject({ success: false });
  });

  it.each([
    ['\t\n\f\r text/javascript \t\n\f\r', true],
    ['\u00a0text/javascript\u00a0', false],
    [' '.repeat(32768), false],
  ])('preserves HTML classic-script type whitespace rules', (type, success) => {
    const result = captureSdkReference({
      html: `<script type="${type}" src="../sdk.js"></script>`,
      answerUrl: ANSWER_URL,
      rules: RULES,
    });
    expect(result).toMatchObject({ success });
  });

  it('refuses different allowed references and relevant malformed syntax without source text', () => {
    const candidates = [
      '<script src="../sdk.js"></script><script src="/other/sdk.js"></script>',
      '<script>self.__next_s.push(["synthetic-private-source"</script>',
    ];
    for (const html of candidates) {
      const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
      expect(result).toMatchObject({ success: false });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('synthetic-private-source');
    }
  });

  it('refuses malformed active sources even alongside an allowed reference', () => {
    const sources = [
      '<script src="https://["></script>',
      '<script>self.__next_s.push([dynamicSource])</script>',
      '<script>self.__next_s.push([])</script>',
    ];
    for (const source of sources) {
      const html = `<script src="../sdk.js"></script>${source}`;
      const result = captureSdkReference({ html, answerUrl: ANSWER_URL, rules: RULES });
      expect(result).toMatchObject({ success: false });
    }
  });
});
