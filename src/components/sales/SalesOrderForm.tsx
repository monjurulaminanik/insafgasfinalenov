import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { customerService } from "@/services/customer.service";
import { productService } from "@/services/product.service";
import { productCategoryService } from "@/services/product-category.service";
import { salesService } from "@/services/sales.service";
import { computeTotals, genOrderNo, lineAmount, paymentStatus } from "@/utils/helpers";
import { formatCurrency } from "@/utils/formatters";
import { salesOrderSchema } from "@/utils/validators";
import type { Customer, LineItem, Product } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useT } from "@/i18n";
import { hrService } from "@/services/hr.service";
import { isDeliveryStaff } from "@/lib/hr-staff";
import { cylinderService } from "@/services/cylinder.service";
import { deliveryService } from "@/services/delivery.service";
import { inventoryService } from "@/services/inventory.service";
import { buildProductInventory } from "@/lib/cylinder-inventory";
import {
  defaultProductSaleItemType,
  isCylinderMovementOnly,
  isCylinderProduct,
  isCylinderSaleLine,
  isCylinderTrackedLine,
  lineFromProduct,
  saleItemType,
  type SaleItemType,
} from "@/lib/cylinder-product";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function emptyLine(): LineItem {
  return { productId: "", productName: "", quantity: 1, price: 0, taxRate: 0 };
}

function customerMatches(c: Customer, q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [c.name, c.phone, c.whatsapp, c.email, c.address]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(n));
}

interface EditableComboboxOption {
  value: string;
  label: string;
}

function EditableCombobox({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
  id,
  align = "start",
}: {
  value: string;
  onChange: (val: string) => void;
  options: Array<EditableComboboxOption | string>;
  placeholder?: string;
  className?: string;
  id?: string;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: EditableComboboxOption[] = [];
    for (const item of options) {
      const opt = typeof item === "string" ? { value: item, label: item } : item;
      const trimmedVal = opt.value.trim();
      if (!trimmedVal || seen.has(trimmedVal)) continue;
      seen.add(trimmedVal);
      list.push({ value: trimmedVal, label: opt.label.trim() || trimmedVal });
    }
    return list;
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!isTyping || !value.trim()) return normalizedOptions;
    const q = value.trim().toLowerCase();
    return normalizedOptions.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q),
    );
  }, [normalizedOptions, isTyping, value]);

  const hasExactMatch = useMemo(() => {
    const trimmed = value.trim().toLowerCase();
    return normalizedOptions.some((opt) => opt.value.toLowerCase() === trimmed);
  }, [normalizedOptions, value]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setIsTyping(false);
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn("relative flex w-full items-center", className)}>
          <Input
            id={id}
            value={value}
            placeholder={placeholder}
            className="pr-8"
            onChange={(e) => {
              onChange(e.target.value);
              setIsTyping(true);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onFocus={() => {
              setIsTyping(false);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                setIsTyping(false);
              } else if (e.key === "ArrowDown" && !open) {
                e.preventDefault();
                setOpen(true);
                setIsTyping(false);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle options"
            className="absolute right-0 top-0 bottom-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              setIsTyping(false);
              setOpen((prev) => !prev);
            }}
          >
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align={align}
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="z-50 min-w-[var(--radix-popover-anchor-width,10rem)] max-w-sm max-h-56 overflow-auto p-1 text-sm shadow-md"
      >
        <div className="space-y-0.5">
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
              !value && "bg-accent/60 font-medium",
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setOpen(false);
              setIsTyping(false);
            }}
          >
            <span>—</span>
            {!value && <Check className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />}
          </button>

          {value.trim() && !hasExactMatch && (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-sm border-b border-border/50 px-2 py-1.5 pb-2 text-left text-xs font-medium text-primary hover:bg-accent cursor-pointer"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setIsTyping(false);
              }}
            >
              <span className="truncate">Use &quot;{value.trim()}&quot;</span>
              <Check className="ml-2 h-3.5 w-3.5 shrink-0" />
            </button>
          )}

          {filteredOptions.map((opt) => {
            const isSelected = opt.value.toLowerCase() === value.trim().toLowerCase();
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
                  isSelected && "bg-accent font-medium",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setIsTyping(false);
                }}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />}
              </button>
            );
          })}

          {filteredOptions.length === 0 && !value.trim() && (
            <div className="px-2 py-2 text-center text-xs text-muted-foreground">
              No options
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SalesOrderForm({
  mode = "order",
  id,
}: {
  mode?: "order" | "quotation";
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
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: hrService.listEmployees,
  });
  const deliveryStaff = employees.filter(isDeliveryStaff);
  const { data: existing, isLoading } = useQuery({
    queryKey: ["sales", id],
    queryFn: () => salesService.get(id!),
    enabled: editing,
  });

  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: ["deliveries"],
    queryFn: deliveryService.list,
  });
  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: movements = [] } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });
  const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);

  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [address, setAddress] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [productOpenIdx, setProductOpenIdx] = useState<number | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [driverName, setDriverName] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLine()]);
  const [sellGasOnly, setSellGasOnly] = useState(false);
  const [hydrated, setHydrated] = useState(!editing);

  useEffect(() => {
    if (!existing) return;
    setCustomerId(existing.customerId);
    setCustomerName(existing.customerName || "");
    setContactNo(existing.customerPhone || "");
    setAddress(existing.customerAddress || "");
    setDriverName(existing.driverName ?? "");
    setReceiverName(existing.receiverName ?? "");
    setNotes(existing.notes ?? "");
    setSellGasOnly(Boolean(existing.sellGasOnly));
    setItems(existing.items?.length ? existing.items : [emptyLine()]);
    setHydrated(true);
  }, [existing]);

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

  const deliveryOptions = useMemo(() => {
    const list = deliveryStaff.map((e) => ({
      value: e.name,
      label: `${e.name} · ${e.designation}`,
    }));
    if (driverName && !deliveryStaff.some((e) => e.name === driverName)) {
      list.unshift({ value: driverName, label: driverName });
    }
    return list;
  }, [deliveryStaff, driverName]);

  const update = (idx: number, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const totals = computeTotals(
    items
      .filter(
        (it) =>
          it.productId &&
          (!sellGasOnly ||
            !isCylinderTrackedLine(
              it,
              products.find((p) => p.id === it.productId),
            )),
      )
      .map((it) => {
        const p = products.find((x) => x.id === it.productId);
        return isCylinderMovementOnly(it, p) ? { ...it, price: 0 } : it;
      }),
  );

  const rowAmount = (it: LineItem) => {
    const p = products.find((x) => x.id === it.productId);
    const billed = isCylinderMovementOnly(it, p) ? { ...it, price: 0 } : it;
    return lineAmount(billed);
  };

  const applyProduct = (idx: number, p: Product) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const kind: SaleItemType = defaultProductSaleItemType(p);
        return {
          ...lineFromProduct(p, kind),
          quantity: it.quantity || 1,
          category: it.category !== undefined ? it.category : p.category,
        };
      }),
    );
    setProductOpenIdx(null);
    setProductQuery("");
  };

  const setLineKind = (idx: number, kind: SaleItemType) => {
    const it = items[idx];
    const p = products.find((x) => x.id === it.productId);
    if (kind === "product") {
      update(idx, {
        itemType: "product",
        sellCylinder: false,
        price: it.price > 0 ? it.price : (p?.price ?? it.price),
      });
      return;
    }
    update(idx, {
      itemType: kind,
      category: it.category !== undefined ? it.category : p?.category,
    });
  };

  const mutation = useMutation({
    mutationFn: async (asQuote: boolean) => {
      const workingItems = items.filter(
        (it) => it.productId && it.productName && Number(it.quantity) > 0,
      );
      if (workingItems.length === 0) throw new Error(t("common.noItems"));

      const name = customerName.trim();
      const parsed = salesOrderSchema.safeParse({
        customerId: customerId || undefined,
        customerName: name,
        notes,
        items: workingItems,
        driverName: driverName.trim() || undefined,
        receiverName: receiverName || undefined,
      });
      if (!parsed.success) throw new Error(parsed.error.errors[0]?.message || "Invalid form");

      if (!asQuote) {
        for (const it of workingItems) {
          const row = stockRows.find((r) => r.productId === it.productId);
          const p = products.find((x) => x.id === it.productId);
          const baseAvail =
            sellGasOnly
              ? Math.max(0, p?.stock ?? 0)
              : (row?.available ?? p?.stock ?? 0);
          const heldByThisOrder = editing
            ? (existing?.items
                ?.filter((x) => x.productId === it.productId)
                .reduce((acc, x) => acc + (Number(x.quantity) || 0), 0) ?? 0)
            : 0;
          const avail = baseAvail + heldByThisOrder;
          if (it.quantity > avail) {
            throw new Error(
              t("sales.insufficientStock", { available: avail, requested: it.quantity }),
            );
          }
        }
      }

      let resolvedId = customerId;
      let resolvedName = name;
      const selected = customers.find((c) => c.id === resolvedId);
      if (selected) {
        resolvedName = selected.name;
      } else {
        const exact = customers.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
        if (exact) {
          resolvedId = exact.id;
          resolvedName = exact.name;
        } else {
          const created = await customerService.create({
            name,
            phone: contactNo.trim() || "N/A",
            address: address.trim() || "N/A",
            openingBalance: 0,
            openingBalanceType: "receivable",
            creditLimit: 0,
          });
          resolvedId = created.id;
          resolvedName = created.name;
        }
      }

      const nextItems = workingItems.map((it) => {
        const p = products.find((x) => x.id === it.productId);
        const movementOnly = isCylinderMovementOnly(it, p);
        return {
          ...it,
          category: (it.category !== undefined ? it.category : p?.category)?.trim() || undefined,
          taxRate: 0,
          price: movementOnly ? 0 : it.price,
          sellCylinder: isCylinderSaleLine(it, p),
        };
      });
      const nextTotals = computeTotals(
        nextItems.map((it) => {
          const p = products.find((x) => x.id === it.productId);
          return isCylinderMovementOnly(it, p) ? { ...it, price: 0 } : it;
        }),
      );

      const extra = {
        customerPhone: contactNo.trim() || undefined,
        customerAddress: address.trim() || undefined,
        sellGasOnly,
      };

      if (editing && existing) {
        if (existing.status === "cancelled") {
          throw new Error(t("sales.cannotEdit"));
        }
        return salesService.update(id!, {
          customerId: resolvedId,
          customerName: resolvedName,
          items: nextItems,
          subtotal: nextTotals.subtotal,
          tax: 0,
          total: nextTotals.total,
          notes,
          driverName: driverName.trim() || undefined,
          receiverName: receiverName.trim() || undefined,
          status: asQuote ? "draft" : existing.status === "draft" ? "confirmed" : existing.status,
          ...extra,
        });
      }

      return salesService.create({
        orderNo: genOrderNo(asQuote || mode === "quotation" ? "QT" : "SO"),
        customerId: resolvedId,
        customerName: resolvedName,
        date: new Date().toISOString(),
        items: nextItems,
        subtotal: nextTotals.subtotal,
        tax: 0,
        total: nextTotals.total,
        paid: 0,
        status: asQuote || mode === "quotation" ? "draft" : "confirmed",
        notes,
        driverName: driverName.trim() || undefined,
        receiverName: receiverName.trim() || undefined,
        ...extra,
      });
    },
    onSuccess: (order, asQuote) => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      if (!asQuote) {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["stockMovements"] });
        qc.invalidateQueries({ queryKey: ["cylinders"] });
        qc.invalidateQueries({ queryKey: ["deliveries"] });
      }
      toast.success(
        editing
          ? t("sales.updated")
          : asQuote || mode === "quotation"
            ? t("sales.quotationSaved")
            : t("sales.created"),
      );
      navigate({ to: "/sales/$id", params: { id: order.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (editing && !existing)
    return <div className="p-6 text-sm text-destructive">{t("sales.notFound")}</div>;
  if (editing && existing && existing.status === "cancelled") {
    return <div className="p-6 text-sm text-destructive">{t("sales.cannotEdit")}</div>;
  }
  if (!hydrated)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div>
      <PageHeader
        title={
          editing
            ? t("sales.edit")
            : mode === "quotation"
              ? t("sales.newQuotation")
              : t("sales.newOrder")
        }
        backTo={editing ? { to: "/sales/$id", params: { id: id! } } : "/sales"}
      />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="relative space-y-1.5">
              <Label>{t("common.customer")}</Label>
              <Input
                value={customerName}
                placeholder={t("sales.searchCustomer")}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setCustomerId("");
                  setCustomerOpen(true);
                }}
                onFocus={() => setCustomerOpen(true)}
                onBlur={() => window.setTimeout(() => setCustomerOpen(false), 180)}
              />
              {customerOpen && (filteredCustomers.length > 0 || customerName.trim().length > 1) && (
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
            <div className="space-y-1.5">
              <Label>{t("sales.receiver")}</Label>
              <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("deliveries.deliveryman")}</Label>
              <EditableCombobox
                value={driverName}
                onChange={setDriverName}
                options={deliveryOptions}
                placeholder="—"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sales.contactNo")}</Label>
              <Input value={contactNo} onChange={(e) => setContactNo(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
              <Label>{t("common.address")}</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label>{t("common.notes")}</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("common.optionalNotes")}
              />
            </div>
            <label className="md:col-span-2 xl:col-span-3 flex items-center gap-2 text-sm">
              <Checkbox checked={sellGasOnly} onCheckedChange={(v) => setSellGasOnly(v === true)} />
              <span>{t("sales.sellGasOnly")}</span>
              <span className="text-xs text-muted-foreground">{t("sales.sellGasOnlyHint")}</span>
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("sales.item")}</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setItems((prev) => [...prev, emptyLine()])}
              >
                {t("sales.addItem")}
              </Button>
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
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          {t("common.noItems")}
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((it, idx) => {
                      const p = products.find((x) => x.id === it.productId);
                      const kind = saleItemType(it, p);
                      const categoryNames = [
                        ...new Set(categoryRows.map((c) => c.name).filter(Boolean)),
                      ];
                      const lineCategory =
                        it.category !== undefined ? it.category : (p?.category || "");
                      if (lineCategory && !categoryNames.includes(lineCategory))
                        categoryNames.unshift(lineCategory);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="min-w-[11rem]">
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
                                      const baseAvail = row?.available ?? prod.stock ?? 0;
                                      const heldByThisOrder = editing
                                        ? (existing?.items
                                            ?.filter((x) => x.productId === prod.id)
                                            .reduce((acc, x) => acc + (Number(x.quantity) || 0), 0) ?? 0)
                                        : 0;
                                      const avail = baseAvail + heldByThisOrder;
                                      return (
                                        <li key={prod.id}>
                                          <button
                                            type="button"
                                            className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                                            onClick={() => applyProduct(idx, prod)}
                                          >
                                            <span className="font-medium">{prod.name}</span>
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
                          </TableCell>
                          <TableCell>
                            <EditableCombobox
                              value={lineCategory}
                              onChange={(v) =>
                                update(idx, { category: v })
                              }
                              options={categoryNames}
                              placeholder="—"
                            />
                          </TableCell>
                          <TableCell>
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
                          </TableCell>
                          <TableCell className="w-28 min-w-[7rem]">
                            <Input
                              type="number"
                              min={1}
                              value={it.quantity}
                              onChange={(e) => update(idx, { quantity: Number(e.target.value) })}
                              className="w-full text-right font-medium tabular-nums"
                            />
                            {(() => {
                              const row = stockRows.find((r) => r.productId === it.productId);
                              if (!p && !row) return null;
                              const baseAvail =
                                sellGasOnly
                                  ? Math.max(0, p?.stock ?? 0)
                                  : (row?.available ?? p?.stock ?? 0);
                              const heldByThisOrder = editing
                                ? (existing?.items
                                    ?.filter((x) => x.productId === it.productId)
                                    .reduce((acc, x) => acc + (Number(x.quantity) || 0), 0) ?? 0)
                                : 0;
                              const avail = baseAvail + heldByThisOrder;
                              if (it.quantity > avail) {
                                return (
                                  <p className="mt-1 text-[10px] text-destructive">
                                    {t("sales.stockWarn", { qty: avail })}
                                  </p>
                                );
                              }
                              return null;
                            })()}
                          </TableCell>
                          <TableCell className="w-32 min-w-[7.5rem]">
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
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(rowAmount(it))}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setItems(items.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span>{t("common.subtotal")}</span>
                <span>{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>{t("common.total")}</span>
                <span>{formatCurrency(totals.total)}</span>
              </div>
              {editing && existing && (
                <>
                  <div className="flex justify-between">
                    <span>{t("common.paid")}</span>
                    <span>{formatCurrency(existing.paid)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>{t("common.due")}</span>
                    <span>{formatCurrency(Math.max(0, totals.total - existing.paid))}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("sales.paymentStatus")}</span>
                    <span>{t(`sales.${paymentStatus(totals.total, existing.paid)}`)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {!editing && (
              <Button
                variant="outline"
                onClick={() => {
                  if (!mutation.isPending) mutation.mutate(true);
                }}
                disabled={mutation.isPending}
              >
                {t("sales.saveQuotation")}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                navigate({
                  to: editing ? "/sales/$id" : "/sales",
                  params: editing ? { id: id! } : undefined,
                })
              }
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!mutation.isPending) mutation.mutate(false);
              }}
              disabled={mutation.isPending}
            >
              {editing ? t("common.save") : t("sales.completeOrder")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
