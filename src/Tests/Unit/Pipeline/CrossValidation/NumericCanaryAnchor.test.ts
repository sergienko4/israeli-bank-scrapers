import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `assert-numeric-canaries.cjs` pins every size canary to exactly `cap + 1`
 * lines, the only size at which raising its cap by one is caught.
 *
 * These tests cover the decision the harness makes about a single canary. The
 * case that matters most is a canary whose declared rule resolves to no cap at
 * all: an earlier revision skipped it silently, so the harness could report
 * success having measured nothing — the same vacuous pass the canary suite
 * exists to prevent.
 */
const MODULE_URL = import.meta.url;
const MODULE_PATH = fileURLToPath(MODULE_URL);
const HERE = dirname(MODULE_PATH);
const CANARY_DIR = '../../../../Scrapers/Pipeline/EslintCanaries';
const VERDICT_MODULE = join(HERE, CANARY_DIR, 'numeric-canary-verdict.cjs');

const LOAD_COMMON_JS = createRequire(MODULE_URL);

interface ICap {
  found: boolean;
  max: number;
  options: object;
}

const { capOf: CAP_OF, verdict: VERDICT_OF } = LOAD_COMMON_JS(VERDICT_MODULE) as {
  capOf: (value: unknown) => ICap;
  verdict: (cap: ICap, stillRed: boolean) => string;
};

describe('assert-numeric-canaries capOf', () => {
  it('reads a bare numeric cap', () => {
    const cap = CAP_OF(['error', 150]);
    expect(cap).toEqual({ found: true, max: 150, options: { max: 150 } });
  });

  it('reads a cap from an options object, preserving the other options', () => {
    const cap = CAP_OF(['error', { max: 10, skipBlankLines: true }]);
    expect(cap).toEqual({ found: true, max: 10, options: { max: 10, skipBlankLines: true } });
  });

  it('reports no cap when the rule is switched off by name', () => {
    const cap = CAP_OF(['off']);
    expect(cap.found).toBe(false);
  });

  it('reports no cap when the rule is switched off by severity', () => {
    const cap = CAP_OF(0);
    expect(cap.found).toBe(false);
  });

  it('reports no cap when the rule carries no max', () => {
    const cap = CAP_OF(['error', { skipBlankLines: true }]);
    expect(cap.found).toBe(false);
  });
});

describe('assert-numeric-canaries verdict', () => {
  it('fails a canary whose declared rule resolves to no cap', () => {
    const capless: ICap = { found: false, max: 0, options: {} };
    const outcome = VERDICT_OF(capless, false);
    expect(outcome).toBe('unarmed');
  });

  it('fails a canary that stays red after its own cap is raised by one', () => {
    const cap: ICap = { found: true, max: 10, options: {} };
    const outcome = VERDICT_OF(cap, true);
    expect(outcome).toBe('unanchored');
  });

  it('passes a canary that goes clean at cap + 1', () => {
    const cap: ICap = { found: true, max: 10, options: {} };
    const outcome = VERDICT_OF(cap, false);
    expect(outcome).toBe('ok');
  });
});
