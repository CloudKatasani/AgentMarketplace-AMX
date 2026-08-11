# 14. A tenant's theme override is validated data, never a stylesheet

Date: 2026-08-11 · Status: Accepted

## Context

`CLAUDE.md` promises white-label: an Enterprise buyer rebrands by overriding the
same design tokens the product ships. `Organization.themeOverride` had existed
since Phase 1 and nothing read it, so [ADR 7](0007-design-tokens-as-rgb-channels.md)
was describing a mechanism that did not exist.

Implementing it means a tenant's input ends up inside a `<style>` tag on every
page of that tenant. Anything accepted as text is an injection surface — a `}`
closes the rule and everything after it is arbitrary CSS.

## Decision

The override is data, and the emitted CSS is rebuilt from that data:

- only nine token names are accepted — the brand and surface tokens. Semantic
  states (`success`, `warning`, `danger`, the `AI_DRAFT` marker) are **not**
  overridable, because they carry meaning and WCAG contrast guarantees a
  rebrand must not be able to repaint;
- every value parses to three integers 0–255 — the same RGB-channel form
  `tokens.css` uses, so Tailwind's alpha modifiers keep working under a rebrand;
- hex is accepted at the boundary, because that is what a brand guideline hands
  a person, and converted immediately;
- the stored form is JSON, validated with a `.strict()` Zod schema on read as
  well as write, so a corrupt or hand-edited row is treated as *no override*
  rather than a partial one;
- `toCssVariables()` emits a string built entirely from parsed integers. No
  character a tenant typed reaches the page.

The plan flag is checked where the flag belongs — losing Enterprise drops the
override rather than stranding a rebrand whose controls are no longer visible.
Saving one is audited like any other workspace setting.

## Consequences

- Rebranding is demonstrable in a browser, and an end-to-end test asserts both
  halves: the header band changes colour, and `red; } body { display: none }` is
  refused in words.
- A buyer cannot rebrand everything. That is the trade: the palette is theirs,
  the meaning of a warning is not.
- The example colours shown in the settings form live in the theme module rather
  than the component, because the lint rule that keeps hex out of `src/app` and
  `src/components` is worth more than the convenience of typing them inline.

## Alternatives rejected

- **Store CSS and sanitise it.** Sanitising CSS is a permanent arms race for a
  feature that is nine colours.
- **A stylesheet per tenant on disk.** Deployment complexity, and it moves
  per-tenant data out of the database that already isolates it.
