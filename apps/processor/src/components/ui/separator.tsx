import type * as React from "react";
import { cn } from "~/lib/utils";

function Separator({
  className,
  ...props
}: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      data-slot="separator"
      className={cn(
        "shrink-0 bg-border",
        props.orientation === "vertical" ? "h-full w-px" : "h-px w-full",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
