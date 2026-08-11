# 7. Design tokens as RGB channels, enforced by a lint rule

Date: 2026-08-04 · Status: Accepted

## Context

`CLAUDE.md` requires that a buyer can rebrand AMX by editing one file, and that no component
ever hard-codes a hex. Tailwind's alpha modifiers (`bg-panel/60`) only work if the CSS variable
holds channels rather than a hex string.

## Decision

`src/styles/tokens.css` is the only file in the product containing a colour value, written as
space-separated RGB channels with the source hex in a comment on every line.
`tailwind.config.ts` wires each token as `rgb(var(--token) / <alpha-value>)`.

An ESLint rule bans hex literals, hex-bearing template strings and raw `rgb()`/`hsl()` calls
under `src/app`, `src/components` and the Tailwind config. White-labelling overrides the same
token names via `Organization.themeOverride`; there is no third mechanism.

## Consequences

- Rebranding is a diff to one file, and the lint rule makes that stay true.
- Charts and the hand-laid binding-graph SVG use token classes rather than fill attributes,
  which is more constrained than a charting library would be — and is why the graph renders
  correctly under a tenant override.
- Anything genuinely outside the palette (an embedded PDF, a favicon) lives outside those
  directories and is reviewed by eye.

## Alternatives rejected

- **Hex in the Tailwind theme.** Loses alpha modifiers, and moves the source of truth into a
  config file that a designer will not open.
- **CSS-in-JS theming.** Another runtime, for a decision that is six variables.
