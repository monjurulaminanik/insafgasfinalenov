export type DatePreset = "all" | "today" | "week" | "month" | "custom";

export type DateRange = {
  preset: DatePreset;
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
};

export const EMPTY_DATE_RANGE: DateRange = { preset: "all", from: "", to: "" };

/** Business calendar shared by SSR and browsers, independent of host timezone. */
export const REPORT_TIME_ZONE = "Asia/Dhaka";
const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function createTodayDateRange(now = new Date()): DateRange {
  return { preset: "today", ...rangeForPreset("today", now) };
}

/** Dhaka calendar date as YYYY-MM-DD. */
export function toDateInputValue(d = new Date()): string {
  const parts = businessDateFormatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function startOfDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000+06:00`);
}

function endOfDay(isoDate: string): number {
  return Date.parse(`${isoDate}T23:59:59.999+06:00`);
}

export function rangeForPreset(
  preset: Exclude<DatePreset, "custom" | "all">,
  now = new Date(),
): Pick<DateRange, "from" | "to"> {
  const to = toDateInputValue(now);
  if (preset === "today") return { from: to, to };
  if (preset === "week") {
    // Calendar arithmetic must not inherit the host timezone or DST.
    const from = new Date(`${to}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: from.toISOString().slice(0, 10), to };
  }
  // month
  return { from: `${to.slice(0, 7)}-01`, to };
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
    return startOfDay(`${s}-01`);
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return startOfDay(s);

  // Legacy timestamps without an offset are business wall-clock times.
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)
    ? `${s}+06:00`
    : s;
  const t = Date.parse(timestamp);
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
