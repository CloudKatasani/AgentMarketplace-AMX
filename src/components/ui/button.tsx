import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded font-medium no-underline transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand-primary text-surface hover:bg-brand-deep",
        secondary: "bg-panel text-brand-ink hover:bg-band",
        outline: "border border-border bg-surface text-brand-ink hover:bg-panel",
        ghost: "text-brand-primary hover:bg-panel",
        danger: "bg-danger text-surface hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-body",
        md: "h-10 px-4 text-body",
        lg: "h-11 px-6 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
