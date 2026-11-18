import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

type AlertVariant = "default" | "destructive" | "success";

const variantClasses: Record<AlertVariant, string> = {
  default: "bg-card text-card-foreground",
  destructive:
    "border-destructive/40 bg-destructive/10 text-destructive [&>svg]:text-destructive",
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 [&>svg]:text-emerald-400",
};

const variantIcons = {
  default: Info,
  destructive: CircleAlert,
  success: CircleCheck,
};

function Alert({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: AlertVariant }) {
  const Icon = variantIcons[variant];

  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      <Icon className="mt-0.5 size-4" />
      <div className="col-start-2">{children}</div>
    </div>
  );
}

export { Alert };
