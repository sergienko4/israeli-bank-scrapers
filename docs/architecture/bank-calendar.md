---
title: Bank calendar
source-files:
  - src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts
  - src/Scrapers/Pipeline/Mediator/Scrape/BankMonth.ts
---

# Bank calendar — the zone every date decision resolves in

> **Who this is for:** anyone reading `ITransaction.date`, comparing a
> transaction against `startDate`, or debugging why the same account produced
> different dates on two machines.

Israeli providers state dates in their own calendar, and most of them state a
**day**, not an instant: `29/06/2026` carries no time and no offset. Turning
that into the ISO instant the public `ITransaction.date` promises requires
choosing a zone. The Pipeline chooses **`Asia/Jerusalem`**, names that choice in
one module, and routes every date decision through it:
[`src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts).

## The rule

**The bank's calendar is `Asia/Jerusalem`. All day-level reasoning happens in
that calendar. Instants stay instants.**

A date-only provider value denotes **midnight of that day in the bank's
calendar**. So `29/06/2026` becomes `2026-06-28T21:00:00.000Z` — the 29th in
Israel, expressed in UTC.

## Reading the day back

The provider's stated day is **not** the UTC date prefix. Slicing
`txn.date.slice(0, 10)` returns the 28th for a row the bank dated the 29th.
Read it in the bank calendar instead:

```ts
import moment from 'moment-timezone';

moment(txn.date).tz('Asia/Jerusalem').format('YYYY-MM-DD'); // '2026-06-29'
```

This is exact for every date-only provider, and it is the recipe the public
field documents.

## The module

Everything above lives in
[`BankCalendar.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts).
It is Pipeline-internal — callers consume the _result_ on `ITransaction`, not
these helpers — but the Scrape cluster reaches for it constantly, so the shape
is worth knowing when reading that code.

| Export                   | What it is for                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BANK_CALENDAR_TIMEZONE` | The zone itself, aliased from the browser context's `ISRAEL_TIMEZONE` so a page cannot render in one calendar while its rows parse in another                                                                                                                    |
| `BANK_DAY_FORMAT`        | The `YYYY-MM-DD` day label every day-level comparison reduces to; it sorts lexicographically, which is why the window comparisons need no date maths                                                                                                             |
| `BankDay`                | Nominal type for that label, so a day cannot be passed where the ISO _instant_ it came from is expected                                                                                                                                                          |
| `parseInBankZone`        | Turns a raw provider value into a moment fixed to the bank zone — the entry point `parseAutoDate` uses                                                                                                                                                           |
| `bankMomentOfInstant`    | Reads an instant in the bank zone. A `Date` is already unambiguous and is only re-expressed; a _string_ may not be, so it is parsed **through** the zone rather than against the host — see [Zone-less strings](#zone-less-strings-resolve-in-the-bank-zone-too) |
| `bankDayOfInstant`       | Reduces an instant to its `BankDay`, or to `false` when the value cannot be read — `moment`'s own `'Invalid date'` string is day-shaped enough to survive a `string` return and then sorts after every real label                                                |

### Named months are not instants

Monthly orchestration carries an `IBankMonth` object instead of serializing a
month to an ISO-looking string and parsing it back through `Date`. The companion
[`BankMonth.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/BankMonth.ts)
owns that boundary:

| Export                    | What it is for                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `IBankDateParts`          | Validated `{ year, month, day }` components for provider wire formats                                      |
| `IBankMonth`              | A validated `{ year, month }` value; `month` is 1-indexed to match bank request parameters                 |
| `IBankMonthBounds`        | Start and end instants for one bank-calendar month                                                         |
| `bankDatePartsOfInstant`  | Projects a resolved instant into validated bank-calendar date components                                   |
| `bankDatePartsOfLabel`    | Strictly validates a complete bank date label before exposing its numeric components                       |
| `bankMonthOfLabel`        | Strictly validates an ISO-shaped bank label and reads the month it names without treating it as an instant |
| `bankMonthOfSlashedLabel` | Strictly validates provider billing labels in `MM/YYYY` form                                               |
| `bankMonthOfInstant`      | Projects a real `Date` or ISO instant into the bank's month                                                |
| `shiftBankMonth`          | Moves a named month without host-local `Date` arithmetic                                                   |
| `shiftBankInstant`        | Moves a resolved instant by bank-calendar months while preserving its bank-calendar wall time              |
| `bankMonthBounds`         | Builds the first and last instants of a named month in `Asia/Jerusalem`                                    |

`MatrixLoopStrategy` now consumes this object from cycle selection through
request construction. The request body and URL bounds therefore describe the
same month on every host.

## Zone-less strings resolve in the bank zone too

ISO-8601 lets a value carry no offset — `2026-02-09`, or `2026-02-09T00:00:00`.
Such a value is not an instant until some zone is chosen for it, and plain
`moment(value, moment.ISO_8601)` chooses **moment's effective default** — the
host's zone, unless something in the process has called `moment.tz.setDefault`.
Something does: `BaseScraper.initialize()` sets it before scraping, on the same
singleton the Pipeline imported. So the old reading varied not only with the
machine but with **scrape order** within one process, exactly as described under
[Why the zone is named rather than inherited](#why-the-zone-is-named-rather-than-inherited).
The argument looks absolute, so nothing at the call site suggests the answer
could move at all.

It did. Read from `Pacific/Kiritimati` (UTC+14), a bare `2026-02-09` resolved to
`2026-02-08` in the bank calendar. In the window audit that shifted the
requested start back a day, inflating `gapDays` by one and reporting a fully
covered window as `unproven` — a spurious backfill ask, on nothing but the
reader's location.

`bankMomentOfInstant` therefore parses strings with `moment.tz(value,
moment.ISO_8601, strict, BANK_CALENDAR_TIMEZONE)`.

The change is confined to values that were ambiguous in the first place:

- **`Date` arguments** — unchanged. A `Date` is already an instant; it is only
  re-expressed.
- **Strings carrying an explicit offset** — unchanged, byte for byte. The offset
  still wins, so everything `Date.prototype.toISOString()` produces resolves
  exactly as before. Every caller that passes `ctx.options.startDate`, a window
  bound, or a `toISOString()` result is in this group.
- **Bare `YYYY-MM-DD` (or offset-less) strings** — these **do** change, which is
  the point. `ITransaction.date` can reach `bankMomentOfInstant` this way
  through `isInWindow` in
  [`src/Scrapers/Pipeline/Mediator/Scrape/StartWindow.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/StartWindow.ts)
  whenever `parseAutoDate` could not normalise the provider's raw value. Such a
  row used to be classified in or out of the window by the reader's location;
  it is now classified in the bank's calendar.

!!! note "Why the test suite could not see this"
`jest.config.js` pins `TZ='Asia/Jerusalem'`, and Jerusalem is the one zone
in which the ambient reading and the bank-anchored reading agree. CI's
`test:pipeline` uses `jest.pipeline.config.cjs`, which pins nothing and so
runs in the runner's UTC. The divergence is deliberate: pinning the pipeline
config would buy a green suite by hiding this whole class of defect. Zone
contracts are asserted explicitly instead, with the shared `underZone`
helper in `src/Tests/Helpers/AmbientZone.ts`, which moves `moment`'s default
**and** `process.env.TZ` — they are separate mechanisms, and a renderer
built on `new Date(y, m, d)` is invisible to the first.

## Why the zone is named rather than inherited

Before this was fixed ([#545](https://github.com/sergienko4/israeli-bank-scrapers/issues/545)),
the zone was whatever the Node process happened to sit in. That was worse than
merely machine-dependent, for a reason that is easy to miss:

`BaseScraper.initialize()` calls `moment.tz.setDefault(ISRAEL_TIMEZONE)`
([`src/Scrapers/Base/BaseScraper.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Base/BaseScraper.ts)),
and `moment-timezone` augments the _same singleton_ the Pipeline's mapper
imported as plain `moment`. So the emitted value depended not only on the host
but on **scrape order** — running a legacy scraper first silently changed what
the Pipeline emitted for identical input, in the same process.

There was therefore no true sentence to write on `ITransaction.date` describing
the old behaviour. Naming the zone removes both variables at once.

## What it governs

| Site                                                       | Decision it makes                                   |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `parseAutoDate` (`Coercion.ts`)                            | Which instant a date-only provider value becomes    |
| `applyStartWindow` (`StartWindow.ts`)                      | Whether a row falls inside the caller's `startDate` |
| `assessWindowCoverage` (`CoverageAudit/WindowCoverage.ts`) | Whether the provider served the whole window        |

These three have to agree. Fixing only the parse would have left the mapper
resolving in Jerusalem while the window compared in the host zone — a fresh
defect in place of the old one. The window sites also take a _full UTC instant_
(`ApiDirectScrapeBackfill` passes `startDate.toISOString()`), so reduced west of
UTC that instant named the previous day, inflating the measured gap by one and
turning a fully covered window into a spurious backfill request.

### The one site deliberately left ambient

`planBackfill` (`WindowBackfill.ts`) turns a day _label_ into the upper bound of
a re-ask, and the bank shapes turn that bound straight back into a label —
`YYYYMMDD` for Hapoalim, `YYYY-MM-DD` for the FIBI group and Pepper, month
components for Yahav. That round trip is lossless only while both halves read
the same zone.

Anchoring the producing half alone would make a host east of Israel re-ask for
`oldest + 1` — a slice the caller never lost — because an Israel end-of-day
instant is already the next calendar day in Tokyo. So the pair moves together or
not at all, and moving it means touching every bank shape; that is a larger
change than this defect warrants. The label's _meaning_ is fixed either way,
because the label itself now comes from `assessWindowCoverage`, which is
bank-anchored. `BankCalendar.test.ts` pins the round trip in four zones so the
symmetry cannot be broken silently later.

Leumi is the one shape that consumes the bound as an instant
(`toUTCString()`), and it therefore still inherits the ambient end-of-day. That
is pre-existing behaviour, unchanged here, and tracked separately.

## Impact of the change

The variable is not the host zone but the _effective moment default_ at the
moment a value is parsed — which `BaseScraper.initialize()` can move mid-process
(see above).

| Effective moment default | Effect                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `Asia/Jerusalem`         | **No change.** Emitted values are byte-identical.                              |
| Anything else            | Values move to agree with an Israel host. Day-level comparisons stop drifting. |

An Israel host is _usually_ the first row, but not necessarily: an application
that calls `moment.tz.setDefault('UTC')` for its own reasons, or that runs a
Legacy scraper first, was in the second row even on Israeli hardware. That is
the non-determinism this change removes.

## Alternatives that were rejected

- **Emit a bare `YYYY-MM-DD` for date-only providers.** Honest about the missing
  time, but it breaks the field's declared `ISO date string` type for every
  existing consumer, and gives no answer for providers that _do_ state a time.
- **Anchor to UTC midnight instead.** Stable, but silently wrong: it claims a
  day boundary the bank does not observe, and it moves values for the Israeli
  hosts that are the primary audience.
- **Document the existing behaviour and change nothing.** Not available. The
  behaviour was non-deterministic across hosts _and_ across scrape order, so
  there was no accurate sentence to write.

## The same trap in month chunks

A monthly scrape is split into chunks by
`src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.ts`, whose
boundaries are chosen in the bank calendar for exactly the reasons above. Each
chunk carries its start as `2026-03-01T00:00:00.000Z`.

That `Z` is part of the rendering, not a claim about UTC — the string **names a
bank day**. Handing it to `new Date()` is fine for ordering it against another
instant, or for passing it to a range filter. Asking the resulting instant which
_month_ it is, is not:

| Host               | `new Date('2026-03-01T00:00:00.000Z').getMonth() + 1` | Month the chunk names |
| ------------------ | ----------------------------------------------------- | --------------------- |
| `Asia/Jerusalem`   | 3                                                     | 3                     |
| `UTC`              | 3                                                     | 3                     |
| `America/New_York` | **2**                                                 | 3                     |

Two callers built a bank request parameter that way — the billing-month body in
`src/Scrapers/Pipeline/Strategy/Scrape/BillingFallbackStrategy.ts` and the
`filterData` URL in
`src/Scrapers/Pipeline/Strategy/Scrape/Account/FilterDataStrategy.ts` — so a
scrape for March asked the bank for February on any host west of UTC. The
provider answered successfully with the wrong month's rows, so nothing failed;
the window simply came back short, and the audit reported `unproven` on those
hosts only.

Anything that needs the month reads the label instead, through
`chunkStartMonth`. It returns an `IChunkMonth` (`year`, plus a 1-indexed
`month` matching what bank request parameters expect), or `false` when the
generated label is malformed:

```ts
const named = chunkStartMonth(chunk);
if (named === false) return [];
const { year, month } = named;
```

It delegates to `bankMonthOfLabel`, which validates the complete date/time
shape and its calendar day without consulting ambient state. A host zone cannot
shift the answer, and a corrupt suffix cannot be accepted merely because its
`YYYY-MM` prefix looks plausible.

> **Testing note.** A probe that swaps `process.env.TZ` at runtime cannot catch
> this class of defect: Jest workers read `TZ` once at startup, as
> `jest.config.js` states, so native `Date` does not move. Pick an input whose
> label month and instant month differ instead — see
> `src/Tests/Unit/Pipeline/Mediator/Scrape/MonthChunkLabel.test.ts`.

## Related

- [Transaction sign](transaction-sign.md) — the other cross-cutting
  normalisation applied to every mapped row.
- [Coverage audit](../observability/coverage-audit.md) — the window verdict this
  calendar is measured in.
