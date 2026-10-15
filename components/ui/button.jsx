import { Slot } from "radix-ui";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * shadcn-style Button that speaks the PolicyCompass class vocabulary: the
 * variants and sizes use the shared clinical control vocabulary.
 */
const buttonVariants = cva("", {
  variants: {
    variant: {
      default: "clinical-button",
      primary: "clinical-button clinical-button--primary",
      confirm: "clinical-button clinical-button--primary clinical-button--confirm",
      danger: "clinical-button clinical-button--danger",
      demo: "clinical-button clinical-button--demo",
      text: "text-action",
    },
    size: {
      default: "",
      sm: "clinical-button--sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} type={props.type ?? "button"} {...props} />;
}

export { Button, buttonVariants };
