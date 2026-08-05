# PayBox (by Discount Bank)

|                |                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CompanyTypes` | `PayBox`                                                                                                                                                     |
| Engine         | **API-direct** (no browser)                                                                                                                                  |
| Credentials    | `phoneNumber`, `otpCodeRetriever` (plus optional `otpLongTermToken`)                                                                                         |
| OTP            | Required (cached long-term token supported)                                                                                                                  |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                        |
| Phone format   | `international-dash` (`972-000000000`)                                                                                                                       |
| Source         | [`Banks/PayBox/PayBoxPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/PayBox/PayBoxPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  phoneNumber: '972-000000000', // international-dash (with -)
  otpCodeRetriever: async () => await myInbox.getCode(),
});

// Save result.persistentOtpToken — pass as otpLongTermToken on next run to skip SMS
```

## Known quirks

- Uses **symmetric (AES-CBC-PKCS7) signing** with the signature written into the request body at an RFC-6901 pointer.
- The `cryptoField` pre-hook encrypts the OTP into `/pin` with a fresh IV at `/pinIv`.
- Deterministic `sha256-prefix-16` bootstrap: PayBox binds its long-term JWT to a phone-derived `deviceId16Hex` so the caller doesn't have to persist a device id.
- v8.4.x added a cold-path unblock when no `PAYBOX_OTP_LONG_TERM` cache exists.

## Post-login auth envelope

PayBox sends no `Authorization` header after login, so `/getUserHistory` identifies itself through an auth envelope in its request **body**. `buildAuthEnvelope()` (`scrape/PayBoxAuthEnvelope.ts`) builds it from the session context; `PAYBOX_AUTH_ENVELOPE_INTERNALS` exposes its two resolution steps for unit tests only.

`/sync` (balance) **must omit the envelope**. It answers HTTP 400 either way, but a rejected body carrying the live `access_token` makes PayBox invalidate the session — a forensic run recorded `/getUserHistory` returning `401 UNAUTHORIZED` 355 ms after a freshly minted token was sent to `/sync`. `balanceVars()` therefore returns `{}`, and `PayBoxScrapeBodyContract.test.ts` pins both halves: the envelope is required on every data step and forbidden on the balance call.

> **Note:** the balance step's `fallbackOnFail: 0` reports the 400 as a zero balance, so a degraded `/sync` is expected and is not by itself a failure. See [Response digest](../observability/response-digest.md) for reading what the server actually objected to.

## Wallet history rows

### Pagination re-serves the first page

`/getUserHistory` is walked with a `{ts, page}` cursor seeded from a `'null'` sentinel. PayBox does **not** always honour the cursor: it can answer page 1 with page 0 verbatim. Because the pagination driver concatenates each page before evaluating the stop condition, an unguarded walk emitted **every transaction twice** — a real run produced 88 rows across only 44 distinct transactions.

`dropCoveredRows()` (`scrape/PayBoxShapeTxns.ts`) filters each page after the first down to rows an earlier page has not already emitted. A re-served page then reduces to zero rows, which ends the walk cleanly.

Two rules decide each row, and identity outranks the clock:

- **Identity is decisive.** The cursor carries `seenIds` — the identities of the previous page's _ambiguous_ rows: those sitting exactly on the boundary instant, plus those whose own timestamp is unparseable. A row whose identity is remembered is a re-serve and is dropped. A distinct transaction that merely shares the boundary timestamp keeps its own identity, so it survives.
- **Identity is total.** `transactionId`, else `_id`, else a fingerprint of the row's own content — its keys ordered at every depth, so a re-serve that respells the row cannot masquerade as a new one. Array order is left alone: a sequence's order is meaning, not spelling. A row without an id is therefore still comparable, so it is neither dropped as unidentifiable nor waved through on every re-serve.
- **The remembered set is drawn from the rows PayBox served, not the rows that survived.** A row already dropped by identity is precisely the one a further re-serve will offer again; forgetting it would re-open the fail-open rule that caught it. Remembering more can never cost a genuine transaction, because identities are unique.
- **The timestamp only settles what identity cannot.** A row strictly older than the boundary is new. A row with no parseable timestamp is kept — fail-open, because a malformed value is not evidence of a duplicate.

The cursor advances on the oldest **parseable** timestamp in the page, chosen by instant rather than by position: nothing in the payload promises the rows arrive sorted, and reading the last row would leave the boundary too new, replaying every row below it on a re-serve. "Parseable" means ISO-8601 specifically, not whatever `Date.parse` will accept — it reads `'1'` as the year 2001, which would place every genuine row in the boundary's future and silently discard the next page. A malformed value never becomes the boundary; a `NaN` boundary would disable filtering outright. When no timestamp on a page parses, the walk stops rather than continue blind. Timestamps are always compared as parsed **instants**, never as text, so two spellings of the same moment (`Z` against a zero offset) cannot disagree about which rows are ambiguous.

### Blank fields are not absent fields

PayBox sends `""` rather than omitting a field, so a `??` chain never reaches its fallback — the first alternative is present, just empty. `displayOf()` therefore selects the first **non-blank** candidate (`merchantName` → `text` → any canonical description alias the row carries), treating whitespace-only as absent. When every candidate is blank the description stays empty: the mapper never invents one.

The alias fallback searches **one alias at a time**. The shared field search returns a single hit per record, so a blank value under a high-priority alias would otherwise end the search and shadow a populated lower-priority peer in the same nested object. Stripping blanks before the search cannot prevent that, because it only sees the row's top level. Alias priority is therefore re-applied afterwards, over non-blank hits only.

`PayBoxWalletRowQuality.test.ts` pins both behaviours. If a future run still shows blank descriptions, read `rowKeys` from the [response digest](../observability/response-digest.md) to find the field name the row actually uses.
