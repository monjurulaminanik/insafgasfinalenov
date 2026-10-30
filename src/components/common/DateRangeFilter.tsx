import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { applyPreset, type DatePreset, type DateRange } from "@/lib/date-range";
import { useT } from "@/i18n";

const PRESETS: DatePreset[] = ["all", "today", "week", "month", "custom"];

export function DateRangeFilter({
  value,
  onChange,
  className,
  compact,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  const showInputs = value.preset !== "all";

  const label = (p: DatePreset) => {
    switch (p) {
      case "all":
        return t("filter.all");
      case "today":
        return t("filter.today");
      case "week":
        return t("filter.week");
      case "month":
        return t("filter.month");
      case "custom":
        return t("filter.custom");
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" />
        {!compact && <span>{t("filter.dateRange")}</span>}
      </span>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={value.preset === p ? "default" : "outline"}
            className="h-8 px-2.5 text-xs"
            onClick={() => onChange(applyPreset(p, value))}
          >
            {label(p)}
          </Button>
        ))}
      </div>
      {showInputs && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("filter.from")}</span>
            <Input
              type="date"
              value={value.from}
              className="h-8 w-auto min-w-[9.5rem]"
              onChange={(e) => onChange({ ...value, preset: "custom", from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("filter.to")}</span>
            <Input
              type="date"
              value={value.to}
              className="h-8 w-auto min-w-[9.5rem]"
              onChange={(e) => onChange({ ...value, preset: "custom", to: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
