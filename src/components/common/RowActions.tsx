import type { ReactNode } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

type ActionBtn = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost";
  disabled?: boolean;
  danger?: boolean;
  iconOnly?: boolean;
};

export function RowActions({
  onView,
  onEdit,
  onDelete,
  editDisabled,
  deleteDisabled,
  deleteLabel,
  className,
  extras,
  leadingExtras,
  compact = false,
}: {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  editDisabled?: boolean;
  deleteDisabled?: boolean;
  deleteLabel?: string;
  className?: string;
  extras?: ActionBtn[];
  leadingExtras?: ActionBtn[];
  compact?: boolean;
}) {
  const t = useT();

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn("flex items-center justify-end gap-1.5", className)}
        onClick={stop}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {leadingExtras?.map((x) => (
          <Action
            key={x.label}
            label={x.label}
            onClick={x.onClick}
            icon={x.icon}
            variant={x.variant ?? "outline"}
            disabled={x.disabled}
            danger={x.danger}
            compact={compact || x.iconOnly}
          />
        ))}
        {onView && (
          <Action
            label={t("common.view")}
            onClick={onView}
            icon={<Eye className="h-3.5 w-3.5" />}
            compact={compact}
          />
        )}
        {onEdit && (
          <Action
            label={t("common.edit")}
            onClick={onEdit}
            disabled={editDisabled}
            icon={<Pencil className="h-3.5 w-3.5" />}
            variant="outline"
            emphasize
            compact={compact}
          />
        )}
        {extras?.map((x) => (
          <Action
            key={x.label}
            label={x.label}
            onClick={x.onClick}
            icon={x.icon}
            variant={x.variant ?? "outline"}
            disabled={x.disabled}
            danger={x.danger}
            compact={compact || x.iconOnly}
          />
        ))}
        {onDelete && (
          <Action
            label={deleteLabel ?? t("common.delete")}
            onClick={onDelete}
            disabled={deleteDisabled}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            danger
            compact={compact}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function Action({
  label,
  onClick,
  icon,
  variant = "outline",
  disabled,
  danger,
  emphasize,
  compact,
}: {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost";
  disabled?: boolean;
  danger?: boolean;
  emphasize?: boolean;
  compact?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={danger ? "destructive" : variant}
          disabled={disabled}
          className={cn(
            "h-8 gap-1.5 shadow-sm transition-all",
            compact ? "h-8 w-8 p-0" : "px-2.5",
            emphasize &&
              !danger &&
              "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
            danger && (compact ? "h-8 w-8 p-0" : "px-2"),
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
          }}
          aria-label={label}
        >
          {icon}
          {!compact && (
            <span className={cn("hidden text-xs font-medium sm:inline", danger && "sm:hidden")}>
              {label}
            </span>
          )}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Sticky actions column header/cell helpers */
export const actionsColumnClass =
  "w-[1%] whitespace-nowrap text-right sticky right-0 bg-card/95 backdrop-blur-sm";
