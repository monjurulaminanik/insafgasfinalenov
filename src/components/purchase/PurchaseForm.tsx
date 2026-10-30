import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2, Plus, Check, ChevronDown } from "lucide-react";
import { supplierService } from "@/services/supplier.service";
import { productService } from "@/services/product.service";
import { purchaseService } from "@/services/purchase.service";
import { inventoryService } from "@/services/inventory.service";
import { computeTotals, genOrderNo, lineAmount, paymentStatus } from "@/utils/helpers";
import { formatCurrency } from "@/utils/formatters";
import { purchaseOrderSchema } from "@/utils/validators";
import type { LineItem, Product } from "@/types";
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
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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

function cleanLeadingZeros(val: string): string {
  if (val === "" || val === null || val === undefined) return "";
  const s = String(val).trim();
  if (s === "") return "";
  if (/^00+\./.test(s)) return s.replace(/^0+/, "0");
  if (/^0\d/.test(s)) return s.replace(/^0+(?=\d)/, "");
  return s;
}

function CostInput({
  value,
  onChange,
  className,
  id,
}: {
  value: number;
  onChange: (val: number) => void;
  className?: string;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (inputRef.current && !isFocusedRef.current) {
      const currentVal = inputRef.current.value;
      if (currentVal === "" && (value === 0 || value === undefined)) {
        // preserve user's empty input
      } else if (Number(currentVal) !== value) {
        inputRef.current.value = value != null ? String(value) : "";
      }
    }
  }, [value]);

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const raw = input.value;
    const cleaned = cleanLeadingZeros(raw);
    if (raw !== cleaned) {
      input.value = cleaned;
    }
    const num = cleaned === "" ? 0 : Number(cleaned);
    onChange(isNaN(num) ? 0 : num);
  };

  return (
    <Input
      ref={inputRef}
      id={id}
      type="number"
      className={className}
      min={0}
      step="any"
      defaultValue={value != null ? String(value) : ""}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={() => {
        isFocusedRef.current = false;
      }}
      onInput={handleInput}
    />
  );
}

function getProductType(p: { productType?: string; category?: string; uom?: string }): "gas" | "cylinder" | "product" {
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "cyl") return "cylinder";
  if (uom === "pcs") return "product";
  if (p.productType === "gas" || p.productType === "cylinder" || p.productType === "product") {
    return p.productType;
  }
  if (uom === "kg" || uom === "ltr") return "gas";
  if (p.category === "LPG" || p.category === "Industrial" || p.category === "Medical") {
    return "cylinder";
  }
  return "gas";
}

interface PurchaseItemOption {
  id: string;
  name: string;
  productType: "gas" | "cylinder" | "product";
  cost: number;
  stock: number;
}

export function PurchaseForm({ id }: { id?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = Boolean(id);
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
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
  const { data: existing, isLoading } = useQuery({
    queryKey: ["purchases", id],
    queryFn: () => purchaseService.get(id!),
    enabled: editing,
  });

  const availableProducts = useMemo<PurchaseItemOption[]>(() => {
    const list: PurchaseItemOption[] = [];
    const seen = new Set<string>();

    const getStock = (
      productId: string,
      productName: string,
      type: "gas" | "cylinder" | "product",
      fallbackStock = 0,
    ): number => {
      const normName = productName.trim().toLowerCase();
      if (type === "gas") {
        const inv =
          gasInventory.find((g) => g.productId === productId || g.id === productId) ||
          gasInventory.find((g) => g.productName.trim().toLowerCase() === normName);
        return inv ? (inv.onHand ?? 0) : fallbackStock;
      }
      if (type === "cylinder") {
        const inv =
          cylinderInventory.find((c) => c.productId === productId || c.id === productId) ||
          cylinderInventory.find((c) => c.productName.trim().toLowerCase() === normName);
        return inv ? (inv.onHand ?? 0) : fallbackStock;
      }
      if (type === "product") {
        const inv =
          productInventory.find((p) => p.productId === productId || p.id === productId) ||
          productInventory.find((p) => p.productName.trim().toLowerCase() === normName);
        return inv ? (inv.onHand ?? 0) : fallbackStock;
      }
      return fallbackStock;
    };

    for (const p of products) {
      const type = getProductType(p);
      list.push({
        id: p.id,
        name: p.name,
        productType: type,
        cost: p.cost ?? p.price,
        stock: getStock(p.id, p.name, type, p.stock ?? 0),
      });
      seen.add(p.id);
    }

    for (const c of cylinderInventory) {
      if (!c.productId || seen.has(c.productId)) continue;
      list.push({
        id: c.productId,
        name: c.productName,
        productType: "cylinder",
        cost: c.costPrice ?? c.unitPrice ?? 0,
        stock: c.onHand ?? 0,
      });
      seen.add(c.productId);
    }

    for (const p of productInventory) {
      if (!p.productId || seen.has(p.productId)) continue;
      list.push({
        id: p.productId,
        name: p.productName,
        productType: "product",
        cost: p.costPrice ?? p.unitPrice ?? 0,
        stock: p.onHand ?? 0,
      });
      seen.add(p.productId);
    }

    for (const g of gasInventory) {
      if (!g.productId || seen.has(g.productId)) continue;
      list.push({
        id: g.productId,
        name: g.productName,
        productType: "gas",
        cost: g.costPrice ?? g.unitPrice ?? 0,
        stock: g.onHand ?? 0,
      });
      seen.add(g.productId);
    }

    if (existing?.items) {
      for (const it of existing.items) {
        if (it.productId && !seen.has(it.productId)) {
          const itemType = it.itemType || "gas";
          list.push({
            id: it.productId,
            name: it.productName,
            productType: itemType,
            cost: it.price,
            stock: getStock(it.productId, it.productName, itemType, 0),
          });
          seen.add(it.productId);
        }
      }
    }

    return list;
  }, [products, gasInventory, cylinderInventory, productInventory, existing]);

  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [hydrated, setHydrated] = useState(!editing);

  const supplierOptions = useMemo(() => {
    return suppliers.map((s) => ({
      value: s.name,
      label: s.name,
    }));
  }, [suppliers]);

  const onSupplierChange = (val: string) => {
    setSupplierName(val);
    const matched = suppliers.find(
      (s) => s.name.trim().toLowerCase() === val.trim().toLowerCase(),
    );
    if (matched) {
      setSupplierId(matched.id);
    } else {
      setSupplierId("");
    }
  };

  useEffect(() => {
    if (!existing) {
      if (availableProducts.length > 0 && items.length === 0) {
        const p = availableProducts[0];
        setItems([
          {
            productId: p.id,
            productName: p.name,
            itemType: p.productType,
            quantity: 1,
            price: p.cost,
            taxRate: 0,
          },
        ]);
      }
      return;
    }
    setSupplierId(existing.supplierId || "");
    setSupplierName(
      existing.supplierName ||
        suppliers.find((s) => s.id === existing.supplierId)?.name ||
        "",
    );
    setNotes(existing.notes ?? "");
    setItems(
      existing.items.map((it) => {
        const p = availableProducts.find((x) => x.id === it.productId);
        return {
          ...it,
          itemType: it.itemType || p?.productType || "gas",
        };
      }),
    );
    setHydrated(true);
  }, [existing, availableProducts, suppliers]);

  const addItem = () => {
    const p = availableProducts[0];
    if (!p) return;
    setItems((prev) => [
      ...prev,
      {
        productId: p.id,
        productName: p.name,
        itemType: p.productType,
        quantity: 1,
        price: p.cost,
        taxRate: 0,
      },
    ]);
  };

  const update = (idx: number, patch: Partial<LineItem>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const setLineType = (idx: number, type: "gas" | "cylinder" | "product") => {
    const matchingProducts = availableProducts.filter((p) => p.productType === type);
    const current = availableProducts.find((p) => p.id === items[idx]?.productId);
    if (current && current.productType === type) {
      update(idx, { itemType: type });
      return;
    }
    const nextProduct = matchingProducts[0];
    if (nextProduct) {
      update(idx, {
        itemType: type,
        productId: nextProduct.id,
        productName: nextProduct.name,
        price: nextProduct.cost,
      });
    } else {
      update(idx, { itemType: type, productId: "", productName: "", price: 0 });
    }
  };

  const onSelectProduct = (idx: number, productId: string) => {
    const p = availableProducts.find((x) => x.id === productId);
    if (!p) return;
    update(idx, {
      productId: p.id,
      productName: p.name,
      itemType: p.productType,
      price: p.cost,
    });
  };

  const totals = computeTotals(items);

  const mutation = useMutation({
    mutationFn: async () => {
      const sName = supplierName.trim();
      if (!sName) throw new Error("Select a supplier");
      if (items.length === 0) throw new Error(t("common.noItems"));

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.productId || !it.productName) {
          throw new Error(`Item ${i + 1}: Please select a product`);
        }
        if (!it.itemType) {
          throw new Error(`Item ${i + 1}: Please select a type`);
        }
        const prod = availableProducts.find((p) => p.id === it.productId);
        if (prod && prod.productType !== it.itemType) {
          throw new Error(`Item ${i + 1}: Product does not belong to selected type`);
        }
        if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
          throw new Error(`Item ${i + 1}: Quantity must be greater than 0`);
        }
        if (!Number.isFinite(it.price) || it.price < 0) {
          throw new Error(`Item ${i + 1}: Cost cannot be negative`);
        }
      }

      const matchedSupplier = suppliers.find(
        (s) =>
          s.name.trim().toLowerCase() === sName.toLowerCase() ||
          (supplierId && s.id === supplierId),
      );

      const finalSupplierId = matchedSupplier ? matchedSupplier.id : (supplierId || sName);
      const finalSupplierName = matchedSupplier ? matchedSupplier.name : sName;

      const parsed = purchaseOrderSchema.safeParse({
        supplierId: finalSupplierId,
        notes,
        items,
      });
      if (!parsed.success) throw new Error(parsed.error.errors[0]?.message || "Invalid form");

      if (editing && existing) {
        if (existing.status === "cancelled") {
          throw new Error(t("purchases.cannotEdit"));
        }
        if (totals.total + 0.009 < (existing.paid || 0)) {
          throw new Error(t("purchases.totalBelowPaid"));
        }
        return purchaseService.update(id!, {
          supplierId: finalSupplierId,
          supplierName: finalSupplierName,
          items: items.map((it) => ({ ...it, taxRate: 0 })),
          subtotal: totals.subtotal,
          tax: 0,
          total: totals.total,
          notes,
        });
      }

      return purchaseService.create({
        orderNo: genOrderNo("PO"),
        supplierId: finalSupplierId,
        supplierName: finalSupplierName,
        date: new Date().toISOString(),
        items: items.map((it) => ({ ...it, taxRate: 0 })),
        subtotal: totals.subtotal,
        tax: 0,
        total: totals.total,
        paid: 0,
        status: "ordered",
        notes,
      });
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["purchases", po.id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      toast.success(editing ? t("purchases.updated") : t("purchases.created"));
      navigate({ to: "/purchases/$id", params: { id: po.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (editing && !existing)
    return <div className="p-6 text-sm text-destructive">{t("purchases.notFound")}</div>;
  if (editing && existing && existing.status === "cancelled") {
    return <div className="p-6 text-sm text-destructive">{t("purchases.cannotEdit")}</div>;
  }
  if (!hydrated)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div>
      <PageHeader
        title={editing ? t("purchases.editTitle") : t("purchases.newTitle")}
        backTo={editing ? { to: "/purchases/$id", params: { id: id! } } : "/purchases"}
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="purchase-supplier">{t("common.supplier")}</Label>
              <EditableCombobox
                id="purchase-supplier"
                value={supplierName}
                onChange={onSupplierChange}
                options={supplierOptions}
                placeholder={t("common.select")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("sales.item")}</h3>
              <Button type="button" size="sm" variant="outline" onClick={addItem}>
                <Plus className="mr-1 h-3 w-3" /> {t("common.addItem")}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.product")}</TableHead>
                    <TableHead className="w-36">{t("common.type")}</TableHead>
                    <TableHead className="w-24 text-right">{t("common.quantity")}</TableHead>
                    <TableHead className="w-32 text-right">{t("purchases.cost")}</TableHead>
                    <TableHead className="w-32 text-right">{t("common.lineTotal")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {t("common.noItems")}
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map((it, idx) => {
                    const selectedProduct = availableProducts.find((x) => x.id === it.productId);
                    const rowType =
                      it.itemType || selectedProduct?.productType || "gas";
                    const filteredProducts = availableProducts.filter(
                      (p) => p.productType === rowType,
                    );

                    return (
                      <TableRow key={idx}>
                        <TableCell className="min-w-[12rem]">
                          <Select
                            value={it.productId}
                            onValueChange={(v) => onSelectProduct(idx, v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("common.select")}>
                                {selectedProduct ? selectedProduct.name : it.productName || undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {filteredProducts.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  <span className="inline-flex items-center gap-1.5">
                                    <span>{p.name}</span>
                                    <span className="text-xs text-muted-foreground font-normal">
                                      — Stock: {p.stock}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="w-36">
                          <Select
                            value={rowType}
                            onValueChange={(v) =>
                              setLineType(idx, v as "gas" | "cylinder" | "product")
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gas">Gas</SelectItem>
                              <SelectItem value="cylinder">Cylinder</SelectItem>
                              <SelectItem value="product">Product</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="text-right"
                            min={1}
                            value={it.quantity}
                            onChange={(e) =>
                              update(idx, { quantity: Number(e.target.value) })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <CostInput
                            className="text-right"
                            value={it.price}
                            onChange={(price) => update(idx, { price })}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(lineAmount(it))}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
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
            <div className="mt-3 flex justify-end text-sm">
              <div className="w-56 space-y-1">
                <div className="flex justify-between">
                  <span>{t("common.subtotal")}</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-semibold">
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
                      <span>
                        {paymentStatus(totals.total, existing.paid) === "unpaid"
                          ? t("purchases.unpaid")
                          : t(`sales.${paymentStatus(totals.total, existing.paid)}`)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/purchases" })}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {editing ? t("common.save") : t("purchases.create")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
