import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Cylinder as CylinderIcon,
  Plus,
  Printer,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { inventoryService } from "@/services/inventory.service";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { supplierReturnService } from "@/services/supplier-return.service";
import { purchaseService } from "@/services/purchase.service";
import { returnService } from "@/services/return.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { CylinderLedger } from "@/components/cylinder/CylinderLedger";
import { isWarehouseLocation } from "@/lib/cylinder-ledger";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CYLINDER_SIZE_OPTIONS,
  companyOwnedLocations,
  cylinderAtCustomer,
  cylinderAtSupplier,
  cylinderIsEmpty,
  cylinderIsFullStock,
  cylinderOverviewCounts,
  isCompanyOwned,
  isInactiveCompanyCylinder,
  matchesCylinderSize,
} from "@/lib/cylinder-product";
import { partyCylinderBalance } from "@/lib/customer-cylinders";
import { formatCurrency, formatDateTime } from "@/utils/formatters";
import type { Cylinder, CylinderStatus } from "@/types";
import { createTodayDateRange, type DateRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/i18n";

const statusVariant: Record<CylinderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  in_stock: "default",
  at_customer: "secondary",
  in_transit: "outline",
  refilling: "outline",
  damaged: "destructive",
  lost: "destructive",
  scrapped: "destructive",
  written_off: "destructive",
  stock_out: "outline",
};

type ReportView = "cylinder" | "customer" | "supplier";
type CardFocus = "all" | "warehouse" | "suppliers" | "customers" | "lostDamaged";

function locationBucket(c: Cylinder): Exclude<CardFocus, "all"> | null {
  if (!isCompanyOwned(c) || isInactiveCompanyCylinder(c)) return null;
  if (c.status === "lost" || c.status === "damaged") return "lostDamaged";
  if (cylinderAtSupplier(c)) return "suppliers";
  if (cylinderAtCustomer(c)) return "customers";
  return "warehouse";
}

export function CylinderRegistry() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"registry" | "tracking">("tracking");
  const [range, setRange] = useState<DateRange>(createTodayDateRange);
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [cardFocus, setCardFocus] = useState<CardFocus | null>(null);
  const [reportView, setReportView] = useState<ReportView>("cylinder");
  const { data = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: cylinderInventory = [] } = useQuery({
    queryKey: ["cylinderInventory"],
    queryFn: inventoryService.getCylinderInventory,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: cylMoves = [] } = useQuery({
    queryKey: ["cylinderMovements"],
    queryFn: cylinderService.listMovements,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });
  const { data: supplierReturns = [] } = useQuery({
    queryKey: ["supplierReturns"],
    queryFn: supplierReturnService.list,
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: purchaseService.list,
  });
  const { data: customerReturns = [] } = useQuery({
    queryKey: ["returns"],
    queryFn: () => returnService.list(),
  });
  const { data: stockMovements = [] } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });
  const warehouses = useMemo(() => {
    const list = Array.from(
      new Set(
        data
          .map((c) => (isWarehouseLocation(c.location) ? "Warehouse" : c.location))
          .filter(Boolean),
      ),
    );
    return list.includes("Warehouse") ? ["Warehouse"] : list.sort();
  }, [data]);
  const filtered = useMemo(() => {
    return data.filter((c) => {
      if (sizeFilter !== "all" && !matchesCylinderSize(c.capacity, Number(sizeFilter)))
        return false;
      if (warehouseFilter !== "all") {
        if (warehouseFilter === "Warehouse" && !isWarehouseLocation(c.location)) return false;
        if (warehouseFilter !== "Warehouse" && c.location !== warehouseFilter) return false;
      }
      return true;
    });
  }, [data, sizeFilter, warehouseFilter]);

  const counts = cylinderOverviewCounts(filtered);
  const locations = useMemo(() => companyOwnedLocations(filtered), [filtered]);
  const gasCategoryOf = (c: Cylinder) =>
    c.gasCategory || products.find((p) => p.id === c.productId)?.category || "—";

  const registryRows = useMemo(() => {
    if (!cardFocus) return filtered;
    if (cardFocus === "all") {
      return filtered.filter((c) => isCompanyOwned(c) && !isInactiveCompanyCylinder(c));
    }
    return filtered.filter((c) => locationBucket(c) === cardFocus);
  }, [filtered, cardFocus]);

  const productRows = useMemo(() => {
    // Map registered cylinder assets by productId
    const byProductCylinders = new Map<string, Cylinder[]>();
    for (const c of filtered) {
      if (!c.productId) continue;
      const list = byProductCylinders.get(c.productId) ?? [];
      list.push(c);
      byProductCylinders.set(c.productId, list);
    }

    // Source of Truth: cylinderInventory
    const cylProductMap = new Map<string, { inv?: (typeof cylinderInventory)[0]; product?: (typeof products)[0] }>();
    for (const inv of cylinderInventory) {
      cylProductMap.set(inv.productId, {
        inv,
        product: products.find((p) => p.id === inv.productId),
      });
    }
    for (const p of products) {
      if (
        (p.productType === "cylinder" || (p.uom === "cyl" && p.productType !== "gas")) &&
        !cylProductMap.has(p.id)
      ) {
        cylProductMap.set(p.id, { product: p });
      }
    }

    const rows = Array.from(cylProductMap.entries()).map(([productId, { inv, product }]) => {
      const name = inv?.productName || product?.name || productId;
      const list = byProductCylinders.get(productId) ?? [];
      const active = list.filter((c) => !isInactiveCompanyCylinder(c));

      // With customer (from cylinder tracking)
      const customer = active.filter((c) => cylinderAtCustomer(c)).length;

      // With supplier (from cylinder tracking)
      const suppliers = active.filter((c) => cylinderAtSupplier(c) || c.status === "refilling").length;

      // Suppliers Return: Quantity of cylinders returned to suppliers
      const suppliersReturn = supplierReturns
        .filter((sr) => sr.status !== "cancelled")
        .reduce((sum, sr) => {
          const lineSum = (sr.items || [])
            .filter((it) => it.productId === productId)
            .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
          return sum + lineSum;
        }, 0);

      // Total Purchase: Total quantity of cylinders purchased
      const totalPurchase = purchases
        .filter((po) => po.status !== "cancelled")
        .reduce((sum, po) => {
          const lineSum = (po.items || [])
            .filter((it) => it.productId === productId)
            .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
          return sum + lineSum;
        }, 0);

      // Customer Return: Quantity of cylinders returned by customers
      const customerReturn = customerReturns
        .filter((cr) => cr.status !== "cancelled")
        .reduce((sum, cr) => {
          const lineSum = (cr.items || [])
            .filter((it) => it.productId === productId)
            .reduce((s, it) => s + (Number(it.returnQuantity) || 0), 0);
          return sum + lineSum;
        }, 0);

      // Loss / Damage: Number of damage entries/units recorded through the Damage Cylinder feature without double counting
      const damageFromMovements = stockMovements
        .filter((sm) => sm.movementType === "DAMAGE" && sm.productId === productId)
        .reduce((sum, sm) => sum + (Number(sm.quantity) || 0), 0);
      const serializedDamaged = active.filter(
        (c) => c.status === "lost" || c.status === "damaged",
      ).length;
      const lossDamage = Math.max(damageFromMovements, serializedDamaged);

      // Empty in warehouse
      const empty = active.filter(
        (c) =>
          cylinderIsEmpty(c) &&
          !cylinderAtCustomer(c) &&
          !cylinderAtSupplier(c) &&
          c.status !== "lost" &&
          c.status !== "damaged",
      ).length;

      // Current onHand stock from authoritative cylinderInventory (Source of Truth)
      const onHandStock = inv != null ? inv.onHand : (product?.stock ?? active.filter((c) => cylinderIsFullStock(c)).length);

      // Full stock in warehouse: onHand minus any empty in warehouse
      const full = Math.max(0, onHandStock - empty);

      // Total cylinders for this product (Warehouse Full + Empty + Suppliers + Customer + Loss/Damage)
      const total = full + empty + suppliers + customer + lossDamage;

      // Authoritative Unit Cost from inventory (costPrice or fallback to unitPrice / product cost)
      const unitCost = inv
        ? (inv.costPrice > 0 ? inv.costPrice : (Number(product?.cost) || inv.unitPrice || Number(product?.price) || 0))
        : (Number(product?.cost) || Number(product?.price) || 0);

      // Stock Value from authoritative inventory stock value (or onHandStock * unitCost)
      const totalValue = inv != null ? inv.totalValue : onHandStock * unitCost;

      return {
        id: productId,
        sl: 1,
        name,
        full,
        empty,
        suppliers,
        customer,
        suppliersReturn,
        totalPurchase,
        customerReturn,
        lossDamage,
        unitCost,
        total,
        totalValue,
      };
    });

    return rows
      .filter((r) => {
        if (sizeFilter === "all") return true;
        const capacity = r.name.match(/(\d+)\s*kg/i)?.[1];
        if (!capacity) return true;
        return matchesCylinderSize(Number(capacity), Number(sizeFilter));
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r, i) => ({ ...r, sl: i + 1 }));
  }, [cylinderInventory, products, filtered, sizeFilter, supplierReturns, purchases, customerReturns, stockMovements]);

  const summaryTotals = useMemo(() => {
    const warehouse = productRows.reduce((sum, r) => sum + r.full + r.empty, 0);
    const suppliers = productRows.reduce((sum, r) => sum + r.suppliers, 0);
    const customers = productRows.reduce((sum, r) => sum + r.customer, 0);
    const lostDamaged = productRows.reduce((sum, r) => sum + r.lossDamage, 0);
    const total = warehouse + suppliers + customers + lostDamaged;
    return { warehouse, suppliers, customers, lostDamaged, total };
  }, [productRows]);

  const customerRows = useMemo(() => {
    const rows = customers
      .map((c) => {
        const b = partyCylinderBalance("customer", c.id, data, cylMoves);
        return { id: c.id, partner: c.name, ...b };
      })
      .filter((r) => r.sent || r.returned || r.lost || r.damaged)
      .sort((a, b) => a.partner.localeCompare(b.partner));
    if (!rows.length) return [];
    const total = rows.reduce(
      (a, r) => ({
        sent: a.sent + r.sent,
        returned: a.returned + r.returned,
        remaining: a.remaining + r.remaining,
        overdue: a.overdue + r.overdue,
        lost: a.lost + r.lost,
        damaged: a.damaged + r.damaged,
      }),
      { sent: 0, returned: 0, remaining: 0, overdue: 0, lost: 0, damaged: 0 },
    );
    return [...rows, { id: "__total__", partner: t("common.total"), ...total }];
  }, [customers, data, cylMoves, t]);

  const supplierRows = useMemo(() => {
    const rows = suppliers
      .map((s) => {
        const b = partyCylinderBalance("supplier", s.id, data, cylMoves);
        return { id: s.id, partner: s.name, ...b };
      })
      .filter((r) => r.sent || r.returned || r.lost || r.damaged)
      .sort((a, b) => a.partner.localeCompare(b.partner));
    if (!rows.length) return [];
    const total = rows.reduce(
      (a, r) => ({
        sent: a.sent + r.sent,
        returned: a.returned + r.returned,
        remaining: a.remaining + r.remaining,
        overdue: a.overdue + r.overdue,
        lost: a.lost + r.lost,
        damaged: a.damaged + r.damaged,
      }),
      { sent: 0, returned: 0, remaining: 0, overdue: 0, lost: 0, damaged: 0 },
    );
    return [...rows, { id: "__total__", partner: t("common.total"), ...total }];
  }, [suppliers, data, cylMoves, t]);

  const cylinderReportRows = useMemo(() => {
    const total = productRows.reduce(
      (a, r) => ({
        full: a.full + r.full,
        empty: a.empty + r.empty,
        customer: a.customer + r.customer,
        suppliers: a.suppliers + r.suppliers,
        suppliersReturn: a.suppliersReturn + r.suppliersReturn,
        totalPurchase: a.totalPurchase + r.totalPurchase,
        customerReturn: a.customerReturn + r.customerReturn,
        lossDamage: a.lossDamage + r.lossDamage,
        unitCost: 0,
        total: a.total + r.total,
        totalValue: a.totalValue + r.totalValue,
      }),
      {
        full: 0,
        empty: 0,
        customer: 0,
        suppliers: 0,
        suppliersReturn: 0,
        totalPurchase: 0,
        customerReturn: 0,
        lossDamage: 0,
        unitCost: 0,
        total: 0,
        totalValue: 0,
      },
    );
    if (!productRows.length) return [];
    return [
      ...productRows,
      { id: "__total__", sl: productRows.length + 1, name: t("common.total"), ...total },
    ];
  }, [productRows, t]);

  const selectCard = (focus: CardFocus) => {
    setCardFocus(focus);
    setTab("registry");
  };

  const remove = useMutation({
    mutationFn: (id: string) => cylinderService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      toast.success(t("cylinders.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summaryCards: {
    focus: CardFocus;
    label: MessageKey;
    value: number;
    icon: typeof Warehouse;
    tone?: string;
  }[] = [
    { focus: "all", label: "cylinders.total", value: summaryTotals.total, icon: CylinderIcon },
    {
      focus: "warehouse",
      label: "cylinders.head.warehouse",
      value: summaryTotals.warehouse,
      icon: Warehouse,
      tone: "text-primary",
    },
    {
      focus: "suppliers",
      label: "dash.cylSuppliers",
      value: summaryTotals.suppliers,
      icon: Truck,
      tone: "text-info",
    },
    {
      focus: "customers",
      label: "dash.cylCustomers",
      value: summaryTotals.customers,
      icon: Users,
      tone: "text-success",
    },
    {
      focus: "lostDamaged",
      label: "cylinders.lossDamage",
      value: summaryTotals.lostDamaged,
      icon: AlertTriangle,
      tone: "text-destructive",
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("cylinders.title")}
        description={t("cylinders.desc")}
        actions={
          <div className="flex flex-wrap gap-2">
            {tab === "tracking" && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" />
                {t("common.print")}
              </Button>
            )}
            <Button asChild>
              <Link to="/cylinders/new">
                <Plus className="mr-1 h-4 w-4" /> {t("cylinders.new")}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/cylinders/report">{t("cylinders.report")}</Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <button
            key={card.focus}
            type="button"
            className="text-left"
            onClick={() => selectCard(card.focus)}
          >
            <Card className={cn(cardFocus === card.focus && "ring-2 ring-primary")}>
              <CardContent className="flex items-start justify-between gap-2 pt-4 pb-3">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(card.label)}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{card.value}</p>
                </div>
                <card.icon className={cn("h-5 w-5 shrink-0 text-muted-foreground", card.tone)} />
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="no-print mb-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={reportView === "cylinder" ? "default" : "outline"}
          onClick={() => setReportView("cylinder")}
        >
          {t("cylinders.report")}
        </Button>
        <Button
          size="sm"
          variant={reportView === "customer" ? "default" : "outline"}
          onClick={() => setReportView("customer")}
        >
          {t("customers.report")}
        </Button>
        <Button
          size="sm"
          variant={reportView === "supplier" ? "default" : "outline"}
          onClick={() => setReportView("supplier")}
        >
          {t("suppliers.report")}
        </Button>
      </div>

      <div className="mb-4">
        {reportView === "cylinder" && (
          <DataTable
            rows={cylinderReportRows}
            searchKeys={["name"]}
            columns={[
              {
                key: "name",
                header: t("common.product"),
                sortable: true,
                sortValue: (r) => (r.id === "__total__" ? "\uFFFF" : r.name),
                render: (r) => (
                  <span className={r.id === "__total__" ? "font-semibold" : ""}>{r.name}</span>
                ),
                className: "min-w-[8rem]",
              },
              {
                key: "full",
                header: t("cylinders.rptFull"),
                sortable: true,
                sortValue: (r) => r.full,
                render: (r) => r.full,
                className: "text-right tabular-nums",
              },
              {
                key: "suppliersReturn",
                header: t("cylinders.suppliersReturn"),
                sortable: true,
                sortValue: (r) => r.suppliersReturn,
                render: (r) => r.suppliersReturn,
                className: "text-right tabular-nums",
              },
              {
                key: "totalPurchase",
                header: t("cylinders.totalPurchase"),
                sortable: true,
                sortValue: (r) => r.totalPurchase,
                render: (r) => r.totalPurchase,
                className: "text-right tabular-nums",
              },
              {
                key: "customerReturn",
                header: t("cylinders.customerReturn"),
                sortable: true,
                sortValue: (r) => r.customerReturn,
                render: (r) => r.customerReturn,
                className: "text-right tabular-nums",
              },
              {
                key: "lossDamage",
                header: t("cylinders.lossDamage"),
                sortable: true,
                sortValue: (r) => r.lossDamage,
                render: (r) => r.lossDamage,
                className: "text-right tabular-nums",
              },
              {
                key: "unitCost",
                header: t("reports.unitCost"),
                sortable: true,
                sortValue: (r) => r.unitCost,
                render: (r) => (r.id === "__total__" ? "—" : formatCurrency(r.unitCost)),
                className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
              },
              {
                key: "total",
                header: t("common.total"),
                sortable: true,
                sortValue: (r) => r.total,
                render: (r) => r.total,
                className: "text-right tabular-nums",
              },
              {
                key: "totalValue",
                header: t("inventory.totalValue"),
                sortable: true,
                sortValue: (r) => r.totalValue,
                render: (r) => formatCurrency(r.totalValue),
                className: "min-w-[7rem] whitespace-nowrap text-right tabular-nums",
              },
            ]}
          />
        )}
        {reportView === "customer" && (
          <DataTable
            rows={customerRows}
            searchKeys={["partner"]}
            columns={[
              {
                key: "partner",
                header: t("cylinders.colPartner"),
                sortable: true,
                sortValue: (r) => (r.id === "__total__" ? "\uFFFF" : r.partner),
                render: (r) => (
                  <span className={r.id === "__total__" ? "font-semibold" : ""}>{r.partner}</span>
                ),
                className: "min-w-[8rem]",
              },
              {
                key: "sent",
                header: t("cylinders.colSent"),
                sortable: true,
                sortValue: (r) => r.sent,
                render: (r) => r.sent,
                className: "text-right tabular-nums",
              },
              {
                key: "returned",
                header: t("cylinders.colReturned"),
                sortable: true,
                sortValue: (r) => r.returned,
                render: (r) => r.returned,
                className: "text-right tabular-nums",
              },
              {
                key: "remaining",
                header: t("cylinders.colRemaining"),
                sortable: true,
                sortValue: (r) => r.remaining,
                render: (r) => r.remaining,
                className: "text-right tabular-nums",
              },
              {
                key: "overdue",
                header: t("customers.cylOverdue"),
                sortable: true,
                sortValue: (r) => r.overdue,
                render: (r) => r.overdue,
                className: "text-right tabular-nums",
              },
              {
                key: "lost",
                header: t("customers.cylLost"),
                sortable: true,
                sortValue: (r) => r.lost,
                render: (r) => r.lost,
                className: "text-right tabular-nums",
              },
              {
                key: "damaged",
                header: t("customers.cylDamaged"),
                sortable: true,
                sortValue: (r) => r.damaged,
                render: (r) => r.damaged,
                className: "text-right tabular-nums",
              },
            ]}
          />
        )}
        {reportView === "supplier" && (
          <DataTable
            rows={supplierRows}
            searchKeys={["partner"]}
            columns={[
              {
                key: "partner",
                header: t("cylinders.colPartner"),
                sortable: true,
                sortValue: (r) => (r.id === "__total__" ? "\uFFFF" : r.partner),
                render: (r) => (
                  <span className={r.id === "__total__" ? "font-semibold" : ""}>{r.partner}</span>
                ),
                className: "min-w-[8rem]",
              },
              {
                key: "sent",
                header: t("cylinders.colSent"),
                sortable: true,
                sortValue: (r) => r.sent,
                render: (r) => r.sent,
                className: "text-right tabular-nums",
              },
              {
                key: "returned",
                header: t("cylinders.colReturned"),
                sortable: true,
                sortValue: (r) => r.returned,
                render: (r) => r.returned,
                className: "text-right tabular-nums",
              },
              {
                key: "remaining",
                header: t("cylinders.colRemaining"),
                sortable: true,
                sortValue: (r) => r.remaining,
                render: (r) => r.remaining,
                className: "text-right tabular-nums",
              },
              {
                key: "overdue",
                header: t("customers.cylOverdue"),
                sortable: true,
                sortValue: (r) => r.overdue,
                render: (r) => r.overdue,
                className: "text-right tabular-nums",
              },
              {
                key: "lost",
                header: t("customers.cylLost"),
                sortable: true,
                sortValue: (r) => r.lost,
                render: (r) => r.lost,
                className: "text-right tabular-nums",
              },
              {
                key: "damaged",
                header: t("customers.cylDamaged"),
                sortable: true,
                sortValue: (r) => r.damaged,
                render: (r) => r.damaged,
                className: "text-right tabular-nums",
              },
            ]}
          />
        )}
      </div>

      <div className="no-print mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={tab === "tracking" ? "default" : "outline"}
          onClick={() => setTab("tracking")}
        >
          {t("cylinders.trackingTab")}
        </Button>
        <Button
          size="sm"
          variant={tab === "registry" ? "default" : "outline"}
          onClick={() => setTab("registry")}
        >
          {t("cylinders.registryTab")}
        </Button>
      </div>
      <div className="no-print mb-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("cylinders.filterSize")}</Label>
          <Select value={sizeFilter} onValueChange={setSizeFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter.all")}</SelectItem>
              {CYLINDER_SIZE_OPTIONS.map((sz) => (
                <SelectItem key={sz} value={String(sz)}>
                  {sz}kg
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("cylinders.filterWarehouse")}</Label>
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter.all")}</SelectItem>
              {warehouses.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["cylinders.full", counts.full],
            ["cylinders.empty", counts.empty],
            ["cylinders.refillPending", counts.refillPending],
            ["cylinders.inTransit", counts.inTransit],
          ] as const
        ).map(([key, value]) => (
          <Card key={key}>
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(key)}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {tab === "tracking" && (
        <div className="space-y-4">
          <div className="no-print rounded-xl border bg-card/60 p-3">
            <DateRangeFilter value={range} onChange={setRange} />
          </div>
          <div className="print-sheet">
            <PrintDocHeader title={t("reports.cylinder")} className="mb-4 !hidden print:!flex" />
            <CylinderLedger range={range} />
          </div>
        </div>
      )}
      {tab === "registry" && (
        <DataTable<Cylinder>
          rows={registryRows}
          searchKeys={["serialNumber", "location"]}
          dateKey="lastMovementAt"
          defaultDatePreset="all"
          onRowClick={(r) => navigate({ to: "/cylinders/$id", params: { id: r.id } })}
          columns={[
            {
              key: "sn",
              header: t("cylinders.serial"),
              sortable: true,
              sortValue: (r) => r.serialNumber,
              render: (r) => <span className="font-mono">{r.serialNumber}</span>,
            },
            {
              key: "cat",
              header: t("cylinders.gasCategory"),
              sortable: true,
              sortValue: (r) => gasCategoryOf(r),
              render: (r) => gasCategoryOf(r),
            },
            {
              key: "cap",
              header: t("cylinders.capacity"),
              sortable: true,
              sortValue: (r) => r.capacity,
              render: (r) => `${r.capacity}`,
            },
            {
              key: "st",
              header: t("common.status"),
              sortable: true,
              sortValue: (r) => r.status,
              render: (r) => (
                <Badge variant={statusVariant[r.status]}>{t(`status.${r.status}` as any)}</Badge>
              ),
            },
            {
              key: "loc",
              header: t("cylinders.location"),
              sortable: true,
              sortValue: (r) => r.location,
              render: (r) => r.location,
            },
            {
              key: "mv",
              header: t("cylinders.lastMovement"),
              sortable: true,
              sortValue: (r) => r.lastMovementAt,
              render: (r) => (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(r.lastMovementAt)}
                </span>
              ),
            },
            {
              key: "actions",
              header: t("common.actions"),
              className: actionsColumnClass,
              render: (r) => (
                <RowActions
                  onView={() => navigate({ to: "/cylinders/$id", params: { id: r.id } })}
                  onEdit={() => navigate({ to: "/cylinders/$id/edit", params: { id: r.id } })}
                  onDelete={() => {
                    if (confirm(t("cylinders.deleteConfirm"))) remove.mutate(r.id);
                  }}
                  deleteDisabled={remove.isPending}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
