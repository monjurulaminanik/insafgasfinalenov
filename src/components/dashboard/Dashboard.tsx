import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { salesService } from "@/services/sales.service";
import { StockAlerts } from "./widgets/StockAlert";
import { FinancialAnalytics } from "./FinancialAnalytics";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { formatCurrency } from "@/utils/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  Users,
  Truck,
  Cylinder as CylinderIcon,
  Package,
  AlertTriangle,
  Warehouse,
} from "lucide-react";
import { useT } from "@/i18n";
import {
  REPORT_TIME_ZONE,
  createTodayDateRange,
  filterByDateRange,
  type DateRange,
} from "@/lib/date-range";
import { getCylinderAccountabilityFn, type CylinderSnapshot } from "@/lib/cylinder.functions";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const t = useT();
  const { user } = useRouteContext({ from: "__root__" });
  const [today, setToday] = useState<string>("");
  const [range, setRange] = useState<DateRange>(createTodayDateRange);
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-GB", {
        timeZone: REPORT_TIME_ZONE,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    );
  }, []);

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: salesService.list,
  });
  const { data: cylAcc, isLoading: cylLoading } = useQuery({
    queryKey: ["cylAccountability", "snapshot"],
    queryFn: () => getCylinderAccountabilityFn({ data: { snapshotOnly: true } }),
  });
  const isLoading = salesLoading || cylLoading;

  const filteredSales = useMemo(
    () => filterByDateRange(sales, range, (r) => r.date).filter((o) => o.status !== "cancelled"),
    [sales, range],
  );

  const owned = cylAcc?.snapshot ?? {
    owned: 0,
    warehouse: 0,
    customers: 0,
    suppliers: 0,
    inRefill: 0,
    lost: 0,
    damaged: 0,
    full: 0,
    empty: 0,
    total: 0,
    inTransit: 0,
    customerOverdue: 0,
    supplierOverdue: 0,
  };
  const customerOverdue = owned.customerOverdue;
  const supplierOverdue = owned.supplierOverdue;

  const greetingName = user?.displayName || "Operator";

  return (
    <div className="space-y-5 sm:space-y-6">
      <div
        data-reveal
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary-glow p-5 text-primary-foreground shadow-elegant sm:p-7"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-primary-glow/40 blur-3xl" />
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-primary-foreground/70">
              {t("dash.region")}
            </p>
            <h1 className="mt-1 truncate text-xl font-bold sm:text-3xl">
              {isLoading ? t("dash.loading") : t("dash.greeting", { name: greetingName })}
            </h1>
            <p className="mt-1 line-clamp-2 text-xs text-primary-foreground/80 sm:text-sm">
              {today}
            </p>
          </div>
        </div>
      </div>
      <div data-reveal className="rounded-xl border bg-card/60 p-3 backdrop-blur-sm">
        <DateRangeFilter value={range} onChange={setRange} />
        <p className="mt-2 text-xs text-muted-foreground">{t("reports.balanceScope")}</p>
      </div>

      <FinancialAnalytics range={range} />

      <CylinderDashboard
        owned={owned}
        overdueCust={customerOverdue}
        overdueSupp={supplierOverdue}
      />

      <div data-reveal className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <StockAlerts />
        </div>
        <KanbanView sales={filteredSales} />
      </div>
    </div>
  );
}

function KanbanView({ sales }: { sales: Awaited<ReturnType<typeof salesService.list>> }) {
  const t = useT();
  const columns = [
    { key: "draft", title: t("status.draft"), tone: "bg-muted text-muted-foreground" },
    { key: "confirmed", title: t("status.confirmed"), tone: "bg-info/15 text-info" },
    { key: "invoiced", title: t("status.invoiced"), tone: "bg-warning/20 text-warning-foreground" },
    { key: "paid", title: t("status.paid"), tone: "bg-success/15 text-success" },
  ] as const;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Link to="/sales" className="hover:text-primary hover:underline underline-offset-2">
            {t("dash.pipeline")}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          {columns.map((col) => {
            const items = sales
              .filter((s) => s.status === col.key)
              .sort((a, b) => {
                const at = Date.parse(a.createdAt || a.date) || 0;
                const bt = Date.parse(b.createdAt || b.date) || 0;
                return bt - at;
              });
            const visible = items.slice(0, 6);
            return (
              <div key={col.key} className="rounded-lg border bg-muted/30 p-2">
                <Link
                  to="/sales"
                  className={`mb-2 flex items-center justify-between rounded-md px-2 py-1 transition hover:opacity-90 ${col.tone}`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    {col.title}
                  </span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {items.length}
                  </Badge>
                </Link>
                <div className="space-y-2">
                  {visible.map((o) => (
                    <Link
                      key={o.id}
                      to="/sales/$id"
                      params={{ id: o.id }}
                      className="block rounded-md border bg-card p-2 text-xs shadow-sm transition hover:border-primary/40"
                    >
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {o.orderNo}
                      </p>
                      <p className="mt-0.5 truncate font-medium">{o.customerName}</p>
                      <p className="mt-1 font-semibold">{formatCurrency(o.total)}</p>
                    </Link>
                  ))}
                  {items.length === 0 && (
                    <p className="p-2 text-[10px] text-muted-foreground">{t("dash.empty")}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_COLORS = {
  full: "#16a34a",
  empty: "#64748b",
  refill: "#2563eb",
  damaged: "#f59e0b",
  lost: "#ef4444",
};
const LOC_COLORS = {
  warehouse: "#0d9488",
  customers: "#7c3aed",
  suppliers: "#2563eb",
  lost: "#ef4444",
  damaged: "#f59e0b",
};

function CylinderMetric({
  title,
  value,
  hint,
  icon: Icon,
  to,
  accent,
}: {
  title: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  to: string;
  accent: string;
}) {
  return (
    <Link
      to={to as "/"}
      className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
    >
      <Card
        className={cn(
          "relative h-full overflow-hidden border-0 text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg",
          accent,
        )}
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/80 sm:text-xs">
                {title}
              </p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
              {hint ? <p className="mt-1 truncate text-[10px] text-white/75">{hint}</p> : null}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CylinderDashboard({
  owned,
  overdueCust,
  overdueSupp,
}: {
  owned: CylinderSnapshot;
  overdueCust: number;
  overdueSupp: number;
}) {
  const t = useT();
  const navigate = useNavigate();
  const overdueTotal = overdueCust + overdueSupp;
  const lostDamaged = owned.lost + owned.damaged;

  const statusRows = [
    {
      key: "full",
      label: t("cylinders.full"),
      value: owned.full,
      color: STATUS_COLORS.full,
      to: "/inventory" as const,
    },
    {
      key: "empty",
      label: t("cylinders.empty"),
      value: owned.empty,
      color: STATUS_COLORS.empty,
      to: "/inventory" as const,
    },
    {
      key: "refill",
      label: t("dash.cylInRefill"),
      value: owned.inRefill,
      color: STATUS_COLORS.refill,
      to: "/suppliers" as const,
    },
    {
      key: "damaged",
      label: t("dash.cylDamaged"),
      value: owned.damaged,
      color: STATUS_COLORS.damaged,
      to: "/cylinders/report" as const,
    },
    {
      key: "lost",
      label: t("dash.cylLost"),
      value: owned.lost,
      color: STATUS_COLORS.lost,
      to: "/cylinders/report" as const,
    },
  ];
  const locRows = [
    {
      key: "warehouse",
      name: t("dash.cylWarehouse"),
      value: owned.warehouse,
      color: LOC_COLORS.warehouse,
      to: "/inventory" as const,
    },
    {
      key: "customers",
      name: t("dash.cylCustomers"),
      value: owned.customers,
      color: LOC_COLORS.customers,
      to: "/customers" as const,
    },
    {
      key: "suppliers",
      name: t("dash.cylSuppliers"),
      value: owned.suppliers,
      color: LOC_COLORS.suppliers,
      to: "/suppliers" as const,
    },
    {
      key: "lost",
      name: t("dash.cylLost"),
      value: owned.lost,
      color: LOC_COLORS.lost,
      to: "/cylinders/report" as const,
    },
    {
      key: "damaged",
      name: t("dash.cylDamaged"),
      value: owned.damaged,
      color: LOC_COLORS.damaged,
      to: "/cylinders/report" as const,
    },
  ];
  const locTotal = locRows.reduce((a, r) => a + r.value, 0) || 1;
  const statusMax = Math.max(...statusRows.map((r) => r.value), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div data-reveal>
          <CylinderMetric
            title={t("dash.cylTotal")}
            value={owned.owned}
            hint={t("dash.cylOwned")}
            icon={CylinderIcon}
            to="/cylinders"
            accent="bg-gradient-to-br from-emerald-600 to-emerald-500"
          />
        </div>
        <div data-reveal>
          <CylinderMetric
            title={t("dash.cylAtWarehouse")}
            value={owned.warehouse}
            icon={Warehouse}
            to="/inventory"
            accent="bg-gradient-to-br from-sky-600 to-cyan-500"
          />
        </div>
        <div data-reveal>
          <CylinderMetric
            title={t("dash.cylWithCustomers")}
            value={owned.customers}
            icon={Users}
            to="/customers"
            accent="bg-gradient-to-br from-violet-600 to-fuchsia-500"
          />
        </div>
        <div data-reveal>
          <CylinderMetric
            title={t("dash.cylWithSuppliers")}
            value={owned.suppliers}
            icon={Truck}
            to="/suppliers"
            accent="bg-gradient-to-br from-blue-700 to-indigo-500"
          />
        </div>
        <div data-reveal className="col-span-2 sm:col-span-1">
          <CylinderMetric
            title={t("dash.cylLostDamaged")}
            value={lostDamaged}
            hint={`${owned.lost} / ${owned.damaged}`}
            icon={AlertTriangle}
            to="/cylinders/report"
            accent="bg-gradient-to-br from-rose-600 to-orange-500"
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Card data-reveal className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("dash.cylStatusTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {statusRows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => navigate({ to: row.to })}
                className="flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-left transition hover:bg-muted/60"
              >
                <span className="w-24 shrink-0 truncate text-xs font-medium sm:w-28">
                  {row.label}
                </span>
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(row.value / statusMax) * 100}%`, background: row.color }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {row.value}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card data-reveal className="lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("dash.cylLocationTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <div className="h-44 w-full max-w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={locRows}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                      onClick={(_, i) => {
                        const row = locRows[i];
                        if (row) navigate({ to: row.to });
                      }}
                      className="cursor-pointer outline-none"
                    >
                      {locRows.map((r) => (
                        <Cell key={r.key} fill={r.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [v, ""]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full min-w-0 space-y-1.5 text-xs">
                {locRows.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => navigate({ to: r.to })}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted/60"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: r.color }}
                        />
                        <span className="truncate">{r.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold">
                        {r.value} · {Math.round((r.value / locTotal) * 100)}%
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Link
          to="/reports"
          data-reveal
          className="block outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-span-3 rounded-xl"
        >
          <Card className="h-full border-0 bg-gradient-to-br from-rose-50 to-orange-50 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg dark:from-rose-950/40 dark:to-orange-950/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                {t("dash.cylOverdueReturns")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-5xl font-bold tabular-nums text-rose-600">{overdueTotal}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t("dash.cylOverdueHint")}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/70 p-2 dark:bg-background/40">
                  <p className="text-muted-foreground">{t("dash.cylOverdueCust")}</p>
                  <p className="text-lg font-semibold tabular-nums">{overdueCust}</p>
                </div>
                <div className="rounded-lg bg-white/70 p-2 dark:bg-background/40">
                  <p className="text-muted-foreground">{t("dash.cylOverdueSupp")}</p>
                  <p className="text-lg font-semibold tabular-nums">{overdueSupp}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card data-reveal>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("dash.legendFlow")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {statusRows.map((r) => (
              <span key={r.key} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                {r.label}
              </span>
            ))}
          </CardContent>
        </Card>
        <Card data-reveal>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("dash.legendIcons")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Warehouse className="h-3.5 w-3.5" />
              {t("dash.cylWarehouse")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {t("dash.cylCustomers")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" />
              {t("dash.cylSuppliers")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              {t("dash.legendRefillPlant")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CylinderIcon className="h-3.5 w-3.5" />
              {t("dash.legendCylinder")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("dash.cylLostDamaged")}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
