import type { Config } from "tailwindcss";

/**
 * Tokens → Tailwind.
 *
 * Every colour resolves to a CSS variable defined in src/styles/tokens.css, so
 * a component can never hard-code a brand decision and a tenant theme override
 * takes effect without rebuilding. `<alpha-value>` keeps opacity modifiers
 * working, which is why the tokens are RGB channels rather than hex.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: token("brand-primary"),
          accent: token("brand-accent"),
          ink: token("brand-ink"),
          deep: token("brand-deep"),
        },
        surface: token("surface"),
        panel: token("panel"),
        band: token("band"),
        success: token("success"),
        warning: {
          DEFAULT: token("warning"),
          tint: token("warning-tint"),
        },
        danger: token("danger"),
        "ai-draft": token("ai-draft"),
        border: token("border"),
        muted: token("muted"),
      },
      fontFamily: {
        sans: "var(--font-sans)",
      },
      fontSize: {
        "page-title": [
          "var(--text-page-title)",
          { lineHeight: "var(--leading-page-title)", fontWeight: "600" },
        ],
        "section-title": [
          "var(--text-section-title)",
          { lineHeight: "var(--leading-section-title)", fontWeight: "600" },
        ],
        body: ["var(--text-body)", { lineHeight: "var(--leading-body)" }],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        lg: "calc(var(--radius) * 1.5)",
      },
      spacing: {
        row: "var(--row-py)",
      },
      ringColor: {
        DEFAULT: token("brand-accent"),
      },
    },
  },
  plugins: [],
} satisfies Config;
