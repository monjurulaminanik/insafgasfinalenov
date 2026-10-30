export type DatePreset = "all" | "today" | "week" | "month" | "custom";

export type DateRange = {
  preset: DatePreset;
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
};

export const EMPTY_DATE_RANGE: DateRange = { preset: "all", from: "", to: "" };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Local calendar date as YYYY-MM-DD */
export function toDateInputValue(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function endOfDay(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function rangeForPreset(
  preset: Exclude<DatePreset, "custom" | "all">,
): Pick<DateRange, "from" | "to"> {
  const now = new Date();
  const to = toDateInputValue(now);
  if (preset === "today") return { from: to, to };
  if (preset === "week") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { from: toDateInputValue(from), to };
  }
  // month
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateInputValue(from), to };
}

export function applyPreset(preset: DatePreset, current?: DateRange): DateRange {
  if (preset === "all") return EMPTY_DATE_RANGE;
  if (preset === "custom") {
    return {
      preset: "custom",
      from: current?.from || toDateInputValue(),
      to: current?.to || toDateInputValue(),
    };
  }
  const { from, to } = rangeForPreset(preset);
  return { preset, from, to };
}

/** Normalize ISO / date / YYYY-MM / timestamp into comparable day ms, or null */
export function parseRecordTime(value: string | number | Date | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const s = String(value).trim();
  // YYYY-MM payroll month → first day of month
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map(Number);
    return new Date(y, m - 1, 1).getTime();
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return startOfDay(s);

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function isInDateRange(
  value: string | number | Date | null | undefined,
  range: DateRange,
): boolean {
  if (range.preset === "all" || (!range.from && !range.to)) return true;
  const t = parseRecordTime(value);
  if (t == null) return false;
  if (range.from && t < startOfDay(range.from)) return false;
  if (range.to && t > endOfDay(range.to)) return false;
  return true;
}

export function filterByDateRange<T>(
  rows: T[],
  range: DateRange,
  getDate: (row: T) => string | number | Date | null | undefined,
): T[] {
  if (range.preset === "all" || (!range.from && !range.to)) return rows;
  return rows.filter((row) => isInDateRange(getDate(row), range));
}

export function formatPeriodLabel(range: DateRange, allLabel: string) {
  if (range.preset === "all" || (!range.from && !range.to)) return allLabel;
  const from = range.from || "…";
  const to = range.to || "…";
  return from === to ? from : `${from} – ${to}`;
}
