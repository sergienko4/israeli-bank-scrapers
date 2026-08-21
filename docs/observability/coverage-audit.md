# Coverage audit

> **Who this is for:** maintainers asking whether a run that reported success actually returned every transaction the bank sent.

A scrape shape reads **named containers**. When a provider adds a container no shape knows about, every row inside it is dropped, every remaining row is well-formed, nothing throws, and the run reports success with a lower total. Two banks shipped in exactly that state: a single Isracard statement lost 58 of 139 rows, and the equivalent Amex response lost 116 — each around 41% — while emitting no `WARN`, no `ERROR` and no `FATAL`. The shortfall was not merely unnoticed; it was **unfalsifiable**, because no log line in the run carried a number that could contradict it.

`auditCoverage()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/CoverageAudit.ts`) closes that gap. After each page is fetched it re-reads the same response body with `huntTransactions` — the schema-agnostic hunter already in production for Yahav — and compares the result against what the shape returned.

## What it compares

Both sides are pushed through `autoMapTransaction` and reduced to a **mapped key**:

```text
date | chargedAmount | description
```

Comparing object references instead would report a false 100% loss for every *transforming* extractor. Yahav's BaNCS normaliser returns new objects, so not one of its rows is reference-equal to the row it came from. The mapped key compares what actually reaches the caller, which is the only thing a consumer can observe.

| Field of `ICoverageResult` | Meaning |
| --- | --- |
| `extracted` | Distinct transactions the bank shape returned |
| `hunted` | Distinct transactions discoverable anywhere in the body |
| `unread` | Hunted transactions the shape did not return — above zero means loss |

The call takes an `ICoverageArgs`: the raw `body` exactly as received, the `extracted` rows the shape produced from it, an `isCardIssuer` hint forwarded to the mapper so charge signs match, and a `label` naming the bank and step for the log line. The label is caller-supplied and must stay free of row content.

## Why unmappable rows are dropped first

The hunter deliberately over-collects: it scores arrays heuristically and will return schema descriptors, summary blocks and pagination envelopes alongside real rows. A row the mapper rejects is not a transaction, so it can never be a lost one. Excluding it **before** the comparison is what keeps the guardrail silent on healthy banks — without that step, every bank would warn on every page and the signal would be worthless within a day.

Max is the sharpest case for the reverse reason: its extractor legitimately filters by `shortCardNumber`, so `hunted > extracted` is its normal, correct state per account. Reconciling the **union across accounts** on the mapped key reports zero for Max, where a raw-row count would have false-positived permanently.

## Why it never repairs

It warns. It does not append the missing rows, and it must not be changed to.

Hunted rows are found by heuristic, so their provenance and field semantics are unverified — a row may be a pending duplicate, a foreign-currency twin of a row already present, or a summary line that merely looks transactional. Injecting them would trade a *visible* shortfall for *invisible* corruption in the user's ledger, which is strictly the worse failure. The correct repair is always to teach the bank shape the container it is missing, which is a reviewed code change with a test.

## Reading the log line

The verdict carries counts and a bank/step label only — never row content, per `logging-pii-guidlines.md`.

```text
coverage isracard/txns: complete (extracted=278 hunted=278)
coverage isracard/txns: INCOMPLETE — unread=111 (extracted=165 hunted=276)
```

`complete` is emitted at `debug`, so healthy runs stay quiet. `INCOMPLETE` is emitted at `warn` and is the line to search for first when a total looks low.

| Observation | Signal |
| --- | --- |
| `unread` above zero, on one step | The shape is missing a container **on that endpoint** |
| `unread` above zero, every step of one bank | Suspect a provider-wide response change |
| `unread` above zero across several banks at once | Suspect a regression in the mapper, not in the shapes |
| Totals low but `unread=0` | The rows never arrived — look at the request window, not the shape |

That last row is the useful half of a silent verdict: it separates *we failed to read it* from *the bank did not send it*, which is the same ambiguity the [response digest](response-digest.md) resolves one layer lower down.

## The blind spot: rows the mapper refuses

`auditCoverage` drops unmappable rows from **both** sides before it compares. That is correct for coverage — an unreadable row is not evidence of a missing container — but it leaves the opposite defect unwatched. A shape that extracts a hundred rows the mapper cannot read scores `unread=0` and stays silent, while the caller receives nothing.

`reportMapRejects()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/MapRejects.ts`) watches that. It takes an `IMapRejectArgs` — the row count the shape produced, the count the mapper accepted, and a bank/step label — and returns an `IMapRejectResult` carrying `extracted`, `mapped` and `rejected`.

Unlike the hunter, a bank shape does **not** over-collect: it reads containers it was told hold transactions. So a rejected row means either the shape claimed a container it should not have, or the mapper is missing a field alias the provider started sending. Both are defects.

```text
mapping visacal/txns: complete (extracted=435 mapped=435)
mapping visacal/txns: UNREADABLE — rejected=7 (extracted=12 mapped=5)
```

Measured against captured traffic, all nine pipeline banks score zero — which is the only reason the signal is worth emitting. If it ever becomes chatty for a healthy bank, the fix is to correct that bank's container list, not to soften the check.

It reports and stops. A rejected row cannot be recovered at this layer: the mapper has already decided the row carries no date, amount or description it recognises, so any value invented here would be a guess written into a user's ledger.

## Verifying a change to it

`auditCoverage` is a pure function over a body and a row list, so it is unit-tested in isolation in `src/Tests/Unit/Pipeline/Mediator/Scrape/CoverageAudit.test.ts` — including the transforming-extractor case that pins the mapped-key decision, and the mapper-reject case that pins the over-collection decision. Both exist to fail loudly if someone "simplifies" the comparison back to reference equality or raw counts. `reportMapRejects` is covered alongside it in `src/Tests/Unit/Pipeline/Mediator/Scrape/MapRejects.test.ts`.
