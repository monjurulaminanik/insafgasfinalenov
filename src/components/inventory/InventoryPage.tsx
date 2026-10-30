import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Cylinder, Package, RefreshCw, ShoppingCart, Truck, Warehouse, Flame } from "lucide-react";
import { productService } from "@/services/product.service";
import { inventoryService } from "@/services/inventory.service";
import { cylinderService } from "@/services/cylinder.service";
import { salesService } from "@/services/sales.service";
import { deliveryService } from "@/services/delivery.service";
import { supplierService } from "@/services/supplier.service";
import { customerService } from "@/services/customer.service";
import { getCylinderTrackingFn } from "@/lib/settings.functions";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { StatCard } from "@/components/dashboard/widgets/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate, formatDateTime } from "@/utils/formatters";
import { buildProductInventory, sumInventory } from "@/lib/cylinder-inventory";
import { buildStockReport, isMovementIn, isMovementOut } from "@/lib/stock-report";
import { EMPTY_DATE_RANGE } from "@/lib/date-range";
import { partyCylinderBalance } from "@/lib/customer-cylinders";
import type { CylinderInventory, GasInventory, ProductInventory, StockMovement, UnitOfMeasure } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT, type MessageKey } from "@/i18n";

type ActivityRow = StockMovement & {
  txn: string;
  fullIn: number;
  fullOut: number;
  emptyIn: number;
  refill: number;
  party: string;
};

function inventoryUnitLabel(uom: UnitOfMeasure | undefined, t: (key: MessageKey) => string) {
  if (uom === "kg") return t("inventory.unitKg");
  if (uom === "ltr") return t("inventory.unitLtr");
  if (uom === "cyl") return t("inventory.unitCyl");
  if (uom === "pcs") return t("inventory.unitPcs");
  return uom || "";
}

function activityFromMovement(m: StockMovement): ActivityRow {
  const isRefill = m.refType === "refill" || /refill/i.test(m.notes || "");
  const isEmpty = /empty/i.test(m.notes || "");
  const txn = isRefill
    ? "refill"
    : isEmpty
      ? "empty_return"
      : m.refType === "purchase"
        ? "purchase"
        : m.refType === "sales"
          ? "sales"
          : m.refType === "delivery"
            ? "delivery"
            : "adjustment";
  const qty = Number(m.quantity) || 0;
  const inbound = m.type === "in" || m.type === "return";
  return {
    ...m,
    txn,
    fullIn: inbound && !isEmpty && !isRefill ? qty : 0,
    fullOut: m.type === "out" ? qty : 0,
    emptyIn: inbound && isEmpty ? qty : 0,
    refill: isRefill ? qty : 0,
    party: m.notes?.split("·")[0] || "—",
  };
}

export function InventoryPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { tab: currentSearchTab = "gas" } = useRouterState({
    select: (r) => (r.location.search as { tab?: string }) || {},
  });
  const activeTab = currentSearchTab || "gas";

  const { data: gasInventory = [] } = useQuery({
    queryKey: ["gasInventory"],
    queryFn: inventoryService.getGasInventory,
  });
  const { data: cylinderInventory = [] } = useQuery({
    queryKey: ["cylinderInventory"],
    queryFn: inventoryService.getCylinderInventory,
  });
  const { data: productInventory = [] } = useQuery({
    queryKey: ["productInventory"],
    queryFn: inventoryService.getProductInventory,
  });

  const gasRows = useMemo(
    () => gasInventory.map((r, i) => ({ ...r, sl: i + 1 })),
    [gasInventory],
  );
  const cylinderRows = useMemo(
    () => cylinderInventory.map((r, i) => ({ ...r, sl: i + 1 })),
    [cylinderInventory],
  );
  const productRows = useMemo(
    () => productInventory.map((r, i) => ({ ...r, sl: i + 1 })),
    [productInventory],
  );
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: cylMoves = [] } = useQuery({
    queryKey: ["cylinderMovements"],
    queryFn: cylinderService.listMovements,
  });
  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: deliveries = [] } = useQuery({
    queryKey: ["deliveries"],
    queryFn: deliveryService.list,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: tracking = "serial" } = useQuery({
    queryKey: ["cylinderTracking"],
    queryFn: () => getCylinderTrackingFn(),
  });

  const rows = useMemo(
    () => buildProductInventory(products, cylinders, sales, deliveries, movements),
    [products, cylinders, sales, deliveries, movements],
  );

  const totals = useMemo(() => sumInventory(rows), [rows]);

  const summaryCards = useMemo(() => {
    let delivery = 0;
    let returned = 0;
    for (const c of customers) {
      const b = partyCylinderBalance("customer", c.id, cylinders, cylMoves);
      delivery += b.sent;
      returned += b.returned;
    }
    let received = 0;
    for (const m of movements) {
      if (isMovementIn(m) && m.refType === "purchase") {
        const p = products.find((x) => x.id === m.productId);
        const isCyl =
          m.productType === "cylinder" ||
          p?.productType === "cylinder" ||
          (p?.uom === "cyl" && p?.productType !== "gas");
        if (isCyl) received += Math.abs(m.quantity || 0);
      }
    }
    if (received === 0) {
      for (const m of cylMoves) {
        if (m.type === "received") received += 1;
      }
    }
    const cylinderOnHand = cylinderInventory.reduce((sum, c) => sum + (c.onHand || 0), 0);
    const cylinderAvailable = cylinderInventory.reduce((sum, c) => sum + (c.available || 0), 0);
    const cylinderReserved = cylinderInventory.reduce((sum, c) => sum + (c.reserved || 0), 0);

    return {
      received,
      delivery,
      cylinder: cylinderOnHand,
      returned,
      reserved: cylinderReserved,
      available: cylinderAvailable,
    };
  }, [customers, cylinders, cylMoves, movements, products, cylinderInventory]);

  const activity = useMemo(
    () =>
      movements
        .map(activityFromMovement)
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [movements],
  );

  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [type, setType] = useState<
    | "in"
    | "out"
    | "adjust"
    | "refill"
    | "customer_sent"
    | "return_empty"
    | "send_supplier"
    | "receive_supplier"
    | "loan"
    | "mark_lost"
    | "mark_damaged"
    | "repair"
    | "scrap"
    | "writeoff"
    | "sell_cylinder"
    | "exchange"
  >("in");
  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [partyKind, setPartyKind] = useState<"customer" | "supplier" | "warehouse">("customer");
  const [sendDate, setSendDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedReturn, setExpectedReturn] = useState("");
  const [condition, setCondition] = useState<"full" | "empty" | "damaged">("full");
  const [reason, setReason] = useState("");
  const [penalty, setPenalty] = useState("0");
  const [treatment, setTreatment] = useState<"charge" | "writeoff" | "none">("none");
  const [lotNumber, setLotNumber] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["gasInventory"] });
    qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
    qc.invalidateQueries({ queryKey: ["productInventory"] });
    qc.invalidateQueries({ queryKey: ["inventorySummary"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stockMovements"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["cylinders"] });
    qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["cylAccountability"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
  };

  const adjust = useMutation({
    mutationFn: async () => {
      if (type === "refill")
        return inventoryService.completeRefill(
          productId,
          Number(qty),
          notes || "Warehouse",
          sendDate || undefined,
        );
      if (type === "send_supplier") {
        return inventoryService.sendToSupplier({
          supplierId,
          productId,
          quantity: Number(qty),
          date: sendDate,
          expectedReturnDate: expectedReturn || undefined,
          notes,
        });
      }
      if (type === "receive_supplier") {
        return inventoryService.receiveFromSupplier({
          supplierId,
          productId,
          quantity: Number(qty),
          condition,
          notes,
        });
      }
      if (type === "customer_sent") {
        return inventoryService.sendToCustomer({
          customerId,
          productId,
          quantity: Number(qty),
          lotNumber: lotNumber || undefined,
          notes,
          expectedReturnDate: expectedReturn || undefined,
        });
      }
      if (type === "exchange") {
        return inventoryService.exchangeWithCustomer({
          customerId,
          productId,
          quantity: Number(qty),
          lotNumber: lotNumber || undefined,
          notes,
          expectedReturnDate: expectedReturn || undefined,
        });
      }
      if (type === "return_empty")
        return inventoryService.returnEmpty({
          customerId,
          productId,
          quantity: Number(qty),
          notes,
        });
      if (type === "loan") {
        return inventoryService.loanToCustomer({
          customerId,
          productId,
          quantity: Number(qty),
          issueDate: sendDate,
          expectedReturnDate: expectedReturn || undefined,
          notes,
        });
      }
      if (type === "mark_lost") {
        const partyId =
          partyKind === "customer" ? customerId : partyKind === "supplier" ? supplierId : "";
        if (partyKind !== "warehouse" && !partyId) {
          throw new Error(t("common.select"));
        }
        return inventoryService.markLost({
          partyKind,
          partyId,
          productId,
          quantity: Number(qty),
          lostDate: sendDate,
          reason,
          penaltyAmount: Number(penalty) || 0,
          accountingTreatment: treatment,
        });
      }
      if (type === "mark_damaged")
        return inventoryService.markDamaged(productId, Number(qty), notes);
      if (type === "repair" || type === "scrap" || type === "writeoff") {
        return inventoryService.resolveDamage(productId, Number(qty), type, notes);
      }
      if (type === "sell_cylinder")
        return inventoryService.sellCylinders({
          customerId,
          productId,
          quantity: Number(qty),
          notes,
        });
      return inventoryService.adjust(productId, Number(qty), type, notes);
    },
    onSuccess: () => {
      invalidate();
      setAdjustOpen(false);
      toast.success(
        type === "refill"
          ? t("inventory.refilled")
          : type === "send_supplier"
            ? t("inventory.sentSupplier")
            : type === "receive_supplier"
              ? t("inventory.receivedSupplier")
              : type === "mark_lost"
                ? t("status.lost")
                : t("inventory.updated"),
      );
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openActivity = (row: ActivityRow) => {
    if (row.refType === "sales" && row.refId)
      navigate({ to: "/sales/$id", params: { id: row.refId } });
    else if (row.refType === "delivery" && row.refId)
      navigate({ to: "/deliveries/$id", params: { id: row.refId } });
    else if (row.refType === "purchase" && row.refId)
      navigate({ to: "/purchases/$id", params: { id: row.refId } });
  };

  const getPageTitle = () => {
    if (activeTab === "gas") return t("inventory.gasTitle");
    if (activeTab === "cylinder") return t("inventory.cylTitle");
    if (activeTab === "product") return t("inventory.prodTitle");
    return t("inventory.summaryTitle");
  };

  const getPageDesc = () => {
    if (activeTab === "gas") return t("inventory.gasDesc");
    if (activeTab === "cylinder") return t("inventory.cylDesc");
    if (activeTab === "product") return t("inventory.prodDesc");
    return t("inventory.summaryDesc");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={getPageTitle()}
        description={getPageDesc()}
        actions={
          <Button type="button" onClick={() => setAdjustOpen(true)}>
            {t("inventory.adjust")}
          </Button>
        }
      />

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Button
          type="button"
          variant={activeTab === "gas" ? "default" : "outline"}
          size="sm"
          onClick={() => navigate({ to: "/inventory", search: { tab: "gas" } })}
        >
          <Flame className="mr-1.5 h-3.5 w-3.5" />
          {t("nav.gasInventory")}
        </Button>
        <Button
          type="button"
          variant={activeTab === "cylinder" ? "default" : "outline"}
          size="sm"
          onClick={() => navigate({ to: "/inventory", search: { tab: "cylinder" } })}
        >
          <Cylinder className="mr-1.5 h-3.5 w-3.5" />
          {t("nav.cylinderInventory")}
        </Button>
        <Button
          type="button"
          variant={activeTab === "product" ? "default" : "outline"}
          size="sm"
          onClick={() => navigate({ to: "/inventory", search: { tab: "product" } })}
        >
          <Package className="mr-1.5 h-3.5 w-3.5" />
          {t("nav.productInventory")}
        </Button>
        <Button
          type="button"
          variant={activeTab === "summary" ? "default" : "outline"}
          size="sm"
          onClick={() => navigate({ to: "/inventory", search: { tab: "summary" } })}
        >
          <Warehouse className="mr-1.5 h-3.5 w-3.5" />
          {t("nav.inventorySummary")}
        </Button>
      </div>

      {/* Note Banner */}
      {activeTab === "gas" && (
        <div className="rounded-md bg-muted/50 border px-3.5 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="font-semibold text-foreground">💡 Note:</span>
          <span>{t("inventory.gasNote")}</span>
        </div>
      )}
      {activeTab === "cylinder" && (
        <div className="rounded-md bg-muted/50 border px-3.5 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="font-semibold text-foreground">💡 Note:</span>
          <span>{t("inventory.cylNote")}</span>
        </div>
      )}
      {activeTab === "product" && (
        <div className="rounded-md bg-muted/50 border px-3.5 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="font-semibold text-foreground">💡 Note:</span>
          <span>{t("inventory.prodNote")}</span>
        </div>
      )}

      {/* Summary Cards View */}
      {activeTab === "summary" && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="text-left">
                <StatCard
                  title={t("inventory.cardReceivedCyl")}
                  value={String(summaryCards.received)}
                  icon={Warehouse}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => navigate({ to: "/purchases/new" })}>
                {t("inventory.purchaseBillCreate")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/purchases" })}>
                {t("inventory.receiveNoteCreate")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="text-left">
                <StatCard
                  title={t("inventory.cardDelivery")}
                  value={String(summaryCards.delivery)}
                  icon={Cylinder}
                  tone="positive"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => navigate({ to: "/purchases/new" })}>
                {t("inventory.purchaseBillCreate")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/purchases" })}>
                {t("inventory.receiveNoteCreate")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="text-left">
                <StatCard
                  title={t("inventory.cardReturn")}
                  value={String(summaryCards.returned)}
                  icon={RefreshCw}
                  tone="warning"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => navigate({ to: "/purchases/new" })}>
                {t("inventory.purchaseBillCreate")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/purchases" })}>
                {t("inventory.receiveNoteCreate")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="text-left" onClick={() => navigate({ to: "/sales" })}>
            <StatCard title={t("inventory.reserved")} value={String(summaryCards.reserved)} icon={Truck} />
          </button>
          <button type="button" className="text-left" onClick={() => navigate({ to: "/cylinders" })}>
            <StatCard
              title={t("inventory.cardCylinder")}
              value={String(summaryCards.cylinder)}
              icon={Package}
              tone="info"
            />
          </button>
          <button type="button" className="text-left" onClick={() => navigate({ to: "/products" })}>
            <StatCard
              title={t("inventory.available")}
              value={String(summaryCards.available)}
              icon={ShoppingCart}
              tone="positive"
            />
          </button>
        </div>
      )}

      {/* Adjust Stock Dialog */}
      <Dialog
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (open) setPartyKind("customer");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("inventory.adjust")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("common.product")}</Label>
              <Select value={productId || undefined} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {products
                    .filter((p) => p.id)
                    .map((p) => {
                      const row = rows.find((r) => r.productId === p.id);
                      const current = row?.full ?? p.stock ?? 0;
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} · {current}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("inventory.txn")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{t("inventory.stockIn")}</SelectItem>
                  <SelectItem value="out">{t("inventory.stockOut")}</SelectItem>
                  <SelectItem value="adjust">{t("inventory.setAbsolute")}</SelectItem>
                  <SelectItem value="refill">{t("inventory.refillComplete")}</SelectItem>
                  <SelectItem value="customer_sent">{t("inventory.sendCustomer")}</SelectItem>
                  <SelectItem value="exchange">{t("inventory.exchangeCustomer")}</SelectItem>
                  <SelectItem value="return_empty">{t("inventory.emptyReturn")}</SelectItem>
                  <SelectItem value="loan">{t("inventory.loanCustomer")}</SelectItem>
                  <SelectItem value="sell_cylinder">{t("inventory.sellCylinder")}</SelectItem>
                  <SelectItem value="send_supplier">{t("inventory.sendSupplier")}</SelectItem>
                  <SelectItem value="receive_supplier">
                    {t("inventory.receiveSupplier")}
                  </SelectItem>
                  <SelectItem value="mark_lost">{t("status.lost")}</SelectItem>
                  <SelectItem value="mark_damaged">{t("status.damaged")}</SelectItem>
                  <SelectItem value="repair">{t("inventory.repairDamage")}</SelectItem>
                  <SelectItem value="scrap">{t("inventory.scrapDamage")}</SelectItem>
                  <SelectItem value="writeoff">{t("inventory.writeoffDamage")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(type === "customer_sent" ||
              type === "return_empty" ||
              type === "loan" ||
              type === "sell_cylinder" ||
              type === "exchange") && (
              <div className="space-y-1.5">
                <Label>{t("common.customer")}</Label>
                <Select value={customerId || undefined} onValueChange={setCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(type === "send_supplier" || type === "receive_supplier") && (
              <div className="space-y-1.5">
                <Label>{t("common.supplier")}</Label>
                <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(type === "customer_sent" || type === "send_supplier" || type === "loan") && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>{t("inventory.sendDate")}</Label>
                  <Input
                    type="date"
                    value={sendDate}
                    onChange={(e) => setSendDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("inventory.expectedReturn")}</Label>
                  <Input
                    type="date"
                    value={expectedReturn}
                    onChange={(e) => setExpectedReturn(e.target.value)}
                  />
                </div>
              </div>
            )}
            {type === "refill" && (
              <div className="space-y-1.5">
                <Label>{t("inventory.refillDate")}</Label>
                <Input
                  type="date"
                  value={sendDate}
                  onChange={(e) => setSendDate(e.target.value)}
                />
              </div>
            )}
            {type === "mark_lost" && (
              <>
                <div className="space-y-1.5">
                  <Label>{t("inventory.lostPartyType")}</Label>
                  <Select
                    value={partyKind}
                    onValueChange={(v) => {
                      setPartyKind(v as typeof partyKind);
                      setCustomerId("");
                      setSupplierId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">{t("common.customer")}</SelectItem>
                      <SelectItem value="supplier">{t("common.supplier")}</SelectItem>
                      <SelectItem value="warehouse">{t("inventory.partyWarehouse")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {partyKind === "customer" && (
                  <div className="space-y-1.5">
                    <Label>{t("common.customer")}</Label>
                    <Select value={customerId || undefined} onValueChange={setCustomerId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {partyKind === "supplier" && (
                  <div className="space-y-1.5">
                    <Label>{t("common.supplier")}</Label>
                    <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{t("inventory.lostReason")}</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="E.g. Not returned / cylinder missing"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>{t("inventory.penaltyAmount")}</Label>
                    <Input
                      type="number"
                      value={penalty}
                      onChange={(e) => setPenalty(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("inventory.accountingTreatment")}</Label>
                    <Select
                      value={treatment}
                      onValueChange={(v) => setTreatment(v as typeof treatment)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="charge">{t("inventory.treatmentCharge")}</SelectItem>
                        <SelectItem value="writeoff">{t("inventory.treatmentWriteoff")}</SelectItem>
                        <SelectItem value="none">{t("inventory.treatmentNone")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
            {tracking === "lot" &&
              (type === "customer_sent" ||
                type === "send_supplier" ||
                type === "loan" ||
                type === "sell_cylinder" ||
                type === "exchange") && (
                <div className="space-y-1.5">
                  <Label>{t("inventory.lotNumber")}</Label>
                  <Input
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                    placeholder="LOT-2026-001"
                  />
                </div>
              )}
            {type === "receive_supplier" && (
              <div className="space-y-1.5">
                <Label>{t("inventory.condition")}</Label>
                <Select
                  value={condition}
                  onValueChange={(v) => setCondition(v as typeof condition)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">{t("inventory.condition.full")}</SelectItem>
                    <SelectItem value="empty">{t("inventory.condition.empty")}</SelectItem>
                    <SelectItem value="damaged">{t("inventory.condition.damaged")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("common.quantity")}</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{type === "refill" ? t("inventory.receivedBy") : t("common.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button
              className="w-full"
              data-testid="adjust-apply"
              disabled={
                !productId ||
                adjust.isPending ||
                Number(qty) < 0 ||
                ((type === "send_supplier" ||
                  type === "receive_supplier" ||
                  (type === "mark_lost" && partyKind === "supplier")) &&
                  !supplierId) ||
                ((type === "return_empty" ||
                  type === "loan" ||
                  type === "sell_cylinder" ||
                  type === "customer_sent" ||
                  type === "exchange" ||
                  (type === "mark_lost" && partyKind === "customer")) &&
                  !customerId) ||
                ((type === "customer_sent" || type === "loan" || type === "exchange") &&
                  !expectedReturn)
              }
              onClick={() => {
                if (adjust.isPending) return;
                adjust.mutate();
              }}
            >
              {t("inventory.apply")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* GAS INVENTORY TABLE */}
      {activeTab === "gas" && (
        <DataTable<GasInventory & { sl: number }>
          rows={gasRows}
          searchKeys={["productName"]}
          columns={[
            {
              key: "sl",
              header: t("inventory.sl"),
              render: (r) => String(r.sl).padStart(2, "0"),
              className: "w-12 whitespace-nowrap",
            },
            {
              key: "productName",
              header: t("inventory.gasName"),
              sortable: true,
              sortValue: (r) => r.productName,
              render: (r) => (
                <span className="whitespace-normal break-words font-medium">{r.productName}</span>
              ),
              className: "min-w-[12rem] max-w-[20rem]",
            },
            {
              key: "uom",
              header: t("inventory.unit"),
              render: (r) => inventoryUnitLabel(r.uom, t),
              className: "w-20 whitespace-nowrap",
            },
            {
              key: "stockIn",
              header: t("inventory.stockIn"),
              sortable: true,
              sortValue: (r) => r.stockIn,
              render: (r) => r.stockIn,
              className: "min-w-[6rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "stockOut",
              header: t("inventory.stockOut"),
              sortable: true,
              sortValue: (r) => r.stockOut,
              render: (r) => r.stockOut,
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "onHand",
              header: t("inventory.onHand"),
              sortable: true,
              sortValue: (r) => r.onHand,
              render: (r) => <span className="font-semibold">{r.onHand}</span>,
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "costPrice",
              header: t("inventory.unitPriceCost"),
              sortable: true,
              sortValue: (r) => r.costPrice,
              render: (r) => formatCurrency(r.costPrice),
              className: "min-w-[9rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "totalValue",
              header: t("inventory.totalValue"),
              sortable: true,
              sortValue: (r) => r.totalValue,
              render: (r) => formatCurrency(r.totalValue),
              className: "min-w-[9rem] whitespace-nowrap text-right tabular-nums font-medium",
            },
          ]}
        />
      )}

      {/* CYLINDER INVENTORY TABLE */}
      {activeTab === "cylinder" && (
        <DataTable<CylinderInventory & { sl: number }>
          rows={cylinderRows}
          searchKeys={["productName"]}
          columns={[
            {
              key: "sl",
              header: t("inventory.sl"),
              render: (r) => String(r.sl).padStart(2, "0"),
              className: "w-12 whitespace-nowrap",
            },
            {
              key: "productName",
              header: t("inventory.cylName"),
              sortable: true,
              sortValue: (r) => r.productName,
              render: (r) => (
                <span className="whitespace-normal break-words font-medium">{r.productName}</span>
              ),
              className: "min-w-[12rem] max-w-[20rem]",
            },
            {
              key: "uom",
              header: t("inventory.unit"),
              render: (r) => inventoryUnitLabel(r.uom, t),
              className: "w-20 whitespace-nowrap",
            },
            {
              key: "stockIn",
              header: t("inventory.stockIn"),
              sortable: true,
              sortValue: (r) => r.stockIn,
              render: (r) => r.stockIn,
              className: "min-w-[6rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "stockOut",
              header: t("inventory.stockOut"),
              sortable: true,
              sortValue: (r) => r.stockOut,
              render: (r) => r.stockOut,
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "onHand",
              header: t("inventory.onHand"),
              sortable: true,
              sortValue: (r) => r.onHand,
              render: (r) => <span className="font-semibold">{r.onHand}</span>,
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "reserved",
              header: t("inventory.reserved"),
              sortable: true,
              sortValue: (r) => r.reserved,
              render: (r) => (r.reserved > 0 ? <Badge variant="secondary">{r.reserved}</Badge> : 0),
              className: "min-w-[6rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "available",
              header: t("inventory.available"),
              sortable: true,
              sortValue: (r) => r.available,
              render: (r) => (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {r.available}
                </span>
              ),
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums font-medium",
            },
            {
              key: "costPrice",
              header: t("inventory.unitPriceCost"),
              sortable: true,
              sortValue: (r) => r.costPrice,
              render: (r) => formatCurrency(r.costPrice),
              className: "min-w-[9rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "totalValue",
              header: t("inventory.totalValue"),
              sortable: true,
              sortValue: (r) => r.totalValue,
              render: (r) => formatCurrency(r.totalValue),
              className: "min-w-[9rem] whitespace-nowrap text-right tabular-nums font-medium",
            },
          ]}
        />
      )}

      {/* GENERAL PRODUCT INVENTORY TABLE */}
      {activeTab === "product" && (
        <DataTable<ProductInventory & { sl: number }>
          rows={productRows}
          searchKeys={["productName"]}
          columns={[
            {
              key: "sl",
              header: t("inventory.sl"),
              render: (r) => String(r.sl).padStart(2, "0"),
              className: "w-12 whitespace-nowrap",
            },
            {
              key: "productName",
              header: t("inventory.productName"),
              sortable: true,
              sortValue: (r) => r.productName,
              render: (r) => (
                <span className="whitespace-normal break-words font-medium">{r.productName}</span>
              ),
              className: "min-w-[12rem] max-w-[20rem]",
            },
            {
              key: "uom",
              header: t("inventory.unit"),
              render: (r) => inventoryUnitLabel(r.uom, t),
              className: "w-20 whitespace-nowrap",
            },
            {
              key: "stockIn",
              header: t("inventory.stockIn"),
              sortable: true,
              sortValue: (r) => r.stockIn,
              render: (r) => r.stockIn,
              className: "min-w-[6rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "stockOut",
              header: t("inventory.stockOut"),
              sortable: true,
              sortValue: (r) => r.stockOut,
              render: (r) => r.stockOut,
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "onHand",
              header: t("inventory.onHand"),
              sortable: true,
              sortValue: (r) => r.onHand,
              render: (r) => <span className="font-semibold">{r.onHand}</span>,
              className: "min-w-[6.5rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "costPrice",
              header: t("inventory.unitPriceCost"),
              sortable: true,
              sortValue: (r) => r.costPrice,
              render: (r) => formatCurrency(r.costPrice),
              className: "min-w-[9rem] whitespace-nowrap text-right tabular-nums",
            },
            {
              key: "totalValue",
              header: t("inventory.totalValue"),
              sortable: true,
              sortValue: (r) => r.totalValue,
              render: (r) => formatCurrency(r.totalValue),
              className: "min-w-[9rem] whitespace-nowrap text-right tabular-nums font-medium",
            },
          ]}
        />
      )}


      {/* SUMMARY MOVEMENT ACTIVITY */}
      {activeTab === "summary" && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inventory.recent")}
          </h3>
          <DataTable<ActivityRow>
            rows={activity}
            searchKeys={["productName", "notes", "by"]}
            dateKey="date"
            onRowClick={openActivity}
            columns={[
              {
                key: "date",
                header: t("inventory.when"),
                sortable: true,
                sortValue: (r) => r.date,
                render: (r) => formatDateTime(r.date),
              },
              {
                key: "ref",
                header: t("inventory.ref"),
                render: (r) => <span className="font-mono text-xs">{r.refId || r.id}</span>,
              },
              {
                key: "txn",
                header: t("inventory.txn"),
                render: (r) => (
                  <Badge variant="outline">{t(`inventory.txn.${r.txn}` as MessageKey)}</Badge>
                ),
              },
              {
                key: "product",
                header: t("common.product"),
                sortable: true,
                sortValue: (r) => r.productName,
                render: (r) => r.productName,
              },
              {
                key: "fin",
                header: t("inventory.fullIn"),
                render: (r) => r.fullIn || "—",
                className: "text-right tabular-nums",
              },
              {
                key: "fout",
                header: t("inventory.fullOut"),
                render: (r) => r.fullOut || "—",
                className: "text-right tabular-nums",
              },
              {
                key: "ein",
                header: t("inventory.emptyIn"),
                render: (r) => r.emptyIn || "—",
                className: "text-right tabular-nums",
              },
              {
                key: "refillDate",
                header: t("inventory.refillDate"),
                sortable: true,
                sortValue: (r) => r.refillDate || "",
                render: (r) => {
                  if (!r.refillDate) return "—";
                  const d = new Date(r.refillDate);
                  return Number.isNaN(d.getTime()) ? "—" : formatDate(r.refillDate);
                },
                className: "whitespace-nowrap",
              },
              {
                key: "refill",
                header: t("inventory.refill"),
                render: (r) => r.refill || "—",
                className: "text-right tabular-nums",
              },
              { key: "by", header: t("inventory.receivedBy"), render: (r) => r.by || "—" },
              {
                key: "st",
                header: t("common.status"),
                render: (r) => <Badge variant="secondary">{r.type}</Badge>,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
