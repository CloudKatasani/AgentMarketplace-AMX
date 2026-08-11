# 10. Industry packs are declarative YAML, validated on load

Date: 2026-08-04 · Status: Accepted

## Context

AMX has to arrive knowing something about the customer's industry — personas, question
archetypes, data-product templates, vocabulary — while the core stays industry-agnostic. The
failure mode to avoid is a pack that quietly changes *logic*.

## Decision

A pack is a `pack.yaml` file describing vocabulary and seed content only: domains, personas,
question archetypes, starter data products and metrics, academy content. It is parsed with Zod
on load; an invalid pack is reported and skipped rather than half-loaded. `pnpm pack:validate`
runs the same schema over every pack in CI.

Packs cannot contribute code, exit criteria or gate rules. Onboarding picks a pack and the
seeded workspace is the pack's content run through the ordinary creation paths.

## Consequences

- Adding an industry is adding a file. Nine ship in the box.
- The generic pack (`_generic`) is the fallback and the reference — which is why the pack-key
  rule permits a leading underscore while the rest of the key space stays strict.
- Anything genuinely industry-specific in *behaviour* has nowhere to live, deliberately. If a
  regulated industry needs a different gate, that is a core feature with a flag, not a pack.

## Alternatives rejected

- **Packs as TypeScript modules.** Executable content is a supply-chain and a divergence risk.
- **Packs in the database.** Makes them per-deployment state instead of reviewable source.
