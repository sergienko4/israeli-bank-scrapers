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

## The stronger check: counts the provider declares

Both audits above are *inferences*. The hunter guesses which arrays hold transactions; the reject counter infers a defect from a mapper refusal. Each can be argued with, which is why one warns only on a shortfall and the other only on a rejection.

Some responses need no inference at all, because they **state their own row count next to the rows**. Where that is true the comparison is not heuristic and cannot be disputed: a container that says it holds twelve rows and carries zero has lost twelve, provable from a single response with no second run to compare against.

`auditDeclaredRows()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.ts`) performs that comparison. It takes an `IDeclaredArgs` — the raw `body`, the `specs` the bank declares, and a bank/step `label` — and returns an `IDeclaredResult` carrying `checked` (groups that stated a count, so were checkable) and `shortfall` (declared rows not carried, summed).

### A count is only an oracle beside the rows it counts

This is the constraint the design turns on, and it was established by measurement rather than assumed.

The obvious candidate was the response-level total `data.currentTransactionsList.currentTransactionsBillingMonth[].totalTransactionsCurrency[].transactionsCount`. It was tested against captured traffic and **rejected**: it matched the extracted row count on **0 of 69** responses across Isracard and Amex, because it counts a whole billing cycle rather than the response. A guardrail built on it would have warned on every healthy run and been silenced within a week.

The count that does hold is scoped to a single group:

| Candidate | Scope | Groups agreeing |
| --- | --- | --- |
| `…currentTransactionsBillingMonth[].totalTransactionsCurrency[].transactionsCount` | Response-level | **0 of 69** — rejected |
| `outOfStatementChargeDateVouchers[].totalVouchersCurrencyDate.countImmediateVouchers` vs sibling `immediateVouchersCurrencyDate[]` | Sibling-scoped | **41 of 41 (100%)** — Isracard 20/20, Amex 21/21 |

`IDeclaredRowSpec` therefore names three paths — `groups` (the array of groups), `rows` (each group's row array) and `count` (each group's declared count) — rather than a single response-level field. A bank adopts the guardrail by naming those three paths and nothing else; the traversal is shared, so a new adopter adds data and no code.

The container it watches is not an arbitrary one. It is the same `outOfStatementChargeDateVouchers` container whose omission cost a real Isracard statement around 47% of its rows. Had this check existed, that defect would have warned on its first run.

Two banks declare it today — `ISRACARD_DECLARED_ROWS` and `AMEX_DECLARED_ROWS`, each a single literal beside the extractor that reads the container, wired onto the shape's `transactions.declaredRowSpecs`. Any bank whose response carries a sibling count can adopt it the same way; a bank that declares nothing is unaffected, because an empty spec list disables the check.

### Why a shortfall always warns

Unlike the coverage audit there is no room to call it a false positive: the provider said it sent rows we did not return. A surplus is treated differently — extracting more than declared is odd but is not loss, and never nets off against a real gap elsewhere.

```text
declared isracard/txns: complete (checked=20)
declared isracard/txns: SHORTFALL — missing=12 (checked=20)
```

A group that declares no count is skipped rather than counted as agreeing, so `checked=0` means *nothing was verifiable*, which is a different answer from *everything agreed*. Conflating the two would hide a renamed field.

Like the audits above it reports and never repairs. A shortfall means the shape reads the wrong path or the provider changed one — both are reviewed code changes with a test.

## Verifying a change to it

`auditCoverage` is a pure function over a body and a row list, so it is unit-tested in isolation in `src/Tests/Unit/Pipeline/Mediator/Scrape/CoverageAudit.test.ts` — including the transforming-extractor case that pins the mapped-key decision, and the mapper-reject case that pins the over-collection decision. Both exist to fail loudly if someone "simplifies" the comparison back to reference equality or raw counts. `reportMapRejects` is covered alongside it in `src/Tests/Unit/Pipeline/Mediator/Scrape/MapRejects.test.ts`, and `auditDeclaredRows` in `src/Tests/Unit/Pipeline/Mediator/Scrape/DeclaredRows.test.ts` — where the surplus case and the declares-nothing case pin the two decisions above.
