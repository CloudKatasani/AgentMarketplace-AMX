import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Class merging that knows about this product's custom scales.
 *
 * tailwind-merge resolves conflicts by class *group*, and it only knows the
 * groups Tailwind ships with. The design system adds three font sizes —
 * `text-page-title`, `text-section-title`, `text-body` — and out of the box
 * tailwind-merge reads those as text *colours*, because that is the other
 * thing `text-…` can mean. It then treats `text-surface text-body` as a
 * conflict and silently drops the colour.
 *
 * That is not theoretical: it is why the primary button rendered white-on-blue
 * everywhere except where it mattered, with ink-coloured text on the brand
 * band, until an axe scan caught the contrast failure in Phase 7. Teaching the
 * merger the three custom sizes fixes the whole class of bug rather than that
 * one button.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["page-title", "section-title", "body"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
