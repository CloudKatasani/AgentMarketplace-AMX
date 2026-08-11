# Architecture decision records

One file per decision that would be expensive to reverse, or that a reader would otherwise
have to reconstruct from the code. Each records the context at the time, what was decided,
what it costs, and what was rejected.

They are dated and immutable. A decision that changes gets a new record that supersedes the
old one; the old one stays, because the reasoning that was true then is what makes the change
legible now.

| # | Decision | Status |
|---|---|---|
| [0001](0001-tenancy-via-client-extension.md) | Tenant isolation through a Prisma client extension, deny by default | Accepted |
| [0002](0002-no-native-enums.md) | No database enums; Zod owns every domain | Accepted |
| [0003](0003-single-approval-path.md) | `recordDecision()` is the only writer of `Approval` | Accepted |
| [0004](0004-content-hashed-versions-and-hash-chained-audit.md) | Content-hashed artifact versions, hash-chained audit | Accepted |
| [0005](0005-version-pinned-bindings.md) | Bindings pin the contract major, so cascade is a comparison | Accepted |
| [0006](0006-no-physical-table-validator.md) | The no-physical-table rule is a validator, and where its limits are | Accepted |
| [0007](0007-design-tokens-as-rgb-channels.md) | Design tokens as RGB channels, enforced by a lint rule | Accepted |
| [0008](0008-read-only-showcase-with-sandbox-twin.md) | The showcase tenant is read-only; a sandbox twin carries the writes | Accepted |
| [0009](0009-solo-mode-self-attestation.md) | Solo mode is a recorded self-attestation, never a silent approval | Accepted |
| [0010](0010-industry-packs-as-declarative-yaml.md) | Industry packs are declarative YAML, validated on load | Accepted |
| [0011](0011-adapters-for-analytics-and-billing.md) | Analytics and billing sit behind adapters | Accepted |
| [0012](0012-sqlite-in-development-postgres-in-production.md) | SQLite in development, Postgres in production | Accepted |
| [0013](0013-invitations-and-the-second-human.md) | An invitation is a single-use token, and the only way into a workspace | Accepted |
| [0014](0014-theme-override-is-data.md) | A tenant's theme override is validated data, never a stylesheet | Accepted |
| [0015](0015-a-read-only-api-with-hashed-tokens.md) | The API is read-only, and its tokens are stored as hashes | Accepted |
| [0016](0016-sso-authenticates-it-never-authorises.md) | SSO authenticates; it never authorises | Accepted |
