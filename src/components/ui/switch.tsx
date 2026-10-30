import * as React from "react";
import { cn } from "@/lib/utils";

type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  name?: string;
};

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, defaultChecked, onCheckedChange, disabled, id, name, ...props }, ref) => {
    const [uncontrolled, setUncontrolled] = React.useState(Boolean(defaultChecked));
    const isControlled = checked !== undefined;
    const value = isControlled ? Boolean(checked) : uncontrolled;

    return (
      <button
        type="button"
        role="switch"
        id={id}
        name={name}
        aria-checked={value}
        disabled={disabled}
        ref={ref}
        onClick={() => {
          const next = !value;
          if (!isControlled) setUncontrolled(next);
          onCheckedChange?.(next);
        }}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          value ? "bg-primary" : "bg-input",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
            value ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
