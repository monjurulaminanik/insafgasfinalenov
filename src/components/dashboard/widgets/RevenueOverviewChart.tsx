import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCurrency, formatCompactCurrency } from "@/utils/formatters";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export type MonthlyDataPoint = {
  month: string;
  key: string;
  sales: number;
  purchases: number;
  expenses: number;
  netProfit: number;
};

export type RevenueOverviewChartProps = {
  data: MonthlyDataPoint[];
  isLoading?: boolean;
};

export function RevenueOverviewChart({ data, isLoading }: RevenueOverviewChartProps) {
  const t = useT();

  const series = [
    { key: "sales", label: "Sales", color: "#3b82f6", gradId: "salesGrad" },
    { key: "purchases", label: "Purchases", color: "#8b5cf6", gradId: "purchasesGrad" },
    { key: "expenses", label: "Expenses", color: "#f59e0b", gradId: "expensesGrad" },
    { key: "netProfit", label: "Net Profit/Loss", color: "#10b981", gradId: "profitGrad" },
  ] as const;

  return (
    <Card data-reveal data-testid="revenue-overview-chart" className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <CardTitle className="text-base font-bold tracking-tight text-foreground sm:text-lg">
            {t("dash.revenueOverview") || "Revenue Overview"}
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            {t("dash.revenueSubtitle") || "Sales vs Purchases vs Expenses vs Net Profit/Loss"}
          </CardDescription>
        </div>

        {/* Legend matching Screenshot 1 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-2 sm:pt-4">
        {isLoading ? (
          <div className="flex h-72 items-center justify-center text-xs text-muted-foreground">
            {t("dash.loading") || "Loading chart data…"}
          </div>
        ) : (
          <div className="h-[280px] w-full sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 12, right: 12, left: -4, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="purchasesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="expensesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border) / 0.6)"
                />

                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  dy={6}
                />

                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(val: number) => formatCompactCurrency(val)}
                  width={68}
                />

                <Tooltip content={<CustomRevenueTooltip />} />

                <Area
                  type="monotone"
                  dataKey="sales"
                  name="Sales"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fill="url(#salesGrad)"
                  isAnimationActive={false}
                  dot={{ r: 3.5, fill: "#3b82f6", strokeWidth: 1.5, stroke: "#ffffff" }}
                  activeDot={{ r: 5.5, strokeWidth: 2, stroke: "#ffffff" }}
                />

                <Area
                  type="monotone"
                  dataKey="purchases"
                  name="Purchases"
                  stroke="#8b5cf6"
                  strokeWidth={2.5}
                  fill="url(#purchasesGrad)"
                  isAnimationActive={false}
                  dot={{ r: 3.5, fill: "#8b5cf6", strokeWidth: 1.5, stroke: "#ffffff" }}
                  activeDot={{ r: 5.5, strokeWidth: 2, stroke: "#ffffff" }}
                />

                <Area
                  type="monotone"
                  dataKey="expenses"
                  name="Expenses"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  fill="url(#expensesGrad)"
                  isAnimationActive={false}
                  dot={{ r: 3.5, fill: "#f59e0b", strokeWidth: 1.5, stroke: "#ffffff" }}
                  activeDot={{ r: 5.5, strokeWidth: 2, stroke: "#ffffff" }}
                />

                <Area
                  type="monotone"
                  dataKey="netProfit"
                  name="Net Profit/Loss"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#profitGrad)"
                  isAnimationActive={false}
                  dot={{ r: 3.5, fill: "#10b981", strokeWidth: 1.5, stroke: "#ffffff" }}
                  activeDot={{ r: 5.5, strokeWidth: 2, stroke: "#ffffff" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CustomRevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="min-w-[210px] rounded-xl border border-border/80 bg-background/95 p-3.5 shadow-xl backdrop-blur-md text-xs space-y-2">
      <p className="font-bold text-foreground border-b border-border/50 pb-1.5">{label}</p>
      <div className="space-y-1.5">
        {payload.map((entry: any) => {
          const isProfit = entry.dataKey === "netProfit";
          const val = Number(entry.value) || 0;
          return (
            <div key={entry.dataKey} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: entry.stroke || entry.color }}
                />
                <span>{entry.name}</span>
              </span>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  isProfit
                    ? val < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground",
                )}
              >
                {val < 0 ? `-${formatCurrency(Math.abs(val))}` : formatCurrency(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
