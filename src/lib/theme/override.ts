/**
 * White-label, without letting a tenant write CSS.
 *
 * `Organization.themeOverride` is the ENTERPRISE rebrand hook named in
 * `CLAUDE.md`: a buyer overrides the same token names that live in
 * `tokens.css`. The risk is obvious — anything a tenant types ends up inside a
 * `<style>` tag on every page of that tenant — so the override is *data*, never
 * a stylesheet:
 *
 * - only the token names below are accepted; anything else is dropped;
 * - every value must be three integers 0–255, which is the same RGB-channel
 *   form `tokens.css` uses so Tailwind's alpha modifiers keep working;
 * - the emitted string is rebuilt from parsed numbers, so no character a tenant
 *   typed ever reaches the page. A `}` or `expression(` cannot survive parsing.
 *
 * Colour values live here rather than in a component, which is why the lint
 * rule that bans hex in `src/app` and `src/components` does not reach this
 * file — and why the parsed form is numeric channels rather than hex at all.
 */
import { z } from "zod";

/**
 * The overridable surface. Deliberately the brand and surface tokens only:
 * semantic states (success, warning, danger) carry meaning and contrast
 * guarantees that a rebrand must not be able to break.
 */
export const OVERRIDABLE_TOKENS = [
  "brand-primary",
  "brand-accent",
  "brand-ink",
  "brand-deep",
  "surface",
  "panel",
  "band",
  "border",
  "muted",
] as const;

export type OverridableToken = (typeof OVERRIDABLE_TOKENS)[number];

/**
 * The example shown in the settings form.
 *
 * It lives here rather than in the component because it contains colour
 * literals, and the lint rule that keeps hex out of `src/app` and
 * `src/components` is worth more than the convenience of typing it inline.
 */
export const THEME_FORM_PLACEHOLDER = ["brand-primary: #0070AD", "brand-accent: #12ABDB"].join(
  "\n",
);

const channel = z.number().int().min(0).max(255);
const rgb = z.tuple([channel, channel, channel]).optional();

/** `.strict()` is the point: an unknown token name is an error, not a no-op. */
export const themeOverrideSchema = z
  .object({
    "brand-primary": rgb,
    "brand-accent": rgb,
    "brand-ink": rgb,
    "brand-deep": rgb,
    surface: rgb,
    panel: rgb,
    band: rgb,
    border: rgb,
    muted: rgb,
  })
  .strict();

export type ThemeOverride = z.infer<typeof themeOverrideSchema>;

export type ParseResult =
  | { ok: true; theme: ThemeOverride }
  | { ok: false; detail: string };

/**
 * Parses what a tenant typed: one `token: #RRGGBB` or `token: r g b` per line.
 *
 * Hex is accepted at the boundary because that is what a brand guideline hands
 * a person; it is converted to channels immediately and never stored as text.
 */
export function parseThemeForm(input: string): ParseResult {
  const theme: Record<string, [number, number, number]> = {};

  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;

    const [namePart, ...rest] = line.split(":");
    const name = namePart.trim().replace(/^--/, "");
    const value = rest.join(":").trim();

    if (!value) return { ok: false, detail: `"${line}" has no value. Use "brand-primary: #0070AD".` };
    if (!(OVERRIDABLE_TOKENS as readonly string[]).includes(name)) {
      return {
        ok: false,
        detail: `"${name}" is not an overridable token. Overridable: ${OVERRIDABLE_TOKENS.join(", ")}.`,
      };
    }

    const channels = toChannels(value);
    if (!channels) {
      return {
        ok: false,
        detail: `"${value}" is not a colour. Use a six-digit hex like #0070AD, or three channels like "0 112 173".`,
      };
    }
    theme[name] = channels;
  }

  const parsed = themeOverrideSchema.safeParse(theme);
  if (!parsed.success) {
    return { ok: false, detail: parsed.error.issues[0]?.message ?? "That theme is not valid." };
  }
  return { ok: true, theme: parsed.data };
}

/** Reads what was stored. Anything unparseable is treated as no override. */
export function readThemeOverride(stored: string | null): ThemeOverride | null {
  if (!stored) return null;
  try {
    const parsed = themeOverrideSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) return null;
    return Object.keys(parsed.data).length > 0 ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The CSS text injected into the shell — rebuilt entirely from parsed integers.
 * Nothing a tenant typed appears in the output.
 */
export function toCssVariables(theme: ThemeOverride): string {
  const declarations = OVERRIDABLE_TOKENS.filter((token) => theme[token]).map((token) => {
    const [r, g, b] = theme[token]!;
    return `--${token}: ${r} ${g} ${b};`;
  });
  return declarations.length > 0 ? `:root{${declarations.join("")}}` : "";
}

/** The editable form of a stored override, for the settings screen. */
export function toThemeForm(theme: ThemeOverride | null): string {
  if (!theme) return "";
  return OVERRIDABLE_TOKENS.filter((token) => theme[token])
    .map((token) => {
      const [r, g, b] = theme[token]!;
      return `${token}: ${r} ${g} ${b}`;
    })
    .join("\n");
}

function toChannels(value: string): [number, number, number] | null {
  const hex = value.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const parts = value.split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const channels = parts.map((part) => Number(part));
  if (channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) return null;
  return [channels[0], channels[1], channels[2]];
}
