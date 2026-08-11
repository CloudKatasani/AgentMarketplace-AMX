# 6. The no-physical-table rule is a validator, and where its limits are

Date: 2026-08-05 · Status: Accepted

## Context

`CLAUDE.md` is absolute: no free-form text-to-SQL against raw or Bronze/Silver physical tables,
ever. The rule has to be enforced where bindings and grounding specs are authored, on text that
is mostly written by humans in English.

The first implementation flagged any `from <word>` — and rejected "accounts moved into arrears
in the last quarter", which is not SQL and not a table.

## Decision

The validator rejects a binding or grounding spec when it finds a table reference, and defines
a table reference as a `FROM`/`JOIN` capture that is *either* accompanied by another SQL signal
in the same text (`SELECT`, `WHERE`, `GROUP BY`, an explicit join form, …) *or* shaped like an
identifier rather than a word (`schema.table`, `raw_customer_events`).

It also rejects a bound product whose `layer` is `RAW`, `BRONZE`, `SILVER` or `STAGING`, and a
binding that names no certified metric — and in that case the message names the metrics that
*are* available on the product, because a rejection that does not say what to do instead is
just an obstacle.

## Consequences

- The layer check is exact and structural; the text check is a heuristic and is documented as
  one. Sufficiently determined SQL smuggled into prose could pass it.
- The heuristic is deliberately biased toward false negatives in the text check, because the
  binding still cannot be approved without naming a certified metric — the structural rule is
  what actually holds the line, and the text scan is a fast warning.
- Five regression tests pin ordinary English sentences that must not be rejected.

## Alternatives rejected

- **A SQL parser.** Correct for SQL, useless for the prose these fields mostly contain, and it
  would reject nothing the layer rule does not already reject.
- **Blocking any occurrence of `from`.** Tested in a browser, rejected within a minute.
