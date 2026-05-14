import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "./utils";

/** Closed-state select: matches popover tokens so native menus align better in dark mode */
export const nativeSelectTriggerClass =
  "h-11 w-full min-w-[180px] cursor-pointer appearance-none rounded-lg border border-input bg-popover px-3 py-2 pr-10 text-sm text-popover-foreground shadow-sm outline-none motion-safe:transition-[box-shadow,background-color,border-color] motion-safe:duration-200 hover:border-ring/40 hover:bg-accent/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

export interface NativeSelectFieldProps extends ComponentProps<"select"> {
  label: ReactNode;
  /** Extra hint under label (optional) */
  description?: ReactNode;
}

export function NativeSelectField({
  id,
  label,
  description,
  className,
  disabled,
  children,
  ...selectProps
}: NativeSelectFieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="space-y-1">
        <label
          htmlFor={id}
          className="block text-sm font-medium leading-snug text-foreground"
        >
          {label}
        </label>
        {description ? (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      <div className="relative">
        <select
          id={id}
          disabled={disabled}
          className={nativeSelectTriggerClass}
          {...selectProps}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400"
          aria-hidden
        />
      </div>
    </div>
  );
}
