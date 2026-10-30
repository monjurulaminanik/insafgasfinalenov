import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronsUpDown, Info, Plus, Trash2, RotateCcw } from "lucide-react";
import { customerService } from "@/services/customer.service";
import { productService } from "@/services/product.service";
import { productCategoryService } from "@/services/product-category.service";
import { salesService } from "@/services/sales.service";
import { deliveryService } from "@/services/delivery.service";
import { returnService } from "@/services/return.service";
import { hrService } from "@/services/hr.service";
import { cylinderService } from "@/services/cylinder.service";
import { inventoryService } from "@/services/inventory.service";
import { buildProductInventory } from "@/lib/cylinder-inventory";
import { isDeliveryStaff } from "@/lib/hr-staff";
import {
  isCylinderProduct,
  lineFromProduct,
  saleItemType,
  type SaleItemType,
} from "@/lib/cylinder-product";
import { deliverySchema } from "@/utils/validators";
import { computeTotals, genOrderNo, lineAmount } from "@/utils/helpers";
import { formatCurrency } from "@/utils/formatters";
import type { Customer, LineItem, Product } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

function emptyLine(): LineItem {
  return { productId: "", productName: "", quantity: 1, price: 0, taxRate: 0, itemType: "gas" };
}

function customerMatches(c: Customer, q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [c.name, c.phone, c.whatsapp, c.email, c.address]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(n));
}

export function ChallanForm({
  salesOrderId: initialSoId,
  id,
}: {
  salesOrderId?: string;
  id?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = Boolean(id);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: categoryRows = [] } = useQuery({
    queryKey: ["productCategories"],
    queryFn: productCategoryService.list,
  });
  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: deliveries = [] } = useQuery({
    queryKey: ["deliveries"],
    queryFn: deliveryService.list,
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: hrService.listEmployees,
  });
  const { data: existing, isLoading } = useQuery({
    queryKey: ["deliveries", id],
    queryFn: () => deliveryService.get(id!),
    enabled: editing,
  });

  const stockRows = useMemo(
    () => buildProductInventory(products, cylinders, sales, deliveries, movements),
    [products, cylinders, sales, deliveries, movements],
  );

  const categoryNames = useMemo(
    () =>
      Array.from(
        new Set([
          "LPG",
          "Industrial",
          "Medical",
          "Other",
          ...categoryRows.map((c) => c.name).filter(Boolean),
          ...products.map((p) => p.category).filter(Boolean),
        ]),
      ),
    [categoryRows, products],
  );

  const openOrders = sales.filter((s) => s.status === "confirmed" || s.status === "invoiced");
  const deliveryStaff = employees.filter(isDeliveryStaff);

  const [salesOrderId, setSalesOrderId] = useState(initialSoId || "");
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderQuery, setOrderQuery] = useState("");
  const [productOpenIdx, setProductOpenIdx] = useState<number | null>(null);
  const [productQuery, setProductQuery] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [address, setAddress] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);

  const [driverName, setDriverName] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLine()]);
  const [hydrated, setHydrated] = useState(!editing);

  // Check if challan is already delivered (locking items from direct inventory mutation)
  const isDelivered = Boolean(existing && existing.status !== "pending");

  useEffect(() => {
    if (!existing) return;
    setSalesOrderId(existing.salesOrderId || "");
    setCustomerId(existing.customerId);
    setCustomerName(existing.customerName || "");
    setDriverName(existing.driverName || "");
    setReceiverName(existing.receiverName || "");
    setVehicleNo(existing.vehicleNo || "");
    setContactNo(existing.customerPhone || "");
    setAddress(existing.customerAddress || "");
    setNotes(existing.notes || "");
    setItems(
      existing.items?.length
        ? existing.items.map((it) => ({
          ...it,
          itemType:
            it.itemType ||
            (isCylinderProduct(products.find((p) => p.id === it.productId))
              ? "cylinder"
              : "gas"),
        }))
        : [emptyLine()],
    );
    setHydrated(true);
  }, [existing, products]);

  // Autofill customer contact info when customer changes
  useEffect(() => {
    if (!customerId || contactNo || address) return;
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    setContactNo(c.phone || "");
    setAddress(c.address || "");
    if (!customerName) setCustomerName(c.name);
  }, [customerId, customers, contactNo, address, customerName]);

  const filteredCustomers = useMemo(
    () => customers.filter((c) => customerMatches(c, customerName)).slice(0, 12),
    [customers, customerName],
  );

  const onSelectOrder = (soId: string) => {
    if (!soId || soId === "__none") {
      setSalesOrderId("");
      setOrderOpen(false);
      setOrderQuery("");
      return;
    }
    const so = sales.find((s) => s.id === soId);
    if (!so) return;
    setSalesOrderId(so.id);
    setCustomerId(so.customerId);
    setCustomerName(so.customerName);
    if (so.driverName) setDriverName(so.driverName);
    if (so.receiverName) setReceiverName(so.receiverName);
    if (so.customerPhone) setContactNo(so.customerPhone);
    if (so.customerAddress) setAddress(so.customerAddress);
    if (so.notes) setNotes(so.notes);

    if (so.items && so.items.length > 0) {
      setItems(
        so.items.map((it) => {
          const p = products.find((x) => x.id === it.productId);
          return {
            productId: it.productId,
            productName: it.productName,
            quantity: it.quantity || 1,
            price: Number(it.price) || 0,
            taxRate: it.taxRate || 0,
            category: it.category || p?.category || "",
            itemType: it.itemType || (isCylinderProduct(p) ? "cylinder" : "gas"),
            sellCylinder: Boolean(it.sellCylinder),
            cylinderIds: it.cylinderIds ? [...it.cylinderIds] : undefined,
          };
        }),
      );
    }
    setOrderOpen(false);
    setOrderQuery("");
  };

  useEffect(() => {
    if (editing || !initialSoId) return;
    onSelectOrder(initialSoId);
  }, [initialSoId, editing]);

  const update = (idx: number, patch: Partial<LineItem>) => {
    if (isDelivered) return;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const applyProduct = (idx: number, p: Product) => {
    if (isDelivered) return;
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const kind: SaleItemType =
          it.itemType === "product" ? "product" : isCylinderProduct(p) ? "cylinder" : "gas";
        return {
          ...lineFromProduct(p, kind),
          quantity: it.quantity || 1,
          price: it.price > 0 ? it.price : p.price,
        };
      }),
    );
    setProductOpenIdx(null);
    setProductQuery("");
  };

  const setLineKind = (idx: number, kind: SaleItemType) => {
    if (isDelivered) return;
    const it = items[idx];
    if (kind === "product") {
      const p = products.find((x) => x.id === it.productId);
      update(idx, {
        itemType: "product",
        sellCylinder: false,
        price: it.price > 0 ? it.price : (p?.price ?? it.price),
      });
      return;
    }
    const current = products.find((x) => x.id === it.productId);
    const matches = (p: Product) =>
      kind === "cylinder" ? isCylinderProduct(p) : !isCylinderProduct(p);
    if (current && matches(current)) {
      update(idx, { itemType: kind, category: it.category || current.category });
      return;
    }
    const next = products.find(matches);
    if (next) {
      setItems((prev) =>
        prev.map((row, i) =>
          i === idx ? { ...lineFromProduct(next, kind), quantity: row.quantity || 1 } : row,
        ),
      );
      return;
    }
    update(idx, { itemType: kind });
  };

  const addItem = () => {
    if (isDelivered) return;
    setItems((prev) => [...prev, emptyLine()]);
  };

  const removeItem = (idx: number) => {
    if (isDelivered) return;
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [emptyLine()]));
  };

  const totals = computeTotals(
    items.filter((it) => it.productId && it.productName && Number(it.quantity) > 0),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const workingItems = items.filter(
        (it) => it.productId && it.productName && Number(it.quantity) > 0,
      );
      if (workingItems.length === 0) throw new Error(t("common.noItems"));

      const parsed = deliverySchema.safeParse({
        customerId: customerId || undefined,
        salesOrderId: salesOrderId || undefined,
        driverName: driverName.trim(),
        receiverName: receiverName.trim() || undefined,
        vehicleNo: vehicleNo.trim(),
        items: workingItems,
      });
      if (!parsed.success) throw new Error(parsed.error.errors[0]?.message || "Invalid form");

      let resolvedCustomerId = customerId;
      let resolvedCustomerName = customerName.trim();
      const c = customers.find((x) => x.id === resolvedCustomerId);
      if (c) {
        resolvedCustomerName = c.name;
      } else {
        const exact = customers.find(
          (x) => x.name.trim().toLowerCase() === resolvedCustomerName.toLowerCase(),
        );
        if (exact) {
          resolvedCustomerId = exact.id;
          resolvedCustomerName = exact.name;
        } else if (resolvedCustomerName) {
          const created = await customerService.create({
            name: resolvedCustomerName,
            phone: contactNo.trim() || "N/A",
            address: address.trim() || "N/A",
            openingBalance: 0,
            openingBalanceType: "receivable",
            creditLimit: 0,
          });
          resolvedCustomerId = created.id;
          resolvedCustomerName = created.name;
        }
      }

      if (editing && existing) {
        // If already delivered, preserve items and stock postings, update metadata
        if (isDelivered) {
          return deliveryService.update(id!, {
            driverName: driverName.trim(),
            receiverName: receiverName.trim() || undefined,
            vehicleNo: vehicleNo.trim(),
            notes: notes.trim() || undefined,
            customerPhone: contactNo.trim() || undefined,
            customerAddress: address.trim() || undefined,
          });
        }

        // If pending, allow updating all fields
        return deliveryService.update(id!, {
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          salesOrderId: salesOrderId || undefined,
          driverName: driverName.trim(),
          receiverName: receiverName.trim() || undefined,
          vehicleNo: vehicleNo.trim(),
          notes: notes.trim() || undefined,
          customerPhone: contactNo.trim() || undefined,
          customerAddress: address.trim() || undefined,
          items: workingItems,
        });
      }

      // Creating new delivery
      return deliveryService.create({
        challanNo: genOrderNo("DC"),
        customerId: resolvedCustomerId,
        customerName: resolvedCustomerName,
        salesOrderId: salesOrderId || undefined,
        driverName: driverName.trim(),
        receiverName: receiverName.trim() || undefined,
        vehicleNo: vehicleNo.trim(),
        notes: notes.trim() || undefined,
        customerPhone: contactNo.trim() || undefined,
        customerAddress: address.trim() || undefined,
        items: workingItems,
        status: "pending",
        date: new Date().toISOString(),
      });
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["deliveries", d.id] });
      toast.success(editing ? t("deliveries.updated") : t("deliveries.created"));
      navigate({ to: "/deliveries/$id", params: { id: d.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnItemsState, setReturnItemsState] = useState<
    Record<string, { returnQuantity: number; condition: "empty" | "full" | "damaged" }>
  >({});
  const [returnNotes, setReturnNotes] = useState("");
  const [returnReason, setReturnReason] = useState("");

  const { data: returnSummary } = useQuery({
    queryKey: ["deliveryReturnSummary", id],
    queryFn: () => returnService.getDeliverySummary(id!),
    enabled: Boolean(editing && id),
  });

  useEffect(() => {
    if (!returnSummary?.items) return;
    const initial: Record<string, { returnQuantity: number; condition: "empty" | "full" | "damaged" }> = {};
    for (const it of returnSummary.items) {
      initial[it.productId] = {
        returnQuantity: it.remainingReturnableQuantity,
        condition: "empty",
      };
    }
    setReturnItemsState(initial);
  }, [returnSummary, returnDialogOpen]);

  const returnMutation = useMutation({
    mutationFn: async () => {
      if (!existing || !id) throw new Error("Challan not loaded");
      const summaryItems = returnSummary?.items || [];
      const payloadItems = summaryItems
        .map((it) => {
          const state = returnItemsState[it.productId];
          const qty = state?.returnQuantity ?? 0;
          return {
            productId: it.productId,
            returnQuantity: qty,
            cylinderCondition: it.itemType === "cylinder" ? (state?.condition || "empty") : undefined,
            cylinderIds: it.cylinderIds,
          };
        })
        .filter((it) => it.returnQuantity > 0);

      if (payloadItems.length === 0) {
        throw new Error(t("returns.noItemsSelected"));
      }

      for (const it of payloadItems) {
        const sumItem = summaryItems.find((s) => s.productId === it.productId);
        if (sumItem && it.returnQuantity > sumItem.remainingReturnableQuantity) {
          throw new Error(
            `${t("returns.exceedsRemaining")}: ${sumItem.productName} (${it.returnQuantity} > ${sumItem.remainingReturnableQuantity})`,
          );
        }
      }

      return returnService.processReturn({
        deliveryId: id,
        returnDate: new Date().toISOString(),
        reason: returnReason.trim() || undefined,
        notes: returnNotes.trim() || undefined,
        items: payloadItems,
      });
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["deliveryReturnSummary", id] });
      qc.invalidateQueries({ queryKey: ["returns"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["inventorySummary"] });

      toast.success(t("returns.success"));
      setReturnDialogOpen(false);
      navigate({
        to: "/returns",
        search: {
          tab:
            record.itemClassification === "gas"
              ? "gas"
              : record.itemClassification === "cylinder"
                ? "cylinder"
                : "product",
        },
      });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to save return");
    },
  });

  if (editing && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (editing && !existing)
    return <div className="p-6 text-sm text-destructive">{t("deliveries.notFound")}</div>;
  if (!hydrated)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  const recentDocs = sales
    .filter((s) => s.status === "confirmed" || s.status === "invoiced" || s.status === "paid")
    .slice(0, 8);
  const selectedSo = sales.find((s) => s.id === salesOrderId);

  return (
    <div>
      <PageHeader
        title={
          editing
            ? `${t("deliveries.editTitle")}${existing?.challanNo ? ` · ${existing.challanNo}` : ""}`
            : t("deliveries.new")
        }
        backTo={editing ? { to: "/deliveries/$id", params: { id: id! } } : "/deliveries"}
      />

      {isDelivered && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            {t("doc.deliveryNote")} <strong>{existing?.challanNo}</strong> has been marked{" "}
            <Badge variant="outline" className="uppercase text-[10px] ml-1 mr-1">
              {existing?.status}
            </Badge>
            . Delivery information and contact details are editable. Core delivered quantities are
            preserved to maintain inventory integrity. Use <strong>Return</strong> to accept customer returns.
          </span>
        </div>
      )}

      {!editing && recentDocs.length > 0 && (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <h3 className="mb-3 text-sm font-semibold">{t("deliveries.recentDocs")}</h3>
            <div className="flex flex-wrap gap-2">
              {recentDocs.map((s) => (
                <Button
                  key={s.id}
                  type="button"
                  size="sm"
                  variant={salesOrderId === s.id ? "default" : "outline"}
                  onClick={() => onSelectOrder(s.id)}
                >
                  {s.orderNo} · {s.customerName}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Top Form Fields matching Sales Order Form pattern */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {/* Customer Searchable Combobox */}
            <div className="relative space-y-1.5">
              <Label>{t("common.customer")}</Label>
              <Input
                value={customerName}
                disabled={isDelivered}
                placeholder={t("sales.searchCustomer")}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setCustomerId("");
                  setCustomerOpen(true);
                }}
                onFocus={() => {
                  if (!isDelivered) setCustomerOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setCustomerOpen(false), 180)}
              />
              {customerOpen && !isDelivered && (filteredCustomers.length > 0 || customerName.trim().length > 1) && (
                <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md">
                  {filteredCustomers.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerName(c.name);
                          setContactNo(c.phone || "");
                          setAddress(c.address || "");
                          setCustomerOpen(false);
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[c.phone, c.address].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                  {customerName.trim().length > 1 &&
                    !customers.some(
                      (c) => c.name.trim().toLowerCase() === customerName.trim().toLowerCase(),
                    ) && (
                      <li>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCustomerId("");
                            setCustomerOpen(false);
                          }}
                        >
                          {t("sales.useTypedCustomer", { name: customerName.trim() })}
                        </button>
                      </li>
                    )}
                </ul>
              )}
            </div>

            {/* Receiver Name */}
            <div className="space-y-1.5">
              <Label>{t("sales.receiver")}</Label>
              <Input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Receiver name"
              />
            </div>

            {/* Deliveryman */}
            <div className="space-y-1.5">
              <Label>{t("deliveries.deliveryman")}</Label>
              {deliveryStaff.length > 0 ? (
                <Select
                  value={driverName || "__none"}
                  onValueChange={(v) => setDriverName(v === "__none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {deliveryStaff.map((e) => (
                      <SelectItem key={e.id} value={e.name}>
                        {e.name} · {e.designation}
                      </SelectItem>
                    ))}
                    {driverName && !deliveryStaff.some((e) => e.name === driverName) && (
                      <SelectItem value={driverName}>{driverName}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder={t("deliveries.deliveryman")}
                />
              )}
            </div>

            {/* Contact Number */}
            <div className="space-y-1.5">
              <Label>{t("sales.contactNo")}</Label>
              <Input
                value={contactNo}
                onChange={(e) => setContactNo(e.target.value)}
                placeholder="Phone / Mobile"
              />
            </div>

            {/* Vehicle Number */}
            <div className="space-y-1.5">
              <Label>{t("deliveries.vehicle")}</Label>
              <Input
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
                placeholder="Vehicle No / Track"
              />
            </div>

            {/* Sales Order / Reference */}
            <div className="space-y-1.5">
              <Label>{t("sales.orderNo")}</Label>
              {editing ? (
                <Input
                  disabled
                  value={
                    existing?.challanNo
                      ? `${existing.challanNo}${selectedSo ? ` · SO: ${selectedSo.orderNo}` : ""}`
                      : "—"
                  }
                />
              ) : (
                <Popover open={orderOpen} onOpenChange={setOrderOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full justify-between font-normal"
                    >
                      <span className={cn("truncate", !salesOrderId && "text-muted-foreground")}>
                        {selectedSo
                          ? `${selectedSo.orderNo} · ${selectedSo.customerName}`
                          : "— (None / Direct Challan)"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-2" align="start">
                    <Input
                      autoFocus
                      value={orderQuery}
                      placeholder={t("common.search") || "Search order # or customer..."}
                      onChange={(e) => setOrderQuery(e.target.value)}
                      className="mb-2"
                    />
                    <ul className="max-h-56 overflow-auto">
                      <li>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                            !salesOrderId && "bg-accent font-medium",
                          )}
                          onClick={() => onSelectOrder("__none")}
                        >
                          <span>— ({t("common.all") || "None / Direct Challan"})</span>
                          {!salesOrderId && <Check className="h-4 w-4" />}
                        </button>
                      </li>
                      {openOrders
                        .filter((s) => {
                          const q = orderQuery.trim().toLowerCase();
                          if (!q) return true;
                          return `${s.orderNo} ${s.customerName} ${s.driverName || ""} ${s.status}`
                            .toLowerCase()
                            .includes(q);
                        })
                        .map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                                salesOrderId === s.id && "bg-accent font-medium",
                              )}
                              onClick={() => onSelectOrder(s.id)}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">{s.orderNo}</span>
                                <span className="text-xs text-muted-foreground">{s.customerName}</span>
                              </div>
                              {salesOrderId === s.id && <Check className="h-4 w-4" />}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* Address */}
            <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
              <Label>{t("common.address")}</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Delivery address"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label>{t("common.notes")}</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("common.optionalNotes")}
              />
            </div>
          </div>

          {/* Line Items Table matching Sales Order Form structure */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("sales.item")}</h3>
              {!isDelivered && (
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t("sales.addItem")}
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">{t("inventory.sl")}</TableHead>
                      <TableHead className="min-w-[11rem]">{t("common.product")}</TableHead>
                      <TableHead className="w-28">{t("common.category")}</TableHead>
                      <TableHead className="w-32">{t("sales.gasOrCylinder")}</TableHead>
                      <TableHead className="w-28 min-w-[7rem] text-right">{t("common.quantity")}</TableHead>
                      <TableHead className="w-32 min-w-[7.5rem] text-right">{t("common.price")}</TableHead>
                      <TableHead className="w-28 text-right">{t("common.subtotal")}</TableHead>
                      {!isDelivered && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={isDelivered ? 7 : 8}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          {t("common.noItems")}
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((it, idx) => {
                      const p = products.find((x) => x.id === it.productId);
                      const kind = saleItemType(it, p);
                      const lineCategory = it.category || p?.category || "";
                      const subtotal = (Number(it.quantity) || 0) * (Number(it.price) || 0);

                      return (
                        <TableRow key={idx}>
                          <TableCell className="tabular-nums text-muted-foreground text-xs">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="min-w-[11rem]">
                            {isDelivered ? (
                              <span className="font-medium text-sm">{it.productName}</span>
                            ) : (
                              <Popover
                                open={productOpenIdx === idx}
                                onOpenChange={(open) => {
                                  setProductOpenIdx(open ? idx : null);
                                  setProductQuery(open ? it.productName || "" : "");
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 w-full justify-start font-normal"
                                  >
                                    <span
                                      className={cn(
                                        "truncate",
                                        !it.productName && "text-muted-foreground",
                                      )}
                                    >
                                      {it.productName || t("common.select")}
                                    </span>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-2" align="start">
                                  <Input
                                    autoFocus
                                    value={productQuery}
                                    placeholder={t("common.select")}
                                    onChange={(e) => setProductQuery(e.target.value)}
                                    className="mb-2"
                                  />
                                  <ul className="max-h-56 overflow-auto">
                                    {products
                                      .filter((prod) => {
                                        const q = productQuery.trim().toLowerCase();
                                        if (!q) return true;
                                        return `${prod.name} ${prod.code} ${prod.category}`
                                          .toLowerCase()
                                          .includes(q);
                                      })
                                      .slice(0, 40)
                                      .map((prod) => {
                                        const row = stockRows.find((r) => r.productId === prod.id);
                                        const avail = row?.available ?? prod.stock ?? 0;
                                        return (
                                          <li key={prod.id}>
                                            <button
                                              type="button"
                                              className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                                              onClick={() => applyProduct(idx, prod)}
                                            >
                                              <span className="font-medium text-sm">{prod.name}</span>
                                              <span className="text-xs text-muted-foreground">
                                                {prod.code} · {avail} {prod.uom}
                                                {avail <= 0 ? ` · ${t("inventory.status.out")}` : ""}
                                              </span>
                                            </button>
                                          </li>
                                        );
                                      })}
                                  </ul>
                                </PopoverContent>
                              </Popover>
                            )}
                          </TableCell>
                          <TableCell>
                            {isDelivered ? (
                              <span className="text-xs text-muted-foreground">{lineCategory || "—"}</span>
                            ) : (
                              <Select
                                value={lineCategory || "__none"}
                                onValueChange={(v) =>
                                  update(idx, { category: v === "__none" ? "" : v })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("common.select")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none">—</SelectItem>
                                  {categoryNames.map((c) => (
                                    <SelectItem key={c} value={c}>
                                      {c}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            {isDelivered ? (
                              <Badge variant="outline" className="text-xs capitalize">
                                {kind}
                              </Badge>
                            ) : (
                              <Select
                                value={kind}
                                onValueChange={(v) => setLineKind(idx, v as SaleItemType)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="gas">{t("products.type.gas")}</SelectItem>
                                  <SelectItem value="cylinder">
                                    {t("products.type.cylinder")}
                                  </SelectItem>
                                  <SelectItem value="product">
                                    {t("products.type.product")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="w-28 min-w-[7rem]">
                            {isDelivered ? (
                              <div className="text-right font-medium tabular-nums">{it.quantity}</div>
                            ) : (
                              <Input
                                type="number"
                                min={1}
                                value={it.quantity}
                                onChange={(e) =>
                                  update(idx, { quantity: Number(e.target.value) })
                                }
                                className="w-full text-right font-medium tabular-nums"
                              />
                            )}
                          </TableCell>
                          <TableCell className="w-32 min-w-[7.5rem]">
                            {isDelivered ? (
                              <div className="text-right tabular-nums">{formatCurrency(it.price)}</div>
                            ) : (
                              <Input
                                type="number"
                                step="any"
                                value={it.price === 0 ? "" : it.price}
                                onChange={(e) =>
                                  update(idx, {
                                    price: e.target.value === "" ? 0 : Number(e.target.value),
                                  })
                                }
                                className="w-full text-right font-medium tabular-nums"
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(subtotal)}
                          </TableCell>
                          {!isDelivered && (
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeItem(idx)}
                                disabled={items.length <= 1}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span>{t("common.subtotal")}</span>
                <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>{t("common.total")}</span>
                <span className="font-mono">{formatCurrency(totals.total)}</span>
              </div>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="flex justify-end gap-2">
            {editing && (
              <Button
                type="button"
                variant="outline"
                className="border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => setReturnDialogOpen(true)}
                disabled={returnMutation.isPending}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                {t("returns.saveReturn")}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                navigate({
                  to: editing ? "/deliveries/$id" : "/deliveries",
                  params: editing ? { id: id! } : undefined,
                })
              }
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {editing ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Return Dialog for Delivery Challan */}
      {editing && (
        <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <RotateCcw className="h-5 w-5 text-primary" />
                <span>
                  {t("returns.saveReturn")} · {existing?.challanNo}
                </span>
              </DialogTitle>
              <div className="text-xs text-muted-foreground pt-1">
                {t("common.customer")}: <strong>{customerName || existing?.customerName}</strong> · SO:{" "}
                <strong>{selectedSo?.orderNo || existing?.salesOrderId || "—"}</strong>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>{t("sales.item")}</TableHead>
                      <TableHead className="text-right">{t("returns.deliveredQty")}</TableHead>
                      <TableHead className="text-right">{t("returns.alreadyReturned")}</TableHead>
                      <TableHead className="text-right">{t("returns.remainingQty")}</TableHead>
                      <TableHead className="w-28 text-right">{t("returns.returnQty")}</TableHead>
                      <TableHead className="w-32">{t("returns.condition")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      returnSummary?.items ||
                      items.map((it) => ({
                        productId: it.productId,
                        productName: it.productName,
                        itemType: it.itemType || "product",
                        deliveredQuantity: it.quantity,
                        previouslyReturnedQuantity: 0,
                        remainingReturnableQuantity: it.quantity,
                        price: it.price,
                        cylinderIds: it.cylinderIds,
                      }))
                    ).map((it) => {
                      const state = returnItemsState[it.productId] || {
                        returnQuantity: it.remainingReturnableQuantity,
                        condition: "empty",
                      };
                      const isCyl = it.itemType === "cylinder";
                      return (
                        <TableRow key={it.productId}>
                          <TableCell className="font-medium text-xs">
                            {it.productName}
                            <div className="text-[10px] text-muted-foreground capitalize">
                              {it.itemType}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            {it.deliveredQuantity}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                            {it.previouslyReturnedQuantity}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold text-primary">
                            {it.remainingReturnableQuantity}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              max={it.remainingReturnableQuantity}
                              value={state.returnQuantity}
                              onChange={(e) => {
                                const val = Math.max(
                                  0,
                                  Math.min(
                                    it.remainingReturnableQuantity,
                                    Number(e.target.value) || 0,
                                  ),
                                );
                                setReturnItemsState((prev) => ({
                                  ...prev,
                                  [it.productId]: {
                                    ...prev[it.productId],
                                    returnQuantity: val,
                                  },
                                }));
                              }}
                              className="h-8 text-right text-xs"
                            />
                          </TableCell>
                          <TableCell>
                            {isCyl ? (
                              <Select
                                value={state.condition || "empty"}
                                onValueChange={(val: "empty" | "full" | "damaged") => {
                                  setReturnItemsState((prev) => ({
                                    ...prev,
                                    [it.productId]: {
                                      ...prev[it.productId],
                                      condition: val,
                                    },
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="empty">{t("returns.condition.empty")}</SelectItem>
                                  <SelectItem value="full">{t("returns.condition.full")}</SelectItem>
                                  <SelectItem value="damaged">{t("returns.condition.damaged")}</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Optional reason / notes */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("returns.reason")}</Label>
                  <Input
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="e.g. Empty cylinders returned"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("common.notes")}</Label>
                  <Input
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="Optional notes"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setReturnDialogOpen(false)}
                disabled={returnMutation.isPending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => returnMutation.mutate()}
                disabled={returnMutation.isPending}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                {returnMutation.isPending ? t("returns.saving") : t("returns.saveReturn")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
