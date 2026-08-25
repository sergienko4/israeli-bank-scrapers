# Coverage audit

> **Who this is for:** maintainers asking whether a run that reported success actually returned every transaction the bank sent.

A scrape shape reads **named containers**. When a provider adds a container no shape knows about, every row inside it is dropped, every remaining row is well-formed, nothing throws, and the run reports success with a lower total. Two banks shipped in exactly that state: a single Isracard statement lost 58 of 139 rows, and the equivalent Amex response lost 116 — each around 41% — while emitting no `WARN`, no `ERROR` and no `FATAL`. The shortfall was not merely unnoticed; it was **unfalsifiable**, because no log line in the run carried a number that could contradict it.

`auditCoverage()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/CoverageAudit.ts`) closes that gap. After each page is fetched it re-reads the same response body with `huntTransactionGroups` — the schema-agnostic hunter already in production for Yahav, returning one `TxnGroup` per container it found — and compares the result against what the shape returned.

## What it compares

Both sides are pushed through `autoMapTransaction` and reduced to a **mapped key**:

```text
date | chargedAmount | description
```

Comparing object references instead would report a false 100% loss for every _transforming_ extractor. Yahav's BaNCS normaliser returns new objects, so not one of its rows is reference-equal to the row it came from. The mapped key compares what actually reaches the caller, which is the only thing a consumer can observe.

| Field of `ICoverageResult` | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `extracted`                | Transaction copies the bank shape returned                     |
| `hunted`                   | Transaction copies discoverable anywhere in the body           |
| `unread`                   | Hunted copies the shape did not return — above zero means loss |

The call takes an `ICoverageArgs`: the raw `body` exactly as received, the `extracted` rows the shape produced from it, an `isCardIssuer` hint forwarded to the mapper so charge signs match, and a `label` naming the bank and step for the log line. The label is caller-supplied and must stay free of row content.

### Why it counts copies rather than distinct keys

Two transactions can share a mapped key legitimately: the same amount, at the same merchant, on the same day is an ordinary double charge. An earlier version reduced both sides to a `Set`, so the second copy was invisible — a shape that returned one of two identical rows scored a perfect `unread: 0`. Precisely the silent loss the audit exists to catch.

Counting is therefore a **multiset**, built by `tallyBy` (`src/Scrapers/Pipeline/Mediator/Scrape/Multiset.ts`).

The correction cannot be a naive sum across the whole body, though, because a transaction cross-listed in a summary container _and_ a detail container is one transaction seen twice. Summing would accuse a correct shape of losing a row that never existed. So the audit tallies **each container separately** and merges those tallies with `maxMerge`, which keeps each key's largest single-container count:

- multiplicity **inside** one container is real — two rows, two transactions;
- multiplicity **across** containers is a cross-listing — one transaction, listed twice.

## Why unmappable rows are dropped first

The hunter deliberately over-collects: it scores arrays heuristically and will return schema descriptors, summary blocks and pagination envelopes alongside real rows. A row the mapper rejects is not a transaction, so it can never be a lost one. Excluding it **before** the comparison is what keeps the guardrail silent on healthy banks — without that step, every bank would warn on every page and the signal would be worthless within a day.

Max is the sharpest case for the reverse reason: one `getTransactionsAndGraphs` response carries **every** card merged, and the extractor legitimately narrows to the account's own card. Hunting the unnarrowed body would therefore report every _other_ card's rows as loss — a WARN on every page of every run, forever, which is precisely the discredited-warning-channel failure this guardrail exists to end.

The fix is a declaration, not an inference. A shape whose response carries every account merged declares `auditOwnsRow` (`IApiDirectScrapeTxnsStep`), and the audit narrows hunted rows through it — the driver binds it to the account under audit and passes it as `ownsRow` (`OwnsRow` in `CoverageAudit.ts`). A shape that declares nothing gets `OWNS_EVERY_ROW`, the exported every-row default, so per-account banks need declare nothing and there is only ever one definition of "this row is mine". Max declares `OWNS_MAX_ROW`, which delegates to the same private predicate `filterMaxRows` uses, so the audit's notion of "this card's rows" cannot drift from the extractor's. Every other bank omits it, because every other bank's response is already scoped to one account.

Crucially the narrowing happens **after** the hunt, not before it. Auditing a pre-filtered slice would compare the extractor against itself and always report zero — switching the guardrail off for Max while looking like it was on. Hunting first means a container the shape never reads is still discovered, and the rows in it that belong to this card still count as loss.

## Why it never repairs

It warns. It does not append the missing rows, and it must not be changed to.

Hunted rows are found by heuristic, so their provenance and field semantics are unverified — a row may be a pending duplicate, a foreign-currency twin of a row already present, or a summary line that merely looks transactional. Injecting them would trade a _visible_ shortfall for _invisible_ corruption in the user's ledger, which is strictly the worse failure. The correct repair is always to teach the bank shape the container it is missing, which is a reviewed code change with a test.

## Reading the log line

The verdict carries counts and a bank/step label only — never row content, per `logging-pii-guidlines.md`.

```text
coverage isracard/txns: complete (extracted=278 hunted=278)
coverage isracard/txns: INCOMPLETE — unread=111 (extracted=165 hunted=276)
```

`complete` is emitted at `debug`, so healthy runs stay quiet. `INCOMPLETE` is emitted at `warn` and is the line to search for first when a total looks low.

| Observation                                      | Signal                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `unread` above zero, on one step                 | The shape is missing a container **on that endpoint**              |
| `unread` above zero, every step of one bank      | Suspect a provider-wide response change                            |
| `unread` above zero across several banks at once | Suspect a regression in the mapper, not in the shapes              |
| Totals low but `unread=0`                        | The rows never arrived — look at the request window, not the shape |

That last row is the useful half of a silent verdict: it separates _we failed to read it_ from _the bank did not send it_, which is the same ambiguity the [response digest](response-digest.md) resolves one layer lower down.

## The blind spot: rows the mapper refuses

`auditCoverage` drops unmappable rows from **both** sides before it compares. That is correct for coverage — an unreadable row is not evidence of a missing container — but it leaves the opposite defect unwatched. A shape that extracts a hundred rows the mapper cannot read scores `unread=0` and stays silent, while the caller receives nothing.

`reportMapRejects()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/MapRejects.ts`) watches that. It takes an `IMapRejectArgs` — the row count the shape produced, the count the mapper accepted, and a bank/step label — and returns an `IMapRejectResult` carrying `extracted`, `mapped` and `rejected`.

Unlike the hunter, a bank shape does **not** over-collect: it reads containers it was told hold transactions. So a rejected row means either the shape claimed a container it should not have, or the mapper is missing a field alias the provider started sending. Both are defects.

```text
mapping visacal/txns: complete (extracted=435 mapped=435)
mapping visacal/txns: UNREADABLE — rejected=7 (extracted=12 mapped=5)
```

Measured against captured traffic, all nine captured bank traces score zero — which is the only reason the signal is worth emitting. If it ever becomes chatty for a healthy bank, the fix is to correct that bank's container list, not to soften the check.

It reports and stops. A rejected row cannot be recovered at this layer: the mapper has already decided the row carries no date, amount or description it recognises, so any value invented here would be a guess written into a user's ledger.

## The stronger check: counts the provider declares

Both audits above are _inferences_. The hunter guesses which arrays hold transactions; the reject counter infers a defect from a mapper refusal. Each can be argued with, which is why one warns only on a shortfall and the other only on a rejection.

Some responses need no inference at all, because they **state their own row count next to the rows**. Where that is true the comparison is not heuristic and cannot be disputed: a container that says it holds twelve rows and carries zero has lost twelve, provable from a single response with no second run to compare against.

`auditDeclaredRows()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.ts`) performs that comparison. It takes an `IDeclaredArgs` — the raw `body`, the `specs` the bank declares, and a bank/step `label` — and returns an `IDeclaredResult` carrying `checked` (groups that stated a count, so were checkable) and `shortfall` (declared rows not carried, summed).

### A count is only an oracle beside the rows it counts

This is the constraint the design turns on, and it was established by measurement rather than assumed.

The obvious candidate was the response-level total `data.currentTransactionsList.currentTransactionsBillingMonth[].totalTransactionsCurrency[].transactionsCount`. It was tested against captured traffic and **rejected**: it matched the extracted row count on **0 of 69** responses across Isracard and Amex, because it counts a whole billing cycle rather than the response. A guardrail built on it would have warned on every healthy run and been silenced within a week.

The count that does hold is scoped to a single group:

| Candidate                                                                                                                          | Scope          | Groups agreeing                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------ |
| `…currentTransactionsBillingMonth[].totalTransactionsCurrency[].transactionsCount`                                                 | Response-level | **0 of 69** — rejected                           |
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

A group that declares no count is skipped rather than counted as agreeing, so `checked=0` means _nothing was verifiable_, which is a different answer from _everything agreed_. Conflating the two would hide a renamed field.

Like the audits above it reports and never repairs. A shortfall means the shape reads the wrong path or the provider changed one — both are reviewed code changes with a test.

## The check none of the above can make: the window we asked for

Every audit above compares the response against **itself**. The hunter asks whether we read every row the body contained; the reject counter asks whether the mapper accepted them; the declared count asks whether the body carried what it claimed. All three therefore score a _truncated_ response as perfect — if a provider silently drops the oldest half of the requested window, every row that did arrive was found, mapped and counted.

That blind spot is not hypothetical. It cost a real Hapoalim account four weeks of history with no error, no warning and no failed assertion; the defect surfaced only because a contributor compared two runs by hand (PR #489, `danielbenzvi`).

The one question a truncated response cannot answer honestly compares the body against the **request**:

> We asked for `[startDate … today]`. Do the returned rows reach back to `startDate`?

`assessWindowCoverage()` (`src/Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.ts`) asks exactly that. It takes an `IWindowArgs` — the `requestedStart`, the extracted `rows`, and a bank/step `label` — and returns an `IWindowResult` carrying a `WindowVerdict`, the `oldest` day returned, and the `gapDays` still unproven.

### Why it applies to every bank without being adopted

It reads **no provider metadata**. Of the nine banks whose live traffic was captured and measured, only Hapoalim declares a page size, and none offers a next-page link or cursor to follow — these are date-window APIs, not paged ones. A guardrail built on provider metadata would therefore protect one bank; a guardrail built on the requested window protects all of them.

Row dates resolve through the shared `WK.date` aliases, the same list the mapper uses, so a bank is covered by existing rather than by opting in. A bank whose rows carry a date field the aliases do not know is not silently passed — it reports `unproven`, which is the honest answer.

### Why it runs per account and not per page

The other three audits are per-page questions: each compares one body against itself, so a page is the natural unit. This one is not. Several banks walk the window month by month, one request per month — an August page cannot reach a February start no matter how healthy the scrape is.

Measured across the nine captured traces, asking per page warns on **31 of 69 pages** for each card issuer, and on every page for Yahav and Leumi — on scrapes that are complete. Per account, over the union of every page, the same traces resolve to four banks `covered` and the genuine Hapoalim gap still reported at 64 days. The noisy framing would have buried the one true positive.

So the assessment happens once per account in `walk` (`ApiDirectScrapeBackfill.ts`), after each full `fetchPaginated` walk and **before** the rows are mapped, deduplicated or trimmed by `applyStartWindow`. Assessing the trimmed set would be circular: trimming is precisely what guarantees nothing predates the start.

### Why the verdict is `unproven`, not `truncated`

A quiet account and a truncated one look identical in a single response: both return rows that stop short of the requested start. Nothing in the body distinguishes them.

```text
window hapoalim/txns: covered
window hapoalim/txns: UNPROVEN — oldest=2026-04-14 gapDays=64
window hapoalim/txns: UNPROVEN — no row carried a usable date
```

So the verdict names the doubt rather than a diagnosis, and warns rather than errors. Only re-requesting the uncovered slice separates the two cases, and an empty answer to that request is what turns `unproven` into _quiet_.

Two cases deliberately report `unproven` rather than `covered`: an account that returned no rows, and one whose rows carry no resolvable date. Absence of evidence is not evidence the window was served — treating either as covered would reintroduce the exact silence this check exists to break.

## The check `assessWindowCoverage` cannot make: the window's recent end

Every check above grades a page by how far **back** it reaches. `auditCoverage` asks whether each row in the body was read; `auditDeclaredRows` compares the count the provider declares; `assessWindowCoverage` compares the **oldest** row against the requested start. All three look at the same end of the window.

Hapoalim's backwards date-walk (`HapoalimShapeTxns.ts`) rests on an assumption about the other end. It sends `sortCode=1` and takes the bank at its word: when a page is capped at the bank's own `numItemsPerPage`, the rows returned are the most **recent** N of the requested window and the older remainder is dropped. The walk then re-asks with the window ending on the oldest day it just saw, and marches backwards until the caller's start is reached.

If that ordering ever inverted — the bank capping from the recent end instead — **not one of the checks above would notice**. A page truncated at its recent end still reaches the requested start, so `assessWindowCoverage` grades it `covered`. Every row in the body was still read, so `auditCoverage` is perfect. The loss would land precisely where nothing is looking, and the run would score clean.

`assessWalkOrder()` (`src/Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimWalkGuard.ts`) narrows that blind spot using facts the walk has already proved. It takes an `IWalkOrderArgs` — the day the request `asked` the window to end on, the `newest` and `oldest` days the page carried, whether the page came back full (`capped`), and a bank/step `label` — and returns an `IWalkOrderResult` carrying a `WalkOrderVerdict`.

It narrows rather than closes: none of its tests observes the window's recent end directly, because nothing in a response body reports it. They infer a fault from the walk's own arithmetic instead. Observing that end would take a separate probe request, which is a change to the fetch layer rather than to this guard.

The guard is deliberately conservative about what it will call a fault, because a warning that fires on healthy traffic is worse than no warning: it teaches the reader to ignore the line. The section below on what it **cannot** prove is as load-bearing as the section on what it can.

### Why the newest row is a sound oracle

A cursor is never invented. It is only ever minted from a day that carried rows — the `oldestDay` of the previous page — and the next request ends on that day _inclusively_. The bank has therefore already shown that the day holds at least one row, and has been asked for it again. The next page's newest row must be that same day.

A newest row **older** than the day asked for means the bank withheld everything between the two. That is the inverted-ordering signature, and nothing else produces it. A newest row **newer** than the day asked for honours no bound at all, and reports separately as `beyond`; grading it as honouring the ordering, which an inequality comparison did, would let a bank ignore the window silently. The comparison is lexicographic on `YYYYMMDD`, which needs no date parsing and orders correctly across a year boundary.

### What a full page does not prove

One premise has to be stated carefully, because getting it wrong produced two false detectors that an earlier revision of this guard shipped.

`pageWasCapped` compares `rowCount >= serverPageSize`. That means the page came back **full**. It does _not_ mean rows were dropped: a window holding exactly the cap's worth of rows fills the page and leaves nothing behind. And the cap counts **rows**, not days, so its boundary can fall part-way through any single calendar day — including the first day of the window and the last.

Two shapes therefore look like inverted ordering and are not.

### Why a stalled cursor is graded apart from a violation

A cursor page whose **oldest** row is the cursor day itself did not reach below its cursor. Whether that matters depends entirely on whether the page was full.

When the page is **not** full, this is how every ordinary walk ends. The previous page was full and ended on day D; re-asking `[start, D]` inclusively returns that day's rows and nothing older, because the window held nothing older. `txnsExtractPage` returns `nextCursor: false` and the walk stops. Warning here would fire on the normal termination of a healthy account.

When the page **is** full and every row lands on one day, the cursor genuinely cannot move: the next request would repeat the identical window. That is worth reporting, and reports as `stalled`. But it is a date-cursor granularity limit — one day carrying at least a whole page of rows — not proof that the ordering inverted, so it does not report `violated`. The walk does not spin on it either: `haltReason` in `src/Scrapers/Pipeline/Strategy/Fetch/Pagination.ts` detects the repeated cursor and stops the walk immediately, before the `MAX_PAGES` ceiling is ever relevant.

### Why the first page reports `unknown`

Page one carries no cursor, and a cursor is the only ordering evidence a response body holds.

It is tempting to grade it on its cap instead: under the assumed ordering a cap drops the **oldest** rows, so a page that was full and _yet_ reached back to the requested start looks like a contradiction. It is not one. With a 150-row cap, a window holding 149 newer rows and two rows on the start day returns the 149 plus one start-day row — full, reaching the start, and perfectly newest-first. `HapoalimTxnPaging.test.ts` pins that exact shape as healthy, and the walk recovers the withheld second row by re-asking the start day inclusively.

So the first page reports `unknown`. This is a real gap, and naming it is more useful than filling it with a detector that fires on ordinary traffic: under inverted ordering the walk can terminate on page one, and no oracle available from a single response body would catch it. Closing it needs the recent-end probe described above.

### Why the remaining cases report `unknown`

A page on which no row carried a usable date proves nothing, and neither does any first page. Both yield `unknown` rather than `honoured` — the same rule the window check applies: absence of evidence is not evidence the ordering held.

```text
walk-order hapoalim/txns: honoured
walk-order hapoalim/txns: unknown
walk-order hapoalim/txns: VIOLATED — asked=20260715 newest=20260701; page truncated at its recent end
walk-order hapoalim/txns: STALLED — asked=20260715 oldest=20260715; a full page held one day, so the cursor cannot advance
walk-order hapoalim/txns: BEYOND — asked=20260715 newest=20260716; page carried rows newer than the bound it was given
```

### Why it reports and never repairs

A faulting verdict warns rather than throws, matching `assessWindowCoverage`. Throwing would discard the rows already gathered, which is a larger loss than the one being reported — and the rows on a violated page are still real rows, they are simply not all of them.

## Verifying a change to it

`auditCoverage` is a pure function over a body and a row list, so it is unit-tested in isolation in `src/Tests/Unit/Pipeline/Mediator/Scrape/CoverageAudit.test.ts` — including the transforming-extractor case that pins the mapped-key decision, and the mapper-reject case that pins the over-collection decision. Both exist to fail loudly if someone "simplifies" the comparison back to reference equality or raw counts. `reportMapRejects` is covered alongside it in `src/Tests/Unit/Pipeline/Mediator/Scrape/MapRejects.test.ts`, and `auditDeclaredRows` in `src/Tests/Unit/Pipeline/Mediator/Scrape/DeclaredRows.test.ts` — where the surplus case and the declares-nothing case pin the two decisions above.

`assessWindowCoverage` is covered in `src/Tests/Unit/Pipeline/Mediator/Scrape/WindowCoverage.test.ts`, which pins the two `unproven` cases above and carries the real numbers from the captured Hapoalim trace. Two cases exist solely to pin subtle correctness points. The first: the caller holds `startDate` as a `Date`, so the start arrives as a UTC instant while row dates are local calendar days. Reducing only one side to a calendar day truncates the difference by a partial day and understates `gapDays` by one — enough for a backfill bound derived from `oldest` to skip a day. The second pins the per-account unit: two month-slices that are each `unproven` alone are `covered` in union, which is the whole reason the call site sits after pagination.

`assessWalkOrder` is covered in `src/Tests/Unit/Pipeline/Banks/Hapoalim/HapoalimWalkGuard.test.ts`. Beyond the five verdicts, several cases exist to pin correctness points that are easy to break: the year-boundary comparison (`asked=20260101`, `newest=20251231`) fails for any implementation that compares day-of-month or string length instead of the whole `YYYYMMDD` token; the `beyond` case fails for any implementation that relaxes the cursor comparison to an inequality; and two cases pin the guard's silence rather than its noise — a short page holding only its cursor day, and a full first page reaching the requested start. Both are healthy shapes that an earlier revision graded `violated`, so both fail for any implementation that reads a full page as proof rows were dropped.

Those two silence cases are the ones worth keeping honest. A detector that fires on ordinary traffic is worse than no detector, so they assert `not.toHaveBeenCalled()` on the logger through the real extractor, not merely a verdict string.

Whether the guard is _called_ is a separate question from whether it is correct, and it needs its own coverage: the guard reports and never repairs, so deleting its call site changes no return value anywhere. `src/Tests/Unit/Pipeline/Banks/Hapoalim/HapoalimWalkGuardWiring.test.ts` reads the emitted warning through the real extractor, and `src/Tests/Unit/Pipeline/Infrastructure/ForensicAuditWindowWiring.test.ts` does the same for the run-level `WINDOW` verdict. Both go red if the call is removed.
