---
title: Bank calendar
source-files:
  - src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts
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
It is Pipeline-internal — callers consume the *result* on `ITransaction`, not
these helpers — but the Scrape cluster reaches for it constantly, so the shape
is worth knowing when reading that code.

| Export | What it is for |
| --- | --- |
| `BANK_CALENDAR_TIMEZONE` | The zone itself, aliased from the browser context's `ISRAEL_TIMEZONE` so a page cannot render in one calendar while its rows parse in another |
| `BANK_DAY_FORMAT` | The `YYYY-MM-DD` day label every day-level comparison reduces to; it sorts lexicographically, which is why the window comparisons need no date maths |
| `BankDay` | Nominal type for that label, so a day cannot be passed where the ISO *instant* it came from is expected |
| `parseInBankZone` | Turns a raw provider value into a moment fixed to the bank zone — the entry point `parseAutoDate` uses |
| `bankMomentOfInstant` | Reads an already-resolved instant in the bank zone |
| `bankDayOfInstant` | Reduces an instant to its `BankDay`, or to `false` when the value cannot be read — `moment`'s own `'Invalid date'` string is day-shaped enough to survive a `string` return and then sorts after every real label |

## Why the zone is named rather than inherited

Before this was fixed ([#545](https://github.com/sergienko4/israeli-bank-scrapers/issues/545)),
the zone was whatever the Node process happened to sit in. That was worse than
merely machine-dependent, for a reason that is easy to miss:

`BaseScraper.initialize()` calls `moment.tz.setDefault(ISRAEL_TIMEZONE)`
([`src/Scrapers/Base/BaseScraper.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Base/BaseScraper.ts)),
and `moment-timezone` augments the *same singleton* the Pipeline's mapper
imported as plain `moment`. So the emitted value depended not only on the host
but on **scrape order** — running a legacy scraper first silently changed what
the Pipeline emitted for identical input, in the same process.

There was therefore no true sentence to write on `ITransaction.date` describing
the old behaviour. Naming the zone removes both variables at once.

## What it governs

| Site | Decision it makes |
| --- | --- |
| `parseAutoDate` (`Coercion.ts`) | Which instant a date-only provider value becomes |
| `applyStartWindow` (`StartWindow.ts`) | Whether a row falls inside the caller's `startDate` |
| `assessWindowCoverage` (`CoverageAudit/WindowCoverage.ts`) | Whether the provider served the whole window |

These three have to agree. Fixing only the parse would have left the mapper
resolving in Jerusalem while the window compared in the host zone — a fresh
defect in place of the old one. The window sites also take a *full UTC instant*
(`ApiDirectScrapeBackfill` passes `startDate.toISOString()`), so reduced west of
UTC that instant named the previous day, inflating the measured gap by one and
turning a fully covered window into a spurious backfill request.

### The one site deliberately left ambient

`planBackfill` (`WindowBackfill.ts`) turns a day *label* into the upper bound of
a re-ask, and the bank shapes turn that bound straight back into a label —
`YYYYMMDD` for Hapoalim, `YYYY-MM-DD` for the FIBI group and Pepper, month
components for Yahav. That round trip is lossless only while both halves read
the same zone.

Anchoring the producing half alone would make a host east of Israel re-ask for
`oldest + 1` — a slice the caller never lost — because an Israel end-of-day
instant is already the next calendar day in Tokyo. So the pair moves together or
not at all, and moving it means touching every bank shape; that is a larger
change than this defect warrants. The label's *meaning* is fixed either way,
because the label itself now comes from `assessWindowCoverage`, which is
bank-anchored. `BankCalendar.test.ts` pins the round trip in four zones so the
symmetry cannot be broken silently later.

Leumi is the one shape that consumes the bound as an instant
(`toUTCString()`), and it therefore still inherits the ambient end-of-day. That
is pre-existing behaviour, unchanged here, and tracked separately.

## Impact of the change

The variable is not the host zone but the *effective moment default* at the
moment a value is parsed — which `BaseScraper.initialize()` can move mid-process
(see above).

| Effective moment default | Effect |
| --- | --- |
| `Asia/Jerusalem` | **No change.** Emitted values are byte-identical. |
| Anything else | Values move to agree with an Israel host. Day-level comparisons stop drifting. |

An Israel host is *usually* the first row, but not necessarily: an application
that calls `moment.tz.setDefault('UTC')` for its own reasons, or that runs a
Legacy scraper first, was in the second row even on Israeli hardware. That is
the non-determinism this change removes.

## Alternatives that were rejected

- **Emit a bare `YYYY-MM-DD` for date-only providers.** Honest about the missing
  time, but it breaks the field's declared `ISO date string` type for every
  existing consumer, and gives no answer for providers that *do* state a time.
- **Anchor to UTC midnight instead.** Stable, but silently wrong: it claims a
  day boundary the bank does not observe, and it moves values for the Israeli
  hosts that are the primary audience.
- **Document the existing behaviour and change nothing.** Not available. The
  behaviour was non-deterministic across hosts *and* across scrape order, so
  there was no accurate sentence to write.

## Related

- [Transaction sign](transaction-sign.md) — the other cross-cutting
  normalisation applied to every mapped row.
- [Coverage audit](../observability/coverage-audit.md) — the window verdict this
  calendar is measured in.
