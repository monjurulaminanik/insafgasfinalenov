import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { salesService } from "@/services/sales.service";
import { purchaseService } from "@/services/purchase.service";
import { productService } from "@/services/product.service";
import { expenseService } from "@/services/expense.service";
import { accountingService } from "@/services/accounting.service";
import { deliveryService } from "@/services/delivery.service";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { StockReport } from "@/components/reports/StockReport";
import { CylinderLedger } from "@/components/cylinder/CylinderLedger";
import { cylinderService } from "@/services/cylinder.service";
import { buildCylinderMovementLedger, buildCylinderOverdueRows } from "@/lib/cylinder-reports";
import { getCylinderAccountabilityFn, type CylinderBalanceStatus } from "@/lib/cylinder.functions";
import { isCylinderProduct } from "@/lib/cylinder-product";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { useT } from "@/i18n";
import { EMPTY_DATE_RANGE, filterByDateRange, type DateRange } from "@/lib/date-range";
import { customerOpeningSigned } from "@/lib/customer-balance";
import {
  computeCustomerReceivables,
  computeSupplierPayables,
  computeProfitAndLoss,
  computeBalanceSheet,
  computeCashFlow,
} from "@/lib/accounting-engine";
import { inventoryService } from "@/services/inventory.service";
import { Printer } from "lucide-react";

const reports = [
  { id: "sales", key: "reports.sales" },
  { id: "purchase", key: "reports.purchase" },
  { id: "stock", key: "reports.stock" },
  { id: "cylinder", key: "reports.cylinder" },
  { id: "cylMove", key: "reports.cylMove" },
  { id: "cylBal", key: "reports.cylBal" },
  { id: "cylOverdue", key: "reports.cylOverdue" },
  { id: "ar", key: "reports.ar" },
  { id: "ap", key: "reports.ap" },
  { id: "cash", key: "reports.cash" },
  { id: "bank", key: "reports.bank" },
  { id: "gl", key: "reports.gl" },
  { id: "pnl", key: "reports.pnl" },
  { id: "balanceSheet", key: "reports.balanceSheet" },
  { id: "cashFlow", key: "reports.cashFlow" },
  { id: "trialBalance", key: "reports.trialBalance" },
  { id: "expense", key: "reports.expense" },
  { id: "delivery", key: "reports.delivery" },
  { id: "product", key: "reports.product" },
] as const;

type ReportId = (typeof reports)[number]["id"];

export function ReportsPage() {
  const t = useT();
  const [active, setActive] = useState<ReportId>("sales");
  const [range, setRange] = useState<DateRange>(EMPTY_DATE_RANGE);
  const { data: salesRaw = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: purchasesRaw = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: purchaseService.list,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: expensesRaw = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: expenseService.list,
  });
  const { data: ledgerRaw = [] } = useQuery({
    queryKey: ["ledger"],
    queryFn: accountingService.listLedger,
  });
  const { data: deliveriesRaw = [] } = useQuery({
    queryKey: ["deliveries"],
    queryFn: deliveryService.list,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["assets"],
    queryFn: accountingService.listAssets,
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: cylMoves = [] } = useQuery({
    queryKey: ["cylinderMovements"],
    queryFn: cylinderService.listMovements,
  });
  const { data: vouchersRaw = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });
  const { data: stockMovementsRaw = [] } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listStockMovements,
  });
  const { data: costLayersRaw = [] } = useQuery({
    queryKey: ["costLayers"],
    queryFn: inventoryService.listCostLayers,
  });
  const { data: accountsRaw = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const [cylKind, setCylKind] = useState<"all" | "customer" | "supplier">("all");
  const [cylProductId, setCylProductId] = useState("all");
  const [cylStatus, setCylStatus] = useState<CylinderBalanceStatus>("all");

  const sales = useMemo(() => filterByDateRange(salesRaw, range, (r) => r.date), [salesRaw, range]);
  const purchases = useMemo(
    () => filterByDateRange(purchasesRaw, range, (r) => r.date),
    [purchasesRaw, range],
  );
  const expenses = useMemo(
    () => filterByDateRange(expensesRaw, range, (r) => r.date),
    [expensesRaw, range],
  );
  const ledger = useMemo(
    () => filterByDateRange(ledgerRaw, range, (r) => r.date),
    [ledgerRaw, range],
  );
  const deliveries = useMemo(
    () => filterByDateRange(deliveriesRaw, range, (r) => r.date),
    [deliveriesRaw, range],
  );
  const cylProducts = useMemo(
    () => products.filter((p) => isCylinderProduct(p) || p.uom === "cyl"),
    [products],
  );
  const cylMoveRows = useMemo(
    () =>
      buildCylinderMovementLedger({
        cylinders,
        movements: cylMoves,
        products,
        customers,
        suppliers,
        range,
      })
        .filter(
          (r) =>
            cylProductId === "all" ||
            r.cylinder === (cylProducts.find((p) => p.id === cylProductId)?.name || r.cylinder),
        )
        .filter((r) => cylKind === "all" || r.partyKind === cylKind),
    [
      cylinders,
      cylMoves,
      products,
      customers,
      suppliers,
      range,
      cylProductId,
      cylKind,
      cylProducts,
    ],
  );
  const { data: cylAcc } = useQuery({
    queryKey: ["cylAccountability", cylKind, cylProductId, range, cylStatus],
    queryFn: () =>
      getCylinderAccountabilityFn({
        data: {
          kind: cylKind,
          productId: cylProductId === "all" ? undefined : cylProductId,
          range,
          status: cylStatus,
        },
      }),
  });
  const cylBalRows = cylAcc?.parties ?? [];
  const cylOverdueRows = useMemo(
    () =>
      buildCylinderOverdueRows({ cylinders, movements: cylMoves, products, customers, suppliers })
        .filter((r) => cylKind === "all" || r.partyKind === cylKind)
        .filter(
          (r) =>
            cylProductId === "all" ||
            r.cylinder === (cylProducts.find((p) => p.id === cylProductId)?.name || r.cylinder),
        ),
    [cylinders, cylMoves, products, customers, suppliers, cylKind, cylProductId, cylProducts],
  );

  const productSales = useMemo(() => {
    const map = new Map<string, { productName: string; qty: number; amount: number }>();
    for (const so of sales.filter((s) => s.status !== "cancelled" && s.status !== "draft")) {
      for (const it of so.items) {
        const cur = map.get(it.productId) ?? { productName: it.productName, qty: 0, amount: 0 };
        cur.qty += it.quantity;
        cur.amount += it.price * it.quantity;
        map.set(it.productId, cur);
      }
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [sales]);

  const arRows = useMemo(() => {
    const { rows } = computeCustomerReceivables(customers, sales, vouchersRaw);
    return rows;
  }, [customers, sales, vouchersRaw]);

  const apRows = useMemo(() => {
    const { rows } = computeSupplierPayables(suppliers, purchases, vouchersRaw);
    return rows;
  }, [suppliers, purchases, vouchersRaw]);

  const glRows = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        accountName: string;
        totalDebit: number;
        totalCredit: number;
        balance: number;
        entries: any[];
      }
    >();
    for (const e of ledger) {
      // Treat "in" as Debit, "out" as Credit
      const isDebit = e.direction === "in";
      const debit = isDebit ? e.amount : 0;
      const credit = !isDebit ? e.amount : 0;

      const cur = map.get(e.account) ?? {
        id: e.account,
        accountName: e.account,
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
        entries: [],
      };
      cur.totalDebit += debit;
      cur.totalCredit += credit;
      cur.balance += debit - credit;
      cur.entries.push({ ...e, debit, credit });
      map.set(e.account, cur);
    }
    // Sort entries by date and compute running balance
    for (const acc of map.values()) {
      acc.entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let run = 0;
      for (const ent of acc.entries) {
        run += ent.debit - ent.credit;
        ent.runningBalance = run;
      }
    }
    return [...map.values()];
  }, [ledger]);

  const pnlData = useMemo(() => {
    return computeProfitAndLoss({
      sales,
      stockMovements: stockMovementsRaw,
      expenses,
      vouchers: vouchersRaw,
      range,
    });
  }, [sales, stockMovementsRaw, expenses, vouchersRaw, range]);

  const balanceSheet = useMemo(() => {
    return computeBalanceSheet({
      ledger,
      products,
      costLayers: costLayersRaw,
      customers,
      suppliers,
      sales,
      purchases,
      assets,
      stockMovements: stockMovementsRaw,
      expenses,
      vouchers: vouchersRaw,
      accounts: accountsRaw,
    });
  }, [
    ledger,
    products,
    costLayersRaw,
    customers,
    suppliers,
    sales,
    purchases,
    assets,
    stockMovementsRaw,
    expenses,
    vouchersRaw,
    accountsRaw,
  ]);

  const cashFlow = useMemo(() => {
    return computeCashFlow({ ledger, accounts: accountsRaw, range });
  }, [ledger, accountsRaw, range]);

  const trialBalance = useMemo(() => {
    const rows: { name: string; debit: number; credit: number }[] = [];

    const addRow = (name: string, isDebitNormal: boolean, amount: number) => {
      if (amount === 0) return;
      if (amount > 0) {
        if (isDebitNormal) rows.push({ name, debit: amount, credit: 0 });
        else rows.push({ name, debit: 0, credit: amount });
      } else {
        if (isDebitNormal) rows.push({ name, debit: 0, credit: Math.abs(amount) });
        else rows.push({ name, debit: Math.abs(amount), credit: 0 });
      }
    };

    addRow("Cash in Hand", true, balanceSheet.cash);
    addRow("Cash at Bank", true, balanceSheet.bank);
    addRow("Accounts Receivable", true, balanceSheet.ar);
    addRow("Inventory (Closing Stock)", true, balanceSheet.inventoryValue);
    addRow("Property, Plant & Equipment", true, balanceSheet.fixedAssets);

    addRow("Accounts Payable", false, balanceSheet.ap);
    addRow("Output VAT Liability", false, balanceSheet.outputVat);
    addRow("Owner Capital", false, balanceSheet.ownerCapital);

    addRow("Sales Revenue", false, pnlData.revenue);
    addRow("Cost of Goods Sold", true, pnlData.cogs);

    for (const exp of pnlData.expenseList) {
      addRow(`Expense: ${exp.name}`, true, exp.amount);
    }

    const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
    const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);

    return { rows, totalDebit, totalCredit };
  }, [balanceSheet, pnlData]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.desc")}
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            {t("common.print")}
          </Button>
        }
      />
      <div className="no-print rounded-xl border bg-card/60 p-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="no-print flex flex-wrap gap-2">
        {reports.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={active === r.id ? "default" : "outline"}
            onClick={() => setActive(r.id)}
          >
            {t(r.key)}
          </Button>
        ))}
      </div>

      <Card className="print-sheet">
        <CardContent className="space-y-5 pt-6">
          <PrintDocHeader
            title={t(reports.find((r) => r.id === active)?.key ?? "reports.title")}
            subtitle={
              range.preset === "all"
                ? t("filter.all")
                : `${range.from ? formatDate(range.from) : "—"} – ${range.to ? formatDate(range.to) : "—"}`
            }
          />
          {active === "sales" && (
            <DataTable
              rows={sales}
              searchKeys={["orderNo", "customerName"]}
              columns={[
                { key: "no", header: t("sales.orderNo"), render: (r) => r.orderNo },
                { key: "date", header: t("common.date"), render: (r) => formatDate(r.date) },
                {
                  key: "cust",
                  header: t("common.customer"),
                  render: (r) => (
                    <PartyNameLink kind="customer" id={r.customerId} name={r.customerName} />
                  ),
                },
                {
                  key: "total",
                  header: t("common.total"),
                  render: (r) => formatCurrency(r.total),
                  className: "text-right",
                },
                { key: "st", header: t("common.status"), render: (r) => r.status },
              ]}
            />
          )}
          {active === "purchase" && (
            <DataTable
              rows={purchases}
              searchKeys={["orderNo", "supplierName"]}
              columns={[
                { key: "no", header: t("purchases.poNo"), render: (r) => r.orderNo },
                { key: "date", header: t("common.date"), render: (r) => formatDate(r.date) },
                {
                  key: "sup",
                  header: t("common.supplier"),
                  render: (r) => (
                    <PartyNameLink kind="supplier" id={r.supplierId} name={r.supplierName} />
                  ),
                },
                {
                  key: "total",
                  header: t("common.total"),
                  render: (r) => formatCurrency(r.total),
                  className: "text-right",
                },
                { key: "st", header: t("common.status"), render: (r) => r.status },
              ]}
            />
          )}
          {active === "stock" && <StockReport range={range} />}
          {active === "cylinder" && <CylinderLedger range={range} />}
          {(active === "cylMove" || active === "cylBal" || active === "cylOverdue") && (
            <div className="no-print mb-3 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("reports.partyFilter")}</Label>
                <Select value={cylKind} onValueChange={(v) => setCylKind(v as typeof cylKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("filter.all")}</SelectItem>
                    <SelectItem value="customer">{t("common.customer")}</SelectItem>
                    <SelectItem value="supplier">{t("common.supplier")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("reports.cylType")}</Label>
                <Select value={cylProductId} onValueChange={setCylProductId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("filter.all")}</SelectItem>
                    {cylProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {active === "cylBal" && (
                <div className="space-y-1.5">
                  <Label>{t("reports.cylStatus")}</Label>
                  <Select
                    value={cylStatus}
                    onValueChange={(v) => setCylStatus(v as CylinderBalanceStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filter.all")}</SelectItem>
                      <SelectItem value="outstanding">
                        {t("reports.cylStatus.outstanding")}
                      </SelectItem>
                      <SelectItem value="overdue">{t("reports.cylStatus.overdue")}</SelectItem>
                      <SelectItem value="lost">{t("reports.cylStatus.lost")}</SelectItem>
                      <SelectItem value="damaged">{t("reports.cylStatus.damaged")}</SelectItem>
                      <SelectItem value="refill">{t("reports.cylStatus.refill")}</SelectItem>
                      <SelectItem value="full">{t("reports.cylStatus.full")}</SelectItem>
                      <SelectItem value="empty">{t("reports.cylStatus.empty")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {active === "cylMove" && (
            <DataTable
              rows={cylMoveRows}
              searchKeys={["party", "cylinder", "from", "to"]}
              dateKey="date"
              columns={[
                {
                  key: "date",
                  header: t("common.date"),
                  sortable: true,
                  sortValue: (r) => r.date,
                  render: (r) => formatDate(r.date),
                },
                {
                  key: "party",
                  header: t("inventory.party"),
                  sortable: true,
                  sortValue: (r) => r.party,
                  render: (r) => r.party,
                },
                { key: "mv", header: t("inventory.txn"), render: (r) => t(r.movementKey as any) },
                { key: "cyl", header: t("reports.cylType"), render: (r) => r.cylinder },
                {
                  key: "qty",
                  header: t("common.quantity"),
                  render: (r) => r.qty,
                  className: "text-right",
                },
                { key: "from", header: t("reports.from"), render: (r) => r.from },
                { key: "to", header: t("reports.to"), render: (r) => r.to },
              ]}
            />
          )}
          {active === "cylBal" && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("customers.cylRemainingHint")}
              </p>
              <DataTable
                rows={cylBalRows}
                searchKeys={["partner"]}
                columns={[
                  {
                    key: "p",
                    header: t("reports.partner"),
                    sortable: true,
                    sortValue: (r) => r.partner,
                    render: (r) => r.partner,
                  },
                  {
                    key: "sent",
                    header: t("customers.cylSent"),
                    render: (r) => r.sent,
                    className: "text-right",
                  },
                  {
                    key: "ret",
                    header: t("customers.cylReturned"),
                    render: (r) => r.returned,
                    className: "text-right",
                  },
                  {
                    key: "rem",
                    header: t("customers.cylRemaining"),
                    render: (r) => r.remaining,
                    className: "text-right",
                  },
                  {
                    key: "od",
                    header: t("customers.cylOverdue"),
                    render: (r) => r.overdue,
                    className: "text-right",
                  },
                  {
                    key: "lost",
                    header: t("customers.cylLost"),
                    render: (r) => r.lost,
                    className: "text-right",
                  },
                  {
                    key: "dmg",
                    header: t("customers.cylDamaged"),
                    render: (r) => r.damaged,
                    className: "text-right",
                  },
                ]}
              />
            </>
          )}
          {active === "cylOverdue" && (
            <DataTable
              rows={cylOverdueRows}
              searchKeys={["party", "cylinder"]}
              columns={[
                { key: "party", header: t("inventory.party"), render: (r) => r.party },
                { key: "cyl", header: t("reports.cylType"), render: (r) => r.cylinder },
                {
                  key: "sent",
                  header: t("reports.sentDate"),
                  render: (r) => formatDate(r.sentDate),
                },
                {
                  key: "exp",
                  header: t("inventory.expectedReturn"),
                  render: (r) => formatDate(r.expectedReturn),
                },
                {
                  key: "days",
                  header: t("reports.daysOverdue"),
                  render: (r) => r.daysOverdue,
                  className: "text-right",
                },
                {
                  key: "qty",
                  header: t("common.quantity"),
                  render: (r) => r.quantity,
                  className: "text-right",
                },
              ]}
            />
          )}
          {active === "ar" && (
            <DataTable
              rows={arRows}
              searchKeys={["customerName"]}
              columns={[
                {
                  key: "cust",
                  header: t("common.customer"),
                  render: (r) => <PartyNameLink kind="customer" id={r.id} name={r.customerName} />,
                },
                {
                  key: "orders",
                  header: t("sales.title"),
                  render: (r) => (
                    <span className="text-muted-foreground text-sm">
                      {r.orders.length} {t("sales.title")}
                    </span>
                  ),
                },
                {
                  key: "due",
                  header: t("common.due"),
                  render: (r) => <span className="font-medium">{formatCurrency(r.due)}</span>,
                  className: "text-right",
                },
              ]}
              renderSubComponent={(r) => (
                <div className="bg-muted/30 p-4 pl-12 rounded-b-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left">
                        <th className="pb-2 font-medium">{t("sales.orderNo")}</th>
                        <th className="pb-2 font-medium">{t("common.date")}</th>
                        <th className="pb-2 font-medium text-right">{t("common.due")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.orders.map((o) => (
                        <tr key={o.id} className="border-b last:border-0">
                          <td className="py-2">{o.orderNo}</td>
                          <td className="py-2">{formatDate(o.date)}</td>
                          <td className="py-2 text-right">{formatCurrency(o.due)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            />
          )}
          {active === "ap" && (
            <DataTable
              rows={apRows}
              searchKeys={["supplierName"]}
              columns={[
                {
                  key: "sup",
                  header: t("common.supplier"),
                  render: (r) => <PartyNameLink kind="supplier" id={r.id} name={r.supplierName} />,
                },
                {
                  key: "orders",
                  header: t("purchases.title"),
                  render: (r) => (
                    <span className="text-muted-foreground text-sm">
                      {r.orders.length} {t("purchases.title")}
                    </span>
                  ),
                },
                {
                  key: "due",
                  header: t("common.due"),
                  render: (r) => <span className="font-medium">{formatCurrency(r.due)}</span>,
                  className: "text-right",
                },
              ]}
              renderSubComponent={(r) => (
                <div className="bg-muted/30 p-4 pl-12 rounded-b-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left">
                        <th className="pb-2 font-medium">{t("purchases.poNo")}</th>
                        <th className="pb-2 font-medium">{t("common.date")}</th>
                        <th className="pb-2 font-medium text-right">{t("common.due")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.orders.map((o) => (
                        <tr key={o.id} className="border-b last:border-0">
                          <td className="py-2">{o.orderNo}</td>
                          <td className="py-2">{formatDate(o.date)}</td>
                          <td className="py-2 text-right">{formatCurrency(o.due)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            />
          )}
          {active === "cash" && (
            <DataTable
              rows={ledger.filter((e) => e.account === "cash")}
              searchKeys={["notes", "category"]}
              columns={[
                { key: "date", header: t("common.date"), render: (r) => formatDate(r.date) },
                { key: "cat", header: t("accounting.category"), render: (r) => r.category },
                { key: "dir", header: t("accounting.dir"), render: (r) => r.direction },
                {
                  key: "amt",
                  header: t("common.amount"),
                  render: (r) => formatCurrency(r.amount),
                  className: "text-right",
                },
              ]}
            />
          )}
          {active === "bank" && (
            <DataTable
              rows={ledger.filter((e) => e.account === "bank")}
              searchKeys={["notes", "category"]}
              columns={[
                { key: "date", header: t("common.date"), render: (r) => formatDate(r.date) },
                { key: "cat", header: t("accounting.category"), render: (r) => r.category },
                { key: "dir", header: t("accounting.dir"), render: (r) => r.direction },
                {
                  key: "amt",
                  header: t("common.amount"),
                  render: (r) => formatCurrency(r.amount),
                  className: "text-right",
                },
              ]}
            />
          )}
          {active === "gl" && (
            <DataTable
              rows={glRows}
              searchKeys={["accountName"]}
              columns={[
                {
                  key: "acc",
                  header: t("common.account"),
                  render: (r) => <span className="font-medium capitalize">{r.accountName}</span>,
                },
                {
                  key: "dr",
                  header: "Total Debit",
                  render: (r) => formatCurrency(r.totalDebit),
                  className: "text-right",
                },
                {
                  key: "cr",
                  header: "Total Credit",
                  render: (r) => formatCurrency(r.totalCredit),
                  className: "text-right",
                },
                {
                  key: "bal",
                  header: "Balance",
                  render: (r) => <span className="font-medium">{formatCurrency(r.balance)}</span>,
                  className: "text-right",
                },
              ]}
              renderSubComponent={(r) => (
                <div className="bg-muted/30 p-4 pl-12 rounded-b-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left">
                        <th className="pb-2 font-medium">{t("common.date")}</th>
                        <th className="pb-2 font-medium">Doc/Ref</th>
                        <th className="pb-2 font-medium">{t("common.notes")}</th>
                        <th className="pb-2 font-medium text-right">Debit</th>
                        <th className="pb-2 font-medium text-right">Credit</th>
                        <th className="pb-2 font-medium text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.entries.map((ent) => (
                        <tr key={ent.id} className="border-b last:border-0">
                          <td className="py-2 whitespace-nowrap">{formatDate(ent.date)}</td>
                          <td className="py-2">
                            {ent.refId ? `${ent.refType}: ${ent.refId.substring(0, 8)}` : "—"}
                          </td>
                          <td className="py-2">{ent.notes || ent.category}</td>
                          <td className="py-2 text-right">
                            {ent.debit ? formatCurrency(ent.debit) : "—"}
                          </td>
                          <td className="py-2 text-right">
                            {ent.credit ? formatCurrency(ent.credit) : "—"}
                          </td>
                          <td className="py-2 text-right font-medium">
                            {formatCurrency(ent.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            />
          )}
          {active === "pnl" && (
            <div className="mx-auto max-w-3xl border border-muted p-8 rounded bg-card/40">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold uppercase tracking-wider">{t("reports.pnl")}</h2>
                <p className="text-muted-foreground">
                  {range.from ? formatDate(range.from) : ""} -{" "}
                  {range.to ? formatDate(range.to) : "Today"}
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {/* REVENUE */}
                  <tr>
                    <td
                      colSpan={2}
                      className="font-bold uppercase pb-2 pt-4 border-b border-muted text-primary"
                    >
                      Revenue
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pl-4 text-muted-foreground">Sales Revenue</td>
                    <td className="py-3 text-right">{formatCurrency(pnlData.revenue)}</td>
                  </tr>
                  <tr className="border-t border-muted/50">
                    <td className="py-3 font-bold uppercase">Total Revenue</td>
                    <td className="py-3 text-right font-bold">{formatCurrency(pnlData.revenue)}</td>
                  </tr>

                  {/* COST OF SALES */}
                  <tr>
                    <td
                      colSpan={2}
                      className="font-bold uppercase pb-2 pt-8 border-b border-muted text-primary"
                    >
                      Cost of Sales
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pl-4 text-muted-foreground">Cost of Goods Sold</td>
                    <td className="py-3 text-right">{formatCurrency(pnlData.cogs)}</td>
                  </tr>
                  <tr className="border-t border-muted/50">
                    <td className="py-3 font-bold uppercase">Total Cost of Sales</td>
                    <td className="py-3 text-right font-bold">{formatCurrency(pnlData.cogs)}</td>
                  </tr>

                  {/* GROSS PROFIT */}
                  <tr className="border-t-2 border-b-2 border-primary/30 bg-muted/10">
                    <td className="py-4 font-bold uppercase">Gross Profit</td>
                    <td className="py-4 text-right font-bold text-[15px]">
                      {formatCurrency(pnlData.grossProfit)}
                    </td>
                  </tr>

                  {/* EXPENSES */}
                  <tr>
                    <td
                      colSpan={2}
                      className="font-bold uppercase pb-2 pt-8 border-b border-muted text-primary"
                    >
                      Expenses
                    </td>
                  </tr>
                  {pnlData.expenseList.length === 0 ? (
                    <tr>
                      <td className="py-3 pl-4 italic text-muted-foreground">
                        No expenses recorded
                      </td>
                      <td className="py-3 text-right">—</td>
                    </tr>
                  ) : (
                    pnlData.expenseList.map((exp, i) => (
                      <tr key={i} className="border-b border-muted/20 last:border-0">
                        <td className="py-2.5 pl-4 text-muted-foreground">{exp.name}</td>
                        <td className="py-2.5 text-right">{formatCurrency(exp.amount)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="border-t border-muted/50">
                    <td className="py-3 font-bold uppercase">Total Expenses</td>
                    <td className="py-3 text-right font-bold">
                      {formatCurrency(pnlData.totalExpenses)}
                    </td>
                  </tr>

                  {/* NET PROFIT */}
                  <tr className="border-t-4 border-b-[6px] border-double border-primary/40 bg-muted/20">
                    <td className="py-5 font-bold uppercase text-base">
                      Net Profit (Loss) Before Tax
                    </td>
                    <td
                      className={`py-5 text-right font-bold text-lg ${pnlData.netProfit < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                    >
                      {formatCurrency(pnlData.netProfit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {active === "balanceSheet" && (
            <div className="mx-auto max-w-3xl border border-muted p-8 rounded bg-card/40">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold uppercase tracking-wider">
                  {t("reports.balanceSheet")}
                </h2>
                <p className="text-muted-foreground">
                  {range.from ? formatDate(range.from) : ""} -{" "}
                  {range.to ? formatDate(range.to) : "Today"}
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {/* ASSETS */}
                  <tr>
                    <td
                      colSpan={2}
                      className="font-bold uppercase pb-2 pt-4 border-b border-muted text-primary"
                    >
                      Assets
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="py-2 pl-2 font-medium">
                      Current Assets
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">Cash in Hand</td>
                    <td className="py-1.5 text-right">{formatCurrency(balanceSheet.cash)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">Cash at Bank</td>
                    <td className="py-1.5 text-right">{formatCurrency(balanceSheet.bank)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">Accounts Receivable</td>
                    <td className="py-1.5 text-right">{formatCurrency(balanceSheet.ar)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">Inventory (Closing Stock)</td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(balanceSheet.inventoryValue)}
                    </td>
                  </tr>
                  <tr className="border-t border-muted/30">
                    <td className="py-2 pl-4 font-semibold text-muted-foreground">
                      Total Current Assets
                    </td>
                    <td className="py-2 text-right font-semibold text-muted-foreground">
                      {formatCurrency(balanceSheet.currentAssets)}
                    </td>
                  </tr>

                  <tr>
                    <td colSpan={2} className="py-2 pl-2 font-medium pt-4">
                      Non-Current Assets
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">
                      Property, Plant & Equipment (Fixed Assets)
                    </td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(balanceSheet.fixedAssets)}
                    </td>
                  </tr>

                  <tr className="border-t-2 border-b-2 border-primary/30 bg-muted/10">
                    <td className="py-4 font-bold uppercase">Total Assets</td>
                    <td className="py-4 text-right font-bold text-[15px]">
                      {formatCurrency(balanceSheet.totalAssets)}
                    </td>
                  </tr>

                  {/* LIABILITIES */}
                  <tr>
                    <td
                      colSpan={2}
                      className="font-bold uppercase pb-2 pt-8 border-b border-muted text-primary"
                    >
                      Liabilities
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="py-2 pl-2 font-medium">
                      Current Liabilities
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">Accounts Payable</td>
                    <td className="py-1.5 text-right">{formatCurrency(balanceSheet.ap)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">
                      Output VAT (Tax Liability)
                    </td>
                    <td className="py-1.5 text-right">{formatCurrency(balanceSheet.outputVat)}</td>
                  </tr>
                  <tr className="border-t border-muted/50">
                    <td className="py-3 font-bold uppercase">Total Liabilities</td>
                    <td className="py-3 text-right font-bold">
                      {formatCurrency(balanceSheet.totalLiabilities)}
                    </td>
                  </tr>

                  {/* EQUITY */}
                  <tr>
                    <td
                      colSpan={2}
                      className="font-bold uppercase pb-2 pt-8 border-b border-muted text-primary"
                    >
                      Owners Equity
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">Owner Capital</td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(balanceSheet.ownerCapital)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pl-6 text-muted-foreground">
                      Retained Earnings (Net Profit)
                    </td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(balanceSheet.retainedEarnings)}
                    </td>
                  </tr>
                  <tr className="border-t border-muted/50">
                    <td className="py-3 font-bold uppercase">Total Owners Equity</td>
                    <td className="py-3 text-right font-bold">
                      {formatCurrency(balanceSheet.totalEquity)}
                    </td>
                  </tr>

                  {/* TOTAL LIABILITIES & EQUITY */}
                  <tr className="border-t-4 border-b-[6px] border-double border-primary/40 bg-muted/20">
                    <td className="py-5 font-bold uppercase text-base">
                      Total Liabilities & Equities
                    </td>
                    <td className="py-5 text-right font-bold text-[15px]">
                      {formatCurrency(balanceSheet.totalLiabilitiesAndEquity)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {active === "cashFlow" && (
            <div className="mx-auto max-w-3xl border border-muted p-8 rounded bg-card/40">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold uppercase tracking-wider">
                  {t("reports.cashFlow")}
                </h2>
                <p className="text-muted-foreground">
                  {range.from ? formatDate(range.from) : ""} -{" "}
                  {range.to ? formatDate(range.to) : "Today"}
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {/* BEGINNING CASH */}
                  <tr className="border-b border-muted/50">
                    <td className="py-3 font-semibold text-muted-foreground uppercase">
                      Beginning Cash & Bank Balance
                    </td>
                    <td className="py-3 text-right font-semibold">
                      {formatCurrency(cashFlow.openingCash)}
                    </td>
                  </tr>

                  {/* OPERATING ACTIVITIES */}
                  <tr>
                    <td colSpan={2} className="font-bold uppercase pb-2 pt-6 text-primary">
                      Cash Flow from Operating Activities
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">
                      Cash receipts from customers
                    </td>
                    <td className="py-2 text-right">{formatCurrency(cashFlow.customerReceipts)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">Cash paid to suppliers</td>
                    <td className="py-2 text-right">
                      ({formatCurrency(cashFlow.supplierPayments)})
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">
                      Cash paid for operating expenses
                    </td>
                    <td className="py-2 text-right">
                      ({formatCurrency(cashFlow.operatingExpenses)})
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">
                      Cash paid for salaries & payroll
                    </td>
                    <td className="py-2 text-right">
                      ({formatCurrency(cashFlow.payrollPayments)})
                    </td>
                  </tr>
                  <tr className="border-t border-muted/30">
                    <td className="py-2 pl-4 font-semibold text-muted-foreground">
                      Net cash from operating activities
                    </td>
                    <td
                      className={`py-2 text-right font-semibold ${cashFlow.netOperating < 0 ? "text-destructive" : ""}`}
                    >
                      {formatCurrency(cashFlow.netOperating)}
                    </td>
                  </tr>

                  {/* INVESTING ACTIVITIES */}
                  <tr>
                    <td colSpan={2} className="font-bold uppercase pb-2 pt-6 text-primary">
                      Cash Flow from Investing Activities
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">
                      Purchase of property, plant & equipment
                    </td>
                    <td className="py-2 text-right">({formatCurrency(cashFlow.assetPurchases)})</td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">
                      Proceeds from sale of assets
                    </td>
                    <td className="py-2 text-right">{formatCurrency(cashFlow.assetSales)}</td>
                  </tr>
                  <tr className="border-t border-muted/30">
                    <td className="py-2 pl-4 font-semibold text-muted-foreground">
                      Net cash from investing activities
                    </td>
                    <td
                      className={`py-2 text-right font-semibold ${cashFlow.netInvesting < 0 ? "text-destructive" : ""}`}
                    >
                      {formatCurrency(cashFlow.netInvesting)}
                    </td>
                  </tr>

                  {/* FINANCING ACTIVITIES */}
                  <tr>
                    <td colSpan={2} className="font-bold uppercase pb-2 pt-6 text-primary">
                      Cash Flow from Financing Activities
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">Owner capital contributions</td>
                    <td className="py-2 text-right">
                      {formatCurrency(cashFlow.capitalContributions)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pl-6 text-muted-foreground">Owner drawings</td>
                    <td className="py-2 text-right">({formatCurrency(cashFlow.ownerDrawings)})</td>
                  </tr>
                  <tr className="border-t border-muted/30">
                    <td className="py-2 pl-4 font-semibold text-muted-foreground">
                      Net cash from financing activities
                    </td>
                    <td
                      className={`py-2 text-right font-semibold ${cashFlow.netFinancing < 0 ? "text-destructive" : ""}`}
                    >
                      {formatCurrency(cashFlow.netFinancing)}
                    </td>
                  </tr>

                  {/* NET CHANGE & ENDING */}
                  <tr className="border-t-2 border-primary/30 bg-muted/10">
                    <td className="py-3.5 font-bold uppercase text-base text-primary">
                      Net Increase / (Decrease) in Cash
                    </td>
                    <td
                      className={`py-3.5 text-right font-bold text-base ${cashFlow.netCashFlow < 0 ? "text-destructive" : "text-primary"}`}
                    >
                      {cashFlow.netCashFlow < 0
                        ? `(${formatCurrency(Math.abs(cashFlow.netCashFlow))})`
                        : formatCurrency(cashFlow.netCashFlow)}
                    </td>
                  </tr>
                  <tr className="border-t-4 border-b-[6px] border-double border-primary/40 bg-muted/20">
                    <td className="py-4 font-bold uppercase text-base">
                      Ending Cash & Bank Balance
                    </td>
                    <td className="py-4 text-right font-bold text-lg text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(cashFlow.closingCash)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {active === "trialBalance" && (
            <div className="mx-auto max-w-3xl border border-muted p-8 rounded bg-card/40">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold uppercase tracking-wider">
                  {t("reports.trialBalance")}
                </h2>
                <p className="text-muted-foreground">
                  {range.from ? formatDate(range.from) : ""} -{" "}
                  {range.to ? formatDate(range.to) : "Today"}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-muted">
                    <th className="py-2 text-left font-bold uppercase">Account Name</th>
                    <th className="py-2 text-right font-bold uppercase w-32">Debit</th>
                    <th className="py-2 text-right font-bold uppercase w-32">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.rows.map((row, i) => (
                    <tr key={i} className="border-b border-muted/20 last:border-0">
                      <td className="py-2.5">{row.name}</td>
                      <td className="py-2.5 text-right">
                        {row.debit > 0 ? formatCurrency(row.debit) : ""}
                      </td>
                      <td className="py-2.5 text-right">
                        {row.credit > 0 ? formatCurrency(row.credit) : ""}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-b-4 border-double border-primary/40 bg-muted/20">
                    <td className="py-5 font-bold uppercase text-base">Totals</td>
                    <td className="py-5 text-right font-bold text-base">
                      {formatCurrency(trialBalance.totalDebit)}
                    </td>
                    <td className="py-5 text-right font-bold text-base">
                      {formatCurrency(trialBalance.totalCredit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {active === "expense" && (
            <DataTable
              rows={expenses}
              searchKeys={["category", "description"]}
              columns={[
                { key: "date", header: t("common.date"), render: (r) => formatDate(r.date) },
                { key: "cat", header: t("common.category"), render: (r) => r.category },
                { key: "desc", header: t("common.description"), render: (r) => r.description },
                {
                  key: "amt",
                  header: t("common.amount"),
                  render: (r) => formatCurrency(r.amount),
                  className: "text-right",
                },
              ]}
            />
          )}
          {active === "delivery" && (
            <DataTable
              rows={deliveries}
              searchKeys={["challanNo", "vehicleNo", "driverName"]}
              columns={[
                { key: "no", header: t("deliveries.challanNo"), render: (r) => r.challanNo },
                { key: "veh", header: t("deliveries.vehicle"), render: (r) => r.vehicleNo },
                { key: "drv", header: t("deliveries.driver"), render: (r) => r.driverName },
                { key: "st", header: t("common.status"), render: (r) => r.status },
              ]}
            />
          )}
          {active === "product" && (
            <DataTable
              rows={productSales}
              searchKeys={["productName"]}
              columns={[
                { key: "name", header: t("common.product"), render: (r) => r.productName },
                {
                  key: "qty",
                  header: t("reports.qtySold"),
                  render: (r) => r.qty,
                  className: "text-right",
                },
                {
                  key: "amt",
                  header: t("common.amount"),
                  render: (r) => formatCurrency(r.amount),
                  className: "text-right",
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
