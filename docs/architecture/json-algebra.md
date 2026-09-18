# JSON algebra — one declaration site, two distinct concepts

> **Who this is for:** anyone typing a value that arrives from `JSON.parse`, a
> captured response body, or a bank's API — i.e. every extraction and
> redaction module in the Pipeline.

[`src/Scrapers/Pipeline/Types/JsonValue.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/JsonValue.ts)
is the **single declaration site** for every JSON type in the Pipeline. No
other module may declare one; an architecture test enforces that.

## The two concepts

A JSON value plays two genuinely different roles, and conflating them is what
caused the original divergence.

| Concept | Meaning | Use it when |
|---|---|---|
| **closed** | Recursively a JSON document. Every nested value is itself a `JsonValue`. | You have *validated* the shape, or you must narrow it exhaustively. |
| **open** | The outer container is known; the contents are not yet checked. | The value came from `JSON.parse`, a captured response body, or a type-guard parameter. |

## The symbols

| Symbol | Definition | Arm |
|---|---|---|
| `JsonScalar` | `string \| number \| boolean \| null` | closed |
| `IJsonObject` | `{ readonly [key: string]: JsonValue }` | closed |
| `JsonArray` | `readonly JsonValue[]` | closed |
| `JsonValue` | `JsonScalar \| IJsonObject \| JsonArray` | closed |
| `JsonObject` | alias of `IJsonObject`, for call-sites that read better without the `I` | closed |
| `JsonUnknown` | one un-narrowed value at a boundary | open |
| `JsonUnknownRecord` | `Record<string, JsonUnknown>` | open |
| `JsonUnknownList` | `readonly JsonUnknown[]` | open |

## Why not a single wide type

The obvious consolidation — point everything at one permissive `JsonValue` —
does not compile, and the reason is instructive.

[`Types/PiiRedactor/JsonBody.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/PiiRedactor/JsonBody.ts)
walks a body and narrows **exhaustively**: object → array → therefore scalar.
That final "therefore" is only sound over a *closed* union. Widen `JsonValue`
to admit `unknown` and the walker loses its exhaustiveness, so redaction can no
longer prove it visited every node — the one guarantee it exists to provide.

But the extraction boundaries genuinely do receive unchecked input. Fusing both
meanings under one name means every signature that says "this is JSON" silently
also accepts "this is anything". That is precisely why four modules quietly
re-declared the algebra locally in the first place.

So the two concepts stay distinct, are each declared once, and both derive from
the same algebra.

## Choosing an arm

Take `JsonUnknown` at the boundary, validate, and only then hold a closed type:

```ts
function isRecord(v: JsonUnknown): v is JsonUnknownRecord { … }   // ✅ open → open
function isJsonObject(v: JsonValue): v is IJsonObject { … }       // ✅ closed → closed
function isRecord(v: JsonUnknown): v is IJsonObject { … }         // ❌ unsound
```

The third promises that **every nested value** is a `JsonValue`, but a container
check cannot establish that: `{ data: [undefined] }` satisfies it and smuggles
`undefined` into code typed to receive closed JSON. A guard may only return a
closed arm when its input was already closed, or after recursive validation.

## Enforcement

[`src/Tests/Unit/Pipeline/Architecture/JsonValueSingleSource.test.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Unit/Pipeline/Architecture/JsonValueSingleSource.test.ts)
parses every Pipeline source with the TypeScript compiler API and fails when:

1. any module other than the canonical one declares an algebra member, or
2. a type predicate accepts an open arm and asserts a closed one.

Detection is AST-based rather than line-based deliberately. A regex is bypassed
by ordinary TypeScript a reviewer would never flag — `type JsonValue<T> = …`,
`declare type …`, `export default interface …`, or a declaration nested in a
namespace — and it *fires* on the same text inside a block comment. Walking the
parse tree removes both failure modes.

## Why `JsonUnknown` is spelled `unknown`

The open arm is declared `type JsonUnknown = unknown`. "One un-narrowed value
at a boundary" describes an **opaque** boundary — a value carrying no trusted
structural guarantee this code may rely on — and `unknown` is the spelling that
states it. The converse does not hold: a value with trusted provenance can
deserve a narrower arm even before anything narrows it. The open arm is for the
values that have no such guarantee. It previously read
`JsonValue | NonNullable<unknown> | null | undefined` — a union written purely
so Sonar **S6564** (redundant type alias) would not fire on a one-word alias.
That spelling was never a narrower type: it is mutually assignable with
`unknown` in both directions, so no value-level call site in this repository
can tell the two apart. (Exact-identity tricks — a distributive conditional
type, for instance — still can; the claim is compatibility at every use site
here, not type identity.)
`NonNullable<unknown>` resolves to `{}`, which `@typescript-eslint`'s
`no-generated-empty-object-type` rejects as of 8.70.0.

Each obvious direct alternative is blocked as well — every row below was run,
not assumed:

| Spelling | Rejected by |
|---|---|
| `JsonValue \| NonNullable<unknown> \| null \| undefined` | `no-generated-empty-object-type` — resolves to `{}` |
| `JsonValue \| unknown \| null \| undefined` | `no-redundant-type-constituents` |
| `JsonValue \| object \| null \| undefined` | `tsc` — 20 diagnostics at boundary call sites that legitimately pass `unknown` |

Each row is reproducible the same way: swap the alias body in
`src/Scrapers/Pipeline/Types/JsonValue.ts` and re-run the offending gate. For
the `tsc` row that is
`./node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'`.

Indirect evasions do exist — `ReturnType<() => unknown>` passes every rule
above. They are worse than an explicit, documented exemption, not better.

So the alias is **exempted from S6564** in `eslint.config.mjs`,
`sonar-project.properties` and the architecture allowlist. All three exemptions
are **file**-scoped — the narrowest scope any of those three mechanisms
supports — so each also silences S6564 for the closed arms declared alongside
it. The declaration-level guard is restored by a test:
`JsonValueSingleSource.test.ts` runs S6564 itself with the exemption
overridden and asserts the rule reports **exactly one** alias in that file,
`JsonUnknown`. Modelling the rule by hand drifts from it — S6564 flags a type
reference only when it resolves to *another alias*, so `JsonObject` is not a
violation, because `IJsonObject` is an interface. Running the real rule cannot
drift. The test also asserts — through ESLint's own resolved config — that
S6564 is `off` for that file and still `error` for its neighbours. S6564 is right that the alias adds no *type* information; it is wrong that the
alias is therefore redundant. Here the **name is the contract**: it marks "not
narrowed yet", and it is the vocabulary the single-source architecture test
uses to tell the open arm from the closed ones. It does **not** currently keep
bare `unknown` out of Pipeline signatures — both `unknown` signature selectors
are drain-queued in `PIPELINE_SYNTAX_PENDING_DRAIN` and filtered out of the
active rule set.

## Known gap — the open arm is still wider than it should be

`JsonUnknown` is the top type today because the consolidation described in
*History* covered the **declaration sites** but not the **call sites**. The
codebase still carries **31 duplicate open-record aliases** — 24 spelled
`Record<string, unknown>` and 7 spelled `Readonly<Record<string, unknown>>` —
of which 25 sit inside the Pipeline (`ApiRecord`, `ApiBody`, `ApiPayload`,
`VarsMap`, plus a per-bank `…Txn` for most banks).

Read that number for what it is: a **related open-record debt population**,
not a proven causal inventory. Most of these are boundaries laundering
`unknown` through a JSON-shaped name, but the count is repo-wide and sweeps in
test and logging helpers (`RecordedOptions`, `LogEvent`, `LogLine`) that do not
feed `JsonUnknown` at all. The evidence that narrowing the arm is a real
refactor is the 29 type errors below, not this count.

That 31 is a **ratchet**, not a footnote. `JsonValueSingleSource.test.ts`
counts them through the TypeScript AST — a lexical grep misses the `Readonly`
wrapper, multi-line declarations and anything nested in a namespace — and
asserts **exact equality**, not a ceiling. A ceiling would let the count fall
to 30 and drift back to 31 unnoticed; exact equality means paying the debt
down has to edit the baseline in the same commit.

Closing the gap is a genuine refactor, not a mechanical rename. The cost is
one line away from measurable — narrow the arm to the closed one and type-check:

```bash
# Never edit the live checkout for this — measure in a throwaway worktree.
# `set -e` matters: without it a failed `cd` lets `perl -pi` rewrite the
# checkout you are standing in, which is the accident this avoids.
probe=$(mktemp -d)/jsonunknown-probe
repo=$(git rev-parse --show-toplevel)
git worktree add "$probe" HEAD
(
  set -e
  cd "$probe"
  ln -s "$repo/node_modules" node_modules
  perl -pi -e 's/^type JsonUnknown = unknown;/type JsonUnknown = JsonValue;/' \
    src/Scrapers/Pipeline/Types/JsonValue.ts
  ./node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'
)
git worktree remove --force "$probe"   # runs even if the subshell failed
```

At the time of writing that reports **29 errors across 17 files** — boundaries
that today accept whatever arrived and have no guard to narrow it. Re-run it
rather than trusting the number; it is a snapshot, and the point is that it is
not zero.

The blocker is real, not incidental: `Record<string, JsonUnknown>` is not
assignable to `IJsonObject` under index-signature variance, so each boundary
needs a validating guard rather than a wider annotation. Until that work is
scheduled, prefer `JsonUnknown` over bare `unknown` in new code, and narrow with
a guard at the boundary rather than widening the arm.

## History

The algebra was consolidated in v8.6.10. Seven modules had been carrying their
own copy: four declared the full algebra, and three more declared a `JsonObject`
that shared the canonical **name** but meant `Record<string, unknown>` — a
weaker type wearing a stronger name. Structural typing reconciled all seven at
every boundary, so `tsc`, ESLint and the knowledge graph stayed silent.
