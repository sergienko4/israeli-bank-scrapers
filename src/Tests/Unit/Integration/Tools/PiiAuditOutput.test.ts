/**
 * Output contract of the `fixtures-pii` gate (`scripts/audit-fixtures-pii.cjs`).
 *
 * The pre-commit hook writes the gate's console output to
 * `.pre-commit-output.log`, so a hit line must locate a leak without
 * repeating it: severity, rule id, line:column and match length only, never
 * the matched text or its surrounding context. The summary and verdict lines
 * stay byte-identical to the earlier gate, so anything that reads them keeps
 * working.
 */

import {
  type AuditHit,
  type AuditSeverity,
  type AuditSummary,
  auditText,
  formatHit,
  renderFileReport,
  renderSummary,
  summarizeReports,
} from '../../../../../scripts/audit-fixtures-pii.cjs';

/** RFC 5737 documentation address, never a real client. */
const FAKE_IP = '198.51.100.7';
/** Same-length RFC 5737 address, for the swap-invariance check. */
const FAKE_IP_SWAP = '198.51.100.9';
/** Unique marker placed just left of the secret, inside the ctx window. */
const LEFT_SENTINEL = 'QQLEFTSENTINELQQ';
/** Unique marker placed just right of the secret, inside the ctx window. */
const RIGHT_SENTINEL = 'QQRIGHTSENTINELQQ';
/** Header line `renderFileReport` emits for the synthetic file. */
const HEADER = '\n=== f.json ===';

/**
 * Build a synthetic hit whose rule id is derived from its severity.
 *
 * @param severity - Rule severity.
 * @param at - Offset of the match in the fixture text.
 * @param match - Matched text.
 * @returns A hit with a `ctx` that names the match.
 */
function makeHit(severity: AuditSeverity, at = 0, match = 'x'): AuditHit {
  const pat = { id: `rule-${severity.toLowerCase()}`, severity };
  return { pat, match, at, ctx: `ctx-${match}` };
}

/**
 * Build `count` same-severity hits at consecutive offsets.
 *
 * @param severity - Rule severity of every hit.
 * @param count - Number of hits.
 * @returns The hits, in offset order.
 */
function makeHits(severity: AuditSeverity, count: number): AuditHit[] {
  return Array.from({ length: count }, (_, at): AuditHit => makeHit(severity, at));
}

/**
 * A JSON fixture with a client IP between the two sentinels.
 *
 * @param ip - The client address to embed.
 * @returns Fixture text whose ctx window spans both sentinels.
 */
function ipFixture(ip: string): string {
  return `{"a":"${LEFT_SENTINEL}","client_ip":"${ip}","b":"${RIGHT_SENTINEL}"}`;
}

/**
 * Render the report for a fixture through the real audit.
 *
 * @param raw - Fixture text.
 * @returns The report lines.
 */
function reportFor(raw: string): string[] {
  const hits = auditText(raw);
  return renderFileReport('f.json', raw, hits);
}

/**
 * Locate a hit at the first occurrence of `needle` and format it.
 *
 * @param raw - Fixture text.
 * @param needle - Text the hit starts at.
 * @returns The formatted hit line.
 */
function formatAt(raw: string, needle: string): string {
  const at = raw.indexOf(needle);
  const hit = makeHit('HIGH', at, needle);
  return formatHit(hit, raw);
}

/** A fixture text, the text a hit starts at, and its expected line:column. */
interface ILocationCase {
  readonly name: string;
  readonly raw: string;
  readonly needle: string;
  readonly at: string;
}

/**
 * A summary with no hits, overridden field by field.
 *
 * @param overrides - Fields to change.
 * @returns The summary.
 */
function summaryOf(overrides: Partial<AuditSummary>): AuditSummary {
  return { critical: 0, high: 0, filesWithHits: 0, failed: false, ...overrides };
}

describe('formatHit', () => {
  it('TC-1 prints severity, rule id, location and length only', () => {
    const pat = { id: 'client-ip-field', severity: 'HIGH' } as const;
    const line = formatHit({ pat, match: 'cde', at: 2, ctx: 'abcdef' }, 'abcdef');
    expect(line).toBe('  [HIGH] client-ip-field at 1:3 (len 3)');
  });

  it('TC-2 counts lines and columns from the hit offset', () => {
    const raw = `a\nbb\n${'x'.repeat(13)}SECRETVALUE`;
    const line = formatAt(raw, 'SECRETVALUE');
    expect(line).toBe('  [HIGH] rule-high at 3:14 (len 11)');
  });

  it.each<ILocationCase>([
    { name: 'offset 0', raw: 'ab\ncd', needle: 'ab', at: '1:1' },
    { name: 'offset 0 on a leading newline', raw: '\nab', needle: '\n', at: '1:1' },
    { name: 'the first char after a newline', raw: 'ab\ncd', needle: 'cd', at: '2:1' },
  ])('TC-2b puts $name in column 1', row => {
    const line = formatAt(row.raw, row.needle);
    expect(line).toContain(` at ${row.at} `);
  });

  it.each<ILocationCase>([
    { name: 'the start of a CRLF line', raw: 'ab\r\ncd\r\nef', needle: 'ef', at: '3:1' },
    { name: 'mid CRLF line', raw: 'ab\r\ncd\r\nef', needle: 'd', at: '2:2' },
  ])('TC-2c counts \\n only at $name', row => {
    const line = formatAt(row.raw, row.needle);
    expect(line).toContain(` at ${row.at} `);
  });

  it.each<ILocationCase>([
    { name: 'Hebrew', raw: '\u05e9\u05dc\u05d5\u05dd x', needle: 'x', at: '1:6' },
    { name: 'a surrogate pair', raw: '\u{1F600}x', needle: 'x', at: '1:3' },
  ])('TC-2d counts UTF-16 code units after $name', row => {
    const line = formatAt(row.raw, row.needle);
    expect(line).toContain(` at ${row.at} `);
  });
});

describe('renderFileReport', () => {
  it('TC-3 never prints the secret, its neighbours or the ctx', () => {
    const raw = ipFixture(FAKE_IP);
    const hits = auditText(raw);
    const ctxs = hits.map((hit): string => hit.ctx);
    const allCtx = ctxs.join('\n');
    expect(allCtx).toContain(LEFT_SENTINEL);
    expect(allCtx).toContain(RIGHT_SENTINEL);
    const output = renderFileReport('f.json', raw, hits).join('\n');
    expect(output).toContain('client-ip-field');
    for (const leak of [FAKE_IP, LEFT_SENTINEL, RIGHT_SENTINEL, ...ctxs]) {
      expect(output).not.toContain(leak);
    }
  });

  it('TC-4 is identical when only a same-length secret changes', () => {
    const swappedRaw = ipFixture(FAKE_IP_SWAP);
    const originalRaw = ipFixture(FAKE_IP);
    const swapped = reportFor(swappedRaw);
    const original = reportFor(originalRaw);
    expect(swapped).toEqual(original);
  });

  it('TC-5 caps each file at 15 hit lines', () => {
    const raw = 'x'.repeat(20);
    const hits = makeHits('HIGH', 17);
    const lines = renderFileReport('f.json', raw, hits);
    expect(lines).toHaveLength(17);
    expect(lines[0]).toBe(HEADER);
    expect(lines[16]).toBe('  ... and 2 more');
  });

  it('TC-6 prints nothing for a file with INFO hits only', () => {
    const hits = makeHits('INFO', 2);
    const lines = renderFileReport('f.json', 'xx', hits);
    expect(lines).toEqual([]);
  });

  it('TC-7 puts CRITICAL first and keeps scan order within a severity', () => {
    const hits = [makeHit('HIGH', 0), makeHit('CRITICAL', 1), makeHit('HIGH', 2)];
    const lines = renderFileReport('f.json', 'abc', hits);
    expect(lines).toEqual([
      HEADER,
      '  [CRITICAL] rule-critical at 1:2 (len 1)',
      '  [HIGH] rule-high at 1:1 (len 1)',
      '  [HIGH] rule-high at 1:3 (len 1)',
    ]);
  });
});

describe('summarizeReports', () => {
  it('TC-12 does not count a file with INFO hits only', () => {
    const summary = summarizeReports([[makeHit('INFO')], [makeHit('HIGH')]]);
    const expected = summaryOf({ high: 1, filesWithHits: 1, failed: true });
    expect(summary).toEqual(expected);
  });

  it('TC-13 tallies the top 15 hits of a file only', () => {
    const hits = makeHits('HIGH', 17);
    const summary = summarizeReports([hits]);
    expect(summary.high).toBe(15);
  });

  it('TC-14 takes the top 15 after the severity sort', () => {
    const summary = summarizeReports([[...makeHits('HIGH', 15), makeHit('CRITICAL', 15)]]);
    expect([summary.critical, summary.high]).toEqual([1, 14]);
  });

  it.each([
    ['no files', [], false],
    ['an INFO-only file', [[makeHit('INFO')]], false],
    ['a HIGH hit', [[makeHit('HIGH')]], true],
    ['a CRITICAL hit', [[makeHit('CRITICAL')]], true],
  ])('TC-15 sets failed for %s to %s', (_name, hitLists, failed) => {
    const summary = summarizeReports(hitLists);
    expect(summary.failed).toBe(failed);
  });
});

describe('renderSummary', () => {
  it('TC-16 prints the FAIL block unchanged', () => {
    const summary = summaryOf({ critical: 1, high: 2, filesWithHits: 1, failed: true });
    const lines = renderSummary(3, summary);
    expect(lines).toEqual([
      '\n========== AUDIT SUMMARY ==========',
      'Files scanned: 3',
      'Files with PII hits: 1',
      'CRITICAL hits (top 15/file): 1',
      'HIGH     hits (top 15/file): 2',
      '\n❌ FAIL: PII detected in committed fixtures. Re-run redactor and re-audit.',
    ]);
  });

  it('TC-16 prints the PASS block unchanged', () => {
    const summary = summaryOf({});
    const lines = renderSummary(4, summary);
    expect(lines).toEqual([
      '\n========== AUDIT SUMMARY ==========',
      'Files scanned: 4',
      'Files with PII hits: 0',
      'CRITICAL hits (top 15/file): 0',
      'HIGH     hits (top 15/file): 0',
      '\n✅ PASS: no PII patterns detected.',
    ]);
  });
});
