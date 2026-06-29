/**
 * Origin-only guard for the proven Yahav (BaNCS) scrape-replay contract.
 *
 * <p>This suite guards two halves of the contract that no other test
 * fires on the June data-bearing window (run 29-06-2026_19271361):
 *   1. `UIID.Id` origin restoration on the REAL `RecCtrl`-absent June
 *      replay shape — the dashboard-captured scrape-ACTION/0039 template
 *      OMITS any record-control block and carries an EMPTY origin, which
 *      the bank's input validator rejected with `88501`
 *      (`SubjctElmnt.Path:"origin"`). Restoring the origin is the proven
 *      fix the reject named.
 *   2. The response parser (`extractTransactions`) yields ≥1 txn from a
 *      BaNCS success body whose `Payload.DataEntity` holds one
 *      `Transaction_1.0.0` record.
 * Flat (non-BaNCS) bodies stay free of any envelope mutation, so the 18
 * other banks remain byte-identical.
 *
 * <p>`RecCtrl` restoration is intentionally OUT OF SCOPE — staged as a
 * contingency pending live-run evidence, because the reject named only
 * `origin`.
 */

import type { ApiRecord } from '../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { extractTransactions } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import { buildMonthBody } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.js';
import ORIGIN from '../../../../Scrapers/Pipeline/Registry/WK/ScrapeRequestEnvelope.js';

/** Replayed BaNCS body view exposing the origin envelope under assertion. */
interface IBancsReplayBody {
  readonly UIID: { readonly Ver: string; readonly Id?: string };
}

/**
 * AND-filter pair the captured template uses for the txn date window —
 * GE/LE `OrigDt` bounds the cycle loop rewrites per month.
 * @returns Captured-shape AND filter with placeholder bounds.
 */
function andDateFilter(): Record<string, unknown> {
  return {
    Ver: 'ANDFilter_1.0.0',
    Filters: [
      {
        Ver: 'TransactionListFilter_1.0.0',
        OrigDt: { Ver: 'Date_1.0.0' },
        Operator: 'GREATERTHANOREQUAL',
      },
      {
        Ver: 'TransactionListFilter_1.0.0',
        OrigDt: { Ver: 'Date_1.0.0' },
        Operator: 'LESSTHANOREQUAL',
      },
    ],
  };
}

/**
 * June seed in the REAL broken replay shape: a BaNCS `UIIDomain`
 * envelope with an EMPTY `UIID.Id` (no `Id` key) and NO `Payload.RecCtrl`
 * — the exact captured scrape-ACTION/0039 window that produced the 88501
 * origin reject.
 * @returns Serialized BaNCS replay template.
 */
function juneSeedTemplate(): string {
  return JSON.stringify({
    Ver: 'MessageEnvelope_1.0.0',
    Payload: { Ver: 'MessagePayload_1.0.0', Operation: 'INQ', Filters: [andDateFilter()] },
    UIID: { Ver: 'UIIDomain_1.0.0' },
  });
}

/**
 * Replay the June seed for a June 2026 window.
 * @returns Replayed body typed for the origin assertion.
 */
function buildJuneBody(): IBancsReplayBody {
  const result = buildMonthBody({
    template: juneSeedTemplate(),
    accountId: '',
    month: 6,
    year: 2026,
  });
  return result as unknown as IBancsReplayBody;
}

/**
 * One BaNCS `Transaction_1.0.0` record carrying the proven WK date /
 * amount / description aliases so the parser recognises it.
 * @returns A mappable BaNCS transaction record.
 */
function bancsTxnRecord(): ApiRecord {
  return {
    Ver: 'Transaction_1.0.0',
    OperationDate: '2026-06-15',
    OperationAmount: -250.75,
    OperationDescriptionToDisplay: 'SUPERMARKET PURCHASE',
  };
}

/**
 * Minimal BaNCS SUCCESS response: `Status.Code:0` + one txn under
 * `Payload.DataEntity`.
 * @returns Success response body for the parser.
 */
function bancsSuccessBody(): ApiRecord {
  return {
    Status: { Ver: 'Status_1.0.0', Code: 0 },
    Payload: { Ver: 'MessagePayload_1.0.0', Operation: 'INQ', DataEntity: [bancsTxnRecord()] },
  };
}

describe('ScrapeReplay June window — proven BaNCS request shape', () => {
  // Meaningful (non-trivial) guard: the seed enters with an EMPTY UIID.Id,
  // so a passing assertion proves ensureRequestOrigin rewrote the REAL
  // broken input — not a value the template already carried.
  it('restores the empty UIID.Id origin the validator requires', () => {
    const body = buildJuneBody();
    expect(body.UIID.Id).toBe(ORIGIN.value);
  });

  it('leaves a flat non-BaNCS body free of envelope mutation (18-bank no-op)', () => {
    const template = JSON.stringify({ accountId: 'X', month: '1', year: '2025' });
    const result = buildMonthBody({ template, accountId: 'A1', month: 6, year: 2026 });
    expect(result).toEqual({ accountId: 'A1', month: '6', year: '2026' });
  });
});

describe('ScrapeReplay June window — BaNCS success parser path', () => {
  it('yields ≥1 transaction from a DataEntity success body', () => {
    const body = bancsSuccessBody();
    const txns = extractTransactions(body);
    expect(txns.length).toBeGreaterThanOrEqual(1);
  });
});
