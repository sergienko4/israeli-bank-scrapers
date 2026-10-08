---
title: Transaction currency
source-files:
  - src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnCurrency.ts
  - src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.ts
  - src/Scrapers/Pipeline/Registry/WK/ScrapeFieldMappings.ts
---

# Transaction currency — which code `originalCurrency` reports

> **Who this is for:** anyone mapping a bank or card-issuer payload into a
> `Transaction`, or debugging a row whose `originalCurrency` came back as a
> number or as `ILS` for a foreign purchase.

Consumers read `originalCurrency` as an ISO-4217 code (`ILS`, `USD`, `EUR`).
Providers name the field differently, and some send more than one candidate on
the same row. Picking the right one is owned by
[`src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnCurrency.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnCurrency.ts).

## Resolution order — the alias list decides

`findCurrencyHit` matches the WK `currency` alias list in
`ScrapeFieldMappings.ts`. The list is **first-match-wins**, so its order is the
contract:

1. `bancsCurrency`, `trnCurrencySymbol`, `currency`
2. `originalCurrencyIso` — ISO-4217 text
3. `originalCurrency` — on Amex/Isracard DigitalV3 this is a **numeric enum**
4. `currencyCode`, `movementCurrency`

DigitalV3 (`GetTransactionsList`) rows carry both `originalCurrencyIso` and a
sibling `originalCurrency`. Before
[#614](https://github.com/sergienko4/israeli-bank-scrapers/issues/614) the
numeric field was listed first, so foreign rows reported `"19"` or `"100"`
instead of `USD` or `EUR`. The ISO alias now wins whenever it is present.

Enum values observed in captured DigitalV3 responses:

| `originalCurrency` | `originalCurrencyIso` |
| ------------------ | --------------------- |
| `0`                | `ILS`                 |
| `19`               | `USD`                 |
| `100`              | `EUR`                 |

## A blank value is absent

The shared scalar matcher accepts an empty or whitespace-only string as a match,
and the string coercion that follows turns `''` into the `ILS` default. Left
alone, a blank `originalCurrencyIso` would win the match and silently relabel a
foreign purchase as shekels.

`findCurrencyHit` therefore drops blank and whitespace-only values from each
record **before** matching, so the next usable alias — or the next record in
the tree — gets its turn. `null` was already treated as absent by the matcher.

## Search order — root first

Records are searched in the same order as every other mapped field: the root
record first, then each nested non-array object record breadth-first, down to
`MAX_SEARCH_DEPTH` (10) levels. Arrays and deeper records are not searched — array
contents must already be flattened into transaction rows.
The first record that yields a usable hit decides; alias order applies
**within** that record.

## Normalisation

`normalizeCurrency` maps the shekel aliases from WK `shekelAliases`
(`שח`, `ש"ח`, `NIS`, `₪`) to `ILS` and passes every other value through. When
no record yields a usable hit, the mapper falls back to `ILS`.
`chargedCurrency` goes through the same `normalizeCurrency` step.

## Known limitation — numeric code without an ISO sibling

The enum table above is an observation, not a mapping the code applies. A row
that carries **only** the numeric `originalCurrency` still reports the number.
Every captured DigitalV3 row so far carries the ISO sibling, so no translation
table is maintained; adding one would mean owning an undocumented provider enum.

## Adding a provider

Add the field name to the WK `currency` list at the position that reflects its
trust: ISO text above any numeric or symbolic code that can appear on the same
row. Then extend the contract test.

The contract is `CrossBankCurrency.test.ts`. It maps captured-shape Amex and
Isracard fixtures through the real `autoMapTransaction` entry point, and pins
the alias precedence and the blank-alias fall-through on minimal records. The
[docs staleness gate](../workflow/docs-coverage.md) fails if `TxnCurrency.ts`,
`TxnMapper.ts` (the `ILS` fallback and `chargedCurrency` normalisation) or
`ScrapeFieldMappings.ts` (the alias order) is edited without this page being
updated.
