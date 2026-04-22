import * as React from "react";
import { cn } from "@/lib/utils";

type CardVariant = "primary" | "secondary" | "ghost" | "destructive";

type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  variant?: CardVariant;
};

export const Card = React.forwardRef<HTMLElement, CardProps>(function Card(
  { as = "div", children, className, variant = "secondary", ...rest },
  ref
) {
  return React.createElement(
    as,
    {
      className: cn(
        "w-full rounded-lg p-4",
        {
          "btn-primary": variant === "primary",
          "btn-secondary": variant === "secondary"
        },
        className
      ),
      ref,
      ...rest
    },
    children
  );
});
