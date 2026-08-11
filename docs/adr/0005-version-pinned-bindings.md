# 5. Bindings pin the contract major, so cascade is a comparison

Date: 2026-08-04 · Status: Accepted

## Context

The product's central promise is that a breaking change to a data product invalidates the
certifications standing on it. Making that trustworthy on stage means it cannot be a heuristic
or a background job that might not have run.

## Decision

`BindingVersion` stores `boundContractVersion` and `boundContractMajor` — the exact contract the
binding was *approved against*. Staleness is then the comparison
`boundContractMajor < dataProduct.contractMajor`, evaluated on read as well as written on
publish, so the screen can never disagree with the database.

Publishing a major version sets the dependent bindings and certifications to `STALE` with a
plain-language `staleReason` naming the versions involved, and opens a re-certification task.
Changing a binding's type is a new version, not an edit, because the type is part of what was
approved — which is why `Binding` is unique on `(agent, product, type)` with the type
denormalised from the current version and a test asserting the two agree.

## Consequences

- The STALE flip is instant and explicable: the banner can say "moved from contract 2.1.0 to
  3.0.0" because both numbers are stored.
- A minor or patch bump deliberately does *not* invalidate anything. That is a semver bet: it
  assumes producers version honestly, which is exactly what a data contract is for.
- Two cascade directions exist and are tested separately: an artifact re-version makes its gates
  stale, and a product major bump makes dependent certifications stale.

## Alternatives rejected

- **Comparing semantic model hashes.** More precise, and unexplainable in a sales call.
- **A nightly staleness job.** Introduces a window in which the screen is lying.
