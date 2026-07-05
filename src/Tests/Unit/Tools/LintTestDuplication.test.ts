/**
 * Unit tests for the test-duplication canary's pure core — the
 * normalized-body matcher ({@link detectDuplicates}) and the
 * comment/whitespace normaliser ({@link normalizeBody}).
 *
 * The canary enforces the guideline "Tests must NOT duplicate production
 * logic — import and reuse shared helpers from production code." These
 * tests pin the matcher (a byte-identical normalized test body flags),
 * the allowlist escape hatch (the documented Network<->AccountResolve
 * `findFirstIdInPool` copy is exempt), and the normaliser (a reformatted,
 * re-commented copy still collides).
 */

import { detectDuplicates, normalizeBody } from '../../../Tests/Tools/lint-test-duplication.js';

describe('lint-test-duplication — detectDuplicates', () => {
  it('flags a test body byte-identical to a production body', () => {
    const prod = [{ file: 'src/Foo.ts', line: 10, name: 'helper', norm: 'BODYX' }];
    const test = [{ file: 'src/Tests/Unit/Foo.test.ts', line: 20, name: 'copy', norm: 'BODYX' }];
    const violations = detectDuplicates(prod, test);
    const pairs = violations.map((v): string => `${v.test.name}<->${v.prod.name}`);
    expect(pairs).toEqual(['copy<->helper']);
  });

  it('ignores a test body that matches nothing in production', () => {
    const prod = [{ file: 'src/Foo.ts', line: 10, name: 'helper', norm: 'AAA' }];
    const test = [{ file: 'src/Tests/Unit/Foo.test.ts', line: 20, name: 'other', norm: 'BBB' }];
    const violations = detectDuplicates(prod, test);
    expect(violations).toEqual([]);
  });

  it('honours the allowlist for the documented intentional copy', () => {
    const prodFile = 'src/Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.Wait.ts';
    const testFile = 'src/Tests/Unit/Pipeline/Mediator/Network/WaitForFirstId.test.ts';
    const prod = [{ file: prodFile, line: 54, name: 'findFirstIdInPool', norm: 'DUP' }];
    const test = [{ file: testFile, line: 30, name: 'findFirstIdInPool', norm: 'DUP' }];
    const violations = detectDuplicates(prod, test);
    expect(violations).toEqual([]);
  });
});

describe('lint-test-duplication — normalizeBody', () => {
  it('ignores whitespace + line comments so a reformatted copy still collides', () => {
    const spaced = normalizeBody('{\n  const x = 1; // note\n  return x;\n}');
    const compact = normalizeBody('{ const x = 1; return x; }');
    expect(spaced).toBe(compact);
  });

  it('strips block comments', () => {
    const stripped = normalizeBody('{ /* doc */ return 1; }');
    expect(stripped).toBe('{return1;}');
  });
});
