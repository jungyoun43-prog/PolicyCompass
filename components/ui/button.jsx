import * as React from "react";
import { Slot } from "radix-ui";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * shadcn-style Button that speaks the PolicyCompass class vocabulary: the
 * variants map onto the existing clinical-button styles, so adopting the
 * component changes no pixels while call sites gain the shadcn API.
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
  },
  defaultVariants: {
    variant: "default",
  },
});

function Button({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} type={props.type ?? "button"} {...props} />;
}

export { Button, buttonVariants };
