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
  type AuditFileSelection,
  type AuditHit,
  type AuditSeverity,
  type AuditSummary,
  auditText,
  formatHit,
  renderFileReport,
  renderSummary,
  selectFileHits,
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
 * Build a hit from a rule whose severity the gate does not support.
 *
 * Simulates a future PATTERNS entry added without a severity rank, so
 * the fail-closed guard can be proven without editing the gate.
 *
 * @param severity - A severity outside the supported set.
 * @returns A hit carrying the unsupported severity.
 */
function unsupportedHit(severity: string): AuditHit {
  return makeHit(severity as AuditSeverity);
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
 * Select a synthetic fixture's hits and render its report, as the gate does.
 *
 * @param raw - Fixture text.
 * @param hits - Hits of the fixture.
 * @returns The report lines.
 */
function renderHits(raw: string, hits: readonly AuditHit[]): string[] {
  const selection = selectFileHits(hits);
  return renderFileReport('f.json', raw, selection);
}

/**
 * Render the report for a fixture through the real audit.
 *
 * @param raw - Fixture text.
 * @returns The report lines.
 */
function reportFor(raw: string): string[] {
  const hits = auditText(raw);
  return renderHits(raw, hits);
}

/**
 * Select each fixture's hits and tally them, as the gate does.
 *
 * @param hitLists - Hits of each fixture.
 * @returns The summary.
 */
function summarizeHits(hitLists: readonly (readonly AuditHit[])[]): AuditSummary {
  const selections = hitLists.map((hits): AuditFileSelection => selectFileHits(hits));
  return summarizeReports(selections);
}

/**
 * Where each selected hit sits, as `SEVERITY@offset`.
 *
 * @param selection - A file's selection.
 * @returns One tag per selected hit, in report order.
 */
function topTags(selection: AuditFileSelection): string[] {
  return selection.top.map((hit): string => `${hit.pat.severity}@${String(hit.at)}`);
}

/**
 * Count the report lines of one severity.
 *
 * @param lines - Report lines.
 * @param severity - Severity tag to count.
 * @returns The number of hit lines with that tag.
 */
function countLines(lines: readonly string[], severity: AuditSeverity): number {
  return lines.filter((line): boolean => line.startsWith(`  [${severity}] `)).length;
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
    const output = renderHits(raw, hits).join('\n');
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
    const lines = renderHits(raw, hits);
    expect(lines).toHaveLength(17);
    expect(lines[0]).toBe(HEADER);
    expect(lines[16]).toBe('  ... and 2 more');
  });

  it('TC-6 prints nothing for a file with INFO hits only', () => {
    const hits = makeHits('INFO', 2);
    const lines = renderHits('xx', hits);
    expect(lines).toEqual([]);
  });

  it('TC-7 puts CRITICAL first and keeps scan order within a severity', () => {
    const hits = [makeHit('HIGH', 0), makeHit('CRITICAL', 1), makeHit('HIGH', 2)];
    const lines = renderHits('abc', hits);
    expect(lines).toEqual([
      HEADER,
      '  [CRITICAL] rule-critical at 1:2 (len 1)',
      '  [HIGH] rule-high at 1:1 (len 1)',
      '  [HIGH] rule-high at 1:3 (len 1)',
    ]);
  });
});

describe('selectFileHits', () => {
  it('TC-8 keeps scan order within each severity', () => {
    const hits = [
      makeHit('HIGH', 0),
      makeHit('CRITICAL', 1),
      makeHit('HIGH', 2),
      makeHit('INFO', 3),
      makeHit('CRITICAL', 4),
    ];
    const selection = selectFileHits(hits);
    const tags = topTags(selection);
    expect(tags).toEqual(['CRITICAL@1', 'CRITICAL@4', 'HIGH@0', 'HIGH@2']);
    expect(selection.hidden).toBe(0);
  });

  it('TC-9 selects a CRITICAL hit found past the 15th HIGH hit', () => {
    const hits = [...makeHits('HIGH', 16), makeHit('CRITICAL', 16)];
    const selection = selectFileHits(hits);
    const [firstTag] = topTags(selection);
    expect(selection.top).toHaveLength(15);
    expect(firstTag).toBe('CRITICAL@16');
    expect(selection.hidden).toBe(2);
  });

  it('TC-10 selects nothing from INFO hits or no hits', () => {
    const infoHits = makeHits('INFO', 3);
    const infoOnly = selectFileHits(infoHits);
    const empty = selectFileHits([]);
    expect(infoOnly).toEqual({ top: [], hidden: 0 });
    expect(empty).toEqual({ top: [], hidden: 0 });
  });

  it('TC-11 tallies exactly the hit lines the report prints', () => {
    const hits = [...makeHits('HIGH', 10), ...makeHits('CRITICAL', 10)];
    const raw = 'x'.repeat(20);
    const lines = renderHits(raw, hits);
    const summary = summarizeHits([hits]);
    const printedCritical = countLines(lines, 'CRITICAL');
    const printedHigh = countLines(lines, 'HIGH');
    expect(summary.critical).toBe(printedCritical);
    expect(summary.high).toBe(printedHigh);
    expect([summary.critical, summary.high]).toEqual([10, 5]);
  });

  it('TC-11b fails closed on a severity it does not know', () => {
    const hit = unsupportedHit('MEDIUM');
    expect(() => selectFileHits([hit])).toThrow('MEDIUM');
  });
});

describe('summarizeReports', () => {
  it('TC-12 does not count a file with INFO hits only', () => {
    const summary = summarizeHits([[makeHit('INFO')], [makeHit('HIGH')]]);
    const expected = summaryOf({ high: 1, filesWithHits: 1, failed: true });
    expect(summary).toEqual(expected);
  });

  it('TC-13 tallies the top 15 hits of a file only', () => {
    const hits = makeHits('HIGH', 17);
    const summary = summarizeHits([hits]);
    expect(summary.high).toBe(15);
  });

  it('TC-14 takes the top 15 after CRITICAL-first selection', () => {
    const summary = summarizeHits([[...makeHits('HIGH', 15), makeHit('CRITICAL', 15)]]);
    expect([summary.critical, summary.high]).toEqual([1, 14]);
  });

  it.each([
    ['no files', [], false],
    ['an INFO-only file', [[makeHit('INFO')]], false],
    ['a HIGH hit', [[makeHit('HIGH')]], true],
    ['a CRITICAL hit', [[makeHit('CRITICAL')]], true],
  ])('TC-15 sets failed for %s to %s', (_name, hitLists, failed) => {
    const summary = summarizeHits(hitLists);
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

  it('TC-16b prints the PASS block unchanged', () => {
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
